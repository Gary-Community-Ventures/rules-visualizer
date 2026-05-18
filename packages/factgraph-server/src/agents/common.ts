import type { TaskSource } from './types.js'

export const SUMMARY_MARKER_START = '<<TASK_RESULT>>'
export const SUMMARY_MARKER_END = '<<TASK_END>>'

export const SYSTEM_PROMPT = `You are editing fact-graph XML rulesets in the current working directory.

RULESET SCOPE:
  The current working directory is the selected ruleset and is the only ruleset
  you should inspect or edit. Do not read, search, cite, or modify parent
  directories or sibling ruleset directories. If the user asks about todos,
  missing work, facts, tests, policy references, or files, answer only from this
  current ruleset directory.

POLICY REFERENCES — references.json (next to the XML files):
  documents[]  PDFs registered for this ruleset
  sections[]   captured PDF highlights — each has id, documentId, page, text
  mappings[]   { nodePath, sectionId } pairs — what the visualizer renders
               as "policy" on a node. nodePath is the fact's path (the
               value of <Fact path="…">).

WHENEVER you add or edit a fact that derives from policy, you MUST also
append a mapping to references.json. Two cases:

(A) The user's message includes <policy-sources>...</policy-sources>.
    Each <source> tag has a sectionId attribute. Use it directly:
      { "nodePath": "/yourFactPath", "sectionId": "<sectionId from source>" }
    This is the normal case — do not search references.json for an
    alternative section, the user picked this one.

(B) No source attached. Read references.json, grep sections[] by text
    for a passage that matches the fact, and map to that section's id.
    Only ask the user to capture the excerpt if nothing matches.

Never invent a sectionId. Never use a section's label or page number as
an id. If a node already has the right mapping, leave it alone.

FACT-GRAPH SYNTAX NOTES (engine extensions you won't find in stock docs):

\`^\` (caret) in a Dependency path escapes one Filter/Find/IndexOf scope
and lands at the parent of the host fact. Use it when a Filter predicate
needs to refer back to the surrounding collection-item.

  - \`^/active\` inside \`<Filter path="/incomes">\` on a host fact at
    \`/members/*/X\` resolves to \`/members/*/active\` — the surrounding
    member's active flag.
  - Bare \`^\` resolves to the surrounding member itself, useful for
    comparing a CollectionItem reference: \`<Equal><Left><Dependency
    path="memberId"/></Left><Right><Dependency path="^"/></Right></Equal>\`
    means "this income belongs to the surrounding member."
  - \`^^\` escapes two scopes (nested Filter inside Filter).
  - Bare names like \`<Dependency path="memberId"/>\` inside a Filter
    resolve against the iterated collection (\`/incomes/*/memberId\`), not
    against the host. Use \`^\` when you want to reach back out.

\`<Count>\` vs \`<CollectionSize>\` — easy to confuse:
  - \`<Count>\` takes a BooleanNode that returns multiple values (typically
    a Dependency on a wildcard path like \`/collection/*/bool\`). It counts
    how many are true.
  - \`<CollectionSize>\` takes a CollectionNode and returns its length.
    Use this to count the items in a \`<Filter>\` result — Filter returns
    a Collection, not a Boolean, so wrapping it in \`<Count>\` will fail
    with "invalid child type."

When you finish, print exactly one line in this form (and nothing after it):
${SUMMARY_MARKER_START}{"summary":"<one-sentence summary>","modifiedPaths":["/factPath",...]}${SUMMARY_MARKER_END}

Only include fact paths you actually added or edited. The visualizer parses this line to surface what you touched.`

/** Render attached sources as a labeled block injected into the user prompt. */
export function formatSources(sources: TaskSource[] | undefined): string {
  if (!sources || sources.length === 0) return ''
  const esc = (s: string) => s.replace(/"/g, '&quot;')
  const blocks = sources.map((s, i) => {
    const attrs: string[] = [`index="${i + 1}"`, `sectionId="${s.sectionId}"`]
    if (s.documentTitle) attrs.push(`document="${esc(s.documentTitle)}"`)
    // file + page give the agent enough to locate this source on disk
    // (e.g. via `pdftotext -l N -f N <file>`) for surrounding context.
    if (s.documentFile) attrs.push(`file="${esc(s.documentFile)}"`)
    if (s.page !== undefined) attrs.push(`page="${s.page}"`)
    if (s.comment) attrs.push(`comment="${esc(s.comment)}"`)
    const text = (s.text ?? '').trim()
    return `<source ${attrs.join(' ')}>\n${text || '(no text captured)'}\n</source>`
  })
  return `\n\n<policy-sources>\n${blocks.join('\n')}\n</policy-sources>`
}

export function parseSummaryMarker(
  text: string
): { summary: string; modifiedPaths: string[] } | undefined {
  const start = text.lastIndexOf(SUMMARY_MARKER_START)
  if (start < 0) return undefined
  const end = text.indexOf(SUMMARY_MARKER_END, start)
  if (end < 0) return undefined
  const json = text.slice(start + SUMMARY_MARKER_START.length, end).trim()
  try {
    const parsed = JSON.parse(json)
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      modifiedPaths: Array.isArray(parsed.modifiedPaths)
        ? parsed.modifiedPaths.filter(
            (p: unknown): p is string => typeof p === 'string'
          )
        : [],
    }
  } catch {
    return undefined
  }
}

// Single-quote-safe POSIX quoting: end-quote, backslash-escape the quote,
// re-open. Lets the user paste straight into bash/zsh.
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
