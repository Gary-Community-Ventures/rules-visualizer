# Bruno collection — Factgraph API

A ready-to-run collection of API calls against the Factgraph adapter API.
Open this directory in [Bruno](https://www.usebruno.com/) and click Send on
any request — no copy-paste, no JSON formatting.

## Quick start

1. **Install Bruno** — `brew install --cask bruno` on macOS, or download from
   [usebruno.com](https://www.usebruno.com/downloads).
2. **Open this folder** — File → Open Collection, point at
   `packages/factgraph-api/docs/bruno/`.
3. **Pick an environment** — top-right dropdown in Bruno. `local` points at
   `http://localhost:5002`; `prod` points at the deployed Heroku URL.
4. **Set the bearer token** — open the env editor in Bruno and paste the
   token into the `api_token` secret. See "Bearer-token auth" below.
5. **For `local`**: start the API with `npm run dev:api` from the repo root.
6. **Click Send** on any request.

## What's in here

| #   | File                            | Tests                                                                                                  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 01  | `01-health.bru`                 | Liveness probe                                                                                         |
| 02  | `02-list-rulesets.bru`          | Discovering which rulesets the server has loaded                                                       |
| 03  | `03-get-schema.bru`             | Inspecting one ruleset's node definitions                                                              |
| 04  | `04-discover-inputs.bru`        | Empty query → full intake-form shape (smart walker)                                                    |
| 05  | `05-bbce-determination.bru`     | Multi-target + metadata + supportingFacts + member IDs in one call                                     |
| 06  | `06-full-determination.bru`     | Full SNAP determination — get a benefit amount                                                         |
| 07  | `07-intermediate-gate.bru`      | Querying an intermediate fact directly                                                                 |
| 08  | `08-error-missing-target.bru`   | 400 Problem Details                                                                                    |
| 09  | `09-error-unknown-ruleset.bru`  | 404 Problem Details                                                                                    |
| 10  | `10-error-unknown-target.bru`   | 404 Problem Details, multiple bad targets surfaced together                                            |
| 11  | `11-trace-denial.bru`           | Structured trace/explanation tree via `include: ["trace"]`                                             |
| 12  | `12-snap-complete-eligible.bru` | `snap-complete` real-world scenario mapping a HouseholdDeterminationRequest → /query → ProgramDecision |

Run them in order on the first session — each one builds on the previous
one as documentation of the API surface.

## Quick reference: request shape

```json
{
  "targets":  ["/eligible"],
  "inputs": {
    "/grossEarnedIncome": 1500,
    "/members": [
      { "id": "applicant", "/members/*/age": 30, ... }
    ]
  },
  "include":  ["supportingFacts"],
  "metadata": { "applicationId": "abc-123" }
}
```

Scalar facts and collection rows live in the same `inputs` map. The
key shape (path vs collection root) tells you which is which; the
value shape mirrors that on the response side too.

All fields except `targets` are optional. `id` on entity rows lets you
correlate per-member response values back to specific rows.

## Environments

| Env     | `base_url`              | Notes                                                             |
| ------- | ----------------------- | ----------------------------------------------------------------- |
| `local` | `http://localhost:5002` | Run `npm run dev:api` from the repo root. Auth is off by default. |
| `prod`  | The deployed Heroku URL | Bearer token required. Get the token from the team.               |

Pick the environment in Bruno's top-right dropdown before clicking Send.

## Bearer-token auth

Every `/v1/*` request in the collection uses `auth: bearer` with the
`{{api_token}}` variable. The token is declared as a **secret variable**
in each environment file, which means Bruno stores its actual value in a
gitignored local file (`environments/local.env.local`, etc.) — never in
the committed `.bru`.

**Setting the token in Bruno:**

1. Pick the environment (top-right dropdown).
2. Click the environment name → opens the env editor.
3. Find `api_token` in the secrets list, paste the value, save.

The value is stored locally and gets sent on every request via the
`auth:bearer` block.

**Don't have a token?** Ask whoever set up the deploy. For `local`, the
API is open by default (server reads `API_BEARER_TOKEN` from its env
and skips auth when unset), so you can leave `api_token` empty and
requests still succeed.

## Editing or extending the collection

Each `.bru` file is a small text format — readable on GitHub, diffable in
PRs, editable in Bruno's GUI or in any text editor. To add a new request,
duplicate one of the existing files and tweak the `meta`, `url`, and
`body:json` sections. The `seq` field controls ordering in the sidebar.

When adding a request that demonstrates a meaningful API behavior, drop
it into this collection — the partner team uses it as a working
reference, so we want it to stay current.
