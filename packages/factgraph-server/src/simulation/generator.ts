/**
 * Scenario generator — creates randomized household scenarios from a model's
 * schema. Uses a seeded PRNG for reproducibility.
 */

import type { Model, ModelNode } from '../types.js'
import type {
  SimulationConfig,
  FieldConfig,
  CollectionConfig,
  GeneratedScenario,
} from './types.js'

// --- Seeded PRNG (mulberry32) ---

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Auto-configuration from model ---

const DEFAULT_RANGES: Record<string, { min: number; max: number }> = {
  Dollar: { min: 0, max: 10000 },
  Int: { min: 0, max: 100 },
  Short: { min: 0, max: 100 },
  Byte: { min: 0, max: 10 },
}

function fieldConfigFromNode(node: ModelNode): FieldConfig | null {
  const c = node.content
  if (c.format !== 'factGraph' || c.type !== 'writable') return null

  const type = c.typeName
  if (type === 'Collection' || type === 'CollectionItem') return null

  const config: FieldConfig = {
    path: c.path,
    type: type as FieldConfig['type'],
  }

  // Apply limits from the XML if present
  if (c.limits) {
    for (const limit of c.limits) {
      if (limit.type === 'Min') config.min = Number(limit.value)
      if (limit.type === 'Max') config.max = Number(limit.value)
    }
  }

  // Apply default ranges for numeric types
  const defaults = DEFAULT_RANGES[type]
  if (defaults) {
    if (config.min === undefined) config.min = defaults.min
    if (config.max === undefined) config.max = defaults.max
  }

  // Static enum options
  if ((type === 'Enum' || type === 'MultiEnum') && c.enumOptions) {
    config.enumOptions = c.enumOptions
  }

  return config
}

/**
 * Auto-generate a SimulationConfig by scanning the model's writable inputs.
 */
export function autoConfigFromModel(
  model: Model,
  overrides?: Partial<SimulationConfig>
): SimulationConfig {
  const scalarFields: FieldConfig[] = []
  const collectionFields = new Map<string, FieldConfig[]>()

  for (const node of Object.values(model.nodes)) {
    const c = node.content
    if (c.format !== 'factGraph' || c.type !== 'writable') continue
    if (c.typeName === 'Collection') continue

    const field = fieldConfigFromNode(node)
    if (!field) continue

    // Check if this is a collection-scoped field
    const collMatch = c.path.match(/^(\/[^*]+)\/\*\//)
    if (collMatch) {
      const collPath = collMatch[1]
      if (!collectionFields.has(collPath)) collectionFields.set(collPath, [])
      collectionFields.get(collPath)!.push(field)
    } else {
      scalarFields.push(field)
    }
  }

  const collections: CollectionConfig[] = Array.from(
    collectionFields.entries()
  ).map(([collectionPath, fields]) => ({
    collectionPath,
    minMembers: 1,
    maxMembers: 5,
    fields,
  }))

  // Auto-detect outcome nodes: nodes with no dependents (true leaves)
  const allDeps = new Set<string>()
  for (const node of Object.values(model.nodes)) {
    for (const dep of node.dependencies) allDeps.add(dep)
  }
  const outcomeNodes = Object.values(model.nodes)
    .filter((n) => !allDeps.has(n.id) && n.content.type !== 'entity')
    .map((n) => n.name)

  return {
    id: crypto.randomUUID(),
    seed: overrides?.seed ?? Math.floor(Math.random() * 2147483647),
    caseCount: overrides?.caseCount ?? 10000,
    outcomeNodes: overrides?.outcomeNodes ?? outcomeNodes,
    scalarFields: overrides?.scalarFields ?? scalarFields,
    collections: overrides?.collections ?? collections,
    ...overrides,
  }
}

// --- Scenario generation ---

function generateValue(field: FieldConfig, rng: () => number): unknown {
  switch (field.type) {
    case 'Boolean': {
      const p = field.trueProbability ?? 0.5
      return rng() < p
    }

    case 'Dollar': {
      const min = field.min ?? 0
      const max = field.max ?? 10000
      // Round to cents
      return Math.round((min + rng() * (max - min)) * 100) / 100
    }

    case 'Int':
    case 'Short':
    case 'Byte': {
      const min = field.min ?? 0
      const max = field.max ?? 100
      return Math.floor(min + rng() * (max - min + 1))
    }

    case 'Enum':
      if (field.enumOptions && field.enumOptions.length > 0) {
        return field.enumOptions[Math.floor(rng() * field.enumOptions.length)]
      }
      return null

    case 'String':
      return ''

    default:
      return null
  }
}

/**
 * Apply post-generation constraints to fix inconsistent values.
 * E.g., if isElderly is true, ensure age >= 60.
 */
function applyConstraints(
  row: Record<string, unknown>,
  fields: FieldConfig[]
): void {
  // Find field paths by suffix for easy lookup
  const byName = new Map<string, string>()
  for (const f of fields) {
    const segments = f.path.split('/')
    byName.set(segments[segments.length - 1], f.path)
  }

  // Constraint: isElderly → age >= 60
  const agePath = byName.get('age')
  const elderlyPath = byName.get('isElderly')
  if (agePath && elderlyPath) {
    if (row[elderlyPath] === true && typeof row[agePath] === 'number') {
      if ((row[agePath] as number) < 60)
        row[agePath] = 60 + Math.floor(((row[agePath] as number) / 100) * 30)
    }
  }

  // Constraint: if not isHigherEdStudent, weeklyWorkHours doesn't matter for student logic
  // (no fixup needed, just generates naturally)
}

/**
 * Generate N scenarios from a config using a seeded PRNG.
 */
export function generateScenarios(
  config: SimulationConfig
): GeneratedScenario[] {
  const rng = mulberry32(config.seed)
  const scenarios: GeneratedScenario[] = []

  for (let i = 0; i < config.caseCount; i++) {
    const inputs: Record<string, unknown> = {}

    for (const field of config.scalarFields) {
      inputs[field.path] = generateValue(field, rng)
    }

    let entities: Record<string, Record<string, unknown>[]> | undefined

    for (const coll of config.collections) {
      const memberCount =
        coll.minMembers +
        Math.floor(rng() * (coll.maxMembers - coll.minMembers + 1))
      const rows: Record<string, unknown>[] = []

      for (let m = 0; m < memberCount; m++) {
        const row: Record<string, unknown> = {}
        for (const field of coll.fields) {
          row[field.path] = generateValue(field, rng)
        }
        applyConstraints(row, coll.fields)
        rows.push(row)
      }

      if (!entities) entities = {}
      entities[coll.collectionPath] = rows
    }

    scenarios.push({ id: i, inputs, entities })
  }

  return scenarios
}
