import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { getRuleset } from '../../store.js'
import type { Model, ModelNode } from '../../types.js'

function getModel(rulesetId: string): Model {
  const model = getRuleset(rulesetId)
  if (!model) throw new Error(`Ruleset "${rulesetId}" not found`)
  return model
}

export const listNodes = tool(
  (input: { rulesetId: string }) => {
    const model = getModel(input.rulesetId)
    const entries = Object.values(model.nodes).map((n) => {
      const c = n.content
      const type = c.type === 'entity' ? 'entity' : `${c.type} (${c.format})`
      return `- ${n.name} [${type}]${n.description ? ': ' + n.description.slice(0, 80) : ''}`
    })
    return `Found ${entries.length} nodes:\n${entries.join('\n')}`
  },
  {
    name: 'list_nodes',
    description:
      'List all nodes in the ruleset with their type and a brief description.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
    }),
  }
)

export const getNodes = tool(
  (input: { rulesetId: string; names: string[] }) => {
    const model = getModel(input.rulesetId)
    const nameMap = new Map<string, ModelNode>()
    for (const node of Object.values(model.nodes)) {
      nameMap.set(node.name.toLowerCase(), node)
    }
    const results = input.names.map((name) => {
      const node = nameMap.get(name.toLowerCase())
      if (!node) return `Node "${name}" not found.`
      // Resolve dependency IDs to names
      const depNames = node.dependencies
        .map((id) => model.nodes[id]?.name)
        .filter(Boolean)
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
      ]
        .filter(Boolean)
        .join('\n')
    })
    return results.join('\n\n---\n\n')
  },
  {
    name: 'get_nodes',
    description:
      'Get full details for one or more nodes by name, including their logic, dependencies, and metadata.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      names: z.array(z.string()).describe('Node names to look up'),
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
    const node = nameMap.get(input.name.toLowerCase())
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
