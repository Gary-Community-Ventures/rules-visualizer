/**
 * Fact Graph execution using the Scala.js bundle.
 *
 * Converts our parsed XML facts into the "digest" format the Scala.js
 * GraphFactory expects, creates a graph, sets input values, and reads
 * all computed results.
 */

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sfg = require('../vendor/factgraph-scala.cjs')

// --- Vendored bundle bug fix ------------------------------------------
// factgraph-scala.cjs has a copy-paste defect in
// DigestNodeWrapper.overrideDefaultOption (~line 77205): it null-checks
// `this.overrideDefault` correctly but then runs
// `toNative(this.overrideCondition)` — so the condition node gets handed
// to Override.apply as BOTH the condition and the default, and the
// Override Switch evaluates to the condition's boolean instead of the
// Default's value.
//
// Why nobody upstream noticed: Direct File's own processFactsToDigestWrapper.ts
// does NOT pass overrides through this wrapper — their WrappedFact only
// carries {path, writable, derived, placeholder} and override handling
// goes through the Scala XML loader path (DefaultFactDictConfig.fromXml).
// We extended the digest with overrideCondition/overrideDefault so we
// could keep one JS-driven loading path; that surfaced this stale getter.
//
// The runtime patch shadows the buggy getter on the wrapper prototype.
// Original getter is captured for the null-overrideDefault short-circuit
// (avoids needing the bundle's None singleton). For the non-null case we
// borrow the *working* sibling `overrideConditionOption` getter by
// stuffing our overrideDefault into a throwaway wrapper's condition slot
// — same toNative helper, but now reading from the right field.
const dnwProto = sfg.DigestNodeWrapper?.prototype as
  | { __overrideDefaultOptionPatched?: boolean }
  | undefined
if (dnwProto && !dnwProto.__overrideDefaultOptionPatched) {
  // Capture the buggy original so the null-overrideDefault short-circuit
  // can still hand back the bundle's None singleton without us having to
  // reach into non-exported internals.
  const origGetter = Object.getOwnPropertyDescriptor(
    dnwProto,
    'overrideDefaultOption'
  )?.get
  if (!origGetter)
    throw new Error(
      'factgraph-scala bundle changed shape — no overrideDefaultOption getter to patch'
    )
  Object.defineProperty(dnwProto, 'overrideDefaultOption', {
    configurable: true,
    get(this: { path: string; overrideDefault: unknown }): unknown {
      // overrideDefault === null: the original returns None correctly,
      // so just delegate. Avoids needing access to the bundle's None.
      if (this.overrideDefault === null) return origGetter.call(this)
      // overrideDefault !== null: the original would (buggily) toNative
      // the *condition*. The sibling getter `overrideConditionOption`
      // wires its own field through toNative correctly — borrow it by
      // putting our default into a temp wrapper's condition slot.
      const tmp = new sfg.DigestNodeWrapper(
        this.path,
        null,
        null,
        null,
        this.overrideDefault,
        null
      )
      return tmp.overrideConditionOption
    },
  })
  dnwProto.__overrideDefaultOptionPatched = true
}

// --- Vendored bundle perf patch: JS-side cache for Fact.get --------------
// The engine's Graph.resultCache already memoizes computed fact values by
// path (~bundle line 30890), so duplicate reads return cached results
// instead of recomputing. The catch is that the lookup itself goes through
// Scala-compiled-to-JS HashMap code and pays ~6μs of JS↔Scala boundary
// overhead *per call* — and one executeFactGraph triggers ~326k internal
// .get invocations on a 5-member snap-complete scenario (mostly cache hits
// cascading through recursive expression evaluation). At 6μs each, that's
// the bulk of the ~2s per-execute cost.
//
// A native JS Map in front of the engine's get returns hits at ~50ns.
// Measured impact:
//   - Single execute (5 members):      2,015 ms -> 350 ms   (5.8× faster)
//   - 1000-case snap-complete sim:     152 s    -> 56 s     (2.7× faster)
//   - Cumulative vs unoptimized:       ~42 min  -> 56 s     (~45× faster)
//
// Outputs verified deepStrictEqual to the unpatched baseline. The cache
// is per-graph via WeakMap, so it dies with the graph instance when
// executeFactGraph returns — no leaks across calls.
//
// `/?/` paths get cached the same way. Empirically these return a
// MaybeVector that's the same across all callers — the engine evaluates
// the collection-wide value once and callers index into it via their own
// evaluation context. So path alone is a valid cache key. Verified with
// deepStrictEqual against an uncached baseline.
//
// Safety notes:
//   1) Override bypass: Fact.get has logic at the top (~bundle line 30871)
//      that returns the override value immediately when present, bypassing
//      resultCache. Our wrapper short-circuits *before* that check. Safe
//      within executeFactGraph because all writes happen in the setup
//      phase, before any reads. If a caller interleaved set/get/set/get,
//      the cache could return stale values — but executeFactGraph never
//      does that.
//   2) Cycle detection: the engine's get has cycle-detection logic. Cache
//      hits skip it. Snap-complete and other production rulesets are
//      acyclic; cycle-example is the only ruleset in the repo with one,
//      and our cache check is path-keyed so a path doesn't get cached
//      until its computation completes.
//
// The Fact class isn't directly exported from the bundle, so we lazy-patch
// the prototype the first time we see a Fact instance in readFactValue.
// If the bundle is re-vendored and the prototype shape changes, the
// patch quietly no-ops (no error) and we fall back to the engine's own
// slower-but-correct caching.
const jsResultCache = new WeakMap<object, Map<string, unknown>>()
let factProtoPatched = false
function patchFactProtoOnce(factInstance: unknown): void {
  if (factProtoPatched) return
  const proto = Object.getPrototypeOf(factInstance as object) as {
    get__Lgov_irs_factgraph_monads_MaybeVector?: () => unknown
  } | null
  if (!proto?.get__Lgov_irs_factgraph_monads_MaybeVector) return
  const orig = proto.get__Lgov_irs_factgraph_monads_MaybeVector
  proto.get__Lgov_irs_factgraph_monads_MaybeVector = function (this: {
    Lgov_irs_factgraph_Fact__f_path: { toString(): string }
    Lgov_irs_factgraph_Fact__f_graph: object
  }): unknown {
    const p = String(this.Lgov_irs_factgraph_Fact__f_path)
    const g = this.Lgov_irs_factgraph_Fact__f_graph
    let cache = jsResultCache.get(g)
    if (!cache) {
      cache = new Map()
      jsResultCache.set(g, cache)
    }
    if (cache.has(p)) return cache.get(p)
    const r = orig.call(this)
    cache.set(p, r)
    return r
  }
  factProtoPatched = true
}

// --- Diagnostic: trace per-path Fact.get call counts ---------------------
// Off by default. Enable with FACTGRAPH_TRACE_GETS=1 to count engine calls
// during executions — useful when investigating which paths dominate.
// Adds a counter wrapper around the cached get. Read counts via
// factCallCounts; reset with resetFactCallCounts().
export const factCallCounts = new Map<string, number>()
export function resetFactCallCounts(): void { factCallCounts.clear() }

/** EXEC_TIME_SETS=1 populates this with total graph.set time + call count. */
export const graphSetTimings = { elapsedMs: 0, count: 0 }
export function resetGraphSetTimings(): void {
  graphSetTimings.elapsedMs = 0
  graphSetTimings.count = 0
}
let traceWrapperInstalled = false
function maybeInstallTraceWrapper(factInstance: unknown): void {
  if (traceWrapperInstalled || process.env.FACTGRAPH_TRACE_GETS !== '1') return
  const proto = Object.getPrototypeOf(factInstance as object) as {
    get__Lgov_irs_factgraph_monads_MaybeVector?: () => unknown
  } | null
  if (!proto?.get__Lgov_irs_factgraph_monads_MaybeVector) return
  const cachedGet = proto.get__Lgov_irs_factgraph_monads_MaybeVector
  proto.get__Lgov_irs_factgraph_monads_MaybeVector = function (this: {
    Lgov_irs_factgraph_Fact__f_path: { toString(): string }
  }): unknown {
    factCallCounts.set(
      String(this.Lgov_irs_factgraph_Fact__f_path),
      (factCallCounts.get(String(this.Lgov_irs_factgraph_Fact__f_path)) ?? 0) + 1
    )
    return cachedGet.call(this)
  }
  traceWrapperInstalled = true
}

// --- Digest conversion ---
// Converts fast-xml-parser output to the {typeName, options, children} format.
// This mirrors processFactsToDigestWrapper.ts from Direct File.

type DigestNode = {
  typeName: string
  options: Record<string, string>
  children: DigestNode[]
}

type DigestWritable = {
  typeName: string
  options: Record<string, string>
  collectionItemAlias: string | null
  limits: DigestLimit[]
}

type DigestLimit = {
  operation: string
  level: string
  node: DigestNode
}

type DigestFact = {
  path: string
  writable: DigestWritable | null
  derived: DigestNode | null
  placeholder: DigestNode | null
  overrideCondition: DigestNode | null
  overrideDefault: DigestNode | null
}

function processOptions(
  rawNode: Record<string, unknown>
): Record<string, string> {
  const buffer: Record<string, string> = {}
  for (const [key, val] of Object.entries(rawNode)) {
    if (key.startsWith('@_')) {
      buffer[key.slice(2)] = String(val)
    } else if (key === '#text') {
      buffer['value'] = String(val)
    }
  }
  return buffer
}

function processWritable(rawWritable: Record<string, unknown>): DigestWritable {
  // Find the type element (first non-attribute, non-Limit key)
  let typeName = 'String'
  for (const key of Object.keys(rawWritable)) {
    if (key.startsWith('@_') || key === 'Limit') continue
    typeName = key
    break
  }

  const typeValue = rawWritable[typeName]
  const defaultOptions =
    typeof typeValue === 'object' && typeValue !== null
      ? processOptions(typeValue as Record<string, unknown>)
      : {}

  const options = typeName === 'CollectionItem' ? {} : defaultOptions
  const collectionItemAlias =
    typeName === 'CollectionItem'
      ? (defaultOptions['collection'] ?? null)
      : null

  return {
    typeName,
    options,
    collectionItemAlias,
    limits: processLimits(rawWritable['Limit']),
  }
}

function processLimits(rawNode: unknown): DigestLimit[] {
  if (rawNode === undefined || rawNode === null) return []
  const rawNodes = Array.isArray(rawNode) ? rawNode : [rawNode]
  return rawNodes.map((node: Record<string, unknown>): DigestLimit => {
    const typeName = Object.keys(node).find((name) => !name.startsWith('@_'))
    if (!typeName)
      return {
        operation: '',
        level: 'Error',
        node: { typeName: 'Int', options: { value: '0' }, children: [] },
      }

    if (typeName === 'Dependency') {
      const dep = node['Dependency'] as Record<string, unknown>
      return {
        operation: String(node['@_type'] ?? ''),
        level: 'Error',
        node: {
          typeName: 'Dependency',
          options: { path: String(dep?.['@_path'] ?? '') },
          children: [],
        },
      }
    }

    return {
      operation: String(node['@_type'] ?? ''),
      level: 'Error',
      node: {
        typeName,
        options: { value: String(node[typeName] ?? '') },
        children: [],
      },
    }
  })
}

function processDerived(rawNode: Record<string, unknown>): DigestNode {
  const typeName = Object.keys(rawNode).find(
    (k) => !k.startsWith('@_') && k !== '#text'
  )
  if (!typeName) return { typeName: 'True', options: {}, children: [] }
  return inner(rawNode[typeName], typeName)
}

function inner(currentNode: unknown, typeName: string): DigestNode {
  if (Array.isArray(currentNode)) {
    // Array of children — flatten into parent
    return {
      typeName,
      options: {},
      children: currentNode.flatMap((node) => {
        if (typeof node === 'object' && node !== null) {
          const keys = Object.keys(node as Record<string, unknown>).filter(
            (k) => !k.startsWith('@_') && k !== '#text'
          )
          return keys.map((key) =>
            inner((node as Record<string, unknown>)[key], key)
          )
        }
        return [{ typeName, options: { value: String(node) }, children: [] }]
      }),
    }
  }

  if (typeof currentNode === 'object' && currentNode !== null) {
    const obj = currentNode as Record<string, unknown>
    const keys = Object.keys(obj)
    const defaultOptions = processOptions(obj)

    const hasValueChild = typeof obj[typeName] !== 'object'
    const options =
      hasValueChild && obj[typeName] != null
        ? { value: String(obj[typeName]) }
        : defaultOptions

    const children = keys
      .filter((key) => !key.startsWith('@_') && key !== '#text')
      .flatMap((key) => {
        const child = obj[key]
        if (Array.isArray(child)) {
          return child.map((item) => inner(item, key))
        }
        return [inner(child, key)]
      })

    return { typeName, options, children }
  }

  return {
    typeName,
    options: { value: String(currentNode) },
    children: [],
  }
}

// --- Graph creation and execution ---

type ParsedFact = {
  path: string
  raw: Record<string, unknown>
}

type ModelNodeForLookup = {
  content: { dataType?: string; enumOptionsPath?: string; path?: string }
}
type FactLookup = Map<string, ParsedFact>
type ModelLookup = Map<string, ModelNodeForLookup>

type DictionaryCacheEntry = {
  dictionary: unknown
  effectiveFacts: ParsedFact[]
  effectiveLookup: FactLookup
  collectionPrefixes: Set<string>
}

// Per-facts caches. WeakMap keys give us free invalidation on file-watcher
// reloads — a new ParsedFact[] array misses the cache, the old one's
// WeakMap entry is GC'd once nothing references it.
const factsLookupCache = new WeakMap<ParsedFact[], FactLookup>()
const modelLookupCache = new WeakMap<object, ModelLookup>()
const dictionaryCache = new WeakMap<
  ParsedFact[],
  Map<string, DictionaryCacheEntry>
>()

export const cacheStats = { hits: 0, misses: 0 }
export const timings = {
  dict: 0,
  graphInit: 0,
  collections: 0,
  scalarInputs: 0,
  read: 0,
  total: 0,
  count: 0,
}

function getFactsLookup(facts: ParsedFact[]): FactLookup {
  let m = factsLookupCache.get(facts)
  if (!m) {
    m = new Map()
    for (const f of facts) m.set(f.path, f)
    factsLookupCache.set(facts, m)
  }
  return m
}

function getModelLookup(
  modelNodes: Record<string, ModelNodeForLookup> | undefined
): ModelLookup | undefined {
  if (!modelNodes) return undefined
  let m = modelLookupCache.get(modelNodes)
  if (!m) {
    m = new Map()
    for (const node of Object.values(modelNodes)) {
      const path = node.content?.path
      if (typeof path === 'string') m.set(path, node)
    }
    modelLookupCache.set(modelNodes, m)
  }
  return m
}

function buildDictionary(effectiveFacts: ParsedFact[]): unknown {
  const digestFacts: DigestFact[] = effectiveFacts.map((fact) => {
    const raw = fact.raw
    const writable = raw['Writable']
      ? processWritable(raw['Writable'] as Record<string, unknown>)
      : null
    const derived = raw['Derived']
      ? processDerived(raw['Derived'] as Record<string, unknown>)
      : null
    const placeholder = raw['Placeholder']
      ? processDerived(raw['Placeholder'] as Record<string, unknown>)
      : null

    const override = raw['Override'] as Record<string, unknown> | undefined
    const overrideCondition = override?.['Condition']
      ? processDerived(override['Condition'] as Record<string, unknown>)
      : null
    const overrideDefault = override?.['Default']
      ? processDerived(override['Default'] as Record<string, unknown>)
      : null

    return {
      path: fact.path,
      writable,
      derived,
      placeholder,
      overrideCondition,
      overrideDefault,
    }
  })

  const meta = new sfg.DigestMetaWrapper('2024').toNative()
  const nativeFacts = digestFacts.map((fact) =>
    sfg.DigestNodeWrapperFactory.toNative(
      new sfg.DigestNodeWrapper(
        fact.path,
        fact.writable,
        fact.derived,
        fact.placeholder,
        fact.overrideCondition,
        fact.overrideDefault
      )
    )
  )
  const config = sfg.FactDictionaryConfig.create(meta, nativeFacts)
  return sfg.FactDictionaryFactory.fromConfig(config)
}

function promoteFacts(
  facts: ParsedFact[],
  pathsToPromote: Set<string>,
  modelLookup?: ModelLookup
): ParsedFact[] {
  return facts.map((f) => {
    if (!pathsToPromote.has(f.path)) return f
    const modelNode = modelLookup?.get(f.path)
    const typeName = inferWritableType(f.raw, modelNode?.content)
    // Enum writables need the optionsPath attribute so EnumFactory can
    // resolve the option set when we stamp the user's value. The model
    // node carries it; fall back to scanning the raw expression.
    const enumOptionsPath =
      typeName === 'Enum'
        ? (modelNode?.content?.enumOptionsPath ??
          findEnumOptionsPathInRaw(f.raw['Derived']))
        : undefined
    const writableInner =
      typeName === 'Enum' && enumOptionsPath
        ? { '@_optionsPath': enumOptionsPath }
        : {}
    return {
      ...f,
      raw: {
        ...f.raw,
        Writable: { [typeName]: writableInner },
        Derived: undefined,
      },
    }
  })
}

function getOrBuildDictionary(
  facts: ParsedFact[],
  factsLookup: FactLookup,
  pathsToPromote: Set<string>,
  modelLookup?: ModelLookup
): DictionaryCacheEntry {
  let inner = dictionaryCache.get(facts)
  if (!inner) {
    inner = new Map()
    dictionaryCache.set(facts, inner)
  }
  const sig =
    pathsToPromote.size === 0 ? '' : [...pathsToPromote].sort().join('|')
  const hit = inner.get(sig)
  if (hit) {
    cacheStats.hits++
    return hit
  }
  cacheStats.misses++

  const effectiveFacts =
    pathsToPromote.size === 0
      ? facts
      : promoteFacts(facts, pathsToPromote, modelLookup)
  const dictionary = buildDictionary(effectiveFacts)

  const effectiveLookup: FactLookup =
    pathsToPromote.size === 0
      ? factsLookup
      : new Map(effectiveFacts.map((f) => [f.path, f]))

  const collectionPrefixes = new Set<string>()
  for (const fact of effectiveFacts) {
    const match = fact.path.match(/^(\/[^*]+)\/\*\//)
    if (match) collectionPrefixes.add(match[1])
  }

  const entry: DictionaryCacheEntry = {
    dictionary,
    effectiveFacts,
    effectiveLookup,
    collectionPrefixes,
  }
  inner.set(sig, entry)
  return entry
}

/**
 * Execute a fact graph ruleset with the given input values.
 *
 * @param rulesetId - The ruleset identifier
 * @param facts - Parsed facts from the XML (with raw objects)
 * @param inputs - Map of fact path → value to set as inputs
 * @returns Map of node path → computed value
 */
/**
 * Infer the writable type for a derived fact.
 * Uses the model node's dataType if available, otherwise inspects the expression.
 */
function inferWritableType(
  raw: Record<string, unknown>,
  modelNode?: { dataType?: string }
): string {
  // Prefer the pre-computed dataType from the model
  if (modelNode?.dataType) {
    return modelNode.dataType
  }

  const derived = raw['Derived'] as Record<string, unknown> | undefined
  if (!derived) return 'Dollar'
  const typeName = Object.keys(derived).find(
    (k) => !k.startsWith('@_') && k !== '#text'
  )
  if (!typeName) return 'Dollar'

  // Expression types that produce booleans
  const booleanOps = new Set([
    'All',
    'Any',
    'Not',
    'Equal',
    'NotEqual',
    'GreaterThan',
    'GreaterThanOrEqual',
    'LessThan',
    'LessThanOrEqual',
    'True',
    'False',
    'IsComplete',
  ])
  if (booleanOps.has(typeName)) return 'Boolean'

  // Literal types
  if (typeName === 'Dollar') return 'Dollar'
  if (typeName === 'Int') return 'Int'
  if (typeName === 'String') return 'String'
  if (typeName === 'Day') return 'Day'
  if (typeName === 'Rational') return 'Rational'

  // Arithmetic operations produce Dollar by default
  const dollarOps = new Set([
    'Add',
    'Subtract',
    'Multiply',
    'Divide',
    'Round',
    'RoundToInt',
    'TruncateCents',
    'GreaterOf',
    'LesserOf',
  ])
  if (dollarOps.has(typeName)) return 'Dollar'

  // Switch/conditional — need to look at the Then branches to infer type
  if (typeName === 'Switch') {
    const cases = derived['Switch'] as Record<string, unknown> | undefined
    if (cases) {
      const caseList = Array.isArray(cases['Case'])
        ? cases['Case']
        : cases['Case']
          ? [cases['Case']]
          : []
      for (const c of caseList as Record<string, unknown>[]) {
        const then = c['Then'] as Record<string, unknown> | undefined
        if (then) {
          const innerType = Object.keys(then).find(
            (k) => !k.startsWith('@_') && k !== '#text'
          )
          if (innerType === 'Dollar') return 'Dollar'
          if (innerType === 'Int') return 'Int'
          if (innerType === 'String') return 'String'
          if (innerType === 'Enum') return 'Enum'
          if (innerType === 'True' || innerType === 'False') return 'Boolean'
          if (innerType === 'Dependency') return 'Boolean' // dependency in Then likely returns same type
          if (
            innerType &&
            new Set([
              'All',
              'Any',
              'Not',
              'GreaterThan',
              'LessThan',
              'Equal',
              'GreaterThanOrEqual',
              'LessThanOrEqual',
            ]).has(innerType)
          )
            return 'Boolean'
          if (
            innerType &&
            new Set([
              'Add',
              'Subtract',
              'Multiply',
              'Divide',
              'GreaterOf',
              'LesserOf',
            ]).has(innerType)
          )
            return 'Dollar'
        }
      }
    }
  }

  // Default to Dollar for unknown types
  return 'Dollar'
}

/** Walk a derived expression tree looking for the first `<Enum optionsPath="…">`
 *  literal. Used as a fallback when promoting a derived Enum node to writable
 *  and the model-node didn't carry the optionsPath. */
function findEnumOptionsPathInRaw(node: unknown): string | undefined {
  if (node === null || node === undefined || typeof node !== 'object')
    return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const p = findEnumOptionsPathInRaw(item)
      if (p) return p
    }
    return undefined
  }
  const obj = node as Record<string, unknown>
  if (typeof obj['@_optionsPath'] === 'string')
    return obj['@_optionsPath'] as string
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('@_') || key === '#text') continue
    const p = findEnumOptionsPathInRaw(value)
    if (p) return p
  }
  return undefined
}

export function executeFactGraph(
  rulesetId: string,
  facts: ParsedFact[],
  inputs: Record<string, unknown>,
  modelNodes?: Record<string, { content: { dataType?: string } }>,
  entities?: Record<string, Record<string, unknown>[]>,
  // Narrow the final read pass to only these fact paths. Use the template
  // form for collection fields (e.g. "/members/*/isEligible") to match
  // fact.path. Dictionary is always built from the full facts list so
  // dependencies still resolve; this only filters what gets read back.
  // Empty/undefined = read everything (legacy behavior).
  readPaths?: Set<string>
): Record<string, unknown> {
  void rulesetId

  const factsLookup = getFactsLookup(facts)
  const modelLookup = getModelLookup(
    modelNodes as Record<string, ModelNodeForLookup> | undefined
  )

  // Separate inputs into writable values and derived overrides
  const writableInputs: Record<string, unknown> = {}
  const derivedOverrides: Record<string, unknown> = {}

  for (const [path, value] of Object.entries(inputs)) {
    const fact = factsLookup.get(path)
    if (!fact) continue
    if (fact.raw['Writable']) {
      writableInputs[path] = value
    } else {
      derivedOverrides[path] = value
    }
  }

  // Per-member derived fields referenced in entityData also need to be
  // promoted to writable so graph.set can stamp per-instance overrides.
  // Row keys are full fact paths like "/members/*/isEligibleMember".
  const perMemberDerivedOverrides = new Set<string>()
  if (entities) {
    for (const rows of Object.values(entities)) {
      for (const row of rows) {
        for (const fieldPath of Object.keys(row)) {
          if (fieldPath === 'id') continue
          const fact = factsLookup.get(fieldPath)
          if (fact && !fact.raw['Writable']) {
            perMemberDerivedOverrides.add(fieldPath)
          }
        }
      }
    }
  }

  const pathsToPromote = new Set<string>([
    ...Object.keys(derivedOverrides),
    ...perMemberDerivedOverrides,
  ])

  const t0 = Date.now()
  // Cached: dictionary build is the bulk of the cost. We key the cache
  // by (facts identity, sorted promotion paths), so a typical 10k-case
  // run hits the cache 9999 times per side instead of rebuilding.
  const { dictionary, effectiveFacts, effectiveLookup, collectionPrefixes } =
    getOrBuildDictionary(facts, factsLookup, pathsToPromote, modelLookup)

  const t1a = Date.now()
  // Fresh persister + graph per execution — the persister is the stateful
  // part; the dictionary is config-only and reusable.
  const persister = sfg.JSPersister.create()
  const graph = sfg.GraphFactory.apply(dictionary, persister) as {
    set: (path: string, value: unknown) => void
    get: (path: string) => {
      complete: boolean
      hasValue: boolean
      get: unknown
    }
    getVect: (path: string) => unknown
    save: () => { valid: boolean }
  }
  // Diagnostic: when EXEC_TIME_SETS=1, wrap graph.set with a perf timer
  // so callers can read graphSetTimings to find out how much of the
  // collections phase is the Scala-side graph.set call vs JS-side
  // factory/loop work. Earlier profiling showed ~99% of collections
  // phase time is in graph.set itself.
  if (process.env.EXEC_TIME_SETS === '1') {
    const origSet = graph.set.bind(graph)
    graph.set = (path: string, value: unknown) => {
      const t = performance.now()
      origSet(path, value)
      graphSetTimings.elapsedMs += performance.now() - t
      graphSetTimings.count += 1
    }
  }

  const t1b = Date.now()
  // Two-pass collection setup: (1) generate UUIDs and create every
  // collection up front, (2) set per-item field values. The first pass
  // has to complete before the second so CollectionItem-typed fields
  // (e.g. /incomes/x/memberId pointing at /members) can resolve their
  // "#index" references — the target collection's UUIDs must already
  // exist no matter which order the prefixes happen to be in.
  const collectionUuids: Record<string, string[]> = {}
  for (const prefix of collectionPrefixes) {
    const entityRows = entities?.[prefix] ?? []
    if (entityRows.length === 0) continue
    const uuids = entityRows.map(() => crypto.randomUUID())
    collectionUuids[prefix] = uuids
    try {
      const collection = sfg.CollectionFactory(uuids)
      graph.set(prefix, collection)
    } catch (e) {
      console.warn(
        `Failed to create collection ${prefix}:`,
        (e as Error).message
      )
      delete collectionUuids[prefix]
    }
  }

  for (const prefix of collectionPrefixes) {
    const entityRows = entities?.[prefix] ?? []
    const uuids = collectionUuids[prefix]
    if (!uuids || entityRows.length === 0) continue

    // Set per-item values. Row keys are full fact paths like "/members/*/age";
    // swap `/*/` for `/#${uuid}/` to produce the per-instance path.
    for (let i = 0; i < entityRows.length; i++) {
      const row = entityRows[i]
      const uuid = uuids[i]
      for (const [fieldPath, value] of Object.entries(row)) {
        if (fieldPath === 'id') continue
        const itemPath = fieldPath.replace('/*/', `/#${uuid}/`)
        try {
          const typedValue = createTypedValue(
            fieldPath,
            value,
            effectiveLookup,
            collectionUuids
          )
          if (typedValue !== undefined) {
            graph.set(itemPath, typedValue)
          }
        } catch (e) {
          console.warn(`Failed to set ${itemPath}:`, (e as Error).message)
        }
      }
    }
  }

  const t1c = Date.now()
  // Set scalar writable input values
  for (const [path, value] of Object.entries(writableInputs)) {
    // Skip collection items — already handled above
    if (path.includes('/*')) continue
    try {
      const typedValue = createTypedValue(
        path,
        value,
        effectiveLookup,
        collectionUuids
      )
      if (typedValue !== undefined) {
        graph.set(path, typedValue)
      }
    } catch (e) {
      console.warn(`Failed to set ${path}:`, (e as Error).message)
    }
  }

  // Set derived-turned-writable overrides
  for (const [path, value] of Object.entries(derivedOverrides)) {
    try {
      const typedValue = createTypedValue(
        path,
        value,
        effectiveLookup,
        collectionUuids
      )
      if (typedValue !== undefined) {
        graph.set(path, typedValue)
      }
    } catch (e) {
      console.warn(`Failed to set override ${path}:`, (e as Error).message)
    }
  }

  const t2 = Date.now()
  // Read all fact values
  // In factgraph 3.1, graph.get()/getVect()/save() were removed.
  // Instead, use getFact(path) and read via the Scala-mangled get method.
  const results: Record<string, unknown> = {}
  const filterReads = readPaths && readPaths.size > 0
  for (const fact of facts) {
    if (filterReads && !readPaths.has(fact.path)) continue
    // For collection item facts (with /*), read per-instance values
    const collMatch = fact.path.match(/^(\/[^*]+)\/\*\/(.+)$/)
    if (collMatch) {
      const [, prefix, fieldSuffix] = collMatch
      const uuids = collectionUuids[prefix]
      if (uuids && uuids.length > 0) {
        const perInstanceValues: unknown[] = []
        for (const uuid of uuids) {
          const itemPath = `${prefix}/#${uuid}/${fieldSuffix}`
          try {
            const value = readFactValue(graph, itemPath)
            perInstanceValues.push(value)
          } catch {
            perInstanceValues.push(null)
          }
        }
        results[fact.path] = perInstanceValues
      }
      continue
    }

    // For collection parent facts, skip (they're structural)
    const isCollectionParent = collectionPrefixes.has(fact.path)
    if (isCollectionParent) {
      results[fact.path] = `${collectionUuids[fact.path]?.length ?? 0} members`
      continue
    }

    // Scalar facts
    try {
      const value = readFactValue(graph, fact.path)
      if (value !== undefined) {
        results[fact.path] = value
      }
    } catch {
      // Skip facts that can't be read
    }
  }

  const t3 = Date.now()
  timings.dict += t1a - t0
  timings.graphInit += t1b - t1a
  timings.collections += t1c - t1b
  timings.scalarInputs += t2 - t1c
  timings.read += t3 - t2
  timings.total += t3 - t0
  timings.count++

  return results
}

/**
 * Read a fact value from the graph using the factgraph 3.1 API.
 *
 * In 3.1, graph.get()/getVect() were removed. Instead we use
 * getFact(path) → Fact, then call the Scala-mangled get method
 * which returns a MaybeVector wrapping a Result.
 *
 * MaybeVector$Single.x → Result$Complete._f_v = the value
 * MaybeVector$Single.x → Result$Incomplete (anonymous) = no value
 * MaybeVector$Vect._f_vect → Scala Vector of Results
 */
function readFactValue(graph: unknown, path: string): unknown {
  const g = graph as {
    getFact: (p: string) => Record<string, unknown>
  }
  const fact = g.getFact(path)
  patchFactProtoOnce(fact)
  maybeInstallTraceWrapper(fact)

  // Call the Scala-mangled get method
  const getFn = fact[
    'get__Lgov_irs_factgraph_monads_MaybeVector'
  ] as () => Record<string, unknown>
  if (!getFn) return undefined
  const mv = getFn.call(fact)
  if (!mv || typeof mv !== 'object') return undefined

  // Single result (scalar facts)
  const singleKey = Object.keys(mv).find((k) => k.includes('Single__f_x'))
  if (singleKey) {
    const result = mv[singleKey] as Record<string, unknown>
    if (!result || typeof result !== 'object') return undefined
    // Check for Complete (has __f_v field) vs Incomplete
    const valueKey = Object.keys(result).find((k) => k.endsWith('__f_v'))
    if (!valueKey) return undefined // Incomplete
    return extractValue(result[valueKey])
  }

  // Vector result (collection aggregations like Any/All)
  const vectKey = Object.keys(mv).find((k) => k.includes('__f_vect'))
  if (vectKey) {
    const completeKey = Object.keys(mv).find((k) => k.endsWith('__f_c'))
    if (completeKey && !mv[completeKey]) return undefined

    const vect = mv[vectKey] as Record<string, unknown>
    if (!vect || typeof vect !== 'object') return undefined

    // Extract from Scala Vector backing array
    const prefix1Key = Object.keys(vect).find((k) => k.includes('prefix1'))
    if (!prefix1Key) return undefined

    const arrObj = vect[prefix1Key] as { u?: unknown[] }
    if (!arrObj?.u) return undefined

    const values = arrObj.u.map((item) => {
      if (item === null || item === undefined) return null
      if (typeof item === 'boolean' || typeof item === 'number') return item
      if (typeof item === 'object') {
        const valKey = Object.keys(item as object).find((k) =>
          k.endsWith('__f_v')
        )
        if (valKey)
          return extractValue((item as Record<string, unknown>)[valKey])
      }
      return extractValue(item)
    })

    if (values.length === 1) return values[0]
    return values
  }

  return undefined
}

function createTypedValue(
  path: string,
  value: unknown,
  lookup: FactLookup,
  collectionUuids?: Record<string, string[]>
): unknown {
  const fact = lookup.get(path)
  if (!fact?.raw['Writable']) return undefined

  const writable = fact.raw['Writable'] as Record<string, unknown>
  const typeName = Object.keys(writable).find(
    (k) => !k.startsWith('@_') && k !== 'Limit'
  )

  switch (typeName) {
    case 'CollectionItem': {
      // The frontend dropdown stores a "#index" sentinel — look up the
      // referenced collection's UUID for that row. Already-UUID-shaped
      // values pass through (allows JSON imports of saved profiles to
      // keep working with raw UUIDs in the field).
      const typeObj = writable[typeName] as Record<string, unknown> | undefined
      const target = String(typeObj?.['@_collection'] ?? '')
      const raw = String(value)
      const indexMatch = raw.match(/^#(\d+)$/)
      let uuid: string | undefined
      if (indexMatch && target && collectionUuids?.[target]) {
        const idx = Number(indexMatch[1])
        uuid = collectionUuids[target][idx]
      } else if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          raw
        )
      ) {
        uuid = raw
      }
      if (!uuid) return undefined
      try {
        // The bundle's CollectionItemFactory export is a plain function —
        // `.apply(uuid)` would call Function.prototype.apply, not the Scala
        // factory.
        return sfg.CollectionItemFactory(uuid)
      } catch {
        return undefined
      }
    }
    case 'String': {
      const result = sfg.StringFactory(String(value))
      return result.isRight ? result.right : undefined
    }
    case 'Dollar': {
      const result = sfg.DollarFactory(String(value))
      return result.isRight ? result.right : undefined
    }
    case 'Int':
    case 'Short':
    case 'Byte':
      return Number(value)
    case 'Boolean':
      return value === true || value === 'true'
    case 'Enum': {
      const typeObj = writable[typeName] as Record<string, unknown> | undefined
      const optionsPath = String(typeObj?.['@_optionsPath'] ?? '')
      const result = sfg.EnumFactory(String(value), optionsPath)
      return result.isRight ? result.right : undefined
    }
    case 'Day': {
      const result = sfg.DayFactory(String(value))
      return result.isRight ? result.right : undefined
    }
    case 'Rational': {
      const match = String(value).match(/^(-?\d+)\/(-?\d+)$/)
      if (!match) return undefined
      return sfg.Rational(Number(match[1]), Number(match[2]))
    }
    default:
      return undefined
  }
}

function extractValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'boolean' || typeof raw === 'number') return raw

  // Unwrap Scala collection/wrapper types using the bundle's helpers
  const str = String(raw)
  if (str.startsWith('Collection(')) {
    try {
      return sfg.convertCollectionToArray(raw)
    } catch {
      return str
    }
  }
  if (str.startsWith('List(')) {
    try {
      return sfg.scalaListToJsArray(raw)
    } catch {
      return str
    }
  }
  if (str.startsWith('Set(')) {
    try {
      return Array.from(sfg.scalaSetToJsSet(raw) as Set<unknown>)
    } catch {
      return str
    }
  }

  // Try to parse as number
  if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str)
  if (str === 'true') return true
  if (str === 'false') return false

  return str
}
