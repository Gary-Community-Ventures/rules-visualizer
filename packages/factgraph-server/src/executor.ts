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

let cachedGraph: {
  rulesetId: string
  graph: unknown
  dictionary: unknown
} | null = null

function createGraph(rulesetId: string, facts: ParsedFact[]): unknown {
  // Convert parsed XML to digest format
  const digestFacts: DigestFact[] = facts.map((fact) => {
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

    return { path: fact.path, writable, derived, placeholder }
  })

  // Create the Scala.js graph
  const meta = new sfg.DigestMetaWrapper('2024').toNative()
  const nativeFacts = digestFacts.map((fact) =>
    sfg.DigestNodeWrapperFactory.toNative(
      new sfg.DigestNodeWrapper(
        fact.path,
        fact.writable,
        fact.derived,
        fact.placeholder
      )
    )
  )
  const config = sfg.FactDictionaryConfig.create(meta, nativeFacts)
  const dictionary = sfg.FactDictionaryFactory.fromConfig(config)
  const persister = sfg.JSPersister.create()
  const graph = sfg.GraphFactory.apply(dictionary, persister)

  cachedGraph = { rulesetId, graph, dictionary }
  return graph
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
  if (typeName === 'Rational') return 'Int'

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

export function executeFactGraph(
  rulesetId: string,
  facts: ParsedFact[],
  inputs: Record<string, unknown>,
  modelNodes?: Record<string, { content: { dataType?: string } }>,
  entities?: Record<string, Record<string, unknown>[]>
): Record<string, unknown> {
  // Separate inputs into writable values and derived overrides
  const writableInputs: Record<string, unknown> = {}
  const derivedOverrides: Record<string, unknown> = {}

  for (const [path, value] of Object.entries(inputs)) {
    const fact = facts.find((f) => f.path === path)
    if (!fact) continue
    if (fact.raw['Writable']) {
      writableInputs[path] = value
    } else {
      derivedOverrides[path] = value
    }
  }

  // If there are derived overrides, rebuild the graph with those facts as writables
  const effectiveFacts =
    Object.keys(derivedOverrides).length > 0
      ? facts.map((f) => {
          if (f.path in derivedOverrides) {
            const modelNode = modelNodes
              ? Object.values(modelNodes).find(
                  (n) =>
                    n.content &&
                    'path' in n.content &&
                    (n.content as { path: string }).path === f.path
                )
              : undefined
            const typeName = inferWritableType(
              f.raw,
              modelNode?.content as { dataType?: string } | undefined
            )
            return {
              ...f,
              raw: {
                ...f.raw,
                Writable: { [typeName]: {} },
                Derived: undefined,
              },
            }
          }
          return f
        })
      : facts

  const graph = createGraph(rulesetId, effectiveFacts) as {
    set: (path: string, value: unknown) => void
    get: (path: string) => {
      complete: boolean
      hasValue: boolean
      get: unknown
    }
    save: () => { valid: boolean }
  }

  // Detect collections: find facts with /* in path, group by collection prefix
  const collectionPrefixes = new Set<string>()
  for (const fact of effectiveFacts) {
    const match = fact.path.match(/^(\/[^*]+)\/\*\//)
    if (match) collectionPrefixes.add(match[1])
  }

  // Generate UUIDs for each collection instance and set up collections
  const collectionUuids: Record<string, string[]> = {}
  for (const prefix of collectionPrefixes) {
    const entityRows = entities?.[prefix] ?? []
    if (entityRows.length === 0) continue

    const uuids = entityRows.map(() => crypto.randomUUID())
    collectionUuids[prefix] = uuids

    // Create the collection
    try {
      const collection = sfg.CollectionFactory(uuids)
      graph.set(prefix, collection)
    } catch (e) {
      console.warn(
        `Failed to create collection ${prefix}:`,
        (e as Error).message
      )
      continue
    }

    // Save after creating collection so the engine registers the items
    graph.save()

    // Set per-item values
    for (let i = 0; i < entityRows.length; i++) {
      const row = entityRows[i]
      const uuid = uuids[i]
      for (const [fieldName, value] of Object.entries(row)) {
        if (fieldName === 'id') continue
        // Find the fact for this field to determine its type
        const fieldPath = `${prefix}/*/${fieldName}`
        const itemPath = `${prefix}/#${uuid}/${fieldName}`
        try {
          const typedValue = createTypedValue(fieldPath, value, effectiveFacts)
          if (typedValue !== undefined) {
            graph.set(itemPath, typedValue)
          }
        } catch (e) {
          console.warn(`Failed to set ${itemPath}:`, (e as Error).message)
        }
      }
    }
  }

  // Set scalar writable input values
  for (const [path, value] of Object.entries(writableInputs)) {
    // Skip collection items — already handled above
    if (path.includes('/*')) continue
    try {
      const typedValue = createTypedValue(path, value, effectiveFacts)
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
      const typedValue = createTypedValue(path, value, effectiveFacts)
      if (typedValue !== undefined) {
        graph.set(path, typedValue)
      }
    } catch (e) {
      console.warn(`Failed to set override ${path}:`, (e as Error).message)
    }
  }

  // Save to trigger computation
  graph.save()

  // Read all fact values
  const results: Record<string, unknown> = {}
  for (const fact of facts) {
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
            const result = graph.get(itemPath)
            if (result.complete && result.hasValue) {
              perInstanceValues.push(extractValue(result.get))
            } else {
              perInstanceValues.push(null)
            }
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
      const result = graph.get(fact.path)
      if (result.complete && result.hasValue) {
        results[fact.path] = extractValue(result.get)
      }
    } catch {
      // Skip facts that can't be read
    }
  }

  return results
}

function createTypedValue(
  path: string,
  value: unknown,
  facts: ParsedFact[]
): unknown {
  // Find the fact to determine its type
  const fact = facts.find((f) => f.path === path)
  if (!fact?.raw['Writable']) return undefined

  const writable = fact.raw['Writable'] as Record<string, unknown>
  const typeName = Object.keys(writable).find(
    (k) => !k.startsWith('@_') && k !== 'Limit'
  )

  switch (typeName) {
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
    default:
      return undefined
  }
}

function extractValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'boolean' || typeof raw === 'number') return raw

  // Scala.js objects have toString methods
  const str = String(raw)

  // Try to parse as number
  if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str)
  if (str === 'true') return true
  if (str === 'false') return false

  return str
}
