import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { getRuleset } from '../../store.js'
import { getPageText } from '../../pdf-text.js'
import type { Model, ModelNode } from '../../types.js'

function getModel(rulesetId: string): Model {
  const model = getRuleset(rulesetId)
  if (!model) throw new Error(`Ruleset "${rulesetId}" not found`)
  return model
}

/** Look up a node by name, tolerating missing leading `/`. */
function findNode(
  nameMap: Map<string, ModelNode>,
  name: string
): ModelNode | undefined {
  const lower = name.toLowerCase()
  return nameMap.get(lower) ?? nameMap.get('/' + lower)
}

const LIST_PAGE_SIZE = 100

export const listNodes = tool(
  (input: { rulesetId: string; filter?: string; offset?: number }) => {
    const model = getModel(input.rulesetId)
    let nodes = Object.values(model.nodes)

    if (input.filter) {
      const q = input.filter.toLowerCase()
      nodes = nodes.filter(
        (n) =>
          n.content.type === q ||
          (n.content.type !== 'entity' &&
            'role' in n.content &&
            n.content.role === q)
      )
    }

    const total = nodes.length
    const offset = Math.max(0, input.offset ?? 0)
    const slice = nodes.slice(offset, offset + LIST_PAGE_SIZE)
    const entries = slice.map((n) => {
      const c = n.content
      const type = c.type === 'entity' ? 'entity' : `${c.type} (${c.format})`
      return `- ${n.name} [${type}]${n.description ? ': ' + n.description.slice(0, 80) : ''}`
    })

    const end = offset + slice.length
    const remaining = total - end
    if (remaining > 0) {
      entries.push(
        `... ${remaining} more nodes. Call list_nodes again with offset=${end} to continue, or use filter / search_nodes to narrow.`
      )
    }

    const range =
      total === 0
        ? '0'
        : `${offset + 1}–${end}${total > end ? ` of ${total}` : ` (all)`}`
    return `Showing nodes ${range}:\n${entries.join('\n')}`
  },
  {
    name: 'list_nodes',
    description:
      'List nodes in the ruleset, paginated 100 at a time. Pass offset to fetch subsequent pages. Use filter to narrow by type ("writable", "derived", "constant", "computed"). For large rulesets, prefer search_nodes when you have a query in mind.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      filter: z
        .string()
        .optional()
        .describe(
          'Filter by node type: "writable", "derived", "constant", "computed"'
        ),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'Zero-based index to start from. Default 0; bump by 100 to page through.'
        ),
    }),
  }
)

export const getNodes = tool(
  async (input: {
    rulesetId: string
    names: string[]
    includeReferences?: boolean
  }) => {
    const model = getModel(input.rulesetId)
    const nameMap = new Map<string, ModelNode>()
    for (const node of Object.values(model.nodes)) {
      nameMap.set(node.name.toLowerCase(), node)
    }
    const includeRefs = input.includeReferences === true

    const results = await Promise.all(
      input.names.map(async (name) => {
        const node = findNode(nameMap, name)
        if (!node) return `Node "${name}" not found.`
        // Resolve dependency IDs to names
        const depNames = node.dependencies
          .map((id) => model.nodes[id]?.name)
          .filter(Boolean)

        // Policy references — minimal by default, full page text on opt-in.
        let refs: string | null = null
        if (node.references?.length) {
          if (includeRefs) {
            // Dedupe (document, page) so we don't emit the same page twice
            // for a node that has multiple highlights on it.
            const seen = new Set<string>()
            const lines: string[] = []
            for (const r of node.references) {
              const page = r.section.page
              const key = `${r.document.id}|${page ?? '?'}`
              if (seen.has(key)) continue
              seen.add(key)
              const pageText = page
                ? await getPageText(input.rulesetId, r.document.id, page)
                : ''
              lines.push(
                `  - [${r.document.title}] ${r.section.label}${page ? ` (p.${page})` : ''}\n    Page text: ${pageText || '(no text extracted)'}`
              )
            }
            refs = `Policy references:\n${lines.join('\n')}`
          } else {
            refs = `Policy references (${node.references.length}; pass includeReferences=true for the page text):\n${node.references
              .map(
                (r) =>
                  `  - [${r.document.title}] ${r.section.label}${r.section.page ? ` (p.${r.section.page})` : ''}`
              )
              .join('\n')}`
          }
        }

        return [
          `Name: ${node.name}`,
          node.description ? `Description: ${node.description}` : null,
          `Type: ${node.content.type}`,
          node.content.type !== 'entity' && 'path' in node.content
            ? `Path: ${node.content.path}`
            : null,
          depNames.length > 0
            ? `Dependencies: ${depNames.join(', ')}`
            : 'Dependencies: none (leaf node)',
          node.content.type !== 'entity' &&
          'logic' in node.content &&
          node.content.logic
            ? `Logic:\n${node.content.logic}`
            : null,
          node.content.type !== 'entity' &&
          'dataType' in node.content &&
          node.content.dataType
            ? `Returns: ${node.content.dataType}`
            : null,
          refs,
        ]
          .filter(Boolean)
          .join('\n')
      })
    )
    return results.join('\n\n---\n\n')
  },
  {
    name: 'get_nodes',
    description:
      'Get full details for one or more nodes by name (logic, dependencies, metadata, policy reference labels). By default, policy references are listed by label only — pass includeReferences=true to also include the full PDF page text for each linked section, which is heavier but lets you reason about what the policy actually says.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      names: z.array(z.string()).describe('Node names to look up'),
      includeReferences: z
        .boolean()
        .optional()
        .describe(
          'If true, attach the PDF page text for each policy reference (deduped per (document, page)). Default false to keep context small.'
        ),
    }),
  }
)

export const searchNodes = tool(
  (input: { rulesetId: string; query: string }) => {
    const model = getModel(input.rulesetId)
    const q = input.query.toLowerCase()
    const matches = Object.values(model.nodes).filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        (n.description?.toLowerCase().includes(q) ?? false)
    )
    if (matches.length === 0) return 'No nodes matched.'
    return matches
      .slice(0, 20)
      .map(
        (n) =>
          `- ${n.name}: ${n.description?.slice(0, 100) ?? '(no description)'}`
      )
      .join('\n')
  },
  {
    name: 'search_nodes',
    description: 'Search for nodes by name or description text.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      query: z.string().describe('Search text'),
    }),
  }
)

export const getDependencies = tool(
  (input: { rulesetId: string; name: string }) => {
    const model = getModel(input.rulesetId)
    const nameMap = new Map<string, ModelNode>()
    for (const node of Object.values(model.nodes)) {
      nameMap.set(node.name.toLowerCase(), node)
    }
    const node = findNode(nameMap, input.name)
    if (!node) return `Node "${input.name}" not found.`
    const deps = node.dependencies
      .map((id) => model.nodes[id])
      .filter(Boolean)
      .map((n) => `- ${n.name}: ${n.description?.slice(0, 80) ?? ''}`)
    if (deps.length === 0)
      return `${node.name} has no dependencies (it's a leaf/input node).`
    return `Dependencies of ${node.name}:\n${deps.join('\n')}`
  },
  {
    name: 'get_dependencies',
    description:
      'Get the dependency chain for a node — what other nodes it depends on.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      name: z.string().describe('Node name'),
    }),
  }
)

export const SEARCH_TOOLS = [listNodes, getNodes, searchNodes, getDependencies]
