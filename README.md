# Rules Visualizer

A read-only visualizer for rule systems, supporting two formats:

- **Fact Graph** from IRS Direct File — XML-based decision dictionaries
- **RAC** (Rules as Code) from The Axiom Foundation — Python-based rule definitions

Displays rules as an interactive node graph with dependency arrows, pan/zoom, expand/collapse, rule execution with live results, and an AI assistant for exploring rules.

## Quick Start

```bash
# Install dependencies
npm install

# Set up Python venv (for RAC backend)
python3 -m venv .venv
.venv/bin/pip install -e packages/rac-server

# Start Fact Graph backend + frontend
npm run dev

# Or start RAC backend + frontend
npm run dev:rac
```

Open http://localhost:5173 (Fact Graph) or http://localhost:5174 (RAC).

## Features

### Node Graph Visualization

- Interactive pan/zoom canvas with dependency arrows
- Expand/collapse subtrees per node
- Three node types with distinct visual styles:
  - **Input** (blue, pencil icon) — values the user provides
  - **Constant** (gray, book icon) — values from the rules, overridable for simulation
  - **Computed** (purple, branch icon) — calculated from inputs and constants
- Detail panel with logic source, dependencies, and "used by" links
- Node navigation history (back/forward)

### Rule Execution

- Fill in input values directly on node cards or via the execution panel
- Override constants to simulate rule changes ("what if the income limit was $30k?")
- Pin computed nodes to skip their calculation and force a value
- Results displayed as colored badges on every node
- Auto-runs on blur — results update as you fill in values
- **RAC**: Executes via the `rac` library's Python runtime
- **Fact Graph**: Executes via a Scala.js bundle (from IRS Direct File) running in Node.js

### Execution Panel

- **Inputs** section with required/optional indicators and type hints (USD, Boolean, Integer, etc.)
- **Overrides** section with collapsible Constants and Computed sub-groups
- **JSON** import/export — Generate JSON from current form state, or paste JSON to bulk-set values
- Blue rings for input values, amber rings for overrides — visible at a glance on the graph
- Section states persist across panel open/close

### AI Assistant

- Chat panel for asking questions about the rules
- Powered by LangChain + OpenRouter (configurable model)
- Node name autocomplete in the chat input
- Clickable node references in AI responses

### Live Reload

Edit a rule file on disk and the graph updates automatically:

```
File change → watcher detects → backend re-parses → WebSocket broadcast → frontend re-fetches
```

## Project Structure

```
rules-visualizer/
├── bin/rules-visualizer              # Unified launcher (auto-detects format)
├── frontend/                         # React 19 + Vite + TypeScript
│   └── src/
│       ├── components/               # Graph nodes, arrows, panels, content viewers
│       ├── context/                  # App state, model context, execution state
│       ├── lib/                      # API client, graph layout, utilities
│       └── pages/                    # Route-level pages
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
│   │       ├── parser.py             # RAC → Model parser
│   │       ├── server.py             # HTTP server + execution engine
│   │       └── ai/                   # LangChain agent configuration
│   └── shared-types/                 # TypeScript type definitions (single source of truth)
└── data/                             # Example rule files
    ├── rac/
    │   ├── child-care-subsidy/       # Simple example (20 nodes)
    │   ├── child-care-credit/        # Real IRS Section 21 rules (100 nodes)
    │   └── snap/                     # SNAP benefits eligibility (47 nodes)
    └── factgraph/
        ├── child-care-subsidy/       # Same rules as RAC version, in XML
        └── snap/                     # SNAP benefits in Fact Graph XML
```

## Architecture

Both backends implement the same API contract. The frontend is format-agnostic.

### API

| Endpoint                    | Method    | Description                                           |
| --------------------------- | --------- | ----------------------------------------------------- |
| `/api/rulesets`             | GET       | List rulesets: `{ rulesets: [{ id, name, format }] }` |
| `/api/rulesets/:id`         | GET       | Full model with nodes and dependencies                |
| `/api/rulesets/:id/execute` | POST      | Execute rules with `{ inputs: { path: value } }`      |
| `/ws`                       | WebSocket | Live reload + AI chat messages                        |

### Node Model

Every node has a universal `role` regardless of format:

| Role       | Description               | RAC                              | Fact Graph                       |
| ---------- | ------------------------- | -------------------------------- | -------------------------------- |
| `input`    | User provides this value  | Variable with no expression      | `<Writable>` element             |
| `constant` | Set by rules, overridable | Variable with literal expression | `<Derived>` with no dependencies |
| `computed` | Calculated from others    | Variable with expression         | `<Derived>` with dependencies    |

All nodes have `overridable: boolean` — the execution engine supports overriding any node in both formats.

### Execution

**RAC:** The Python `rac` library compiles `.rac` files into an IR. Input variables (dropped by the compiler) are injected into the execution context. Overrides pre-populate `ctx.computed` and skip computation for pinned nodes.

**Fact Graph:** The Scala.js bundle creates a graph from a "digest" representation of the XML. Overriding derived nodes works by converting them to writables in the digest before graph creation.

## Implementation Notes

Both backends required workarounds to get execution working. These are documented here so future maintainers understand what's non-obvious.

### RAC Workarounds

**Compiler drops input variables.** The `rac` library (v0.2.0) only includes variables with temporal `from YYYY-MM-DD:` expressions in the compiled IR. Input variables (declared with metadata but no expression, e.g. `household_size: dtype: Integer, default: 1`) are silently dropped. Our parser recovers them from the raw modules and adds them to the model as `role: 'input'` nodes. See `_ir_to_model()` in `parser.py`.

**Manual executor replication.** We replicate the `rac.executor.Executor.execute()` loop in `server.py` rather than calling `rac.execute()` directly. This lets us: (1) inject default values for input variables the compiler dropped, (2) pre-populate `ctx.computed` with user overrides, and (3) skip computation for pinned nodes. **This is the most fragile workaround** — if the `rac` library changes its executor internals, this code may need updating.

**Execution order not topologically sorted.** The compiler's `ir.order` is just file-parse order, not dependency order. Our skip-if-already-computed approach handles this since pinned values are checked before computation.

### Fact Graph Workarounds

**Scala.js bundle.** The `vendor/factgraph-scala.cjs` file is a 6MB Scala.js bundle compiled from the IRS Direct File project's `fact-graph-scala/` directory. It's a pinned copy — updating it requires rebuilding from the Direct File source. The `.cjs` extension is needed because our project uses ESM.

**Digest conversion.** The Scala.js engine doesn't accept raw XML. We convert `fast-xml-parser` output into a "digest" format (`{typeName, options, children}` trees) that mirrors Direct File's `processFactsToDigestWrapper.ts`. See `executor.ts`.

**Derived node overrides.** The Scala.js `graph.set()` only works on writable facts. To override a derived (computed) node, we rebuild the entire graph dictionary with that fact converted from `Derived` to `Writable`. The `inferWritableType()` function guesses the return type from the expression tree, with a fallback to the model's `dataType` field.

**Dependency resolution.** The XML parser needed several fixes to capture all dependency edges:

- Relative paths (`../foo`) are resolved against the fact's parent path
- Named collection items (`/primaryFiler/age65OrOlder`) are fuzzy-matched to wildcard paths (`/filers/*/age65OrOlder`)
- `optionsPath` attributes on `<Enum>` elements, `<Find path=...>`, and `collection=` attributes are captured as dependencies

**Type limitations.** The Scala engine's `GreaterOf`/`LesserOf` nodes cannot compare values of different types (e.g. Rational vs Dollar). Our example XML uses integer math to work around this.

## Environment Variables

| Variable          | Required    | Description                                         |
| ----------------- | ----------- | --------------------------------------------------- |
| `OPEN_ROUTER_KEY` | For AI chat | API key from [openrouter.ai](https://openrouter.ai) |
| `AI_MODEL`        | No          | Model ID (default: `google/gemini-2.5-flash`)       |

Create a `.env` file in the project root (gitignored):

```
OPEN_ROUTER_KEY=sk-or-v1-your-key-here
```

## Usage

### Unified Launcher

```bash
# Auto-detects format from file extensions
./bin/rules-visualizer ./data/factgraph
./bin/rules-visualizer ./data/rac
./bin/rules-visualizer ./data/rac --port 8080 --no-open
```

### Development

```bash
npm run dev              # Fact Graph backend + Vite frontend
npm run dev:rac          # RAC backend + Vite frontend
npm run dev:frontend     # Vite only (proxies to port 5000)
npm run dev:factgraph    # Fact Graph backend only
npm run dev:rac-backend  # RAC backend only
```

### Production Build

```bash
npm run build:factgraph
node packages/factgraph-server/dist/index.js ./data/factgraph
```

Builds the frontend and bundles it into the Fact Graph backend as static files.

## Data Directory Layout

Each backend expects a directory where **subdirectories are rulesets**:

```
data/factgraph/
  child-care-subsidy/     # ruleset ID = "child-care-subsidy"
    subsidy.xml
  snap/
    eligibility.xml

data/rac/
  child-care-subsidy/
    subsidy.rac
  snap/
    eligibility.rac
```

Multiple files within a ruleset are merged with cross-file dependency resolution.

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, TanStack Router, Tailwind CSS, Radix UI

**Fact Graph Backend:** Node.js, Express 5, TypeScript, fast-xml-parser, Scala.js (execution)

**RAC Backend:** Python 3.10+, aiohttp, [rac](https://github.com/TheAxiomFoundation/rac) library, watchdog

**AI:** LangChain, OpenRouter (configurable model)

**Shared:** npm workspaces monorepo, shared TypeScript types package
