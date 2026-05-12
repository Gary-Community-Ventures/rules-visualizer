# Claude Code Instructions

## Commit Message Workflow

After completing any work, append a short description of the changes to `.git/CLAUDE_MSG`. Use this format:

```
- Brief description of what changed
```

A `prepare-commit-msg` hook prepends this into the commit editor and deletes the file automatically.

## No cosmetic formatting without being asked

Don't title-case, capitalize, or reformat identifiers for display unless
explicitly asked. That means no `capitalize` / `uppercase` Tailwind classes
on path/name labels, no `.replace(/[-_]/g, ' ')`, no `.replace(/\b\w/g, c =>
c.toUpperCase())`. Display collection names, node names, field names, and
paths exactly as they appear in the data. `getCollectionDisplayName` (which
just strips the leading `/`) is the only sanctioned transform. If a raw
identifier looks ugly, surface that concern in the source data — don't
paper over it in the render layer.

## Node/field identifiers: always use the path

Every fact/variable in both the Fact Graph and RuleSpec rulesets is identified
by its full `path`. Node IDs are paths (see
`packages/factgraph-server/src/parsers/factgraph.ts` and
`packages/rac-server/rules_visualizer_rac/rulespec_parser.py`). Entity data
rows use the full path as the field key (e.g. `"/members/*/age"`, not
`"age"`).

Do **not** split a path to reconstruct a shorter field name (no `segments[segments.length - 1]`,
no `.slice(1)`, no `.replace('/*/', '')`). If you catch yourself writing that
logic, use `getCollectionFieldKey(node)` in `frontend/src/context/model-context.tsx`
— which just returns the node's path — or pass the path through unchanged. The
only legitimate consumer of the short form is the executor boundary where it
talks to the Scala factgraph API (`/members/#${uuid}/field`), and that
conversion happens exactly once in `packages/factgraph-server/src/executor.ts`
via `fieldPath.replace('/*/', '/#${uuid}/')`.
