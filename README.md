# Rules Visualizer

A read-only visualizer for rule systems, supporting two formats:

- **Fact Graph** from IRS Direct File — XML-based decision dictionaries, executed via a Scala.js bundle.
- **RuleSpec** from The Axiom Foundation — jurisdiction-scoped YAML rule libraries, executed via the upstream `axiom-rules-engine` Rust binary. (Previously this was a different format called "RAC"; that codebase was rebranded and rewritten upstream and we've migrated.)

Displays rules as an interactive node graph with dependency arrows, pan/zoom, expand/collapse, rule execution with live results, and an AI assistant for exploring rules.

## Quick Start

```bash
# Install Node + Python deps
npm install
python3 -m venv .venv
.venv/bin/pip install -e packages/rac-server

# (RuleSpec only) Build the upstream Rust engine — required for execution
npm run setup:axiom-engine

# Start the Fact Graph backend + frontend
npm run dev

# Or the RuleSpec backend + frontend
npm run dev:axiom
```

Open http://localhost:5173 (Fact Graph) or http://localhost:5174 (RuleSpec).

### Rust toolchain (RuleSpec only)

`npm run setup:axiom-engine` requires Rust 1.85+ (the engine uses Rust edition 2024).

- **macOS:** `brew install rustup-init && rustup-init -y`
- **Linux / WSL:** `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`, plus `sudo apt install build-essential`
- **Windows:** use WSL.

The script clones `TheAxiomFoundation/rac` into `vendor/axiom-rules-engine/` (gitignored) and runs `cargo build --release`. Re-run any time you want to pull the latest engine version — it's idempotent.

## Features

### Node Graph Visualization

- Interactive pan/zoom canvas with dependency arrows
- Expand/collapse subtrees per node
- Three node types with distinct visual styles:
  - **Input** (blue, pencil icon) — values the user provides
  - **Constant** (gray, book icon) — values from the rules, overridable for simulation
  - **Computed** (purple, branch icon) — calculated from inputs and constants
- Detail panel showing the formula, dependencies, source citation, regulation `moduleSummary`, value tables for parameter lookups, and cross-jurisdiction restatement citations
- Node navigation history (back/forward)

### Rule Execution

- Fill in input values directly on node cards or via the execution panel
- Override constants and computed nodes to simulate rule changes ("what if the income limit was $30k?")
- Results displayed as colored badges on every node
- Auto-runs on blur — results update as you fill in values
- **Fact Graph:** executes via a Scala.js bundle (from IRS Direct File) running in Node.js
- **RuleSpec:** compiles each composition to a JSON artifact, then pipes `ExecutionRequest` JSON to the `axiom-rules-engine` Rust binary via stdin/stdout. The wrapper enumerates inputs from the artifact, tags each by entity scope, auto-defaults from upstream `.test.yaml` fixtures (including per-member values from `#relation.member_of_household:` blocks), and falls back to AST type inference for anything fixtures don't cover. Person-scoped inputs route to a single `person-1` member with a `member_of_household: [person-1, h1]` relation tuple.

### Execution Panel

- **Inputs** section with required/optional indicators and type hints (USD, Boolean, Integer, etc.)
- **Overrides** section with collapsible Constants and Computed sub-groups
- **JSON** import/export
- Blue rings for input values, amber rings for overrides — visible at a glance on the graph

### Simulation

- Compare two ruleset versions (e.g. `snap-fy2025` vs `snap-fy2026`) over a generated population or saved test cases
- Per-side overrides for what-if analysis
- Save interesting case sets as named populations for regression testing
- Currently Fact Graph–only; RuleSpec simulation TBD.

### AI Assistant

- Chat panel for asking questions about the rules
- Powered by LangChain + OpenRouter (configurable model)
- Node name autocomplete in the chat input
- Clickable node references in AI responses

### Live Reload (Fact Graph only)

Edit a Fact Graph XML file on disk and the graph updates automatically:

```
File change → watcher detects → backend re-parses → WebSocket broadcast → frontend re-fetches
```

The RuleSpec backend doesn't currently hot-reload — its content comes from upstream snapshots that don't usually change during dev.

## Project Structure

```
rules-visualizer/
├── bin/rules-visualizer              # Unified launcher (auto-detects format)
├── scripts/
│   └── build-axiom-engine.sh         # Clones + builds the RuleSpec engine binary
├── vendor/                           # Per-machine build artifacts (gitignored)
│   └── axiom-rules-engine/           # Vendored upstream Rust crate (built locally)
├── frontend/                         # React 19 + Vite + TypeScript
├── packages/
│   ├── factgraph-server/             # Node.js backend (Express + WebSocket)
│   │   ├── src/
│   │   │   ├── parsers/factgraph.ts  # XML → Model parser
│   │   │   ├── executor.ts           # Scala.js execution engine
│   │   │   ├── routes/               # REST API + AI chat
│   │   │   └── ai/                   # LangChain agent configuration
│   │   └── vendor/
│   │       └── factgraph-scala.cjs   # Scala.js bundle (6MB, from Direct File)
│   ├── rac-server/                   # Python backend (aiohttp + WebSocket)
│   │   └── rules_visualizer_rac/
│   │       ├── rulespec_parser.py    # RuleSpec YAML → Model parser (walks imports)
│   │       ├── axiom_engine.py       # Subprocess wrapper for the Rust binary
│   │       ├── references.py         # references.json policy-doc citation resolver
│   │       ├── server.py             # HTTP server
│   │       └── ai/                   # LangChain agent configuration
│   └── shared-types/                 # TypeScript type definitions
└── data/
    ├── factgraph/                    # Fact Graph rulesets, one subdir per
    │   ├── snap-fy2025/
    │   ├── snap-fy2026/
    │   └── medicaid/
    └── rulespec/                     # RuleSpec content libraries
        ├── rulespec-us/              # rulespec-us snapshot (federal)
        └── rulespec-us-co/           # rulespec-us-co snapshot (Colorado)
```

> The `rulespec-us-co` and `rulespec-us` directories under `data/rulespec/` are clones of [TheAxiomFoundation/rulespec-us](https://github.com/TheAxiomFoundation/rulespec-us) and [rulespec-us-co](https://github.com/TheAxiomFoundation/rulespec-us-co) with `.git` removed. Pull fresh snapshots manually when you want to refresh. The directory names match the upstream repos because the engine resolves `us-co:foo/bar` imports by searching for a directory literally named `rulespec-us-co/`.

## Architecture

Both backends implement the same API contract. The frontend is format-agnostic.

### API

| Endpoint                                       | Method       | Description                                                                                                     |
| ---------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `/api/rulesets`                                | GET          | List rulesets: `{ rulesets: [{ id, name, format }] }`                                                           |
| `/api/rulesets/:id`                            | GET          | Full model with nodes and dependencies                                                                          |
| `/api/rulesets/:id/execute`                    | POST         | Execute rules with `{ inputs, entities, as_of }`                                                                |
| `/api/rulesets/:id/tests`                      | GET / POST   | List or create test cases. POST returns `403` unless `ALLOW_WRITES=1`                                           |
| `/api/rulesets/:id/tests/:testId`              | PUT / DELETE | Update or delete a test case. Both `403` unless `ALLOW_WRITES=1`                                                |
| `/api/rulesets/:id/tests/run`                  | POST         | Run all tests (or a subset via `{ testIds }`). RuleSpec backend currently returns 501 for this                  |
| `/api/rulesets/:id/references`                 | GET / PUT    | Read or write the policy-references manifest. PUT `403` unless `ALLOW_WRITES=1`                                 |
| `/api/rulesets/:id/references/files/:filename` | GET          | Stream a referenced policy PDF (or other doc) from the ruleset's directory                                      |
| `/api/rulesets/:id/profiles`                   | GET / POST   | List or create file-backed profiles (saved input/override/entity snapshots). POST `403` unless `ALLOW_WRITES=1` |
| `/api/rulesets/:id/profiles/:profileId`        | PUT / DELETE | Update or delete a profile. Both `403` unless `ALLOW_WRITES=1`                                                  |
| `/api/rulesets/:id/tasks`                      | GET / POST¹  | List active threads or spawn a new Claude-CLI agent thread (the Builder panel)                                  |
| `/api/rulesets/:id/tasks/:threadId`            | GET¹         | Single thread state, including iterations, summaries, and modified paths                                        |
| `/api/rulesets/:id/tasks/:threadId/follow`     | POST¹        | Send a follow-up prompt (or queue one if the agent is still running)                                            |
| `/api/rulesets/:id/tasks/:threadId/status`     | POST¹        | Mark a thread complete / archived / re-opened                                                                   |
| `/api/rulesets/:id/tasks/:threadId/cancel`     | POST¹        | Stop a running agent and finalize the iteration                                                                 |
| `/ws`                                          | WebSocket    | Live reload broadcasts + AI chat (`{ type: 'ai-chat' }` messages, streamed back over the socket)                |

¹ The `/tasks` routes are mounted only when `ALLOW_WRITES=1`. Without it, every path under `/tasks` returns `404`.

### Node Model

Every node has a universal `role` regardless of format:

| Role       | Description               | RuleSpec                                       | Fact Graph                       |
| ---------- | ------------------------- | ---------------------------------------------- | -------------------------------- |
| `input`    | User provides this value  | Identifier referenced but not declared as rule | `<Writable>` element             |
| `constant` | Set by rules, overridable | `kind: parameter` rule                         | `<Derived>` with no dependencies |
| `computed` | Calculated from others    | `kind: derived` rule with formula              | `<Derived>` with dependencies    |

All nodes have `overridable: boolean` — the execution engine supports overriding any node in both formats.

### Execution

**Fact Graph.** The Scala.js bundle creates a graph from a "digest" representation of the XML. Overriding derived nodes works by converting them to writables in the digest before graph creation.

**RuleSpec.** The Python backend compiles each composition once via `axiom-rules-engine compile`, caching the JSON artifact. For each `/execute` request the wrapper:

1. Walks the AST of the compiled artifact to infer each input's dtype from its surrounding expression context (bool for `if`/`and`/`or` children, decimal for arithmetic and most comparisons).
2. Walks every transitive `.test.yaml` fixture (the composition's own plus every imported module's) and collects authoritative-typed defaults — RuleSpec inputs don't declare dtypes explicitly, so the fixtures are our source of truth.
3. Builds a `CompiledExecutionRequest`, layers user-supplied overrides on top of fixture defaults and inferred zeros, pipes JSON to the binary via stdin/stdout.
4. Reads `ExecutionResponse`. Uses the explain-mode trace to backfill values for every computed node, so the visualizer can show the full graph state, not just queried outputs.

See `packages/rac-server/rules_visualizer_rac/axiom_engine.py`.

## Implementation Notes

### Fact Graph

**Scala.js bundle.** The `vendor/factgraph-scala.cjs` file is a 6MB Scala.js bundle compiled from the IRS Direct File project. Pinned copy — updating it requires rebuilding from Direct File source.

**Digest conversion.** The Scala.js engine doesn't accept raw XML. We convert `fast-xml-parser` output into a "digest" format that mirrors Direct File's `processFactsToDigestWrapper.ts`. See `executor.ts`.

**Derived node overrides.** The Scala.js `graph.set()` only works on writable facts. To override a derived node, we rebuild the graph dictionary with that fact converted from `Derived` to `Writable`. The `inferWritableType()` function guesses the return type from the expression tree.

**Dictionary cache.** Per-scenario dictionary rebuilds were the dominant cost in simulation runs. We now cache the FactDictionary keyed by `(facts identity, paths-to-promote signature)` so the simulation runner reuses a single dictionary across all scenarios with the same input shape.

### RuleSpec

**Engine is a Rust binary.** Upstream rewrote the engine in Rust; there's no Python interpreter for RuleSpec anymore. Integration is a subprocess pipe: JSON in via stdin, JSON out via stdout. See `axiom_engine.py`.

**Imports resolve via repo-name directories.** The engine resolves `us-co:regulations/10-ccr-2506-1/4.401` by looking for a directory named `rulespec-us-co/`. Our content is laid out the same way (`data/rulespec/rulespec-us-co/`) so imports work natively, no symlinks required.

**Person vs Household entity scope.** Most SNAP inputs are Household-scoped (`employee_wages_received`, `rent_amount`, ...), but ~120 are Person-scoped — eligibility flags that feed `count_where(member_of_household, ...) > 0` gates (citizenship, SSN compliance, work-requirement status, elderly/disabled) plus per-member attributes like `member_age` and `member_weekly_wages`. RuleSpec doesn't declare inputs; the engine and our parser both discover them by walking ASTs (`formula.rs:1303-1317`). Entity scope is inferred from the consuming rule, with a context flip when descending through `count_related`/`sum_related` (the `where` and `value` subexpressions evaluate at the related-slot entity). The CLI eagerly compiles each composition and feeds the artifact's authoritative `{bare_input → entity}` map back into the parser so the frontend's Person collection bucket surfaces every per-member input.

**Multi-member dataset assembly.** `axiom_engine.execute` accepts `entities: {Person: [{...row}, ...]}` matching the factgraph wire format. Each row becomes a unique entity_id (`person-1`, `person-2`, ...) with per-row InputRecords for any Person-scoped input the row supplies (falling back to user_inputs > fixture default > typed zero). A `member_of_household` relation row is emitted per member under every name the compiled program references — the artifact has both a bare `member_of_household` and a durable `us:statutes/7/2012/j#relation.member_of_household` and the engine indexes by exact-name match, so we cover both. If `entities` is empty we mint a single default member so flat single-person profiles keep working.

**Query selection.** The auto-query (used when the caller doesn't specify outputs) is filtered to Household-scoped derived rules only. Querying a Person-scoped output against the household entity_id makes the engine evaluate the Person rule against `h1` and error with "missing input X for entity h1". Person-scoped values still come back via the explain-mode trace so the visualizer can render them.

**Profiles.** Each ruleset directory can hold a `profiles.json` file with named input snapshots (e.g. "single working adult", "family of 4 with BCE"). The `/api/rulesets/:id/profiles` endpoints CRUD these; writes are gated on `ALLOW_WRITES`. Colorado SNAP ships with three starter profiles under `data/rulespec/rulespec-us-co/policies/cdhs/snap/profiles.json`.

**Input dtype inference.** RuleSpec doesn't declare input dtypes — they're inferred from formula context. Our wrapper walks the compiled artifact's AST and tags each `kind: input` reference with bool / decimal based on its parent expression kind. This avoids "type mismatch: right side of comparison is not numeric" errors when defaulting unknown inputs.

**Module-summary metadata.** Each RuleSpec module has a `module.summary` describing what the regulation does. We propagate this onto every rule node from that module so each detail panel shows the regulation context, not just the formula.

**source_relation citations.** RuleSpec uses `kind: source_relation` to record cross-rule provenance ("this Colorado regulation restates this federal rule"). These rules don't compute values, but our parser attaches them as `content.citations[]` on the target federal rule so the detail panel can show "Also restated by 10 CCR 2506-1 section …".

## Environment Variables

| Variable                 | Required           | Description                                                                                                                      |
| ------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `OPEN_ROUTER_KEY`        | For AI chat        | API key from [openrouter.ai](https://openrouter.ai)                                                                              |
| `AI_MODEL`               | No                 | Model ID (default: `google/gemini-2.5-flash`)                                                                                    |
| `ALLOW_WRITES`           | For write features | Set to `1` to enable backend write surfaces (Tasks routes mount; Tests/References PUT/POST/DELETE return `200` instead of `403`) |
| `VITE_ALLOW_WRITES`      | For write features | Must mirror `ALLOW_WRITES`. Vite inlines this at build time                                                                      |
| `TASK_AGENT_RUNNER`      | No                 | Task panel agent backend: `claude` (default) or `opencode`                                                                       |
| `OPENCODE_BIN`           | No                 | OpenCode executable path when `TASK_AGENT_RUNNER=opencode` (default: `opencode`)                                                 |
| `OPENCODE_MODEL`         | No                 | OpenCode model, passed as `opencode run --model`                                                                                 |
| `OPENCODE_VARIANT`       | No                 | OpenCode model variant, passed as `opencode run --variant`                                                                       |
| `OPENCODE_AGENT`         | No                 | OpenCode agent, passed as `opencode run --agent`                                                                                 |
| `AXIOM_RULES_ENGINE_BIN` | No                 | Override path to the axiom-rules-engine binary (default: `vendor/axiom-rules-engine/target/release/axiom-rules-engine`)          |

`ALLOW_WRITES` and `VITE_ALLOW_WRITES` must be set together. Without them, the UI runs read-only.

Create a `.env` file in the project root (gitignored):

```
OPEN_ROUTER_KEY=sk-or-v1-your-key-here
# Uncomment for full write access (local dev only)
# ALLOW_WRITES=1
# VITE_ALLOW_WRITES=1
# TASK_AGENT_RUNNER=opencode
# OPENCODE_MODEL=openai/gpt-5.5
# OPENCODE_VARIANT=medium
```

## Usage

### Unified Launcher

```bash
# Auto-detects format from directory contents
./bin/rules-visualizer ./data/factgraph
./bin/rules-visualizer ./data/rulespec
./bin/rules-visualizer ./data/rulespec --port 8080 --no-open
```

### Development

```bash
npm run setup:axiom-engine  # One-time: build the RuleSpec Rust binary
npm run dev                 # Fact Graph backend + Vite frontend
npm run dev:axiom           # RuleSpec backend + Vite frontend
npm run dev:frontend        # Vite only (proxies to port 5000)
npm run dev:factgraph       # Fact Graph backend only
npm run dev:axiom-backend   # RuleSpec backend only
```

### Production Build

```bash
npm run build:factgraph
node packages/factgraph-server/dist/index.js ./data/factgraph
```

Builds the frontend and bundles it into the Fact Graph backend as static files. The RuleSpec backend's production story isn't sorted yet — it still relies on a locally-built Rust binary.

## Data Directory Layout

**Fact Graph** — each subdirectory is a ruleset:

```
data/factgraph/
  snap-fy2026/        # ruleset ID = "snap-fy2026"
    eligibility.xml
  medicaid/
    medicaid.xml
```

**RuleSpec** — jurisdiction-scoped repos contributing rules to compositions:

```
data/rulespec/
  rulespec-us/                            # federal content (snapshot of TheAxiomFoundation/rulespec-us)
    policies/usda/snap/fy-2026-cola/...yaml
    statutes/7/2017/a.yaml
    ...
  rulespec-us-co/                         # Colorado content (snapshot of TheAxiomFoundation/rulespec-us-co)
    policies/cdhs/snap/
      fy-2026-benefit-calculation.yaml    # ← composition (the ruleset entry point)
      fy-2026-benefit-calculation.test.yaml
      profiles.json                       # named input snapshots for this ruleset
    regulations/10-ccr-2506-1/4.401.yaml
    ...
```

The RuleSpec loader scans `data/rulespec/rulespec-<jurisdiction>/policies/**/*.yaml` for files whose `module.kind` is `composition`. Each one becomes a ruleset named after its jurisdiction + path (e.g. `us-co-snap-fy-2026-benefit-calculation`).

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, TanStack Router, Tailwind CSS, Radix UI

**Fact Graph Backend:** Node.js, Express 5, TypeScript, fast-xml-parser, Scala.js (execution)

**RuleSpec Backend:** Python 3.10+, aiohttp, [axiom-rules-engine](https://github.com/TheAxiomFoundation/rac) Rust binary (via subprocess), PyYAML

**AI:** LangChain, OpenRouter (configurable model)

**Shared:** npm workspaces monorepo, shared TypeScript types package
