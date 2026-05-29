# Engine bench

Head-to-head wall-clock comparison of the Fact Graph execution engines
available in this repo:

| key | engine |
| --- | --- |
| `vanilla-sjs` | IRS Direct File Scala.js bundle, both monkey-patches disabled |
| `patched-sjs` | Scala.js bundle + `overrideDefault` correctness fix + `Fact.get` JS-side memoization |
| `wasm` | `factgraph-rs` Rust→WASM (current default) |
| `jvm` | `IRS-Public/fact-graph` 3.1.0-SNAPSHOT built and run on the JVM (the reference engine with no JS bridge) |

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

Override with `--case-index=N` (applies to every ruleset in the run).

## Status

- ✅ Three-way JS/WASM comparison (vanilla-sjs, patched-sjs, wasm)
- ✅ JVM engine variant (skipped on snap-complete; see above)
- ⏳ Add internal timings breakdown (graph init / scalar inputs /
  collections / read) on the wasm side — already captured for Scala.js
  via `timings` export
- ⏳ Add a third workload from an IRS Direct File ruleset (e.g. EITC) so
  the bench isn't SNAP-only

## Latest numbers

See the most recent `.md` file in `results/` for the full table. Headlines
on an M-series Mac, 100 executes:

### snap-complete, case 10 (5-member household)

| engine | mean/execute | vs. wasm |
| --- | --- | --- |
| vanilla-sjs | ~1,250 ms | 129× slower |
| patched-sjs | ~451 ms | 47× slower |
| wasm | ~9.7 ms | 1× |
| jvm | _(skipped — see above)_ | — |

### snap-fy2026, case 0 (single applicant)

| engine | mean/execute | vs. wasm |
| --- | --- | --- |
| vanilla-sjs | ~3.06 ms | 8.8× slower |
| patched-sjs | ~3.20 ms | 9.2× slower |
| wasm | ~0.35 ms | 1× |
| jvm | ~0.44 ms | 1.3× slower |

The JVM ↔ Scala.js gap (3.06 ms → 0.44 ms, ~7×) is purely the Scala.js↔JS
bridge cost: same engine source, same dictionary, same operators. WASM
sits within ~30% of the JVM number, which is the cleanest engine-vs-engine
comparison the bench exposes.
