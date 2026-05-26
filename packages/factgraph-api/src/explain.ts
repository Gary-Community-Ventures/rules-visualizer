/**
 * Structured trace / explanation for a queried fact.
 *
 * Walks the parsed XML logic of a derived fact, descends into each
 * sub-expression, and produces a tree of TraceNode entries that show
 * how the fact's value was derived from its inputs. The tree is the
 * "why" that powers caseworker UIs like "Denied because gross monthly
 * income ($3,500) exceeds the limit of $3,380".
 *
 * The walker is structural — it looks at the operator at each node
 * (All, Any, Not, comparisons, Dependency, literals) and chooses how
 * to recurse. It doesn't know SNAP, it knows boolean algebra and
 * comparison semantics. New rulesets get explanations for free as long
 * as they stick to the supported operator vocabulary.
 *
 * V1 scope: All, Any, Not, the six comparisons, Dependency references,
 * and the common literal types. Other operators (Switch, Multiply,
 * Round, Subtract, GreaterOf, etc.) are surfaced as "opaque" — the
 * computed value is in the trace but we don't descend into the
 * sub-expressions. Callers wanting deeper detail can target those
 * intermediate facts directly via a second /query call.
 */
import { XMLParser } from 'fast-xml-parser'
import type {
  Model,
  ModelNode,
  ResolvedReference,
} from 'rules-visualizer-shared-types'

import { type ModelIndex } from './model-index.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TraceCitation = {
  /** Stable identifier of the section in the ruleset's references.json. */
  sectionId: string
  /** Document title (e.g. "10 CCR 2506-1 SNAP"). */
  documentTitle: string
  /** Direct link to the document, when one was provided. */
  documentUrl?: string
  /** Optional human-written note attached to the section. */
  comment?: string
  /** PDF page where the section was captured (if any). */
  page?: number
}

export type TraceNode = {
  /** Fact path when this node corresponds to a model node. Anonymous
   *  sub-expressions (e.g. the inner `LessThanOrEqual` of an `Any`)
   *  omit this. */
  path?: string
  /** Display name for the fact at `path`. */
  name?: string
  /** XML description for the fact at `path`. */
  description?: string
  /** Operator tag — All, Any, Not, GreaterThan, Dependency, Int, Opaque, etc. */
  op: string
  /** Computed value for this node, or null if it didn't resolve. */
  value: unknown
  /** One-sentence summary of how this value was decided. */
  reason: string
  /** Sub-nodes that contributed. For All/Any, only the deciding branches.
   *  Empty/undefined on terminals. */
  children?: TraceNode[]
  /** Policy citations resolved from references.json. */
  citations?: TraceCitation[]
}

// ---------------------------------------------------------------------------
// Internal AST
// ---------------------------------------------------------------------------

type LogicNode = {
  op: string
  attrs: Record<string, string>
  text?: string
  children: LogicNode[]
}

// preserveOrder keeps the original document order of child elements,
// which matters for "first false child" semantics on All. Each top-level
// entry is wrapped in an array of single-key objects.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: true,
})

function parseLogic(xml: string): LogicNode | null {
  // The stored logic is the inner XML, e.g. "<All><Dependency.../></All>".
  // fast-xml-parser with preserveOrder returns a list of node entries.
  const parsed = xmlParser.parse(xml) as Array<Record<string, unknown>>
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  return toLogicNode(parsed[0])
}

function toLogicNode(raw: Record<string, unknown>): LogicNode | null {
  // preserveOrder entries look like:  { Tag: [<children>], ':@': {<attrs>} }
  let op = ''
  let payload: unknown = null
  for (const key of Object.keys(raw)) {
    if (key === ':@') continue
    op = key
    payload = (raw as Record<string, unknown>)[key]
    break
  }
  if (!op) return null

  const attrsRaw = (raw[':@'] ?? {}) as Record<string, unknown>
  const attrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrsRaw)) {
    if (k.startsWith('@_')) attrs[k.slice(2)] = String(v)
  }

  // Text nodes inside an element come as { '#text': '0' }.
  let text: string | undefined
  const children: LogicNode[] = []
  if (Array.isArray(payload)) {
    for (const entry of payload as Array<Record<string, unknown>>) {
      if (entry && typeof entry === 'object') {
        if ('#text' in entry) {
          text = String((entry as Record<string, unknown>)['#text']).trim()
          continue
        }
        const sub = toLogicNode(entry)
        if (sub) children.push(sub)
      }
    }
  } else if (payload != null) {
    text = String(payload).trim()
  }

  return { op, attrs, text, children }
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

const BOOLEAN_OPS = new Set(['All', 'Any', 'Not'])
const COMPARISON_OPS = new Set([
  'GreaterThan',
  'GreaterThanOrEqual',
  'LessThan',
  'LessThanOrEqual',
  'Equal',
  'NotEqual',
])
const LITERAL_OPS = new Set([
  'Int',
  'Dollar',
  'Short',
  'Byte',
  'String',
  'Day',
  'Rational',
  'True',
  'False',
  'Boolean',
])

/**
 * Build a trace tree for the given target fact. Returns null if the
 * fact doesn't exist in the model.
 */
export function buildTrace(
  model: Model,
  index: ModelIndex,
  results: Record<string, unknown>,
  targetPath: string
): TraceNode | null {
  const node = index.pathToNode.get(targetPath)
  if (!node) return null

  // Guard runaway recursion (cycles, deeply-nested rulesets).
  const stack = new Set<string>()
  return walkFact(node, model, index, results, stack, 0)
}

const MAX_DEPTH = 24

function walkFact(
  node: ModelNode,
  model: Model,
  index: ModelIndex,
  results: Record<string, unknown>,
  stack: Set<string>,
  depth: number
): TraceNode {
  const content = node.content
  if (content.type === 'entity' || !('path' in content)) {
    // Should never happen — caller filters entities. Defensive.
    return makeUnsupported(node, results)
  }
  const path = content.path
  const value = results[path]
  const base: TraceNode = {
    path,
    name: getDisplayName(node),
    description: node.description,
    op: 'Unknown',
    value: value ?? null,
    reason: '',
    citations: toCitations(node.references),
  }

  if (depth >= MAX_DEPTH || stack.has(node.id)) {
    base.op = 'Truncated'
    base.reason =
      depth >= MAX_DEPTH
        ? 'Trace truncated at max depth — query this fact directly for a fresh trace.'
        : 'Trace truncated to avoid cycle.'
    return base
  }

  if (content.type === 'writable') {
    base.op = 'Writable'
    base.reason =
      value == null
        ? 'No value provided — this input is still needed.'
        : `Input value: ${formatValue(value)}`
    return base
  }

  // Derived fact. Parse its logic and walk it.
  if (!('logic' in content) || !content.logic) {
    base.op = 'Opaque'
    base.reason = `Computed value: ${formatValue(value)}`
    return base
  }
  const logic = parseLogic(content.logic)
  if (!logic) {
    base.op = 'Opaque'
    base.reason = `Computed value: ${formatValue(value)} (logic could not be parsed)`
    return base
  }

  stack.add(node.id)
  const inner = walkLogic(logic, node, model, index, results, stack, depth + 1)
  stack.delete(node.id)

  // Lift the inner expression's op/reason/children onto the fact node so
  // the trace doesn't double up "/eligible → All". This keeps the path-
  // bearing fact and its top-level expression collapsed into one node.
  base.op = inner.op
  base.reason = inner.reason
  if (inner.children?.length) base.children = inner.children
  return base
}

function walkLogic(
  logic: LogicNode,
  parentNode: ModelNode,
  model: Model,
  index: ModelIndex,
  results: Record<string, unknown>,
  stack: Set<string>,
  depth: number
): TraceNode {
  if (logic.op === 'Dependency') {
    const path = logic.attrs.path ?? ''
    const ref = index.pathToNode.get(path)
    if (!ref) {
      return {
        op: 'Dependency',
        value: null,
        reason: `Unresolved dependency: ${path}`,
      }
    }
    return walkFact(ref, model, index, results, stack, depth + 1)
  }

  if (LITERAL_OPS.has(logic.op)) {
    const v = literalValue(logic)
    return {
      op: logic.op,
      value: v,
      reason: `Literal ${logic.op}: ${formatValue(v)}`,
    }
  }

  if (BOOLEAN_OPS.has(logic.op)) {
    return walkBoolean(logic, parentNode, model, index, results, stack, depth)
  }

  if (COMPARISON_OPS.has(logic.op)) {
    return walkComparison(logic, parentNode, model, index, results, stack, depth)
  }

  // Anything else: opaque sub-expression. We can't observe its value
  // without re-executing, so report it as unknown rather than echoing
  // the parent's value (which is just wrong for sub-expressions).
  return {
    op: logic.op,
    value: null,
    reason: `Computed via ${logic.op} (full breakdown not yet supported — query this subtree directly to see its values).`,
  }
}

function walkBoolean(
  logic: LogicNode,
  parentNode: ModelNode,
  model: Model,
  index: ModelIndex,
  results: Record<string, unknown>,
  stack: Set<string>,
  depth: number
): TraceNode {
  const parentPath =
    parentNode.content.type !== 'entity' && 'path' in parentNode.content
      ? parentNode.content.path
      : undefined
  const parentValue =
    parentPath != null ? results[parentPath] : undefined

  // Special-case Not: walk the single child and report the inversion
  // factually — no value judgment about whether the result is desirable.
  if (logic.op === 'Not') {
    const child = logic.children[0]
    if (!child) {
      return { op: 'Not', value: parentValue ?? null, reason: 'NOT with no operand.' }
    }
    const childTrace = walkLogic(child, parentNode, model, index, results, stack, depth)
    return {
      op: 'Not',
      value: parentValue ?? null,
      reason:
        parentValue === true
          ? 'Operand did not hold, so Not held.'
          : parentValue === false
            ? 'Operand held, so Not did not hold.'
            : 'Operand has not yet evaluated.',
      children: [childTrace],
    }
  }

  // All / Any: evaluate each child's contribution by looking at its
  // computed value. Boolean values are resolved either through a
  // Dependency reference (recurse and read the child fact's value) or
  // through a True/False/Boolean literal.
  //
  // Reason phrasing is intentionally neutral: "held" / "did not hold"
  // describe the truth value of the operator without judging whether
  // that's a desirable outcome. Whether `true` is "good" depends on the
  // caller's domain — `/eligible = false` is a denial, but
  // `/isStriker = true` or `/isDisqualified = true` are also bad
  // outcomes despite their boolean polarity flipping. The walker reports
  // the math; the UI interprets it.
  const childTraces: TraceNode[] = logic.children.map((c) =>
    walkLogic(c, parentNode, model, index, results, stack, depth)
  )

  if (logic.op === 'All') {
    if (parentValue === true) {
      return {
        op: 'All',
        value: true,
        reason:
          childTraces.length === 1
            ? 'The single operand held.'
            : `All ${childTraces.length} operands held.`,
        children: childTraces,
      }
    }
    if (parentValue === false) {
      // First false child is the deciding one — surface it in the
      // parent reason, but keep every child in `children` for context.
      const failing = childTraces.find((c) => c.value === false)
      return {
        op: 'All',
        value: false,
        reason: failing
          ? `${describeOperand(failing)} did not hold.`
          : 'At least one operand did not hold.',
        children: childTraces,
      }
    }
    return {
      op: 'All',
      value: null,
      reason: 'At least one operand has not yet evaluated.',
      children: childTraces,
    }
  }

  // Any
  if (parentValue === true) {
    const passing = childTraces.find((c) => c.value === true)
    return {
      op: 'Any',
      value: true,
      reason: passing
        ? `${describeOperand(passing)} held.`
        : 'At least one operand held.',
      children: childTraces,
    }
  }
  if (parentValue === false) {
    return {
      op: 'Any',
      value: false,
      reason:
        childTraces.length === 1
          ? 'The single operand did not hold.'
          : `None of the ${childTraces.length} operands held.`,
      children: childTraces,
    }
  }
  return {
    op: 'Any',
    value: null,
    reason: 'No operand has held yet, and others have not evaluated.',
    children: childTraces,
  }
}

function walkComparison(
  logic: LogicNode,
  parentNode: ModelNode,
  model: Model,
  index: ModelIndex,
  results: Record<string, unknown>,
  stack: Set<string>,
  depth: number
): TraceNode {
  // Comparison ops wrap operands in <Left> and <Right> elements.
  const leftWrap = logic.children.find((c) => c.op === 'Left')
  const rightWrap = logic.children.find((c) => c.op === 'Right')
  const leftLogic = leftWrap?.children[0]
  const rightLogic = rightWrap?.children[0]

  const leftTrace = leftLogic
    ? walkLogic(leftLogic, parentNode, model, index, results, stack, depth)
    : ({ op: 'Unknown', value: null, reason: 'Missing left operand' } as TraceNode)
  const rightTrace = rightLogic
    ? walkLogic(rightLogic, parentNode, model, index, results, stack, depth)
    : ({ op: 'Unknown', value: null, reason: 'Missing right operand' } as TraceNode)

  const parentValue =
    parentNode.content.type !== 'entity' && 'path' in parentNode.content
      ? results[parentNode.content.path]
      : undefined

  const symbol = COMPARISON_SYMBOLS[logic.op] ?? logic.op
  const lhs = formatValue(leftTrace.value)
  const rhs = formatValue(rightTrace.value)

  let reason: string
  if (parentValue === true) {
    reason = `${describeOperand(leftTrace)} (${lhs}) ${symbol} ${describeOperand(rightTrace)} (${rhs}) — held.`
  } else if (parentValue === false) {
    reason = `${describeOperand(leftTrace)} (${lhs}) ${symbol} ${describeOperand(rightTrace)} (${rhs}) — did not hold.`
  } else {
    reason = `${describeOperand(leftTrace)} ${symbol} ${describeOperand(rightTrace)} — pending.`
  }

  return {
    op: logic.op,
    value: parentValue ?? null,
    reason,
    children: [leftTrace, rightTrace],
  }
}

const COMPARISON_SYMBOLS: Record<string, string> = {
  GreaterThan: '>',
  GreaterThanOrEqual: '≥',
  LessThan: '<',
  LessThanOrEqual: '≤',
  Equal: '=',
  NotEqual: '≠',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeOperand(trace: TraceNode): string {
  if (trace.name) return trace.name
  if (trace.path) return trace.path
  return trace.op
}

function literalValue(node: LogicNode): unknown {
  // <Int>0</Int> → 0;  <Dollar>3380</Dollar> → 3380;  <True/> → true.
  if (node.op === 'True') return true
  if (node.op === 'False') return false
  if (node.op === 'Boolean') {
    if (node.text === 'true') return true
    if (node.text === 'false') return false
    return node.text
  }
  if (node.text == null) return null
  // Numeric types come through as strings — coerce when safe.
  if (
    node.op === 'Int' ||
    node.op === 'Short' ||
    node.op === 'Byte' ||
    node.op === 'Dollar'
  ) {
    const n = Number(node.text)
    return Number.isFinite(n) ? n : node.text
  }
  return node.text
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `[${value.length} values]`
  return JSON.stringify(value)
}

function getDisplayName(node: ModelNode): string {
  const c = node.content
  if (c.type === 'entity') return node.name
  if ('label' in c && c.label) return c.label
  return node.name
}

function toCitations(
  refs: ResolvedReference[] | undefined
): TraceCitation[] | undefined {
  if (!refs || refs.length === 0) return undefined
  return refs.map((r) => ({
    sectionId: r.section.id,
    documentTitle: r.document.title,
    documentUrl: r.document.url,
    comment: r.section.comment,
    page: r.section.page,
  }))
}

function makeUnsupported(node: ModelNode, results: Record<string, unknown>): TraceNode {
  const path =
    node.content.type !== 'entity' && 'path' in node.content
      ? node.content.path
      : undefined
  return {
    path,
    name: getDisplayName(node),
    op: 'Unsupported',
    value: path ? (results[path] ?? null) : null,
    reason: 'This node type is not currently traceable.',
  }
}
