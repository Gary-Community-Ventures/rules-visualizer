import { XMLParser } from 'fast-xml-parser'
import type {
  Model,
  ModelNode,
  ModelNodes,
  FactGraphWritable,
  FactGraphDerived,
  WritableTypeName,
  Limit,
} from 'rules-visualizer-shared-types'

const WRITABLE_TYPE_NAMES = new Set<string>([
  'String',
  'Boolean',
  'Dollar',
  'Int',
  'Short',
  'Byte',
  'Rational',
  'Day',
  'Enum',
  'MultiEnum',
  'Collection',
  'CollectionItem',
  'Address',
  'BankAccount',
  'EmailAddress',
  'PhoneNumber',
  'TIN',
  'EIN',
  'PIN',
  'IPPIN',
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
  trimValues: true,
  // Tell the parser which elements can repeat
  isArray: (_name, jpath) => {
    // Facts and Limits always appear as arrays
    const jp = String(jpath)
    return (
      jp === 'FactDictionaryModule.Facts.Fact' ||
      jp.endsWith('.Limit') ||
      jp.endsWith('.Case')
    )
  },
})

type ParsedFact = {
  path: string
  name?: string
  description?: string
  module: string // which module file this came from
  raw: Record<string, unknown>
  logic?: string // raw XML for this <Fact> block
  placeholderLogic?: string // raw XML inside <Placeholder>…</Placeholder>
}

// Node IDs are just the fact's path. Paths are already unique within a
// ruleset, so this keeps workspace/selection state stable across edits
// (inserting or reordering <Fact> elements no longer shifts IDs).

/**
 * Parse multiple Fact Graph XML module files into a single Model.
 * Each file is a <FactDictionaryModule> containing <Facts><Fact>...</Fact></Facts>.
 * Dependencies can cross modules via <Dependency module="filers" path="/foo"/>.
 */
export type { ParsedFact }

export function parseFactGraphModules(
  modules: { name: string; xml: string }[],
  rulesetId: string,
  rulesetName: string
): { model: Model; facts: ParsedFact[] } {
  // Phase 1: Parse all XML files and collect facts
  const allFacts: ParsedFact[] = []
  for (const mod of modules) {
    const facts = parseModuleXml(mod.xml, mod.name)
    allFacts.push(...facts)
  }

  // Phase 2: Build path→id map across all modules
  const pathToId: Record<string, string> = {}
  const nodes: ModelNodes = {}

  for (let i = 0; i < allFacts.length; i++) {
    const fact = allFacts[i]
    const id = fact.path
    pathToId[fact.path] = id

    const isWritable = fact.raw.Writable !== undefined
    const isDerived = fact.raw.Derived !== undefined

    let content: FactGraphWritable | FactGraphDerived

    if (isWritable) {
      content = parseWritableContent(
        fact.path,
        fact.raw.Writable as Record<string, unknown>
      )
      // Skip Collection parent nodes — they're structural, not rules
      if (content.typeName === 'Collection') continue
    } else if (isDerived) {
      content = parseDerivedContent(
        fact.path,
        fact.raw.Derived as Record<string, unknown>
      )
    } else {
      // Placeholder-only or unknown — treat as derived constant with no computation
      content = {
        format: 'factGraph',
        type: 'derived',
        role: 'constant',
        path: fact.path,
      }
    }

    // Attach raw XML source
    if (fact.logic) {
      content.logic = fact.logic
    }
    if (fact.placeholderLogic !== undefined) {
      content.placeholderLogic = fact.placeholderLogic
    }

    // Store human-readable <Name> as label on content
    if (fact.name) {
      content.label = fact.name
    }

    const node: ModelNode = {
      id,
      name: fact.path,
      dependencies: [], // filled in phase 3
      content,
      overridable: true,
      description: fact.description,
    }

    nodes[id] = node
  }

  // Resolve static Enum options: for each Enum node (writable OR derived
  // that returns an Enum) with an enumOptionsPath, look up the target
  // fact's <EnumOptions> derivation and collect its simple
  // <String value="..."/> children. Conditional options (EnumOption with
  // When/Then) stay unresolved and the frontend falls back to a text input.
  for (const node of Object.values(nodes)) {
    const content = node.content
    if (content.format !== 'factGraph') continue
    const isWritableEnum =
      content.type === 'writable' &&
      content.typeName === 'Enum' &&
      !!content.enumOptionsPath
    const isDerivedEnum =
      content.type === 'derived' &&
      content.dataType === 'Enum' &&
      !!content.enumOptionsPath
    if (!isWritableEnum && !isDerivedEnum) continue
    const target = allFacts.find((f) => f.path === content.enumOptionsPath)
    if (!target) continue
    const derived = target.raw.Derived as Record<string, unknown> | undefined
    const opts = extractEnumOptions(derived)
    if (opts) content.enumOptions = opts
  }

  // Build a suffix lookup for fuzzy resolution of collection item references.
  // E.g. /primaryFiler/age65OrOlder should match /filers/*/age65OrOlder.
  // Key: last path segment(s) after a wildcard, Value: node id
  const suffixToId: Record<string, string> = {}
  for (const [path, nodeId] of Object.entries(pathToId)) {
    const wildcardIdx = path.indexOf('/*/')
    if (wildcardIdx !== -1) {
      const suffix = path.slice(wildcardIdx + 3) // everything after /*/
      suffixToId[suffix] = nodeId
    }
  }

  // CollectionItem reference lookup: path → target collection path. Lets
  // resolvePath walk slash-separated paths like "relatedTo/isHeadOfHousehold"
  // segment-by-segment, hopping through references the same way the engine
  // follows CollectionItem aliases at evaluation time.
  const collectionItemPathByPath: Record<string, string> = {}
  for (const node of Object.values(nodes)) {
    const c = node.content
    if (
      c.format === 'factGraph' &&
      c.type === 'writable' &&
      c.collectionItemPath
    ) {
      collectionItemPathByPath[c.path] = c.collectionItemPath
    }
  }

  // Phase 3: Resolve dependencies
  for (let i = 0; i < allFacts.length; i++) {
    const fact = allFacts[i]
    const id = fact.path

    // Collect all <Dependency> elements from the entire fact tree
    const depRefs = collectDependencyPaths(fact.raw)
    const resolved = new Set<string>()

    for (const ref of depRefs) {
      // Resolve relative paths (e.g. "../lastName") against the fact's own
      // path. Multi-hop CollectionItem dereferences produce one entry per
      // hop plus the final target — every fact the engine touches becomes
      // its own dep edge.
      const absolutePaths = resolvePaths(
        ref.path,
        fact.path,
        ref.scope,
        collectionItemPathByPath
      )

      for (const absolutePath of absolutePaths) {
        let depId = pathToId[absolutePath]

        // Day facts expose virtual child paths like /applicationDate/month.
        // Those children are not standalone facts, but the graph still
        // depends on the owning Day fact.
        if (!depId) {
          const extractedDepId = resolveExtractedDayPath(
            absolutePath,
            pathToId,
            nodes
          )
          if (extractedDepId) depId = extractedDepId
        }

        // Fuzzy match: /primaryFiler/X or /secondaryFiler/X -> /filers/*/X
        if (!depId) {
          const segments = absolutePath.split('/').filter(Boolean)
          if (segments.length >= 2) {
            // Try matching the last segment against wildcard collection items
            const lastSegment = segments[segments.length - 1]
            depId = suffixToId[lastSegment]
          }
        }

        if (depId && depId !== id) {
          resolved.add(depId)
        }
      }
    }

    if (nodes[id]) {
      nodes[id].dependencies = Array.from(resolved)
    }
  }

  // Phase 4: Propagate data types through dependency chain
  // Repeat until no more types can be resolved
  let resolved = true
  while (resolved) {
    resolved = false
    for (const [, node] of Object.entries(nodes)) {
      const c = node.content
      if (c.format === 'factGraph' && c.type === 'derived' && !c.dataType) {
        for (const depId of node.dependencies) {
          const depContent = nodes[depId]?.content
          if (!depContent || depContent.format !== 'factGraph') continue
          const depType =
            depContent.type === 'writable'
              ? depContent.typeName
              : depContent.type === 'derived'
                ? depContent.dataType
                : undefined
          if (depType) {
            c.dataType = depType
            resolved = true
            break
          }
        }
      }
    }
  }

  return {
    model: {
      id: rulesetId,
      name: rulesetName,
      format: 'factGraph',
      nodes,
    },
    facts: allFacts,
  }
}

/**
 * Extract the inner <Derived> or <Writable> XML block for each <Fact path="...">.
 * Returns a map from fact path to the logic XML snippet.
 */
function extractLogicBlocks(xml: string): Record<string, string> {
  const blocks: Record<string, string> = {}
  const factRegex = /<Fact\s[^>]*path="([^"]+)"[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = factRegex.exec(xml)) !== null) {
    const path = match[1]
    const factStart = match.index

    // Find the closing </Fact>
    let depth = 1
    let searchIdx = factStart + match[0].length
    let factEnd = xml.length
    while (depth > 0 && searchIdx < xml.length) {
      const nextOpen = xml.indexOf('<Fact', searchIdx)
      const nextClose = xml.indexOf('</Fact>', searchIdx)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        searchIdx = nextOpen + 5
      } else {
        depth--
        if (depth === 0) factEnd = nextClose + '</Fact>'.length
        searchIdx = nextClose + '</Fact>'.length
      }
    }

    const factBody = xml.slice(factStart, factEnd)

    // Extract inner content of <Derived>...</Derived> or <Writable>...</Writable>.
    // <Placeholder>'s inner content is captured separately by
    // extractPlaceholderBlocks and surfaced in the node panel's Advanced
    // section rather than mixed into the main logic view.
    for (const tag of ['Derived', 'Writable']) {
      const openTag = `<${tag}>`
      const closeTag = `</${tag}>`
      const openIdx = factBody.indexOf(openTag)
      if (openIdx !== -1) {
        const closeIdx = factBody.indexOf(closeTag, openIdx)
        if (closeIdx !== -1) {
          const inner = dedentXml(
            factBody.slice(openIdx + openTag.length, closeIdx)
          )
          if (inner) blocks[path] = inner
          break
        }
      }
    }
  }

  return blocks
}

// Capture the inner content of `<Placeholder>…</Placeholder>` for each fact,
// keyed by fact path. Mirrors extractLogicBlocks' regex/depth-walk strategy
// so the same fact-body bounding logic applies. Self-closing
// `<Placeholder ... />` is captured as an empty string (engine ignores it
// anyway, but recording presence lets the FE show "Placeholder: (none)").
function extractPlaceholderBlocks(xml: string): Record<string, string> {
  const blocks: Record<string, string> = {}
  const factRegex = /<Fact\s[^>]*path="([^"]+)"[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = factRegex.exec(xml)) !== null) {
    const path = match[1]
    const factStart = match.index
    let depth = 1
    let searchIdx = factStart + match[0].length
    let factEnd = xml.length
    while (depth > 0 && searchIdx < xml.length) {
      const nextOpen = xml.indexOf('<Fact', searchIdx)
      const nextClose = xml.indexOf('</Fact>', searchIdx)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        searchIdx = nextOpen + 5
      } else {
        depth--
        if (depth === 0) factEnd = nextClose + '</Fact>'.length
        searchIdx = nextClose + '</Fact>'.length
      }
    }
    const factBody = xml.slice(factStart, factEnd)
    const openIdx = factBody.indexOf('<Placeholder')
    if (openIdx === -1) continue
    const tagEnd = factBody.indexOf('>', openIdx)
    if (tagEnd === -1) continue
    // Self-closing form: <Placeholder/> — record presence as empty string.
    if (factBody.charAt(tagEnd - 1) === '/') {
      blocks[path] = ''
      continue
    }
    const closeIdx = factBody.indexOf('</Placeholder>', tagEnd)
    if (closeIdx === -1) continue
    blocks[path] = dedentXml(factBody.slice(tagEnd + 1, closeIdx))
  }
  return blocks
}

/**
 * Parse a single module XML file into a list of facts.
 */
function parseModuleXml(xml: string, moduleName: string): ParsedFact[] {
  const parsed = parser.parse(xml)
  const root = parsed.FactDictionaryModule
  if (!root) {
    console.warn(`  Skipping ${moduleName}.xml: not a FactDictionaryModule`)
    return []
  }

  const factsContainer = root.Facts
  if (!factsContainer) return []

  const factElements: unknown[] = Array.isArray(factsContainer.Fact)
    ? factsContainer.Fact
    : factsContainer.Fact
      ? [factsContainer.Fact]
      : []

  // Extract raw XML blocks for source display
  const logicBlocks = extractLogicBlocks(xml)
  const placeholderBlocks = extractPlaceholderBlocks(xml)

  const facts: ParsedFact[] = []
  for (const el of factElements) {
    const fact = el as Record<string, unknown>
    const path = fact['@_path'] as string
    if (!path) continue

    facts.push({
      path,
      name: (fact.Name as string) || undefined,
      description: (fact.Description as string) || undefined,
      module: moduleName,
      raw: fact,
      logic: logicBlocks[path],
      placeholderLogic: placeholderBlocks[path],
    })
  }

  return facts
}

// One <Dependency> path discovered while walking a fact's XML tree, along with
// the most-recent enclosing collection scope (the path attribute on a Filter /
// Find / IndexOf, if any). The scope lets resolvePath() resolve bare-name
// paths like `memberId` inside <Filter path="/incomes"> against the iterated
// collection (so they map to /incomes/*/memberId) instead of leaving them
// unresolved.
type DepRef = { path: string; scope?: string }

const SCOPE_ELEMENTS = new Set(['Filter', 'Find', 'IndexOf'])

/**
 * Recursively collect all dependency paths from a fact's XML tree.
 * Dependencies can be nested deep inside expression trees (Switch/Case/When/Then/All/Any/etc).
 */
function collectDependencyPaths(obj: unknown, scope?: string): DepRef[] {
  const refs: DepRef[] = []

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return refs
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      refs.push(...collectDependencyPaths(item, scope))
    }
    return refs
  }

  const record = obj as Record<string, unknown>

  // Look for Dependency children
  if (record.Dependency !== undefined) {
    const deps = Array.isArray(record.Dependency)
      ? record.Dependency
      : [record.Dependency]
    for (const dep of deps) {
      const d = dep as Record<string, unknown>
      const path = d['@_path'] as string
      if (path) {
        refs.push({ path, scope })
      }
    }
  }

  // optionsPath="..." on Enum elements — references the fact providing enum options
  if (typeof record['@_optionsPath'] === 'string') {
    refs.push({ path: record['@_optionsPath'] as string, scope })
  }

  // collection="..." on CollectionItem — references the parent collection
  if (typeof record['@_collection'] === 'string') {
    refs.push({ path: record['@_collection'] as string, scope })
  }

  // Recurse into all child elements
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('@_') || key === '#text') continue
    if (key === 'Dependency') continue // already handled above

    // Scope-introducing elements (Filter / Find / IndexOf) attach a path
    // attribute pointing at the collection they iterate. Capture it as
    // both a dependency edge and as the new scope for everything inside.
    if (
      SCOPE_ELEMENTS.has(key) &&
      typeof value === 'object' &&
      value !== null
    ) {
      const elements = Array.isArray(value) ? value : [value]
      for (const el of elements) {
        const elObj = el as Record<string, unknown>
        const elPath =
          typeof elObj['@_path'] === 'string' ? elObj['@_path'] : undefined
        if (elPath) refs.push({ path: elPath, scope })
        refs.push(...collectDependencyPaths(elObj, elPath ?? scope))
      }
      continue
    }

    refs.push(...collectDependencyPaths(value, scope))
  }

  return refs
}

/**
 * Parse <Writable> content into a FactGraphWritable.
 */
function parseWritableContent(
  path: string,
  writable: Record<string, unknown>
): FactGraphWritable {
  // Find the type element — it's one of the WritableTypeName keys
  let typeName: WritableTypeName = 'String'
  let enumOptionsPath: string | undefined
  let collectionItemPath: string | undefined

  for (const key of Object.keys(writable)) {
    if (key.startsWith('@_') || key === 'Limit') continue
    if (WRITABLE_TYPE_NAMES.has(key)) {
      typeName = key as WritableTypeName
      const typeValue = writable[key] as
        | Record<string, unknown>
        | string
        | undefined
      if (typeof typeValue === 'object' && typeValue !== null) {
        // Enum has optionsPath, CollectionItem has collection
        if (typeValue['@_optionsPath']) {
          enumOptionsPath = typeValue['@_optionsPath'] as string
        }
        if (typeValue['@_collection']) {
          collectionItemPath = typeValue['@_collection'] as string
        }
      }
      break
    }
  }

  return {
    format: 'factGraph',
    type: 'writable',
    role: 'input',
    path,
    typeName,
    enumOptionsPath,
    limits: parseLimits(writable),
    collectionItemPath,
  }
}

/**
 * Parse <Derived> content into a FactGraphDerived.
 * We serialize the expression tree to a human-readable string.
 */
function parseDerivedContent(
  path: string,
  derived: Record<string, unknown>
): FactGraphDerived {
  const hasDeps = collectDependencyPaths(derived).length > 0
  const dataType = inferType(derived)
  const enumOptionsPath =
    dataType === 'Enum' ? findEnumOptionsPath(derived) : undefined

  return {
    format: 'factGraph',
    type: 'derived',
    role: hasDeps ? 'computed' : 'constant',
    path,
    dataType,
    enumOptionsPath,
  }
}

/** Recursively look for an `<Enum optionsPath="…">` literal within a derived
 *  expression tree. Returns the first one found (by document order). Used
 *  for nodes whose dataType inferred to 'Enum' (e.g. a Switch whose Then
 *  branches return Enum literals) so we know which EnumOptions fact to
 *  resolve dropdown options from. */
function findEnumOptionsPath(node: unknown): string | undefined {
  if (node === null || node === undefined || typeof node !== 'object')
    return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const p = findEnumOptionsPath(item)
      if (p) return p
    }
    return undefined
  }
  const obj = node as Record<string, unknown>
  // Direct match on this element
  if (typeof obj['@_optionsPath'] === 'string') {
    return obj['@_optionsPath'] as string
  }
  // Recurse into Enum child first (most direct), then any other children.
  const enumChild = obj['Enum']
  if (enumChild) {
    const p = findEnumOptionsPath(enumChild)
    if (p) return p
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('@_') || key === '#text' || key === 'Enum') continue
    const p = findEnumOptionsPath(value)
    if (p) return p
  }
  return undefined
}

/**
 * Infer the return type of a Derived expression tree.
 * Optionally uses a path→type map to resolve Dependency references.
 */
function inferType(node: unknown): string | undefined {
  if (node === null || node === undefined || typeof node !== 'object')
    return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const t = inferType(item)
      if (t) return t
    }
    return undefined
  }

  const obj = node as Record<string, unknown>
  const keys = Object.keys(obj).filter(
    (k) => !k.startsWith('@_') && k !== '#text'
  )

  for (const key of keys) {
    // Leaf value types
    if (key === 'Dollar') return 'Dollar'
    if (key === 'Int') return 'Int'
    if (key === 'Day') return 'Day'
    if (key === 'String') return 'String'
    if (key === 'Rational') return 'Rational'
    if (key === 'True' || key === 'False') return 'Boolean'
    if (key === 'Enum') return 'Enum'
    if (key === 'Days') return 'Days'
    if (key === 'Today') return 'Day'

    if (key === 'Dependency') {
      const dep = obj[key] as Record<string, unknown> | undefined
      const path = typeof dep?.['@_path'] === 'string' ? dep['@_path'] : ''
      const segment = path.split('/').filter(Boolean).at(-1)
      if (segment && DAY_EXTRACTORS.has(segment)) return 'Int'
    }

    // Boolean operators
    if (key === 'All' || key === 'Any' || key === 'Not') return 'Boolean'
    if (key === 'Equal' || key === 'NotEqual') return 'Boolean'
    if (key === 'GreaterThan' || key === 'GreaterThanOrEqual') return 'Boolean'
    if (key === 'LessThan' || key === 'LessThanOrEqual') return 'Boolean'
    if (key === 'IsComplete') return 'Boolean'

    // Count/size → Int
    if (key === 'Count' || key === 'CollectionSize') return 'Int'

    // Round to int → Int
    if (key === 'RoundToInt') return 'Int'

    // Date operators
    if (key === 'LastDayOfMonth' || key === 'AddPayrollMonths') return 'Day'

    // Truncate cents → Dollar
    if (key === 'TruncateCents') return 'Dollar'

    // Arithmetic / aggregation — recurse to find the leaf type, default to Dollar
    if (
      key === 'Add' ||
      key === 'Subtract' ||
      key === 'Multiply' ||
      key === 'Divide' ||
      key === 'GreaterOf' ||
      key === 'LesserOf' ||
      key === 'Round' ||
      key === 'CollectionSum' ||
      key === 'Minimum' ||
      key === 'Maximum'
    ) {
      return inferType(obj[key]) ?? 'Dollar'
    }

    // Switch — infer from Then branches
    if (key === 'Switch') {
      const sw = obj[key] as Record<string, unknown>
      const cases = Array.isArray(sw.Case) ? sw.Case : sw.Case ? [sw.Case] : []
      for (const c of cases) {
        const caseObj = c as Record<string, unknown>
        const t = inferType(caseObj.Then)
        if (t) return t
      }
    }

    // Containers — recurse
    if (
      key === 'Then' ||
      key === 'Value' ||
      key === 'Minuend' ||
      key === 'Subtrahends' ||
      key === 'Dividend' ||
      key === 'Divisors' ||
      key === 'Multiplicand' ||
      key === 'Left' ||
      key === 'Right' ||
      key === 'Placeholder' ||
      key === 'Filter'
    ) {
      const t = inferType(obj[key])
      if (t) return t
    }
  }

  return undefined
}

// Resolve a Dependency path to one or more absolute fact paths. Multi-element
// returns happen when a path traverses a CollectionItem reference: every hop
// becomes its own dep edge (the reference field itself + the dereferenced
// target field), mirroring what the engine actually touches at evaluation
// time.
//   - Absolute paths (starting with /) are returned as a single-element array.
//   - Relative paths starting with ../ are resolved against the parent of
//     the fact path: "../lastName" relative to "/filers/x/fullName" becomes
//     ["/filers/x/lastName"].
//   - Escape paths starting with ^ (the SelfStack escape) pop one path
//     segment per ^ char. "^/active" relative to "/members/*/match" becomes
//     ["/members/*/active"]; bare "^" becomes ["/members/*"].
//   - Bare/relative paths are walked segment-by-segment from the starting
//     context (the Filter/Find/IndexOf `scope` collection-item if given,
//     otherwise the fact's own collection-item). At each segment, if the
//     resolved path is a CollectionItem reference, we record an edge to it
//     and continue resolving against the reference's target collection.
//     "relatedTo/isHeadOfHousehold" from /members/*/X becomes
//     ["/members/*/relatedTo", "/members/*/isHeadOfHousehold"].
function resolvePaths(
  depPath: string,
  factPath: string,
  scope: string | undefined,
  collectionItemPathByPath: Record<string, string>
): string[] {
  if (/^\^+(\/|$)/.test(depPath)) {
    const slashIdx = depPath.indexOf('/')
    const head = slashIdx === -1 ? depPath : depPath.slice(0, slashIdx)
    const tail = slashIdx === -1 ? '' : depPath.slice(slashIdx + 1)
    const factSegments = factPath.split('/').filter(Boolean)
    // ^/X means "outside the surrounding Filter scope" — the parent of the
    // host fact. Pop the host's own leaf for each ^; bare ^ lands at the
    // parent, ^^ pops one further level, etc.
    for (let i = 0; i < head.length; i++) factSegments.pop()
    const base = factSegments.length === 0 ? '' : '/' + factSegments.join('/')
    if (tail.length === 0) return [base === '' ? '/' : base]
    return [(base === '' ? '' : base) + '/' + tail]
  }

  if (depPath.startsWith('../')) {
    // ../foo relative to /filers/*/fullName means /filers/*/foo
    // (sibling in the collection). Each ../ pops one segment.
    const factSegments = factPath.split('/').filter(Boolean)
    let remaining = depPath
    factSegments.pop()
    while (remaining.startsWith('../')) {
      remaining = remaining.slice(3)
    }
    return ['/' + factSegments.join('/') + '/' + remaining]
  }

  // Absolute paths (start with /) — already an absolute path, no walking.
  if (depPath.startsWith('/')) {
    return [depPath]
  }

  // Empty path — nothing to resolve.
  if (depPath.length === 0) {
    return []
  }

  // Relative path through CollectionItem hops. Pick a starting collection-
  // item base: the Filter/Find scope (if any), or the host fact's own
  // collection-item if the host lives in one.
  let basePath: string
  if (scope) {
    basePath = scope.endsWith('/') ? `${scope}*` : `${scope}/*`
  } else {
    const factSegs = factPath.split('/').filter(Boolean)
    factSegs.pop() // drop the fact's own leaf to land at the collection-item
    basePath = '/' + factSegs.join('/')
  }

  const segments = depPath.split('/').filter(Boolean)
  const edges: string[] = []
  for (const segment of segments) {
    const resolved = basePath === '/' ? `/${segment}` : `${basePath}/${segment}`
    edges.push(resolved)
    const targetCollection = collectionItemPathByPath[resolved]
    if (targetCollection) {
      // Hop through the reference: subsequent segments resolve against the
      // target collection's items.
      basePath = targetCollection.endsWith('/')
        ? `${targetCollection}*`
        : `${targetCollection}/*`
    } else {
      // Not a CollectionItem reference — any remaining segments would be
      // children of this resolved fact. Keep walking using the resolved
      // path as the new base.
      basePath = resolved
    }
  }
  return edges
}

const DAY_EXTRACTORS = new Set(['year', 'month', 'day', 'ordinal'])

function resolveExtractedDayPath(
  path: string,
  pathToId: Record<string, string>,
  nodes: ModelNodes
): string | undefined {
  const segments = path.split('/').filter(Boolean)
  const extractor = segments.at(-1)
  if (!extractor || !DAY_EXTRACTORS.has(extractor)) return undefined

  const basePath = '/' + segments.slice(0, -1).join('/')
  const baseId = pathToId[basePath]
  if (!baseId) return undefined

  const content = nodes[baseId]?.content
  if (content?.format !== 'factGraph') return undefined
  const typeName = content.type === 'writable' ? content.typeName : content.dataType
  return typeName === 'Day' ? baseId : undefined
}

/**
 * Remove common leading whitespace from each line of an XML snippet.
 */
function dedentXml(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return ''
  const minIndent = Math.min(
    ...lines.map((l) => l.match(/^(\s*)/)?.[1].length ?? 0)
  )
  return lines.map((l) => l.slice(minIndent)).join('\n')
}

/**
 * Extract static enum options from an <EnumOptions> Derived expression,
 * e.g. <EnumOptions><String value="A"/><String value="B"/></EnumOptions>.
 * Returns undefined if the options are conditional (EnumOption children)
 * or if the structure doesn't match.
 */
function extractEnumOptions(
  derived: Record<string, unknown> | undefined
): string[] | undefined {
  if (!derived) return undefined
  const enumOptions = derived['EnumOptions'] as
    | Record<string, unknown>
    | undefined
  if (!enumOptions) return undefined
  // Conditional options use <EnumOption> children — skip those.
  if (enumOptions['EnumOption']) return undefined
  const strings = enumOptions['String']
  if (!strings) return undefined
  const list = Array.isArray(strings) ? strings : [strings]
  const values: string[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      values.push(item)
      continue
    }
    if (typeof item === 'object' && item !== null) {
      const value = (item as Record<string, unknown>)['@_value']
      if (typeof value === 'string') values.push(value)
      else if (typeof value === 'number') values.push(String(value))
    }
  }
  return values.length > 0 ? values : undefined
}

function parseLimits(writable: Record<string, unknown>): Limit[] | undefined {
  if (!writable.Limit) return undefined
  const limits = Array.isArray(writable.Limit)
    ? writable.Limit
    : [writable.Limit]
  const result: Limit[] = []

  for (const l of limits) {
    const lim = l as Record<string, unknown>
    const type = lim['@_type'] as string
    if (!type) continue

    // The limit value is a child element like <Int>20</Int> or <Dollar>300</Dollar>
    let value: string | number = ''
    for (const [key, val] of Object.entries(lim)) {
      if (key.startsWith('@_')) continue
      if (
        typeof val === 'object' &&
        val !== null &&
        '#text' in (val as Record<string, unknown>)
      ) {
        value = String((val as Record<string, unknown>)['#text'])
      } else {
        value = String(val ?? '')
      }
      break
    }

    if (value !== '') {
      result.push({ type: type as Limit['type'], value })
    }
  }

  return result.length > 0 ? result : undefined
}
