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

All five bench engines now run direct-file-full. Three `factgraph-rs`
changes had to land to get there:

1. **Fix `IndexOf`**. The original Rust impl mis-implemented `IndexOf`
   as a predicate-based "find first matching index" (returning Int).
   Upstream is `IndexOf(Collection, Index) → CollectionItem` — pick the
   i-th item from a collection. No fixtures exercised the old version
   so it was safe to repurpose.
2. **Bump the WASM linker stack** from the default 1MB to 16MB. Direct
   File's deeper recursion blew the default. Native already had this
   covered via `std::thread::Builder` with a 64MB stack; WASM had no
   such option at runtime, so set it at link time (see
   `factgraph-rs/.cargo/config.toml`).
3. **Enable `time`'s `wasm-bindgen` feature**. `<Today/>` calls
   `OffsetDateTime::now_utc()`, which on bare wasm32 panics with
   *"time not implemented on this platform"*. The `wasm-bindgen`
   feature on the `time` crate routes that through `js_sys::Date`.

JVM works without modification (IRS's own engine on IRS's own ruleset).
Scala.js works through the same path it always has.

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
