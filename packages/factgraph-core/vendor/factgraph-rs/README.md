# factgraph-rs

A Rust reimplementation of the [IRS-Public/fact-graph](https://github.com/IRS-Public/fact-graph) rules engine — the engine that powers the IRS Direct File application. Parses `<FactDictionaryModule>` XML, walks the expression tree, returns results. Ships as a CLI, a Rust library, and a WebAssembly module.

## Status, honestly

This was built as an experiment over a couple of days — a "could we just rewrite this in Rust" proof of concept that turned out to actually work. It hasn't been battle-tested. **What that means in practice:**

- **Tested against:** the rules-visualizer test corpus (37 cases across snap-fy2026 and snap-complete), a 1,000-case auto-generated simulation, and end-to-end against the rules-visualizer UI's full simulation worker pipeline. **Verified bit-equivalent to the JS engine** on every one of those — 0 output divergences on 1,000-of-1,000 cases.
- **Not tested against:** production traffic, every operator the engine supports under every combination of inputs, untrusted XML, very large rulesets beyond what's in our corpus, multi-module rulesets beyond simple concatenation, the Trace/Explain feature, or any kind of security audit.
- **You probably want to know:** there's a `__debugBuildGraph` stub that's not implemented — anything that calls `Fact.explain()` won't work yet. Today() is wall-clock and non-deterministic.

If you're building something where one of those untested cases matters, this isn't the engine you want yet. If you're curious how fast the engine could run when it isn't paying the Scala.js↔JS bridge cost, here's an answer.

## Why

The reference engine ships as a Scala application that gets compiled to Scala.js for non-JVM consumers. The Scala.js↔JS boundary dominates execution time for any consumer that runs the engine many times against the same ruleset (simulations, batch evaluation, ad-hoc data exploration). A single execute on a 5-member SNAP-complete scenario makes ~326k internal `Fact.get` calls, each paying ~6 μs of bridge cost. Reimplementing the engine in a non-GC language that compiles directly to wasm32 trades hours of compiler engineering for an estimated 50–500× speedup on representative workloads.

Numbers we measured (release build, M-series Mac):

| Workload | factgraph-rs | reference Scala.js | speedup |
| --- | --- | --- | --- |
| snap-fy2026, 1 execute | 0.2 ms | ~ish (small ruleset) | — |
| snap-complete, 1 execute (5-member household) | 1.8 ms | ~350 ms (patched) / ~2,015 ms (upstream) | ~190× / ~1,100× |
| snap-fy2026, 1,000-case simulation | 108 ms via worker pool | 2,684 ms recorded baseline | **~25×** |

The 25× number is the apples-to-apples one: the recorded 1,000-case JS run is in `rules-visualizer/data/factgraph/snap-fy2026/simulations/bench-fy2026-1k-1779832123/summary.json`, and we re-ran the same 1,000 cases through the WASM backend in the same visualizer's worker pool.

## Quick start

### CLI

```sh
cargo build --release
echo '{"inputs": {"/grossEarnedIncome": 1500}, "entities": {"/members": [{"/members/*/age": 30}]}}' \
  | ./target/release/factgraph-run path/to/eligibility.xml /dev/stdin
```

Stdout is the outputs object: `{ "/snap": 223.9, "/householdSize": 1, ... }`.

Use `--pretty` for human-readable JSON.

### Rust library

```toml
[dependencies]
factgraph-core = { path = "path/to/factgraph-rs/crates/core" }
```

```rust
let xml = std::fs::read_to_string("eligibility.xml")?;
let dict = factgraph_core::parse_module(&xml)?;
let request = factgraph_core::ExecuteRequest {
    inputs: /* ... */,
    entities: /* ... */,
    read_paths: vec![],
};
let outputs = factgraph_core::execute(&dict, &request)?;
println!("{}", serde_json::to_string_pretty(&outputs)?);
```

### WebAssembly (Node.js)

```js
const { FactGraph } = require('./pkg-node/factgraph_wasm.js')
const fs = require('node:fs')

const xml = fs.readFileSync('eligibility.xml', 'utf-8')
const handle = new FactGraph(xml)              // parse once
const out = handle.execute({                   // execute many times
  inputs: { '/grossEarnedIncome': 1500 },
  entities: { '/members': [{ '/members/*/age': 30 }] },
})
console.log(out['/snap'])
```

There's also a one-shot `executeFactGraph(xml, request)` for ad-hoc use.

### WebAssembly (browser / bundler)

```js
import init, { FactGraph } from './pkg/factgraph_wasm.js'
await init()
const handle = new FactGraph(xml)
```

## Building

```sh
cargo build --release              # CLI + library
cargo test --release               # all tests, all crates
cargo test --test all_corpora --release -- --nocapture
                                   # parity sweep across rules-visualizer corpus
cargo bench -p factgraph-core      # criterion bench against the 1k workload
```

### WASM build

```sh
./scripts/build-wasm.sh            # emits ./pkg (browser) and ./pkg-node
```

The script handles the toolchain setup. It needs `rustup`; Homebrew's `rust` formula doesn't ship the wasm32 target. The script prints a one-time setup recipe if `rustup` isn't on PATH.

## Project layout

```
factgraph-rs/
├── crates/
│   ├── core/                  parser, AST, value types, interpreter
│   ├── cli/                   factgraph-run binary
│   ├── wasm/                  wasm-bindgen wrapper
│   └── tests-corpus/          integration tests against rules-visualizer data
├── scripts/build-wasm.sh
└── README.md
```

The `tests-corpus` crate currently expects to find the rules-visualizer at `../rules-visualizer/` on disk. Outside that monorepo layout the integration tests just skip.

## Operators supported

`Add`, `Subtract`, `Multiply`, `Divide`, `GreaterOf`, `LesserOf`, `Round`, `RoundToInt`, `Floor`, `TruncateCents`, `All`, `Any`, `Not`, `Equal`, `NotEqual`, `GreaterThan`, `GreaterThanOrEqual`, `LessThan`, `LessThanOrEqual`, `True`, `False`, `IsComplete`, `Switch` (with `Case`/`When`/`Then`), `Dependency`, `Collection`, `CollectionItem`, `CollectionSize`, `CollectionSum`, `Filter`, `Count`, `Find`, `IndexOf`, `Day`, `Days`, `Today`, `LastDayOfMonth`, `AddPayrollMonths`, `Dollar`, `Int`, `Short`, `Byte`, `Rational`, `String`, `Enum`, `MultiEnum`.

Path features: `/X/*/Y` collection-field references, `/X/*` collection-item references (single or vector depending on scope), `../X` sibling refs, `^/X` scope-escape refs (for nested `<Filter>` bodies), `<CollectionItem collection="…">` alias-following.

## Compatibility scope

The interpreter was developed against the upstream commit at the time of writing (mid-2026); the operator semantics match what the rules-visualizer's vendored Scala.js bundle returns. We **don't** track upstream releases — if `fact-graph` adds a new operator or changes existing semantics, this repo won't notice until someone files an issue.

Known semantic deviations from upstream:

- `Today` reads `OffsetDateTime::now_utc()` at execute time, not a request-supplied clock. Deterministic snapshot testing requires passing the date as an explicit input.
- `Round` uses `MidpointAwayFromZero`; the upstream Scala engine uses `HALF_UP` on `Round` and `HALF_EVEN` for arithmetic-result rounding. These agree on positive amounts away from the .5 boundary, which covers the entire SNAP corpus.
- `__debugBuildGraph` is a stub. The Scala bundle's `Fact.explain()` builds a structured Explanation tree — not ported.

## Acknowledgements

This is a clean-room reimplementation of the [IRS-Public/fact-graph](https://github.com/IRS-Public/fact-graph) project, which is a public-domain (CC0) work of the United States Government. None of the engine's source is copied — only its on-the-wire XML format and observable semantics are mirrored. Many thanks to the IRS team for releasing the original under a public-domain dedication.

The research that informed the operator semantics for this rewrite was done by reading the upstream Scala source directly. A condensed reference is captured in the commit history under `research upstream Scala fact-graph semantics`.

## License

Dual-licensed under either:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or <https://www.apache.org/licenses/LICENSE-2.0>)
- MIT License ([LICENSE-MIT](LICENSE-MIT) or <https://opensource.org/licenses/MIT>)

at your option.
