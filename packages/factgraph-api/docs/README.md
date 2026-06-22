# Documentation index

Eleven files, three audiences. Start with the row that matches why you're here.

## I'm integrating a caseworker tool / portal (the v1 adapter — frozen)

| Read | What it is |
|---|---|
| [`eligibility-adapter-openapi.yaml`](./eligibility-adapter-openapi.yaml) | The consumer contract v1 implements — ORCA-shaped requests in, `ProgramDecision` out, no rules-engine internals. Live Swagger: `/v1/eligibility/docs` |
| [`v1-conformance.md`](./v1-conformance.md) | Clause-by-clause conformance to the published adapter contract: what's exact, where we're more lenient, the two deliberate deviations, and findings in the published contract itself |
| [`bruno/eligibility-adapter/`](./bruno/eligibility-adapter/) | Runnable requests for every adapter behavior — open in [Bruno](https://www.usebruno.com/), set the token, click Send |
| [`changelog.md`](./changelog.md) | Public surface changes, with migration notes |

## I'm integrating with the v2 engine-shaped API

Read in this order — field catalog first, then the contract, then background if needed:

| Read | What it is |
|---|---|
| [`eligibility-adapter-v2-proposal-openapi.yaml`](./eligibility-adapter-v2-proposal-openapi.yaml) | The v2 contract — per-program endpoints, no-guess, per-member `missingInputs`. Live Swagger: `/v2/eligibility/docs` |
| [`input-dictionary.md`](./input-dictionary.md) | **Generated** field semantics: rule-author-written definitions, full enum vocabularies, policy citations, and consuming programs for every request field. Never hand-edited — regenerated from the rulesets |
| [`request-field-proposal.md`](./request-field-proposal.md) | Background: the no-guess policy and the rationale for the domain-shaped request fields |
| [`contract-gap-analysis.md`](./contract-gap-analysis.md) | Background: what the v1 ORCA contract carries vs. what the SNAP/Medicaid rules actually need (informed the v2 design) |

## I want direct access to the rules engine (the advanced API)

| Read | What it is |
|---|---|
| [`openapi.yaml`](./openapi.yaml) | The generic Fact Graph query/discovery contract (`/v1/factgraph/...`) — targets, traces, missing-inputs. Live Swagger: `/v1/factgraph/docs` |
| [`concepts.md`](./concepts.md) | The incompleteness model: how partial input, missing-inputs detection, and short-circuiting behave |
| [`examples-snap.md`](./examples-snap.md) | Worked SNAP walkthroughs against the query endpoint, including the full adapter-shape-to-query translation |
| [`bruno/`](./bruno/) | Runnable request collection ([Bruno](https://www.usebruno.com/)) — `eligibility-adapter/` for the consumer endpoints, `advanced-query/` for the query API |
| [`examples/`](./examples/) | Ready-to-POST `snap-complete` query bodies — all-inputs (every writable), minimal (31 fields, same result), and multi-member |

## How the documents relate

The **rules** are the source of truth: the input dictionary is generated from
them, the v2 contract is shaped by them, and v1 translates the published
contract onto them. When a rule author adds an input, CI fails until the
field map (and therefore the dictionary and contract) accounts for it.
