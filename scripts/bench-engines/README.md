# Engine bench

Head-to-head wall-clock comparison of the Fact Graph execution engines
available in this repo:

| key | engine |
| --- | --- |
| `vanilla-sjs` | IRS Direct File Scala.js bundle, both monkey-patches disabled |
| `patched-sjs` | Scala.js bundle + `overrideDefault` correctness fix + `Fact.get` JS-side memoization |
| `wasm` | `factgraph-rs` Rust→WASM (current default) |
| `jvm` | `IRS-Public/fact-graph` 3.1.0-SNAPSHOT built and run on the JVM (the reference engine with no JS bridge) |
| `native` | `factgraph-rs` compiled to a native `factgraph-bench` binary in the sibling repo. The Rust engine with no WASM boundary — the floor for what this implementation can do. |

## Running

```sh
# Default: snap-fy2026 + snap-complete × {1, 100, 1000} × {vanilla-sjs, patched-sjs, wasm}
npx tsx scripts/bench-engines/run.ts

# Faster smoke
npx tsx scripts/bench-engines/run.ts --counts=1,10 --rulesets=snap-fy2026

# Pick a specific test fixture as the input shape
npx tsx scripts/bench-engines/run.ts --case-index=10 --rulesets=snap-complete
```

Each cell runs in its own subprocess. The `FACTGRAPH_DISABLE_PATCHES`
env var (read once at executor module load) selects vanilla vs. patched
Scala.js. The wasm engine is a different module entry; not affected by
the toggle. The jvm engine is a precompiled fat jar (see
[JVM setup](#jvm-setup)). Subprocess isolation means JIT state and patch
toggles don't leak between engines.

Results land in `results/<iso-timestamp>.{md,csv}`.

## JVM setup

The JVM engine needs a one-time build:

```sh
brew install openjdk@21 sbt scala-cli   # one-time, ~600MB
./scripts/bench-engines/jvm/build.sh    # clones IRS-Public/fact-graph,
                                        # publishes locally, builds fat jar
```

`build.sh` is idempotent — it skips the clone if `vendor/fact-graph-jvm/`
exists and skips the publishLocal if the artifact is already in
`~/.ivy2/local/`. The fat jar lands at
`scripts/bench-engines/jvm/harness.jar` (gitignored, ~28MB).

The JVM bench is skipped on `snap-complete` — the public
`IRS-Public/fact-graph` 3.1.0-SNAPSHOT can't resolve at least one
caret-prefixed scope-escape path used inside a `<Filter>` body in that
ruleset, while our vendored Scala.js bundle was built from a commit
that does support it.

## Which test fixture matters

snap-complete's `tests.json` has 11 cases ranging from 1 to 5 members.
The patches and the wasm speedup both target `/members/*/` collection
lookups, so a 1-member case under-represents the perf gap. Defaults:

| ruleset | default case-index | description |
| --- | --- | --- |
| `snap-fy2026` | 0 | single applicant, modest income |
| `snap-complete` | **10** | 5-member household, multiple income sources, elderly + disabled members |
| `direct-file-full` | 0 | 3,030-fact aggregate of the IRS Direct File tax dictionary (CC0). The largest workload here. JVM and Scala.js engines run it; the Rust engines skip it for a parser gap. See [data/factgraph/direct-file-full/README.md](../../data/factgraph/direct-file-full/README.md). |

Override with `--case-index=N` (applies to every ruleset in the run).

## Status

- ✅ Three-way JS/WASM comparison (vanilla-sjs, patched-sjs, wasm)
- ✅ JVM engine variant (skipped on snap-complete; see above)
- ⏳ Add internal timings breakdown (graph init / scalar inputs /
  collections / read) on the wasm side — already captured for Scala.js
  via `timings` export
- ⏳ Add a third workload from an IRS Direct File ruleset (e.g. EITC) so
  the bench isn't SNAP-only

## Native binary setup

Same shape as the JVM step. Builds a native `factgraph-bench` binary in the
sibling `factgraph-rs/` repo:

```sh
cd ../factgraph-rs
cargo build --release --bin factgraph-bench
# the orchestrator finds it at ../factgraph-rs/target/release/factgraph-bench
# (or set FACTGRAPH_BENCH_BIN=/abs/path to override)
```

## Latest numbers

See the most recent `.md` file in `results/` for the full table. Headlines
on an M-series Mac, 100 executes:

### snap-complete, case 10 (5-member household)

| engine | mean/execute | vs. native |
| --- | --- | --- |
| vanilla-sjs | ~1,260 ms | 229× slower |
| patched-sjs | ~419 ms | 76× slower |
| wasm | ~8.1 ms | 1.5× slower |
| native | ~5.5 ms | 1× |
| jvm | _(skipped — see above)_ | — |

### snap-fy2026, case 0 (single applicant)

| engine | mean/execute | vs. native |
| --- | --- | --- |
| vanilla-sjs | ~3.32 ms | 21.7× slower |
| patched-sjs | ~3.16 ms | 20.6× slower |
| jvm | ~0.445 ms | 2.9× slower |
| wasm | ~0.318 ms | 2.1× slower |
| native | ~0.153 ms | 1× |

What the gaps say:

- **Scala.js → JVM** (~7×, same engine source): pure Scala.js↔JS bridge cost.
- **Scala.js → WASM** (~10–155×): bridge cost plus the patched-vs-not-patched delta on snap-complete.
- **WASM → native** (~1.5–2.1×): both the wasm-bindgen serde boundary AND wasm32 codegen being slightly slower than native. Decomposed by the WASM-internal timings below.
- **Patched-sjs → JVM** is the cleanest "is the patched JS close to the engine's true ceiling?" comparison. JVM is still ~7× faster on snap-fy2026 — so even with the JS-side `Fact.get` cache we're paying a lot at the boundary, and a JVM-target deployment (or this Rust port) is the bigger lever.

## Compatibility — what each engine actually supports

The headline numbers above paper over a real finding: these engines aren't bug-different so much as **feature-different**. A given fact-graph XML may run on some engines and not others. The bench's `ENGINE_SKIPS` map captures known incompatibilities; the explanations:

### `^/X` scope-escape paths (used heavily by snap-complete; not in upstream)

The `^` prefix means "out of the current `<Filter>` scope, back to the host fact's iteration context" — e.g. `<Dependency path="^/memberId" />` inside `<Filter path="/caregiverRelationships">` from a host at `/members/*/X` means "the current outer-loop member's memberId".

Neither the upstream [`IRS-Public/fact-graph`](https://github.com/IRS-Public/fact-graph) Scala source (commit `3c9c2a8`, current head) NOR our vendored Scala.js bundle has native `^` handling. Three engines deal with it differently:

- **`patched-sjs`**: `executor.ts` builds a digest, NOT the XML loader path; the bundle's runtime path interpreter happens to silently tolerate the `^` token at digest-eval time. The result on cycles introduced by this is non-obvious — Scala.js's single-threaded lazy vals don't park, so the engine returns *something* (possibly wrong) rather than hanging.
- **`wasm` / `native`**: `factgraph-rs` implements `^` natively in its scope stack — the way the rule author probably intended it to work.
- **`jvm`**: The JVM Scala build can't run anything with `^` in the XML. Two layers of problem:
  1. `FactDictionary.fromXml` validates paths at freeze-time → throws *"cannot find fact at path '^'"*. The JVM harness (`jvm/Harness.scala:rewriteCaretPaths`) preprocesses these into absolute paths to clear this layer.
  2. Even with the rewrite, the absolute-path form changes the dependency-graph shape and exposes cycles that the JVM build's multi-thread-safe lazy vals (CountDownLatch-protected) park on, deadlocking the main thread. Scala.js doesn't hit this because its lazy vals are single-threaded. So `snap-complete` on JVM gets past freeze, then hangs in `Filter$.apply` during dictionary build.

Net effect: `snap-complete` runs on every engine except JVM. The harness's caret rewrite is kept (it's correct and necessary for any future ruleset with carets that doesn't ALSO have cycles), but the deeper fix would be either (a) restructuring the snap-complete ruleset to remove the cycle-inducing patterns, or (b) actually adding `^` to the upstream Scala engine's path resolver. Neither is in scope here.

### Summary table

| ruleset | vanilla-sjs | patched-sjs | wasm | jvm | native |
| --- | --- | --- | --- | --- | --- |
| snap-fy2026 | ✓ | ✓ | ✓ | ✓ | ✓ |
| snap-complete | ✓ | ✓ | ✓ | ⛔ (cycle in deps) | ✓ |
| direct-file-full | ✓ | ✓ | ✓ | ✓ | ✓ |

(Earlier versions of this doc claimed `direct-file-full` was native-only — that was a `factgraph-rs` parser/runtime gap, not a fundamental incompatibility. Three things had to land: rewrite `IndexOf` to match upstream's `(Collection, Index) → CollectionItem` semantics; bump the WASM linker stack from the default 1MB to 16MB so the deeper recursion doesn't trap; and enable the `time` crate's `wasm-bindgen` feature so `<Today/>` works on wasm32. All shipped in factgraph-rs.)


### WASM call decomposition

The WASM module reports the per-phase breakdown of each execute via
`FactGraph.lastExecuteTimings()`. The orchestrator surfaces it on the
wasm row of every table; representative numbers:

| ruleset | total wasm call | deserialize (JS→Rust) | engine | serialize (Rust→JS) |
| --- | --- | --- | --- | --- |
| snap-fy2026 | 0.30 ms | 0.02 ms (7%) | 0.22 ms (73%) | 0.06 ms (20%) |
| snap-complete | 8.21 ms | 0.26 ms (3%) | 7.54 ms (92%) | 0.42 ms (5%) |

What this says: **wasm-bindgen serde at the boundary is a small fraction
of the WASM cost**. The dominant gap vs. native is the engine itself —
wasm32 codegen is ~40% slower than native codegen for this interpreter
(no auto-vectorization, less aggressive PGO, etc.). On a bigger workload
that gap shrinks in relative terms because the serde boundary becomes
proportionally smaller.

### direct-file-full (IRS's own ruleset, 3,030 facts, 10 executes)

| engine | cold | mean | vs. native |
| --- | --- | --- | --- |
| vanilla-sjs | 607 ms | 21.0 ms | 6.8× slower |
| patched-sjs | 516 ms | 19.4 ms | 6.3× slower |
| jvm | 680 ms | 17.3 ms | 5.6× slower |
| wasm | 301 ms | 5.20 ms | 1.7× slower |
| native | 13 ms | **3.08 ms** | **1×** |

After tracking down the per-fact scaling issue, **native is the fastest
engine on direct-file-full — beating the JVM reference build 5.6×.**
WASM also beats JVM (3.3×). The fix was caching Incomplete-scalar
results in the interpreter's per-execute memoization (with a
cycle-taint guard for safety — only skip caching when an Incomplete
result actually consumed a cycle-break Incomplete during eval). Empty-
input runs on a 3,030-fact dictionary produce mostly-Incomplete results,
and not caching them was forcing N² re-evaluation through dependency
chains — direct-file-full native went from **96.2 ms → 3.08 ms (~31×)**.

Patched-sjs is faster than vanilla-sjs here (19.4 vs 21.0 ms) — Direct
File has repeated-lookup patterns the `Fact.get` cache helps with, just
not the `/members/*/...` shape SNAP uses.
