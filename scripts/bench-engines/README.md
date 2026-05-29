# Engine bench

Head-to-head wall-clock comparison of the Fact Graph execution engines
available in this repo:

| key | engine |
| --- | --- |
| `vanilla-sjs` | IRS Direct File Scala.js bundle, both monkey-patches disabled |
| `patched-sjs` | Scala.js bundle + `overrideDefault` correctness fix + `Fact.get` JS-side memoization |
| `wasm` | `factgraph-rs` Rust→WASM (current default) |

A future `jvm` variant will run the upstream Scala engine on the JVM; see
[Status](#status) below.

## Running

```sh
# Default: snap-fy2026 + snap-complete × {1, 100, 1000} × {vanilla-sjs, patched-sjs, wasm}
npx tsx scripts/bench-engines/run.ts

# Faster smoke
npx tsx scripts/bench-engines/run.ts --counts=1,10 --rulesets=snap-fy2026

# Pick a specific test fixture as the input shape
npx tsx scripts/bench-engines/run.ts --case-index=10 --rulesets=snap-complete
```

Each cell runs in its own Node subprocess. The `FACTGRAPH_DISABLE_PATCHES`
env var (read once at executor module load) selects vanilla vs. patched
Scala.js. The wasm engine is a different module entry; not affected by
the toggle. Subprocess isolation means JIT state and patch toggles don't
leak between engines.

Results land in `results/<iso-timestamp>.{md,csv}`.

## Which test fixture matters

snap-complete's `tests.json` has 11 cases ranging from 1 to 5 members.
The patches and the wasm speedup both target `/members/*/` collection
lookups, so a 1-member case under-represents the perf gap. Defaults:

| ruleset | default case-index | description |
| --- | --- | --- |
| `snap-fy2026` | 0 | single applicant, modest income |
| `snap-complete` | **10** | 5-member household, multiple income sources, elderly + disabled members |

Override with `--case-index=N` (applies to every ruleset in the run).

## Status

- ✅ Three-way JS/WASM comparison (vanilla-sjs, patched-sjs, wasm)
- ⏳ Add internal timings breakdown (graph init / scalar inputs /
  collections / read) on the wasm side — already captured for Scala.js
  via `timings` export
- ⏳ Add a third workload from an IRS Direct File ruleset (e.g. EITC) so
  the bench isn't SNAP-only
- ⏳ Add a JVM engine variant (subprocess wrapper around a small Scala
  harness on top of IRS-Public/fact-graph)

## Latest numbers

See the most recent `.md` file in `results/`. The headline so far on an
M-series Mac, `snap-complete` case 10 (5-member household), 100 executes:

| engine | mean/execute | vs. wasm |
| --- | --- | --- |
| vanilla-sjs | ~1,270 ms | 131× slower |
| patched-sjs | ~417 ms | 43× slower |
| wasm | ~9.7 ms | 1× |
