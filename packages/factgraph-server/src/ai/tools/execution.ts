import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { getRuleset, getRawFacts } from '../../store.js'
import { executeFactGraph } from '../../executor.js'
import type { Model } from '../../types.js'

function getModel(rulesetId: string): Model {
  const model = getRuleset(rulesetId)
  if (!model) throw new Error(`Ruleset "${rulesetId}" not found`)
  return model
}

/**
 * Resolve a node name or path to its canonical fact path.
 * Accepts either a path (starts with /) or a node name (case-insensitive match).
 */
export function resolvePathFromName(
  model: Model,
  nameOrPath: string
): string | null {
  if (nameOrPath.startsWith('/')) return nameOrPath
  // Try as-is, then with leading / (LLMs often drop it)
  const lower = nameOrPath.toLowerCase()
  const node = Object.values(model.nodes).find(
    (n) =>
      n.name.toLowerCase() === lower || n.name.toLowerCase() === '/' + lower
  )
  if (node && node.content.type !== 'entity' && 'path' in node.content) {
    return node.content.path
  }
  return null
}

/**
 * Normalize a value for the executor: strip commas, coerce yes/no to boolean.
 */
function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim()
    if (lower === 'true' || lower === 'yes') return true
    if (lower === 'false' || lower === 'no') return false
    // Strip commas from numbers
    const stripped = value.replace(/,/g, '')
    if (/^-?\d+(\.\d+)?$/.test(stripped)) return Number(stripped)
  }
  return value
}

export const listWritableInputs = tool(
  (input: { rulesetId: string }) => {
    const model = getModel(input.rulesetId)
    const entries: string[] = []
    const collectionInputs: Record<string, string[]> = {}

    for (const node of Object.values(model.nodes)) {
      const c = node.content
      if (c.type !== 'writable' || c.format !== 'factGraph') continue

      const parts = [node.name, `(${c.typeName})`]
      if (c.enumOptions?.length) {
        parts.push(`options: [${c.enumOptions.join(', ')}]`)
      }
      if (c.limits?.length) {
        const limitDescs = c.limits.map((l) => `${l.type}: ${l.value}`)
        parts.push(`limits: ${limitDescs.join(', ')}`)
      }

      const line = `- ${parts.join(' ')}`

      // Group collection-scoped inputs
      const collMatch = c.path.match(/^(\/[^*]+)\/\*\//)
      if (collMatch) {
        const prefix = collMatch[1]
        if (!collectionInputs[prefix]) collectionInputs[prefix] = []
        collectionInputs[prefix].push(line)
      } else if (
        c.typeName !== 'Collection' &&
        c.typeName !== 'CollectionItem'
      ) {
        entries.push(line)
      }
    }

    let result = `Scalar inputs (${entries.length}):\n${entries.join('\n')}`

    for (const [prefix, fields] of Object.entries(collectionInputs)) {
      result += `\n\nCollection ${prefix} fields (${fields.length}):\n${fields.join('\n')}`
    }

    return result
  },
  {
    name: 'list_writable_inputs',
    description:
      'List all writable input nodes with their types, enum options, and limits. Use this before execute_graph to know what inputs are available.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
    }),
  }
)

export const executeGraph = tool(
  (input: {
    rulesetId: string
    inputs: Record<string, unknown>
    entities?: Record<string, Record<string, unknown>[]>
    outputNodes?: string[]
    offset?: number
  }) => {
    const model = getModel(input.rulesetId)
    const facts = getRawFacts(input.rulesetId)
    if (!facts) return 'No facts available for this ruleset.'

    // Resolve input keys (names or paths) to canonical paths
    const resolvedInputs: Record<string, unknown> = {}
    const unresolved: string[] = []
    for (const [key, value] of Object.entries(input.inputs)) {
      const path = resolvePathFromName(model, key)
      if (path) {
        resolvedInputs[path] = normalizeValue(value)
      } else {
        unresolved.push(key)
      }
    }

    if (unresolved.length > 0) {
      return `Could not resolve these input names to node paths: ${unresolved.join(', ')}. Use list_writable_inputs to see available inputs.`
    }

    // Resolve entity keys if provided
    let resolvedEntities: Record<string, Record<string, unknown>[]> | undefined
    if (input.entities) {
      resolvedEntities = {}
      for (const [collPath, rows] of Object.entries(input.entities)) {
        resolvedEntities[collPath] = rows.map((row) => {
          const resolved: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(row)) {
            if (k === 'id') {
              resolved[k] = v
              continue
            }
            const p = resolvePathFromName(model, k)
            resolved[p ?? k] = normalizeValue(v)
          }
          return resolved
        })
      }
    }

    try {
      const pathResults = executeFactGraph(
        input.rulesetId,
        facts,
        resolvedInputs,
        model.nodes as Record<string, { content: { dataType?: string } }>,
        resolvedEntities
      )

      // Build path→name lookup
      const pathToName: Record<string, string> = {}
      for (const node of Object.values(model.nodes)) {
        if (node.content.type !== 'entity' && 'path' in node.content) {
          pathToName[node.content.path] = node.name
        }
      }

      // Filter to requested outputs if specified
      let outputPaths: Set<string> | null = null
      if (input.outputNodes?.length) {
        outputPaths = new Set<string>()
        for (const nameOrPath of input.outputNodes) {
          const p = resolvePathFromName(model, nameOrPath)
          if (p) outputPaths.add(p)
        }
      }

      // Format results
      const lines: string[] = []
      for (const [path, value] of Object.entries(pathResults)) {
        if (value === null || value === undefined) continue
        if (outputPaths && !outputPaths.has(path)) continue
        const name = pathToName[path] ?? path
        lines.push(`${name} = ${JSON.stringify(value)}`)
      }

      // Paginate results
      const PAGE_SIZE = 50
      const offset = input.offset ?? 0
      const total = lines.length

      if (!outputPaths && total > PAGE_SIZE) {
        const page = lines.slice(offset, offset + PAGE_SIZE)
        const remaining = total - offset - page.length
        if (remaining > 0) {
          page.push(
            `... ${remaining} more results. Call again with offset: ${offset + PAGE_SIZE} to see the next page.`
          )
        }
        return `Computed ${total} total results (showing ${offset + 1}–${offset + page.length}):\n${page.join('\n')}`
      }

      if (lines.length === 0) {
        return 'Execution completed but no non-null results were produced. Some inputs may be missing.'
      }

      return `Computed ${lines.length} results:\n${lines.join('\n')}`
    } catch (e) {
      return `Execution failed: ${(e as Error).message}`
    }
  },
  {
    name: 'execute_graph',
    description:
      'Execute the fact graph with specific input values and return computed results. Use node paths (like /income) or node names as input keys. Use outputNodes to filter which results to return.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      inputs: z
        .record(z.string(), z.unknown())
        .describe(
          'Map of node path or name → value. Dollar = plain number, Boolean = true/false, Enum = string option name.'
        ),
      entities: z
        .record(z.string(), z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe(
          'Collection entity data: collection path → array of row objects'
        ),
      outputNodes: z
        .array(z.string())
        .optional()
        .describe(
          'Node paths or names to include in output. If omitted, returns all non-null results (paginated, 50 per page).'
        ),
      offset: z
        .number()
        .optional()
        .describe(
          'Pagination offset for results. Use to fetch the next page when results are truncated.'
        ),
    }),
  }
)

export const EXECUTION_TOOLS = [listWritableInputs, executeGraph]
