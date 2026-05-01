import type { Model, ModelNode } from '@/lib/model'
import { getNodePath } from '@/context/model-context'
import type { Profile } from '@/lib/api/profiles-api'

/** Snapshot the current execution-panel state into the wire-format used
 *  by Profile (and TestCase). Splits inputOverrides by role so the inputs
 *  bag mirrors what the user typed, with derived/constant overrides
 *  bucketed separately. */
export function snapshotExecution(
  model: Model,
  inputOverrides: Record<string, string>,
  entityData: Record<string, Record<string, string>[]>
): Pick<Profile, 'inputs' | 'overrides' | 'entities'> {
  const inputs: Record<string, unknown> = {}
  const overrides: Record<string, unknown> = {}
  for (const [nodeId, rawValue] of Object.entries(inputOverrides)) {
    if (rawValue === '') continue
    const node = model.nodes[nodeId]
    if (!node) continue
    const path = getNodePath(node.content)
    if (!path) continue
    let value: unknown
    try {
      value = JSON.parse(rawValue)
    } catch {
      value = rawValue
    }
    if (node.content.type !== 'entity' && node.content.role === 'input') {
      inputs[path] = value
    } else {
      overrides[path] = value
    }
  }

  const entities =
    Object.keys(entityData).length > 0
      ? Object.fromEntries(
          Object.entries(entityData).map(([entity, rows]) => [
            entity,
            rows.map((row) => {
              const parsed: Record<string, unknown> = {}
              for (const [key, val] of Object.entries(row)) {
                if (val === '') continue
                try {
                  parsed[key] = JSON.parse(val)
                } catch {
                  parsed[key] = val
                }
              }
              return parsed
            }),
          ])
        )
      : undefined

  return {
    inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    entities,
  }
}

/** Apply a profile/test snapshot back onto the execution-panel state. */
export function applySnapshot(
  nodes: Record<string, ModelNode>,
  snap: Pick<Profile, 'inputs' | 'overrides' | 'entities'>,
  setInputOverride: (nodeId: string, value: string) => void,
  setEntityData: (
    updater:
      | Record<string, Record<string, string>[]>
      | ((
          prev: Record<string, Record<string, string>[]>
        ) => Record<string, Record<string, string>[]>)
  ) => void
): void {
  const applyByPath = (bag: Record<string, unknown>) => {
    for (const [path, value] of Object.entries(bag)) {
      for (const [nodeId, node] of Object.entries(nodes)) {
        if (getNodePath(node.content) === path) {
          setInputOverride(
            nodeId,
            typeof value === 'string' ? value : JSON.stringify(value)
          )
          break
        }
      }
    }
  }
  if (snap.inputs) applyByPath(snap.inputs)
  if (snap.overrides) applyByPath(snap.overrides)
  if (snap.entities) {
    const ed: Record<string, Record<string, string>[]> = {}
    for (const [entity, rows] of Object.entries(snap.entities)) {
      ed[entity] = rows.map((row) => {
        const stringRow: Record<string, string> = {}
        for (const [key, val] of Object.entries(row)) {
          stringRow[key] = typeof val === 'string' ? val : JSON.stringify(val)
        }
        return stringRow
      })
    }
    setEntityData(ed)
  }
}
