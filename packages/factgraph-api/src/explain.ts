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
 * Scope: All, Any, Not, the six comparisons, Switch/Case/When, Dependency
 * references (absolute, `../sibling`, `^` escape, and bare sibling names —
 * matching the parser's resolution rules), and the common literal types
 * (including Enum). Switch is the branch-selection operator behind every
 * categorical decision, so descending it is what lets a denial trace reach
 * the gate that actually failed rather than stopping at the top-level
 * category node. Collection-scoped facts (paths with a `/*` segment) are
 * traced once per row, with each sub-trace tagged by the caller's row id
 * (`memberId`). Arithmetic and collection operators (Multiply, Round,
 * Subtract, GreaterOf, Filter, Count, etc.) are still surfaced as "opaque"
 * — the computed value is in the trace but we don't descend into the
 * sub-expressions. Dependency paths that traverse a collection reference
 * (e.g. `relatedTo/isHeadOfHousehold`) are likewise surfaced but not
 * descended. Callers wanting that deeper value-composition detail can
 * target those intermediate facts directly via a second /query call.
 *
 * Value semantics: each sub-expression's `value` is derived from its own
 * operands (a comparison computes its comparison, a nested All derives
 * from its children), falling back to `null` when operands are opaque or
 * unresolved. The one exception is the root expression of a fact, whose
 * value is the engine's computed result for that fact — ground truth wins
 * where we have it.
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
  /** Operator tag — All, Any, Not, GreaterThan, Dependency, Int, Opaque,
   *  PerMember, etc. */
  op: string
  /** Computed value for this node, or null if it didn't resolve. */
  value: unknown
  /** One-sentence summary of how this value was decided. */
  reason: string
  /** On the per-row children of a `PerMember` node: the caller-provided
   *  row id this sub-trace belongs to (`member-N` fallback when the
   *  request row carried no id). */
  memberId?: string
  /** When this node appears inside its parent's `children` array, indicates
   *  whether it contributed to the parent's value. For an `All` that's
   *  false, only the first false child is decisive. For an `Any` that's
   *  true, only the first true child is. For `All`-true and `Any`-false,
   *  every operand contributed equally and they all carry decisive=true.
   *  Single-operand structures (Not, leaf comparisons) are always
   *  decisive. Always undefined on the root of a trace. */
  decisive?: boolean
  /** Sub-nodes that contributed or sat alongside. For All/Any, every
   *  operand appears regardless of whether it was decisive — use the
   *  `decisive` flag to filter. Empty/undefined on terminals. */
  children?: TraceNode[]
  /** Policy citations resolved from references.json. */
  citations?: TraceCitation[]
}

/**
 * Compact summary of the path-bearing nodes that drove a trace's
 * outcome — `[target, deciding child, …, deepest single-leaf cause]`.
 * Stops at the first branch point (`All`-true with multiple operands,
 * `Any`-false where every operand failed, a multi-row `PerMember`
 * wrapper) since beyond that the causation fans out and a flat list
 * misrepresents it. The full trace is still available via
 * `TraceNode.children` for callers that want to drill into branched
 * chains.
 */
export type DecidingPathStep = {
  path: string
  name?: string
  value: unknown
  /** Operator at this point — useful for picking icons or color in a UI. */
  op: string
  /** Set on steps inside a per-row sub-trace: the row this step belongs to. */
  memberId?: string
}

export type DecidingPath = DecidingPathStep[]

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
  'Enum',
])

/** Everything a walk needs besides the node at hand. `memberIdx` +
 *  `memberRoot` are set when tracing one row's slice of a collection-
 *  scoped target: any fact under `<memberRoot>/*` whose execution result
 *  is a positional array is read at that row's index. */
type WalkCtx = {
  model: Model
  index: ModelIndex
  results: Record<string, unknown>
  stack: Set<string>
  memberIdx?: number
  memberRoot?: string
}

/** The execution-results value for a fact, sliced to the current row when
 *  the walk is scoped to one member of a collection. */
function factValue(path: string, ctx: WalkCtx): unknown {
  const raw = ctx.results[path]
  if (
    ctx.memberIdx !== undefined &&
    ctx.memberRoot !== undefined &&
    Array.isArray(raw) &&
    path.startsWith(ctx.memberRoot + '/*/')
  ) {
    return raw[ctx.memberIdx]
  }
  return raw
}

/**
 * Build a trace tree for the given target fact. Returns null if the
 * fact doesn't exist in the model.
 *
 * Collection-scoped targets (whose execution result is a positional
 * array) get a `PerMember` root with one fully-walked sub-trace per row,
 * each tagged with the caller's row id from `memberIdsByCollection`
 * (same ids the response's `values` arrays use).
 */
export function buildTrace(
  model: Model,
  index: ModelIndex,
  results: Record<string, unknown>,
  targetPath: string,
  memberIdsByCollection?: Record<string, string[]>
): TraceNode | null {
  const node = index.pathToNode.get(targetPath)
  if (!node) return null

  const collMatch = targetPath.match(/^(\/[^*]+?)\/\*\//)
  const raw = results[targetPath]
  if (collMatch && Array.isArray(raw)) {
    const root = collMatch[1]
    const ids = memberIdsByCollection?.[root] ?? []
    const children = raw.map((_, idx) => {
      const child = walkFact(
        node,
        { model, index, results, stack: new Set(), memberIdx: idx, memberRoot: root },
        0
      )
      child.memberId = ids[idx] ?? `member-${idx}`
      // Each row's value stands on its own — mark all decisive (like
      // All-true: every child contributed equally). With a single row the
      // deciding path continues into that row's chain.
      child.decisive = true
      return child
    })
    return {
      path: targetPath,
      name: getDisplayName(node),
      description: node.description,
      op: 'PerMember',
      value: raw,
      reason:
        children.length === 1
          ? 'Collection-scoped fact — traced for the single row.'
          : `Collection-scoped fact — traced separately for each of the ${children.length} rows.`,
      children,
      citations: toCitations(node.references),
    }
  }

  // Guard runaway recursion (cycles, deeply-nested rulesets).
  return walkFact(node, { model, index, results, stack: new Set() }, 0)
}

/**
 * Extract the deciding chain from a trace. Walks down following the
 * single decisive child at each step; stops as soon as a node has
 * either zero children or multiple decisive children (the latter is
 * the All-true / Any-false branch point — both sides contributed
 * equally, so a linear path would misrepresent the causation).
 *
 * Returns only path-bearing nodes — anonymous sub-expressions like an
 * inline comparison or arithmetic node are skipped in favor of the
 * surrounding fact they live under.
 */
export function buildDecidingPath(root: TraceNode): DecidingPath {
  const out: DecidingPath = []
  let cursor: TraceNode | undefined = root
  const visited = new Set<TraceNode>()
  let memberId: string | undefined
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor)
    if (cursor.memberId) memberId = cursor.memberId
    if (cursor.path) {
      out.push({
        path: cursor.path,
        name: cursor.name,
        value: cursor.value,
        op: cursor.op,
        ...(memberId ? { memberId } : {}),
      })
    }
    const deciders: TraceNode[] = (cursor.children ?? []).filter(
      (c) => c.decisive === true
    )
    cursor = deciders.length === 1 ? deciders[0] : undefined
  }
  return out
}

const MAX_DEPTH = 24

function walkFact(node: ModelNode, ctx: WalkCtx, depth: number): TraceNode {
  const content = node.content
  if (content.type === 'entity' || !('path' in content)) {
    // Should never happen — caller filters entities. Defensive.
    return makeUnsupported(node, ctx.results)
  }
  const path = content.path
  const value = factValue(path, ctx)
  const base: TraceNode = {
    path,
    name: getDisplayName(node),
    description: node.description,
    op: 'Unknown',
    value: value ?? null,
    reason: '',
    citations: toCitations(node.references),
  }

  if (depth >= MAX_DEPTH || ctx.stack.has(node.id)) {
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

  ctx.stack.add(node.id)
  // The fact's own execution result is ground truth for its root
  // expression — sub-expressions derive their values from their operands.
  const inner = walkLogic(logic, node, ctx, depth + 1, value ?? null)
  ctx.stack.delete(node.id)

  // Lift the inner expression's op/reason/children onto the fact node so
  // the trace doesn't double up "/eligible → All". This keeps the path-
  // bearing fact and its top-level expression collapsed into one node.
  base.op = inner.op
  base.reason = inner.reason
  if (inner.children?.length) base.children = inner.children
  return base
}

/**
 * Walk one logic sub-expression. `rootValue` is the engine's computed
 * value for the enclosing fact and is only passed for the fact's
 * top-level expression — nested sub-expressions receive `undefined` and
 * derive their value from their own operands (the engine does not expose
 * per-sub-expression results).
 */
function walkLogic(
  logic: LogicNode,
  parentNode: ModelNode,
  ctx: WalkCtx,
  depth: number,
  rootValue?: unknown
): TraceNode {
  if (logic.op === 'Dependency') {
    const rawPath = logic.attrs.path ?? ''
    const parentPath =
      parentNode.content.type !== 'entity' && 'path' in parentNode.content
        ? parentNode.content.path
        : undefined
    const resolved = resolveDependencyPath(rawPath, parentPath)
    const ref = resolved ? ctx.index.pathToNode.get(resolved) : undefined
    if (!ref) {
      // Multi-segment relative paths traverse a collection reference
      // (e.g. `relatedTo/isHeadOfHousehold`) — dereferencing happens in
      // the engine per row and isn't walkable statically.
      const isReferenceHop =
        resolved === undefined && rawPath.includes('/') && !rawPath.startsWith('/')
      return {
        op: 'Dependency',
        value: null,
        reason: isReferenceHop
          ? `Follows a collection reference (${rawPath}) — not traced; query the referenced fact directly.`
          : `Unresolved dependency: ${rawPath}`,
      }
    }
    return walkFact(ref, ctx, depth + 1)
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
    return walkBoolean(logic, parentNode, ctx, depth, rootValue)
  }

  if (COMPARISON_OPS.has(logic.op)) {
    return walkComparison(logic, parentNode, ctx, depth, rootValue)
  }

  if (logic.op === 'Switch') {
    return walkSwitch(logic, parentNode, ctx, depth, rootValue)
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

/**
 * Resolve a Dependency path against its enclosing fact's path, mirroring
 * the parser's rules (see resolvePaths in factgraph-core/src/parser.ts):
 *   - absolute paths pass through;
 *   - `../foo` is a sibling: pop the fact's own leaf;
 *   - `^`/`^^…` pops one segment per caret (the SelfStack escape);
 *   - a bare name is a sibling resolved from the fact's parent.
 * Multi-segment relative paths traverse collection references and return
 * undefined — the caller reports them as untraced rather than unresolved.
 */
function resolveDependencyPath(
  depPath: string,
  factPath: string | undefined
): string | undefined {
  if (depPath.startsWith('/')) return depPath
  if (!factPath || depPath.length === 0) return undefined
  const segs = factPath.split('/').filter(Boolean)

  if (/^\^+(\/|$)/.test(depPath)) {
    const slashIdx = depPath.indexOf('/')
    const head = slashIdx === -1 ? depPath : depPath.slice(0, slashIdx)
    const tail = slashIdx === -1 ? '' : depPath.slice(slashIdx + 1)
    for (let i = 0; i < head.length; i++) segs.pop()
    const base = segs.length === 0 ? '' : '/' + segs.join('/')
    if (tail.length === 0) return base === '' ? '/' : base
    return (base === '' ? '' : base) + '/' + tail
  }

  if (depPath.startsWith('../')) {
    segs.pop()
    let rest = depPath
    while (rest.startsWith('../')) rest = rest.slice(3)
    return '/' + [...segs, rest].join('/')
  }

  if (!depPath.includes('/')) {
    // Bare sibling name, resolved from the fact's parent.
    segs.pop()
    return '/' + [...segs, depPath].join('/')
  }

  return undefined
}

/** Derive a boolean operator's value from its children's values. Null when
 *  the resolved children don't determine the outcome (opaque operands). */
function deriveBoolValue(op: string, childValues: unknown[]): boolean | null {
  if (op === 'All') {
    if (childValues.some((v) => v === false)) return false
    if (childValues.length > 0 && childValues.every((v) => v === true)) return true
    return null
  }
  // Any
  if (childValues.some((v) => v === true)) return true
  if (childValues.length > 0 && childValues.every((v) => v === false)) return false
  return null
}

function walkBoolean(
  logic: LogicNode,
  parentNode: ModelNode,
  ctx: WalkCtx,
  depth: number,
  rootValue?: unknown
): TraceNode {
  // Special-case Not: walk the single child and report the inversion
  // factually — no value judgment about whether the result is desirable.
  if (logic.op === 'Not') {
    const child = logic.children[0]
    if (!child) {
      return {
        op: 'Not',
        value: typeof rootValue === 'boolean' ? rootValue : null,
        reason: 'NOT with no operand.',
      }
    }
    const childTrace = walkLogic(child, parentNode, ctx, depth)
    childTrace.decisive = true
    const derived =
      childTrace.value === true ? false : childTrace.value === false ? true : null
    const value = typeof rootValue === 'boolean' ? rootValue : derived
    return {
      op: 'Not',
      value,
      reason:
        value === true
          ? 'Operand did not hold, so Not held.'
          : value === false
            ? 'Operand held, so Not did not hold.'
            : 'Operand has not yet evaluated.',
      children: [childTrace],
    }
  }

  // All / Any: evaluate each child's contribution by looking at its
  // computed value — a recursed Dependency reads the child fact's
  // execution result; an inline comparison computes from its operands.
  //
  // Reason phrasing is intentionally neutral: "held" / "did not hold"
  // describe the truth value of the operator without judging whether
  // that's a desirable outcome. Whether `true` is "good" depends on the
  // caller's domain — `/eligible = false` is a denial, but
  // `/isStriker = true` or `/isDisqualified = true` are also bad
  // outcomes despite their boolean polarity flipping. The walker reports
  // the math; the UI interprets it.
  const childTraces: TraceNode[] = logic.children.map((c) =>
    walkLogic(c, parentNode, ctx, depth)
  )
  const derived = deriveBoolValue(
    logic.op,
    childTraces.map((c) => c.value)
  )
  // The engine's result is ground truth at the fact's root expression;
  // nested operators rely on the derivation.
  const value = typeof rootValue === 'boolean' ? rootValue : derived

  if (logic.op === 'All') {
    if (value === true) {
      // Every operand had to hold — they're all decisive.
      markAllDecisive(childTraces)
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
    if (value === false) {
      // First false child is decisive; everything else is context.
      const failingIdx = childTraces.findIndex((c) => c.value === false)
      markOneDecisive(childTraces, failingIdx)
      const failing = failingIdx >= 0 ? childTraces[failingIdx] : undefined
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
  if (value === true) {
    // First true child is decisive; the others sat alongside but
    // didn't drive the outcome.
    const passingIdx = childTraces.findIndex((c) => c.value === true)
    markOneDecisive(childTraces, passingIdx)
    const passing = passingIdx >= 0 ? childTraces[passingIdx] : undefined
    return {
      op: 'Any',
      value: true,
      reason: passing
        ? `${describeOperand(passing)} held.`
        : 'At least one operand held.',
      children: childTraces,
    }
  }
  if (value === false) {
    // Every operand had to fail — they're all decisive.
    markAllDecisive(childTraces)
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

function markAllDecisive(nodes: TraceNode[]): void {
  for (const n of nodes) n.decisive = true
}

function markOneDecisive(nodes: TraceNode[], idx: number): void {
  nodes.forEach((n, i) => {
    n.decisive = i === idx
  })
}

/**
 * Switch/Case/When/Then. The engine takes the first Case whose `When` holds
 * and yields that Case's `Then` value, so we evaluate the When conditions in
 * source order, stopping at the first that holds (matching short-circuit
 * semantics — later cases are never reached and don't appear in the trace).
 *
 * Decisiveness has two modes:
 *   - A *real* condition selected the outcome (its When references facts) —
 *     that single condition is decisive, like an `Any` that held.
 *   - The Switch fell through to a catch-all (`<When><True/></When>`) whose
 *     condition carries no information. Then the meaningful causes are the
 *     preceding conditions that did *not* hold — those are marked decisive,
 *     like an `Any`-false where every operand failed. This is what lets a
 *     denial chain descend through the eligibility tiers (each a failed
 *     condition) into the gate that actually failed.
 */
function walkSwitch(
  logic: LogicNode,
  parentNode: ModelNode,
  ctx: WalkCtx,
  depth: number,
  rootValue?: unknown
): TraceNode {
  // A Switch's own value is the selected Then expression, which we don't
  // descend — so only the engine's result (available at the fact's root
  // expression) can supply it.
  const value = rootValue !== undefined ? rootValue : null

  const cases = logic.children.filter((c) => c.op === 'Case')
  const whenTraces: TraceNode[] = []
  let takenIdx = -1
  for (let i = 0; i < cases.length; i++) {
    const whenLogic = cases[i].children.find((x) => x.op === 'When')
      ?.children[0]
    const whenTrace = whenLogic
      ? walkLogic(whenLogic, parentNode, ctx, depth)
      : ({
          op: 'Unknown',
          value: null,
          reason: 'Switch case missing a When condition.',
        } as TraceNode)
    whenTraces.push(whenTrace)
    if (whenTrace.value === true) {
      takenIdx = i
      break // engine stops at the first matching case
    }
  }

  const taken = takenIdx >= 0 ? whenTraces[takenIdx] : undefined
  // A condition is "informative" when it points at real facts rather than
  // being a bare literal like <True/>.
  const informative =
    !!taken && (taken.path != null || (taken.children?.length ?? 0) > 0)

  if (informative) {
    markOneDecisive(whenTraces, takenIdx)
    return {
      op: 'Switch',
      value,
      reason: `${describeOperand(taken!)} held, selecting ${formatValue(value)}.`,
      children: whenTraces,
    }
  }

  // Fell through (or nothing held): the conditions that did not hold are why.
  whenTraces.forEach((w, i) => {
    w.decisive = i !== takenIdx && w.value === false
  })
  const failedCount = whenTraces.filter((w) => w.decisive).length
  return {
    op: 'Switch',
    value,
    reason: failedCount
      ? `No case applied; ${failedCount === 1 ? 'the condition' : `all ${failedCount} conditions`} did not hold, so the result is ${formatValue(value)}.`
      : `Resolved to ${formatValue(value)}.`,
    children: whenTraces,
  }
}

function walkComparison(
  logic: LogicNode,
  parentNode: ModelNode,
  ctx: WalkCtx,
  depth: number,
  rootValue?: unknown
): TraceNode {
  // Comparison ops wrap operands in <Left> and <Right> elements.
  const leftWrap = logic.children.find((c) => c.op === 'Left')
  const rightWrap = logic.children.find((c) => c.op === 'Right')
  const leftLogic = leftWrap?.children[0]
  const rightLogic = rightWrap?.children[0]

  const leftTrace = leftLogic
    ? walkLogic(leftLogic, parentNode, ctx, depth)
    : ({
        op: 'Unknown',
        value: null,
        reason: 'Missing left operand',
      } as TraceNode)
  const rightTrace = rightLogic
    ? walkLogic(rightLogic, parentNode, ctx, depth)
    : ({
        op: 'Unknown',
        value: null,
        reason: 'Missing right operand',
      } as TraceNode)

  // The comparison's value is computed from its own operands. The engine's
  // result (ground truth) takes precedence at the fact's root expression —
  // nested comparisons have no per-sub-expression engine result to read.
  const computed = compareValues(logic.op, leftTrace.value, rightTrace.value)
  const value = typeof rootValue === 'boolean' ? rootValue : computed

  const symbol = COMPARISON_SYMBOLS[logic.op] ?? logic.op
  const lhs = formatValue(leftTrace.value)
  const rhs = formatValue(rightTrace.value)

  let reason: string
  if (value === true) {
    reason = `${describeOperand(leftTrace)} (${lhs}) ${symbol} ${describeOperand(rightTrace)} (${rhs}) — held.`
  } else if (value === false) {
    reason = `${describeOperand(leftTrace)} (${lhs}) ${symbol} ${describeOperand(rightTrace)} (${rhs}) — did not hold.`
  } else {
    reason = `${describeOperand(leftTrace)} ${symbol} ${describeOperand(rightTrace)} — pending.`
  }

  // Both operands of a comparison contribute equally to the result.
  leftTrace.decisive = true
  rightTrace.decisive = true
  return {
    op: logic.op,
    value,
    reason,
    children: [leftTrace, rightTrace],
  }
}

/** Apply a comparison operator to two resolved operand values. Returns null
 *  when either operand is unresolved or the operand types don't support the
 *  operator (e.g. ordering booleans). Strings compare lexically, which is
 *  correct for the engine's ISO `Day` values. */
function compareValues(op: string, l: unknown, r: unknown): boolean | null {
  if (l == null || r == null) return null
  if (op === 'Equal') return l === r
  if (op === 'NotEqual') return l !== r
  const comparable =
    (typeof l === 'number' && typeof r === 'number') ||
    (typeof l === 'string' && typeof r === 'string')
  if (!comparable) return null
  if (op === 'GreaterThan') return l > r
  if (op === 'GreaterThanOrEqual') return l >= r
  if (op === 'LessThan') return l < r
  if (op === 'LessThanOrEqual') return l <= r
  return null
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
  // <Enum optionsPath="…">Se</Enum> — the option string is the value.
  if (node.op === 'Enum') return node.text ?? null
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

function makeUnsupported(
  node: ModelNode,
  results: Record<string, unknown>
): TraceNode {
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
