# direct-file-full — IRS Direct File tax dictionary (full aggregate)

The complete fact-graph XML for IRS Direct File's tax dictionary,
mechanically aggregated from
[IRS-Public/direct-file](https://github.com/IRS-Public/direct-file)'s
`backend/src/main/resources/tax/` directory (CC0 / public domain).

**3,030 facts**, ~2MB XML. About 6× snap-complete and 23× snap-fy2026 in
fact count.

## How this was assembled

`regenerate.sh` concatenates every `<Facts>…</Facts>` block from the
upstream tax/*.xml files into one `<FactDictionaryModule>`. Direct
File's own Java loader does effectively the same thing at startup; this
script just produces the static aggregate so the visualizer and the
bench can use it like any other ruleset.

## Engine compatibility

| engine | runs direct-file-full? |
| --- | --- |
| vanilla-sjs | ✓ |
| patched-sjs | ✓ |
| jvm | ✓ |
| wasm | ✗ (parse error) |
| native | ✗ (parse error) |

The two Rust engines fail in `factgraph-rs`'s parser with *"IndexOf
missing path"* — Direct File uses `<IndexOf><Collection>…</Collection><Index>…</Index></IndexOf>`,
a shape the current Rust parser doesn't handle (it only accepts the
`<IndexOf path="…"><Index>…</Index></IndexOf>` form used by our SNAP
rulesets). Adding the Collection-wrapped form to the Rust parser would
unlock both native and wasm here; that's a real (non-trivial) extension
on the AST + interpreter side, not in scope yet.

The JVM engine, since it's IRS's own reference implementation, naturally
runs IRS's own ruleset cleanly. So this is the workload that gives the
sharpest "reference engine vs. our forks" picture in the bench.

## tests.json

One placeholder case with empty inputs/entities. This is a bench
workload, not a behavior fixture; the engine has to walk the full graph
and compute (or surface Incomplete for) every reachable fact. Most
outputs will be Incomplete because the inputs are empty — the goal is
to exercise the engine, not assert correctness.

## License

CC0 1.0 Universal (public domain) — same as the upstream Direct File
project. The aggregator script and this README are MIT, matching the
rest of rules-visualizer.
