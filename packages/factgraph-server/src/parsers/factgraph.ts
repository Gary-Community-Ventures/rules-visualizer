import { XMLParser } from 'fast-xml-parser'
import type {
  Model,
  ModelNode,
  ModelNodes,
  FactGraphWritable,
  FactGraphDerived,
  WritableTypeName,
  Limit,
} from '../types.js'

const WRITABLE_TYPE_NAMES = new Set<string>([
  'String', 'Boolean', 'Dollar', 'Int', 'Short', 'Byte', 'Rational',
  'Day', 'Enum', 'MultiEnum', 'Collection', 'CollectionItem',
  'Address', 'BankAccount', 'EmailAddress', 'PhoneNumber',
  'TIN', 'EIN', 'PIN', 'IPPIN',
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
    return jp === 'FactDictionaryModule.Facts.Fact'
      || jp.endsWith('.Limit')
      || jp.endsWith('.Case')
  },
})

type ParsedFact = {
  path: string
  name?: string
  description?: string
  module: string // which module file this came from
  raw: Record<string, unknown>
}

/**
 * Parse multiple Fact Graph XML module files into a single Model.
 * Each file is a <FactDictionaryModule> containing <Facts><Fact>...</Fact></Facts>.
 * Dependencies can cross modules via <Dependency module="filers" path="/foo"/>.
 */
export function parseFactGraphModules(
  modules: { name: string; xml: string }[],
  rulesetId: string,
  rulesetName: string
): Model {
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
    const id = `fg-${i + 1}`
    pathToId[fact.path] = id

    const isWritable = fact.raw.Writable !== undefined
    const isDerived = fact.raw.Derived !== undefined

    let content: FactGraphWritable | FactGraphDerived

    if (isWritable) {
      content = parseWritableContent(fact.path, fact.raw.Writable as Record<string, unknown>)
    } else if (isDerived) {
      content = parseDerivedContent(fact.path, fact.raw.Derived as Record<string, unknown>)
    } else {
      // Placeholder-only or unknown — treat as derived with no computation
      content = {
        format: 'factGraph',
        type: 'derived',
        path: fact.path,
      }
    }

    const node: ModelNode = {
      id,
      name: fact.name || pathToNodeName(fact.path),
      dependencies: [], // filled in phase 3
      content,
      description: fact.description,
      tags: [fact.module], // tag with source module
    }

    nodes[id] = node
  }

  // Phase 3: Resolve dependencies
  for (let i = 0; i < allFacts.length; i++) {
    const fact = allFacts[i]
    const id = `fg-${i + 1}`

    // Collect all <Dependency> elements from the entire fact tree
    const depPaths = collectDependencyPaths(fact.raw)
    const resolved = new Set<string>()

    for (const depPath of depPaths) {
      const depId = pathToId[depPath]
      if (depId && depId !== id) {
        resolved.add(depId)
      }
    }

    nodes[id].dependencies = Array.from(resolved)
  }

  return {
    id: rulesetId,
    name: rulesetName,
    format: 'factGraph',
    nodes,
  }
}

/**
 * Parse a single module XML file into a list of facts.
 */
function parseModuleXml(xml: string, moduleName: string): ParsedFact[] {
  const parsed = parser.parse(xml)
  const root = parsed.FactDictionaryModule
  if (!root) {
    throw new Error(`${moduleName}.xml: missing <FactDictionaryModule> root`)
  }

  const factsContainer = root.Facts
  if (!factsContainer) return []

  const factElements: unknown[] = Array.isArray(factsContainer.Fact)
    ? factsContainer.Fact
    : factsContainer.Fact
      ? [factsContainer.Fact]
      : []

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
    })
  }

  return facts
}

/**
 * Recursively collect all dependency paths from a fact's XML tree.
 * Dependencies can be nested deep inside expression trees (Switch/Case/When/Then/All/Any/etc).
 */
function collectDependencyPaths(obj: unknown): string[] {
  const paths: string[] = []

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return paths
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      paths.push(...collectDependencyPaths(item))
    }
    return paths
  }

  const record = obj as Record<string, unknown>

  // If this is a Dependency element, extract its path
  // The parser flattens <Dependency path="/foo" module="bar"/> to
  // an object with @_path and optional @_module
  if (record['@_path'] !== undefined && isInDependencyContext(record)) {
    // This is a Dependency element — handled by the parent scan below
  }

  // Look for Dependency children
  if (record.Dependency !== undefined) {
    const deps = Array.isArray(record.Dependency)
      ? record.Dependency
      : [record.Dependency]
    for (const dep of deps) {
      const d = dep as Record<string, unknown>
      const path = d['@_path'] as string
      if (path) {
        // Normalize: strip relative path prefixes for now
        // Cross-module deps and relative paths (../) still resolve by absolute path
        if (!path.startsWith('../')) {
          paths.push(path)
        }
      }
    }
  }

  // Recurse into all child elements
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('@_') || key === '#text') continue
    if (key === 'Dependency') continue // already handled above
    paths.push(...collectDependencyPaths(value))
  }

  return paths
}

function isInDependencyContext(_record: Record<string, unknown>): boolean {
  // Helper — not strictly needed since we handle Dependency as a child key
  return false
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
      const typeValue = writable[key] as Record<string, unknown> | string | undefined
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
  return {
    format: 'factGraph',
    type: 'derived',
    path,
    computation: serializeExpression(derived),
  }
}

/**
 * Recursively serialize a Derived expression tree to a human-readable string.
 */
function serializeExpression(node: unknown): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)

  if (Array.isArray(node)) {
    return node.map(serializeExpression).filter(Boolean).join(', ')
  }

  const obj = node as Record<string, unknown>

  // Leaf values: <Dollar>29200</Dollar>, <Int>0</Int>, <String>foo</String>, <Day>...</Day>
  if (obj['#text'] !== undefined) return String(obj['#text'])

  // Find the expression element (skip attributes)
  const keys = Object.keys(obj).filter((k) => !k.startsWith('@_') && k !== '#text')

  if (keys.length === 0) return ''

  // Single-child wrapper — unwrap
  if (keys.length === 1) {
    const key = keys[0]
    const child = obj[key]
    return serializeExpressionNode(key, child)
  }

  // Multiple children — serialize each
  return keys
    .map((key) => serializeExpressionNode(key, obj[key]))
    .filter(Boolean)
    .join('; ')
}

function serializeExpressionNode(tag: string, value: unknown): string {
  switch (tag) {
    // Leaf types
    case 'Dollar': return `$${extractTextValue(value)}`
    case 'Int': return extractTextValue(value)
    case 'Day': return extractTextValue(value)
    case 'String': return `"${extractTextValue(value)}"`
    case 'Boolean': return extractTextValue(value)
    case 'True': return 'true'
    case 'False': return 'false'
    case 'Rational': return extractTextValue(value)

    // Dependencies
    case 'Dependency': {
      if (Array.isArray(value)) {
        return value.map((d) => depStr(d as Record<string, unknown>)).join(', ')
      }
      return depStr(value as Record<string, unknown>)
    }

    // Boolean logic
    case 'All': return `(${serializeChildren(value, ' AND ')})`
    case 'Any': return `(${serializeChildren(value, ' OR ')})`
    case 'Not': return `NOT(${serializeExpression(value)})`

    // Comparison
    case 'Equal': return binaryOp(value, '==')
    case 'NotEqual': return binaryOp(value, '!=')
    case 'GreaterThan': return binaryOp(value, '>')
    case 'GreaterThanOrEqual': return binaryOp(value, '>=')
    case 'LessThan': return binaryOp(value, '<')
    case 'LessThanOrEqual': return binaryOp(value, '<=')
    case 'GreaterOf': return `max(${serializeChildren(value, ', ')})`
    case 'LesserOf': return `min(${serializeChildren(value, ', ')})`

    // Arithmetic
    case 'Add': return `(${serializeChildren(value, ' + ')})`
    case 'Subtract': return serializeSubtract(value)
    case 'Multiply': return `(${serializeChildren(value, ' * ')})`
    case 'Divide': return serializeDivide(value)
    case 'Round': return `round(${serializeExpression(value)})`
    case 'RoundToInt': return `roundToInt(${serializeExpression(value)})`
    case 'TruncateCents': return `truncateCents(${serializeExpression(value)})`

    // Control flow
    case 'Switch': return serializeSwitch(value)
    case 'IsComplete': return `isComplete(${serializeExpression(value)})`

    // Collection ops
    case 'Count': return `count(${serializeExpression(value)})`
    case 'CollectionSum': return `sum(${serializeExpression(value)})`
    case 'CollectionSize': return `size(${serializeExpression(value)})`
    case 'Filter': return `filter(${serializeExpression(value)})`

    // Enum
    case 'Enum': return serializeEnum(value)
    case 'EnumOptions': return `enumOptions(${serializeExpression(value)})`
    case 'EnumOption': return serializeExpression(value)
    case 'EnumOptionsContains': return `enumContains(${serializeExpression(value)})`

    // String ops
    case 'Paste': return `paste(${serializeChildren(value, ', ')})`
    case 'Length': return `length(${serializeExpression(value)})`

    // Misc
    case 'Placeholder': return serializeExpression(value)
    case 'Today': return 'today()'
    case 'Minimum': return `min(${serializeChildren(value, ', ')})`
    case 'Maximum': return `max(${serializeChildren(value, ', ')})`

    // Containers that just wrap children
    case 'Condition':
    case 'Value':
    case 'When':
    case 'Then':
    case 'Left':
    case 'Right':
    case 'Minuend':
    case 'Subtrahends':
    case 'Dividend':
    case 'Divisors':
    case 'Multiplicand':
    case 'Rate':
      return serializeExpression(value)

    // Metadata we skip
    case 'Name':
    case 'Description':
    case 'Export':
    case 'ExportZero':
    case 'BlockSubmissionOnTrue':
    case 'TaxYear':
      return ''

    default:
      // Unknown tag — just show it
      return `${tag}(${serializeExpression(value)})`
  }
}

function extractTextValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj['#text'] !== undefined) return String(obj['#text'])
  }
  return String(value)
}

function depStr(d: Record<string, unknown>): string {
  const path = d['@_path'] as string || '?'
  const mod = d['@_module'] as string | undefined
  // Show last segment of path for readability
  const shortPath = path.startsWith('/') ? path.split('/').filter(Boolean).pop() || path : path
  return mod ? `${mod}:${shortPath}` : shortPath
}

function serializeChildren(value: unknown, sep: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)

  const obj = value as Record<string, unknown>
  const parts: string[] = []

  for (const [key, child] of Object.entries(obj)) {
    if (key.startsWith('@_') || key === '#text') continue
    const s = serializeExpressionNode(key, child)
    if (s) parts.push(s)
  }

  return parts.join(sep)
}

function binaryOp(value: unknown, op: string): string {
  if (typeof value !== 'object' || value === null) return ''
  const obj = value as Record<string, unknown>
  const left = serializeExpression(obj.Left)
  const right = serializeExpression(obj.Right)
  return `${left} ${op} ${right}`
}

function serializeSubtract(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const obj = value as Record<string, unknown>
  const minuend = serializeExpression(obj.Minuend)
  const subtrahends = serializeExpression(obj.Subtrahends)
  return `(${minuend} - ${subtrahends})`
}

function serializeDivide(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const obj = value as Record<string, unknown>
  const dividend = serializeExpression(obj.Dividend)
  const divisors = serializeExpression(obj.Divisors)
  return `(${dividend} / ${divisors})`
}

function serializeSwitch(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const obj = value as Record<string, unknown>
  const cases = Array.isArray(obj.Case) ? obj.Case : obj.Case ? [obj.Case] : []

  const parts: string[] = []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as Record<string, unknown>
    const when = serializeExpression(c.When)
    const then = serializeExpression(c.Then)
    if (i === 0) {
      parts.push(`if ${when} then ${then}`)
    } else if (when === 'true') {
      parts.push(`else ${then}`)
    } else {
      parts.push(`elif ${when} then ${then}`)
    }
  }

  return parts.join(' ')
}

function serializeEnum(value: unknown): string {
  if (typeof value === 'string') return `enum:${value}`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const text = obj['#text'] as string || ''
    return text ? `enum:${text}` : 'enum'
  }
  return 'enum'
}

function pathToNodeName(path: string): string {
  const segments = path.split('/').filter((s) => s && s !== '*')
  return segments[segments.length - 1] || path
}

function parseLimits(writable: Record<string, unknown>): Limit[] | undefined {
  if (!writable.Limit) return undefined
  const limits = Array.isArray(writable.Limit) ? writable.Limit : [writable.Limit]
  const result: Limit[] = []

  for (const l of limits) {
    const lim = l as Record<string, unknown>
    const type = lim['@_type'] as string
    if (!type) continue

    // The limit value is a child element like <Int>20</Int> or <Dollar>300</Dollar>
    let value: string | number = ''
    for (const [key, val] of Object.entries(lim)) {
      if (key.startsWith('@_')) continue
      value = extractTextValue(val)
      break
    }

    if (value !== '') {
      result.push({ type: type as Limit['type'], value })
    }
  }

  return result.length > 0 ? result : undefined
}
