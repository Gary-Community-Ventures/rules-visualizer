# factgraph-core — contributor notes

This package is shared between:

- `packages/factgraph-server` — the visualizer (developer-facing)
- `packages/factgraph-api` — the partner-facing adapter API _(in progress)_

Any change here ships to **both** at once. Treat the public surface in
`src/index.ts` as a real library API; consumers depend on it the way they'd
depend on a published npm package.

## Before changing anything in this package

1. **Confirm the change is needed by both consumers** — or by core itself.
   If only one consumer needs new behavior, prefer adding the wrapper in that
   consumer instead of expanding the shared surface.
2. **Run the visualizer smoke test** (`packages/factgraph-server/tests/`) —
   it pins down a fixed input → fixed output for a known ruleset. Catches
   accidental behavior drift in `executor.ts`.
3. **Avoid widening the public exports without intent.** Each entry in
   `src/index.ts` is a contract. Re-exporting "just in case" creates drift
   risk later.

## What's intentionally NOT in here

- **The Express server, routes, WebSocket layer** — those are visualizer
  concerns and live in `factgraph-server`.
- **`load-env.ts`** — pure side-effect module with import-ordering
  requirements; lives co-located with each server that needs it.
- **File watcher** (`watcher.ts`) — coupled to the visualizer's WebSocket
  broadcast; lives in `factgraph-server`. Can be lifted here later if the
  API also wants hot reload.

## Execution engines

This package ships **two** Fact Graph runtimes side-by-side. Only one is
wired up at a time — `src/index.ts` re-exports `executeFactGraph` from
whichever executor module is active. The other stays on disk as a
fallback. Both pass the same visualizer smoke test
(`packages/factgraph-server/tests/visualizer-smoke.test.ts`) for the same
input fixtures.

### Default: `factgraph-rs` WASM (`executor-rs.ts` + `vendor/factgraph-rs/`)

A Rust tree-walking interpreter for the Fact Graph XML schema, built to
WASM via `wasm-bindgen`. Source lives in the sibling
[`factgraph-rs`](https://github.com/Gary-Community-Ventures/factgraph-rs)
repo. ~250× faster than the Scala.js bundle on `snap-complete`; ~25×
faster on a 1k-scenario simulation worker sweep.

`vendor/factgraph-rs/` holds the compiled artifact (`.wasm`, JS glue,
TypeScript declarations). **Committed to this repo** so checkouts and
the Heroku deploy don't need a Rust toolchain. To re-vendor:

```sh
# from rules-visualizer/, with factgraph-rs cloned next door
cd ../factgraph-rs
./scripts/build-wasm.sh
# script copies pkg-node/* into ../rules-visualizer/packages/factgraph-core/vendor/factgraph-rs/
```

XML is loaded into the WASM module by path: `executor-rs.ts` reads
ruleset XML directly from `process.env.RULES_VISUALIZER_DATA_DIR`
(stashed by `loadFactGraphData` in `store.ts`). The handle is cached per
ruleset so repeated executes reuse the parsed graph.

### Fallback: Scala.js bundle (`executor.ts` + `vendor/factgraph-scala.cjs`)

The original IRS Direct File Scala.js fact-graph runtime. Kept available
in case the Rust engine diverges from upstream on a real ruleset.

**To switch:** in `src/index.ts`, change the executor re-export from
`./executor-rs.js` to `./executor.js`. No other call sites change —
both modules export the same `executeFactGraph` signature.

`executor.ts` includes two runtime monkey-patches against the bundle.
**Both must be re-applied (or removed if upstream has integrated them)
any time the bundle is re-vendored.**

#### 1. `DigestNodeWrapper.overrideDefaultOption` (correctness fix)

A copy-paste bug in the upstream bundle made `overrideDefault` evaluate
to the override *condition* instead of the override *default*. Patched at
the prototype level. Don't remove without confirming the upstream PR (#1
in the upstream tracker) is in the re-vendored bundle.

#### 2. `Fact.prototype.get` JS-side memoization (performance fix)

Layers a native JS `Map` in front of the engine's `Fact.get` lookups.
The engine's internal `Graph.resultCache` is correct but each lookup pays
~6μs of Scala.js↔JS boundary overhead, and a single execute on a complex
ruleset (snap-complete with 5 members) makes ~326k internal `Fact.get`
calls — mostly cache hits cascading through recursive expression
evaluation. The JS-side cache returns hits at ~50ns, cutting per-execute
time by ~5.8× and 1000-case simulation time by ~2.7×.

Caches all paths including `/?/` placeholders. These looked unsafe at
first ("same path, different value per caller context") but empirically
the engine evaluates the collection-wide value once and callers index
into the returned `MaybeVector`. Path alone is sufficient as a cache
key — verified deepStrictEqual against uncached baseline.

Safety: the wrapper short-circuits before the engine's override-bypass
check (~bundle line 30871). Safe within `executeFactGraph` because all
writes happen before any reads — but **do not** call `graph.set` after
`graph.getFact(...).get()` in any consumer code without also clearing
the cache; you'll get stale values. The cache is per-graph (WeakMap), so
it dies with the graph instance.

Diagnostic: set `FACTGRAPH_TRACE_GETS=1` to count engine calls per path;
read counts via `factCallCounts` and reset with `resetFactCallCounts()`.

#### Upstreaming the Scala.js patches

Both patches arguably belong upstream:
- **#1** is a correctness bug they'd want regardless.
- **#2** is JS-specific (the JVM build of factgraph wouldn't pay the
  boundary overhead this caches around). Could be contributed as a
  Scala.js-target optimization, but upstream may prefer to recommend the
  JVM build for performance-sensitive callers — Direct File itself runs
  one user at a time, not population sweeps.

With `factgraph-rs` now the default, the urgency on upstreaming has
dropped: the patches only matter when running the fallback path.
