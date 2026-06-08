/**
 * One-off experiment: how does Fact Graph's built-in Fact.explain()
 * compare to our hand-rolled collectMissingInputs walker?
 *
 * We load snap-fy2026, build a graph with no writable inputs, then on
 * the same /eligible target:
 *   - Walk the engine's Explanation tree (Operation / Dependency /
 *     Writable nodes) and dump it as indented text.
 *   - Try the engine's solves() — list of alternative solution sets.
 *   - Hit our running API's /query with no inputs and dump its
 *     missingInputs list.
 *
 * Findings (kept here as commit-able prose so the next reader doesn't
 * have to re-derive them):
 *
 * 1. The childList of an Operation is a List[List[Explanation]] in
 *    the iterative-accumulation case (each entry is a singleton cons
 *    wrapping the actual explanation) but a flat List[Explanation]
 *    in the short-circuit-collapse case. Two shapes for one field —
 *    likely an upstream bug or quirk. We unwrap both.
 *
 * 2. solves() crashes with `empty.reduceLeft` whenever any Operation
 *    in the tree has an empty childList (which is common before any
 *    fact resolves). Not safely callable without partial-state
 *    guardrails the upstream code does not provide.
 *
 * 3. The engine's explainer does NOT do "ask for A first in Any(A,B,C)."
 *    It accumulates every unresolved case in source order. It only
 *    collapses to a single child when that child has already resolved
 *    Complete(true) (for Any) or Complete(false) (for All) — i.e.
 *    when there's a deciding cause.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  loadFactGraphData,
  getRawFacts,
  __debugBuildGraph,
} from '../packages/factgraph-core/src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '..', 'data', 'factgraph')

// ---------------------------------------------------------------------
// Scala cons-list helpers
// ---------------------------------------------------------------------
function scalaListToArray<T>(list: unknown): T[] {
  const out: T[] = []
  let cur = list as {
    sci_$colon$colon__f_head?: T
    sci_$colon$colon__f_next?: unknown
  } | null
  while (cur && 'sci_$colon$colon__f_head' in cur) {
    out.push(cur.sci_$colon$colon__f_head as T)
    cur = cur.sci_$colon$colon__f_next as typeof cur
  }
  return out
}

// AnyOperator.explainRecurse and AllOperator.explainRecurse both build
// childList by appending `new Cons(xExp, Nil)` rather than xExp directly,
// so a non-collapsed Operation's childList is a List[List[Explanation]].
// On short-circuit collapse, the operator returns
// `opWithInclusiveChildren(List(xExp))` — a flat List[Explanation].
// We accept either: if a cons-cell head is itself a cons cell, unwrap one
// more level.
function unwrapChildList(raw: unknown): Record<string, unknown>[] {
  const items = scalaListToArray<unknown>(raw)
  return items.map((item) => {
    if (
      item &&
      typeof item === 'object' &&
      'sci_$colon$colon__f_head' in (item as object)
    ) {
      const inner = scalaListToArray<Record<string, unknown>>(item)
      return inner[0] ?? ({} as Record<string, unknown>)
    }
    return item as Record<string, unknown>
  })
}

// ---------------------------------------------------------------------
// Explanation tree walker
// ---------------------------------------------------------------------
type ExplanationNode =
  | { kind: 'operation'; children: ExplanationNode[] }
  | {
      kind: 'dependency'
      complete: boolean
      source?: string
      target?: string
      children: ExplanationNode[]
    }
  | { kind: 'writable'; complete: boolean; path: string }

function classifyExplanation(e: Record<string, unknown>): ExplanationNode {
  const writablePathKey = Object.keys(e).find((k) =>
    k.endsWith('Writable__f_path')
  )
  if (writablePathKey) {
    const completeKey = Object.keys(e).find((k) =>
      k.endsWith('Writable__f_complete')
    )
    return {
      kind: 'writable',
      complete: Boolean(completeKey && e[completeKey]),
      path: String(e[writablePathKey]),
    }
  }

  const depSourceKey = Object.keys(e).find((k) =>
    k.endsWith('Dependency__f_source')
  )
  if (depSourceKey) {
    const completeKey = Object.keys(e).find((k) =>
      k.endsWith('Dependency__f_complete')
    )
    const targetKey = Object.keys(e).find((k) =>
      k.endsWith('Dependency__f_target')
    )
    const childListKey = Object.keys(e).find((k) =>
      k.endsWith('Dependency__f_childList')
    )
    const childList = childListKey ? unwrapChildList(e[childListKey]) : []
    return {
      kind: 'dependency',
      complete: Boolean(completeKey && e[completeKey]),
      source: pathToString(e[depSourceKey]),
      target: targetKey ? pathToString(e[targetKey]) : undefined,
      children: childList.map(classifyExplanation),
    }
  }

  const opChildListKey = Object.keys(e).find((k) =>
    k.endsWith('Operation__f_childList')
  )
  const opChildList = opChildListKey ? unwrapChildList(e[opChildListKey]) : []
  return {
    kind: 'operation',
    children: opChildList.map(classifyExplanation),
  }
}

function pathToString(p: unknown): string {
  if (!p || typeof p !== 'object') return String(p)
  const obj = p as Record<string, unknown>
  const itemsKey = Object.keys(obj).find((k) => k.endsWith('Path__f_items'))
  if (itemsKey) {
    const items = scalaListToArray<Record<string, unknown>>(obj[itemsKey])
    return (
      '/' +
      items
        .map((it) => {
          const nameKey = Object.keys(it).find((k) => k.endsWith('__f_name'))
          if (nameKey) return String(it[nameKey])
          return (
            Object.keys(it)
              .find((k) => k.includes('PathItem'))
              ?.replace(/^.*\$/, '') ?? '?'
          )
        })
        .join('/')
    )
  }
  const t = obj.toString?.() ?? '<path>'
  return typeof t === 'string' ? t : '<path>'
}

function renderExplanation(node: ExplanationNode, depth = 0): string {
  const indent = '  '.repeat(depth)
  if (node.kind === 'writable') {
    return `${indent}- Writable ${node.complete ? '✓' : '✗'} ${node.path}`
  }
  if (node.kind === 'dependency') {
    const lines = [
      `${indent}- Dependency ${node.complete ? '✓' : '✗'} ${node.source ?? '?'} → ${node.target ?? '?'}`,
    ]
    for (const c of node.children) lines.push(renderExplanation(c, depth + 1))
    return lines.join('\n')
  }
  const lines = [`${indent}- Operation (${node.children.length} children)`]
  for (const c of node.children) lines.push(renderExplanation(c, depth + 1))
  return lines.join('\n')
}

// Flatten all Writable leaves out of a TS-side explanation tree so we
// can list "what the engine considers unresolved input nodes" alongside
// what our walker listed.
function collectWritables(
  node: ExplanationNode,
  out: { path: string; complete: boolean }[] = []
): { path: string; complete: boolean }[] {
  if (node.kind === 'writable') {
    out.push({ path: node.path, complete: node.complete })
  } else {
    for (const c of node.children) collectWritables(c, out)
  }
  return out
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  loadFactGraphData(dataDir)
  const rawFacts = getRawFacts('snap-fy2026')
  if (!rawFacts) throw new Error('snap-fy2026 not loaded')
  console.log(`Loaded ruleset: snap-fy2026 (${rawFacts.length} facts)\n`)

  // No inputs applied — every writable is unresolved, so the engine's
  // explain reflects "what would resolve me?" rather than "what made
  // this particular value?"
  const { graph } = __debugBuildGraph(rawFacts)

  const target = '/eligible'
  const fact = graph.getFact(target)
  const explainFn = fact['explain__Lgov_irs_factgraph_monads_MaybeVector'] as
    | (() => Record<string, unknown>)
    | undefined
  if (!explainFn) {
    console.error('Fact.explain not available on this bundle')
    process.exit(1)
  }
  const explainMv = explainFn.call(fact)
  const singleKey = Object.keys(explainMv).find((k) =>
    k.includes('Single__f_x')
  )
  if (!singleKey) {
    console.error('Unexpected MaybeVector shape for explain')
    process.exit(1)
  }
  const explanation = explainMv[singleKey] as Record<string, unknown>
  const tree = classifyExplanation(explanation)

  console.log('='.repeat(72))
  console.log(`ENGINE Explanation tree for ${target}`)
  console.log('='.repeat(72))
  console.log(renderExplanation(tree))

  console.log('')
  console.log('='.repeat(72))
  console.log('ENGINE Writable leaves (engine\'s answer to "what inputs?")')
  console.log('='.repeat(72))
  const writables = collectWritables(tree)
  if (writables.length === 0) {
    console.log('  (none — every leaf already resolved)')
  } else {
    for (const w of writables) {
      console.log(`  ${w.complete ? '✓' : '✗'} ${w.path}`)
    }
  }

  console.log('')
  console.log('='.repeat(72))
  console.log('ENGINE solves() output')
  console.log('='.repeat(72))
  const solvesFn = explanation['solves__sci_List'] as
    | (() => unknown)
    | undefined
  if (!solvesFn) {
    console.log('  (solves method not present)')
  } else {
    try {
      const solvesResult = solvesFn.call(explanation)
      const outerList = scalaListToArray<unknown>(solvesResult)
      const sets = outerList.map((inner) =>
        scalaListToArray<unknown>(inner).map(pathToString)
      )
      console.log(`  ${sets.length} alternative solution set(s):`)
      sets.forEach((set, i) => {
        console.log(
          `    Set ${i + 1}: ${set.length === 0 ? '(empty — already resolved)' : set.join(', ')}`
        )
      })
    } catch (e) {
      console.log(`  solves() threw: ${(e as Error).message}`)
      console.log(
        '  (this is normal on partially-resolved graphs — Operations with empty childLists trip empty.reduceLeft)'
      )
    }
  }

  console.log('')
  console.log('='.repeat(72))
  console.log(`OUR collectMissingInputs walker for ${target}`)
  console.log('='.repeat(72))
  const res = await fetch(
    'http://localhost:5002/v1/factgraph/snap-fy2026/query',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [target] }),
    }
  )
  if (!res.ok) {
    console.error(`API returned ${res.status} — is the dev server running?`)
    console.error('Run:  npm run dev:api')
    process.exit(1)
  }
  const data = (await res.json()) as {
    missingInputs?: Array<{ path: string; dataType?: string }>
  }
  const missing = data.missingInputs ?? []
  console.log(`  ${missing.length} missing input(s):`)
  for (const m of missing) console.log(`    - ${m.path} (${m.dataType ?? '?'})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
