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

## Field naming: this layer is a translation boundary

The root `CLAUDE.md` "always use the path" rule governs **internal node
identity** (the model, the visualizer) and the **engine-facing inputs** — the
`inputs` map we hand to the engine must be path-keyed (`/members/*/age`), and
code must never fabricate a short name by splitting a path
(`segments.pop()`, `.replace('/*/','')`).

It does **not** govern the **external request/response DTO**. This package is
an adapter; choosing consumer-friendly field names (`members[].hasPhysicalDisability`,
nested `members[].income[]`) is exactly its job. That path↔name translation
lives in **one place**: `src/translate/field-index.ts`. That module is the
single sanctioned spot that derives a field's `location` + `field` (the path
leaf) from its engine path and maps back, keeping `enginePath` as the canonical
reference — analogous to the executor boundary. Don't scatter `split('/')` /
`segments.pop()` elsewhere; go through the field index.

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

Live in `tests/`. Run with `npm test` from this package (or
`npm test --workspace=rules-visualizer-factgraph-api` from the repo root).

The suite uses Node's built-in `node:test` runner plus `supertest`
against `buildApp()` from `src/server.ts`. No port binding — supertest
drives the app directly. Shared setup lives in `tests/helpers.ts`,
including a canonical SNAP fixture (`APPLICANT_ROW`, `ZEROED_SCALARS`)
so each test isn't 50 lines of boilerplate, and a `withEnv` utility for
auth tests that need to toggle `API_BEARER_TOKEN` without leaking
between tests.

When adding a feature, add a matching test that exercises the wire
shape (response body, status code, headers). The visualizer's smoke
test (in `factgraph-server`) covers core execution; this package
covers route shapes, validation, auth, and error responses.
