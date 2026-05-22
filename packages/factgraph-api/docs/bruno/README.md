# Bruno collection — Factgraph API

A ready-to-run collection of API calls against the Factgraph adapter API.
Open this directory in [Bruno](https://www.usebruno.com/) and click Send on
any request — no copy-paste, no JSON formatting.

## Quick start

1. **Install Bruno** — `brew install --cask bruno` on macOS, or download from
   [usebruno.com](https://www.usebruno.com/downloads).
2. **Open this folder** — File → Open Collection, point at
   `packages/factgraph-api/docs/bruno/`.
3. **Pick an environment** — top-right dropdown in Bruno. `local` is the
   default and points at `http://localhost:5002`. `prod` is a placeholder
   you'll edit once a real URL exists.
4. **Start the API** — `npm run dev:api` from the repo root.
5. **Click Send** on any request.

## What's in here

| #   | File                           | Tests                                                              |
| --- | ------------------------------ | ------------------------------------------------------------------ |
| 01  | `01-health.bru`                | Liveness probe                                                     |
| 02  | `02-list-rulesets.bru`         | Discovering which rulesets the server has loaded                   |
| 03  | `03-get-schema.bru`            | Inspecting one ruleset's node definitions                          |
| 04  | `04-discover-inputs.bru`       | Empty query → full intake-form shape (smart walker)                |
| 05  | `05-bbce-determination.bru`    | Multi-target + metadata + supportingFacts + member IDs in one call |
| 06  | `06-full-determination.bru`    | Full SNAP determination — get a benefit amount                     |
| 07  | `07-intermediate-gate.bru`     | Querying an intermediate fact directly                             |
| 08  | `08-error-missing-target.bru`  | 400 Problem Details                                                |
| 09  | `09-error-unknown-ruleset.bru` | 404 Problem Details                                                |
| 10  | `10-error-unknown-target.bru`  | 404 Problem Details, multiple bad targets surfaced together        |

Run them in order on the first session — each one builds on the previous
one as documentation of the API surface.

## Quick reference: request shape

```json
{
  "targets":  ["/eligible"],
  "inputs":   { "/grossEarnedIncome": 1500 },
  "entities": {
    "/members": [
      { "id": "applicant", "/members/*/age": 30, ... }
    ]
  },
  "include":  ["supportingFacts"],
  "metadata": { "applicationId": "abc-123" }
}
```

All fields except `targets` are optional. `id` on entity rows lets you
correlate per-member response values back to specific rows.

## Adding bearer-token auth

The API is open by default in `local`. To exercise the auth path:

1. Set `API_BEARER_TOKEN` in your `.env` (or shell) before starting the
   API: `API_BEARER_TOKEN=dev-token-please-rotate npm run dev:api`.
2. Edit `environments/local.bru` and set `api_token` to the same value.
3. Edit any `.bru` file you want to authenticate and add an `auth:bearer`
   block (or `headers { Authorization: Bearer {{api_token}} }`).

The collection ships without auth headers so the first-time experience
"just works" against an open dev server.

## Editing or extending the collection

Each `.bru` file is a small text format — readable on GitHub, diffable in
PRs, editable in Bruno's GUI or in any text editor. To add a new request,
duplicate one of the existing files and tweak the `meta`, `url`, and
`body:json` sections. The `seq` field controls ordering in the sidebar.

When adding a request that demonstrates a meaningful API behavior, drop
it into this collection — the partner team uses it as a working
reference, so we want it to stay current.
