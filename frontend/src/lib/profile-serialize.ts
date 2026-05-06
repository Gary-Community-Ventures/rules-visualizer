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

/** Snapshot ready for runExecution: panel-state shape (string values keyed
 *  by node id / collection path), already resolved against the model. */
export type ExecutionSnapshot = {
  inputOverrides: Record<string, string>
  entityData: Record<string, Record<string, string>[]>
}

/** Build a path → nodeId index once. The earlier per-call O(N×M) lookup
 *  in applySnapshot/loadProfile/useApplyAiInputs is now O(N+M). */
function buildPathIndex(nodes: Record<string, ModelNode>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [nodeId, node] of Object.entries(nodes)) {
    const path = getNodePath(node.content)
    if (path) map.set(path, nodeId)
  }
  return map
}

const stringify = (v: unknown): string =>
  typeof v === 'string' ? v : JSON.stringify(v)

/** Convert a wire-format snapshot ({path: value} bags + {coll: [{path: value}]})
 *  into the panel-state shape — without writing it anywhere. The setter-based
 *  applySnapshot wraps this; loadProfile and useApplyAiInputs both end up
 *  needing the result for the synchronous runExecution call (refs lag a
 *  render behind setState), and now share one implementation. */
export function buildSnapshot(
  nodes: Record<string, ModelNode>,
  snap: Pick<Profile, 'inputs' | 'overrides' | 'entities'>
): ExecutionSnapshot {
  const pathToNodeId = buildPathIndex(nodes)

  const inputOverrides: Record<string, string> = {}
  const fold = (bag: Record<string, unknown>) => {
    for (const [path, value] of Object.entries(bag)) {
      const nodeId = pathToNodeId.get(path)
      if (!nodeId) continue
      inputOverrides[nodeId] = stringify(value)
    }
  }
  if (snap.inputs) fold(snap.inputs)
  if (snap.overrides) fold(snap.overrides)

  const entityData: Record<string, Record<string, string>[]> = {}
  if (snap.entities) {
    for (const [entity, rows] of Object.entries(snap.entities)) {
      entityData[entity] = rows.map((row) => {
        const stringRow: Record<string, string> = {}
        for (const [key, val] of Object.entries(row)) {
          stringRow[key] = stringify(val)
        }
        return stringRow
      })
    }
  }

  return { inputOverrides, entityData }
}

/** Apply a profile/test snapshot to the execution-panel state. Returns the
 *  same snapshot in panel shape so callers can hand it to runExecution
 *  without the ref-staleness gotcha. */
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
): ExecutionSnapshot {
  const built = buildSnapshot(nodes, snap)
  for (const [nodeId, value] of Object.entries(built.inputOverrides)) {
    setInputOverride(nodeId, value)
  }
  if (Object.keys(built.entityData).length > 0) setEntityData(built.entityData)
  return built
}
