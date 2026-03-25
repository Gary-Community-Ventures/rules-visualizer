# Rules Visualizer

A read-only visualizer for rule systems, supporting two formats:

- **Fact Graph** from IRS Direct File — XML-based decision dictionaries
- **RAC** (Rules as Code) from The Axiom Foundation — Python-based rule definitions

Displays rules as an interactive node graph with dependency arrows, pan/zoom, expand/collapse, and a detail panel for inspecting individual nodes.

## Quick Start

```bash
npm install
npm run dev
```

This starts both the Fact Graph backend (port 5000) and the Vite dev server (port 5173) pointed at the sample data in `data/factgraph/`. Open http://localhost:5173.

## Project Structure

This is an **npm workspaces monorepo** with a shared frontend and format-specific backends:

```
rules-visualizer/
├── package.json                 # Root workspace config + dev scripts
├── bin/
│   └── rules-visualizer         # Unified launcher (auto-detects format)
├── frontend/                    # React + Vite + TypeScript
│   ├── package.json             # "rules-visualizer-frontend"
│   ├── vite.config.ts           # Proxies /api and /ws to backend in dev
│   └── src/
│       ├── components/          # UI components
│       │   ├── content-viewers/ # Read-only viewers per node format
│       │   └── ui/              # Radix/shadcn primitives
│       ├── context/             # React context (app tabs, model state)
│       ├── lib/
│       │   ├── api/             # HTTP client + WebSocket live reload
│       │   ├── model/           # Type definitions (nodes, content types)
│       │   └── graph.ts         # Layout algorithms (row ordering, deps)
│       ├── pages/               # Route-level page components
│       └── routes.tsx           # TanStack Router config
├── packages/
│   ├── factgraph-server/        # Node.js backend for Fact Graph XML
│   │   ├── package.json         # "rules-visualizer-factgraph"
│   │   └── src/
│   │       ├── index.ts         # CLI entry point
│   │       ├── server.ts        # Express + WebSocket + static serving
│   │       ├── store.ts         # In-memory model store
│   │       ├── watcher.ts       # File watcher for live reload
│   │       ├── routes/          # API route handlers
│   │       └── parsers/         # XML → Model parser
│   └── rac-server/              # Python backend for RAC files
│       ├── pyproject.toml       # "rules-visualizer-rac"
│       └── rules_visualizer_rac/
│           ├── cli.py           # CLI entry point
│           ├── server.py        # HTTP server + WebSocket
│           ├── parser.py        # RAC → Model parser
│           └── watcher.py       # File watcher for live reload
└── data/                        # Sample rule files
    ├── factgraph/direct-file/   # IRS Direct File XML modules (451 nodes)
    └── rac/                     # RAC files (EITC, CTC, standard deduction)
```

## Architecture

Each rule format has its own backend server that:

1. **Parses** rule files into a standardized `Model` JSON structure
2. **Serves** the model via a REST API (`GET /api/rulesets`, `GET /api/rulesets/:id`)
3. **Watches** the data directory for file changes
4. **Broadcasts** reload notifications to the frontend via WebSocket

The frontend is format-agnostic — it consumes the same API regardless of which backend is running. In dev mode, Vite proxies `/api` and `/ws` to the backend. In production, the built frontend is bundled into the backend as static files.

### Live Reload

When you edit a rule file on disk:

```
File change → fs.watch detects it → Backend re-parses → WebSocket broadcasts
  {"type":"reload","rulesetId":"..."} → Frontend re-fetches model via HTTP
```

The WebSocket is only a notification channel — the actual data always flows through the REST API.

### API Contract

Both backends implement the same API:

| Endpoint | Description |
|---|---|
| `GET /api/rulesets` | List all loaded rulesets: `{ rulesets: [{ id, name, format }] }` |
| `GET /api/rulesets/:id` | Full model with nodes and pre-computed dependencies |
| `POST /api/rulesets/:id/execute` | Execute rules (not yet implemented) |
| `WebSocket /ws` | Live reload notifications |

## Usage

### Unified Launcher

The `bin/rules-visualizer` script auto-detects the file format and starts the right backend:

```bash
# Fact Graph (detects .xml files)
./bin/rules-visualizer ./data/factgraph

# RAC (detects .rac files)
./bin/rules-visualizer ./data/rac

# With options
./bin/rules-visualizer ./data/factgraph --port 8080 --no-open
```

### Running Backends Directly

You can also run each backend independently:

**Fact Graph (Node.js):**

```bash
# Dev mode (with tsx hot reload)
npm run dev:factgraph

# Or directly
npx tsx packages/factgraph-server/src/index.ts ./data/factgraph
```

**RAC (Python):**

```bash
# Set up (one time)
python3 -m venv .venv
.venv/bin/pip install -e packages/rac-server

# Run
.venv/bin/rules-visualizer-rac ./data/rac
```

### Development

```bash
# Fact Graph backend + Vite frontend
npm run dev

# RAC backend + Vite frontend
npm run dev:rac

# Frontend only (uses mock data if no backend available)
npm run dev:frontend

# Backends only
npm run dev:factgraph
npm run dev:rac-backend
```

### Production Build

```bash
# Build Fact Graph server with bundled frontend
npm run build:factgraph

# Run the built server
node packages/factgraph-server/dist/index.js ./data/factgraph
```

This builds the frontend, copies it into `packages/factgraph-server/public/`, and compiles the TypeScript. The resulting server is self-contained — it serves both the API and the frontend.

## Data Directory Layout

Each backend expects a directory where **subdirectories are rulesets**:

```
data/factgraph/
  direct-file/          ← ruleset "direct-file"
    constants.xml
    filers.xml
    income.xml
    ...

data/rac/
  eitc/                 ← ruleset "eitc"
    eligibility.rac
    amounts.rac
    ...
  ctc/                  ← ruleset "ctc"
    child_tax_credit.rac
    ...
```

Multiple XML/RAC files within a ruleset are merged into a single model with cross-file dependency resolution.

## npm Scripts Reference

| Script | Description |
|---|---|
| `npm run dev` | Start Fact Graph backend + Vite frontend |
| `npm run dev:rac` | Start RAC backend + Vite frontend |
| `npm run dev:frontend` | Vite dev server only (proxies to localhost:5000) |
| `npm run dev:factgraph` | Fact Graph backend only (tsx watch mode) |
| `npm run dev:rac-backend` | RAC backend only (requires venv setup) |
| `npm run build:frontend` | Build frontend (vite build) |
| `npm run build:factgraph` | Build frontend + bundle into backend + compile TS |
| `npm run start` | Unified launcher (alias for `./bin/rules-visualizer`) |
| `npm run format` | Prettier |
| `npm run lint` | ESLint + TypeScript check |

## Tech Stack

**Frontend:**
- React 19, TypeScript, Vite
- TanStack Router
- Tailwind CSS + Radix UI primitives
- React Context for state management

**Fact Graph Backend:**
- Node.js, Express 5, TypeScript
- fast-xml-parser for XML parsing
- ws for WebSocket

**RAC Backend:**
- Python 3.10+
- [rac](https://github.com/TheAxiomFoundation/rac) library for parsing
- watchdog for file watching
