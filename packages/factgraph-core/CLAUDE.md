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

## Vendored bundle

`vendor/factgraph-scala.cjs` is the IRS Direct File Scala.js fact-graph
runtime. `executor.ts` includes two runtime monkey-patches against this
bundle — see the long comments in that file for details. **Both patches
must be re-applied (or removed if upstream has integrated them) any time
the bundle is re-vendored.**

### 1. `DigestNodeWrapper.overrideDefaultOption` (correctness fix)

A copy-paste bug in the upstream bundle made `overrideDefault` evaluate
to the override *condition* instead of the override *default*. Patched at
the prototype level. Don't remove without confirming the upstream PR (#1
in the upstream tracker) is in the re-vendored bundle.

### 2. `Fact.prototype.get` JS-side memoization (performance fix)

Layers a native JS `Map` in front of the engine's `Fact.get` lookups.
The engine's internal `Graph.resultCache` is correct but each lookup pays
~6μs of Scala.js↔JS boundary overhead, and a single execute on a complex
ruleset (snap-complete with 5 members) makes ~326k internal `Fact.get`
calls — mostly cache hits cascading through recursive expression
evaluation. The JS-side cache returns hits at ~50ns, cutting per-execute
time by ~5.8× and 1000-case simulation time by ~2.7×.

Skips paths containing `/?/` (context-relative placeholders where the
same path string yields different values per evaluation context). Those
fall through to the engine's original `.get`.

Safety: the wrapper short-circuits before the engine's override-bypass
check (~bundle line 30871). Safe within `executeFactGraph` because all
writes happen before any reads — but **do not** call `graph.set` after
`graph.getFact(...).get()` in any consumer code without also clearing
the cache; you'll get stale values. The cache is per-graph (WeakMap), so
it dies with the graph instance.

Diagnostic: set `FACTGRAPH_TRACE_GETS=1` to count engine calls per path;
read counts via `factCallCounts` and reset with `resetFactCallCounts()`.

### Upstreaming

Both patches arguably belong upstream:
- **#1** is a correctness bug they'd want regardless.
- **#2** is JS-specific (the JVM build of factgraph wouldn't pay the
  boundary overhead this caches around). Could be contributed as a
  Scala.js-target optimization, but upstream may prefer to recommend the
  JVM build for performance-sensitive callers — Direct File itself runs
  one user at a time, not population sweeps.
