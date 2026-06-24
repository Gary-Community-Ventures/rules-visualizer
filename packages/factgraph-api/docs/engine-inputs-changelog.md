# Engine inputs — schema changelog

Changes to the field catalog that consumers build their data models against.
Each entry corresponds to a `schemaVersion` bump in `engine-inputs.json`.

For the full field catalog at a given version, see the versioned HTML pages
linked from [engine-inputs.html](https://gary-community-ventures.github.io/rules-visualizer/engine-inputs.html)
or the committed JSON snapshots (`docs/engine-inputs-v*.json`).

---

## v1.0.0 — 2026-06-24

Initial published version of the engine-shaped input catalog.

**Coverage:**
- SNAP (`snap-complete` ruleset) — near-complete field coverage for a full determination
- Medicaid (`medicaid` ruleset) — illustrative subset; not yet exhaustive

**Field groups:**
- Member (demographics, citizenship, disability, work, household flags)
- Income (nested under each member — wages, SSI, SNAP gross income, etc.)
- Expenses (shelter, utilities, medical, dependent care)
- Jobs (employment status, hours)
- Assets (liquid resources, vehicles)
- Caregiver relationships (id references between members)
- Household & application (application date, utility expenses, household-level flags)
