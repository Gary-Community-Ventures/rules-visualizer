# direct-file-tax — vendored IRS Direct File tax dictionary

A non-SNAP, real-world Fact Graph workload assembled from the
[IRS-Public/direct-file](https://github.com/IRS-Public/direct-file)
project's tax dictionary (CC0 / public domain — see Direct File's
LICENSE).

## How this was assembled

Direct File ships ~37 XML modules under
`backend/src/main/resources/tax/`. Their loader concatenates them into
one global fact dictionary at startup. The aggregator here mirrors that:
it finds every `<Facts>…</Facts>` block and pastes them into a single
`<FactDictionaryModule>`. See `scripts/regenerate.sh` for the exact
recipe.

The vendored snapshot is **2,354 facts** — about 5× larger than
`snap-complete` and 18× larger than `snap-fy2026`. Makes a useful big-
ruleset bench workload.

## What's missing and why

Three files are excluded from the aggregate:

- `dependentsBenefitSplit.xml`
- `familyAndHousehold.xml`
- `formW2s.xml`

They use a `<IndexOf>` shape (with `<Collection>` and `<Index>` child
elements) that `factgraph-rs` doesn't yet parse — it currently only
handles the `path=` attribute form. Adding the shape would touch the
AST (collection becomes an expression rather than a path string), the
parser, and the interpreter — a real feature, not a one-line fix.

This means the aggregate has dangling references into the skipped
files. The Scala.js and JVM engines validate path references at
dictionary-build time and refuse to load the partial aggregate;
`factgraph-rs` validates lazily during evaluation and runs it fine. The
bench harness's bench-engines results for `direct-file-tax` are
therefore native-only until the parser gap closes.

## tests.json

One placeholder case with empty inputs/entities. We're not asserting
output correctness on this ruleset — it's a bench workload, not a
behavior fixture. The engine still has to walk the full graph and
compute (or surface Incomplete for) every reachable fact.

## License

CC0 1.0 Universal — same as the upstream Direct File project. No
attribution required; vendoring into this repo is fine. The aggregator
script and README here are MIT, same as the rest of rules-visualizer.
