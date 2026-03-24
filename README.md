# Rules Visualizer

A read-only visualizer for rule systems, supporting two formats:

- **RAC** (Rules as Code) from The Axiom Foundation
- **Fact Graph** from IRS Direct File

Displays rules as an interactive node graph with dependency arrows, pan/zoom, expand/collapse, and a detail panel for inspecting individual nodes.

## Getting Started

```bash
npm install
npm run dev
```

By default the app runs with built-in demo data (no backend required). To connect to a real API, set `VITE_API_URL` in a `.env` file:

```
VITE_API_URL=https://your-api.example.com
```

## Tech Stack

- React, TypeScript, Vite
- TanStack Router
- Tailwind CSS + Radix UI primitives
- React Context for state management

## Available Commands

- `npm run dev` — Start the development server
- `npm run build` — Production build (TypeScript check + Vite)
- `npm run lint` — ESLint + TypeScript `--noEmit`
- `npm run format` — Prettier
- `npm run preview` — Serve the production build locally

## Project Structure

```
src/
  components/        UI components
    content-viewers/ Read-only viewers per node format
    ui/              Radix/shadcn primitives
  context/           React context (app tabs, model state)
  lib/
    api/             API client + mock data
    model/           Type definitions (nodes, content types)
    graph.ts         Layout algorithms (row ordering, dependency helpers)
  pages/             Route-level page components
  routes.tsx         TanStack Router config
```

## API Shape

When `VITE_API_URL` is set, the app expects:

- `GET /api/rulesets` — returns `{ rulesets: [{ id, name, format }] }`
- `GET /api/rulesets/:id` — returns a `Model` object with pre-computed node dependencies
