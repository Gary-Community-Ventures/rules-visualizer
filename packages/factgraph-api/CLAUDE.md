# factgraph-api — contributor notes

This package is the **partner-facing API**. Everything in it is read by
external integrators — code, error messages, route shapes, README, docs.
Treat the public surface as a real contract.

## Boundary

This server is one of two consumers of `rules-visualizer-factgraph-core`.
The other is the visualizer. **Do not import from `factgraph-server`** —
that's the visualizer's package and is not part of the shared surface.
If you need a primitive that's currently only in `factgraph-server`, lift
it into `factgraph-core` first.

## Public-surface discipline

The repo is open source and the integration partner reads it directly to
understand what they're calling. That means:

- **Error responses follow [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)** — `{ type, title, status, detail }`. Don't invent ad-hoc error shapes.
- **Endpoint route comments are public documentation.** Write them so an
  outside engineer reading the source can understand the shape and intent
  without internal context.
- **Don't log request bodies.** This server may handle real applicant data;
  default to scrubbed logs.
- **Breaking changes go in `docs/changelog.md`** with the date and the
  migration path.

## Tests

There aren't any in this package yet. When you add a feature, add a
matching test that hits the endpoint via `supertest` against `buildApp()`
from `src/server.ts`. The visualizer's smoke test (in `factgraph-server`)
covers core execution; this package should cover route shapes, auth, and
error responses.
