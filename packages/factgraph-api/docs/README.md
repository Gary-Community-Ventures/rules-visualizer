# Documentation index

Eleven files, three audiences. Start with the row that matches why you're here.

## I'm integrating a caseworker tool / portal (the v1 adapter)

| Read | What it is |
|---|---|
| [`eligibility-adapter-openapi.yaml`](./eligibility-adapter-openapi.yaml) | The consumer contract v1 implements — ORCA-shaped requests in, `ProgramDecision` out, no rules-engine internals. Live Swagger: `/v1/eligibility/docs` |
| [`v1-conformance.md`](./v1-conformance.md) | Clause-by-clause conformance to the published adapter contract: what's exact, where we're more lenient, the two deliberate deviations, and findings in the published contract itself |
| [`changelog.md`](./changelog.md) | Public surface changes, with migration notes |

## I'm reviewing the contract proposal (the v2 draft)

Read in this order — rationale, then the contract, then the field semantics:

| Read | What it is |
|---|---|
| [`contract-gap-analysis.md`](./contract-gap-analysis.md) | What the published contract carries vs. what the SNAP/Medicaid rules actually need, bucketed (covered / derivable / proposed addition / verification-only), plus the cardinality and response-vocabulary findings |
| [`request-field-proposal.md`](./request-field-proposal.md) | The no-guess policy and the proposed domain-shaped request fields, with the reasoning per group |
| [`eligibility-adapter-v2-proposal-openapi.yaml`](./eligibility-adapter-v2-proposal-openapi.yaml) | The proposal as an executable OpenAPI document — draft for review; live Swagger: `/v2/eligibility/docs` |
| [`input-dictionary.md`](./input-dictionary.md) | **Generated** field semantics: rule-author-written definitions, full enum vocabularies, policy citations, and consuming programs for every v2 request field. Never hand-edited — regenerated from the rulesets |

## I want direct access to the rules engine (the advanced API)

| Read | What it is |
|---|---|
| [`openapi.yaml`](./openapi.yaml) | The generic Fact Graph query/discovery contract (`/v1/factgraph/...`) — targets, traces, missing-inputs. Live Swagger: `/v1/factgraph/docs` |
| [`concepts.md`](./concepts.md) | The incompleteness model: how partial input, missing-inputs detection, and short-circuiting behave |
| [`examples-snap.md`](./examples-snap.md) | Worked SNAP walkthroughs against the query endpoint, including the full adapter-shape-to-query translation |
| [`bruno/`](./bruno/) | Runnable request collection ([Bruno](https://www.usebruno.com/)) covering the query endpoints end to end |

## How the documents relate

The **rules** are the source of truth: the input dictionary is generated from
them, the v2 contract is shaped by them, and v1 translates the published
contract onto them. When a rule author adds an input, CI fails until the
field map (and therefore the dictionary and contract) accounts for it.
