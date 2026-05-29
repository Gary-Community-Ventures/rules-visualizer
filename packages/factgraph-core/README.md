# rules-visualizer-factgraph-core

Internal library extracted from the [rules-visualizer](https://github.com/Gary-Community-Ventures/rules-visualizer)
that owns Fact Graph parsing, execution, and ruleset storage. Consumed by:

- `rules-visualizer-factgraph` — the visualizer/editor server
- `rules-visualizer-factgraph-api` — the partner-facing adapter API _(in progress)_

The package wraps two interchangeable execution engines for the
[IRS Direct File `factgraph`](https://github.com/IRS-Public/direct-file) XML
schema — defaulting to a Rust→WASM build
([`factgraph-rs`](https://github.com/Gary-Community-Ventures/factgraph-rs),
vendored at `vendor/factgraph-rs/`) and falling back to the original
Scala.js bundle (`vendor/factgraph-scala.cjs`) when the export in
`src/index.ts` is flipped. It exposes a small TypeScript surface for
loading XML rulesets, evaluating them against household input, and
attaching policy citations from a per-ruleset `references.json`.

## Public surface

```ts
import {
  // Execution
  executeFactGraph,
  cacheStats,
  timings,

  // Ruleset store (global, dataDir-rooted)
  loadFactGraphData,
  reloadRuleset,
  listRulesets,
  getRuleset,
  getRawFacts,
  getDataDir,

  // Lower-level primitives
  parseFactGraphModules,
  resolveReferences,

  // Types
  type RawFact,
} from 'rules-visualizer-factgraph-core'
```

`src/index.ts` is the contract. Anything not re-exported there is internal and
may change without notice.

## Why this exists

The visualizer and the API are two consumers with very different surface area
but the same execution engine. Keeping the engine in a shared package means a
ruleset change is picked up by both servers identically — no drift between
"what the rules visualizer shows" and "what the adapter API returns."

## Boundary discipline

This is a shared library between a developer-facing tool and a partner-facing
API. See `CLAUDE.md` for the contributor expectations around changes that
cross the boundary.
