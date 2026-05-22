# factgraph-core — contributor notes

This package is shared between:

- `packages/factgraph-server` — the visualizer (developer-facing)
- `packages/factgraph-api` — the partner-facing adapter API _(in progress)_

Any change here ships to **both** at once. Treat the public surface in
`src/index.ts` as a real library API; consumers depend on it the way they'd
depend on a published npm package.

## Before changing anything in this package

1. **Confirm the change is needed by both consumers** — or by core itself.
   If only one consumer needs new behavior, prefer adding the wrapper in that
   consumer instead of expanding the shared surface.
2. **Run the visualizer smoke test** (`packages/factgraph-server/tests/`) —
   it pins down a fixed input → fixed output for a known ruleset. Catches
   accidental behavior drift in `executor.ts`.
3. **Avoid widening the public exports without intent.** Each entry in
   `src/index.ts` is a contract. Re-exporting "just in case" creates drift
   risk later.

## What's intentionally NOT in here

- **The Express server, routes, WebSocket layer** — those are visualizer
  concerns and live in `factgraph-server`.
- **`load-env.ts`** — pure side-effect module with import-ordering
  requirements; lives co-located with each server that needs it.
- **File watcher** (`watcher.ts`) — coupled to the visualizer's WebSocket
  broadcast; lives in `factgraph-server`. Can be lifted here later if the
  API also wants hot reload.

## Vendored bundle

`vendor/factgraph-scala.cjs` is the IRS Direct File Scala.js fact-graph
runtime. The `executor.ts` includes a runtime monkey-patch for an upstream
bug in `DigestNodeWrapper.overrideDefaultOption` — see the long comment at
the top of that file. Do not remove the patch without first verifying the
upstream PR (#1 in the upstream tracker) is reflected in the re-vendored
bundle.
