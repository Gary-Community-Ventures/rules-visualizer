import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useMainContext } from '@/context'
import {
  getNodePath,
  isInputNode,
  isConstantNode,
  isOverridable,
  isCollectionParent,
  getCollectionInputs,
  getTypeHint,
} from '@/context/model-context'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Upload,
  Download,
  Plus,
  Users,
} from 'lucide-react'
import type { ModelNode } from '@/lib/model'

export function ExecutionPanel() {
  const {
    model,
    inputOverrides,
    setInputOverride,
    clearInputOverride,
    clearOverrides,
    entityData,
    setEntityData,
    executionResults,
    executionError,
    runOnBlur,
    clearExecution,
  } = useMainContext()

  // Persist section expand states across panel open/close
  const [sectionState, setSectionState] = useState<Record<string, boolean>>(
    () => {
      try {
        const stored = localStorage.getItem(`exec-panel:${model.id}`)
        return stored ? JSON.parse(stored) : { inputs: true }
      } catch {
        return { inputs: true }
      }
    }
  )
  const setSection = (key: string, open: boolean) => {
    setSectionState((prev) => {
      const next = { ...prev, [key]: open }
      localStorage.setItem(`exec-panel:${model.id}`, JSON.stringify(next))
      return next
    })
  }
  const showInputs = sectionState.inputs ?? true
  const showOverrides = sectionState.overrides ?? false
  const showConstants = sectionState.constants ?? false
  const showComputed = sectionState.computed ?? false
  const showJson = sectionState.json ?? false
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Collection inputs (per-member fields) — works for both RAC and Fact Graph
  const collectionInputs = useMemo(
    () => getCollectionInputs(model.nodes),
    [model.nodes]
  )
  const collectionNames = Object.keys(collectionInputs)
  const totalCollectionRows = Object.values(entityData).reduce(
    (s, rows) => s + rows.length,
    0
  )

  // IDs of nodes that belong to collections (should NOT appear in scalar inputs)
  const collectionNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const fields of Object.values(collectionInputs)) {
      for (const f of fields) ids.add(f.nodeId)
    }
    // Also exclude Collection parent nodes
    for (const node of Object.values(model.nodes)) {
      if (isCollectionParent(node)) ids.add(node.id)
    }
    return ids
  }, [collectionInputs, model.nodes])

  const { inputNodes, constantNodes, computedNodes } = useMemo(() => {
    const inputs: ModelNode[] = []
    const constants: ModelNode[] = []
    const computed: ModelNode[] = []
    for (const node of Object.values(model.nodes)) {
      // Skip collection-scoped inputs and collection parents
      if (collectionNodeIds.has(node.id)) continue
      if (isInputNode(node)) inputs.push(node)
      else if (isConstantNode(node)) constants.push(node)
      else if (isOverridable(node)) computed.push(node)
    }
    inputs.sort((a, b) => a.name.localeCompare(b.name))
    constants.sort((a, b) => a.name.localeCompare(b.name))
    computed.sort((a, b) => a.name.localeCompare(b.name))
    return {
      inputNodes: inputs,
      constantNodes: constants,
      computedNodes: computed,
    }
  }, [model.nodes])

  // Count values by category
  const inputCount = inputNodes.filter(
    (n) => inputOverrides[n.id] && inputOverrides[n.id] !== ''
  ).length
  const constantOverrideCount = constantNodes.filter(
    (n) => inputOverrides[n.id] && inputOverrides[n.id] !== ''
  ).length
  const computedOverrideCount = computedNodes.filter(
    (n) => inputOverrides[n.id] && inputOverrides[n.id] !== ''
  ).length
  const totalOverrideCount = constantOverrideCount + computedOverrideCount

  // Missing required inputs
  const missingRequired = inputNodes.filter(
    (n) =>
      !getDefault(n) && !(inputOverrides[n.id] && inputOverrides[n.id] !== '')
  )

  // Path lookups
  const nodeIdToPath: Record<string, string> = {}
  const pathToNodeId: Record<string, string> = {}
  for (const node of Object.values(model.nodes)) {
    const path = getNodePath(node.content)
    if (path) {
      nodeIdToPath[node.id] = path
      pathToNodeId[path] = node.id
    }
  }

  // Clear just input values
  const clearInputs = () => {
    for (const node of inputNodes) {
      if (inputOverrides[node.id]) clearInputOverride(node.id)
    }
    clearExecution()
  }

  // Export: generate JSON from current state into the text box
  const handleExport = () => {
    const inputs: Record<string, unknown> = {}
    const overrides: Record<string, unknown> = {}

    for (const [nodeId, rawValue] of Object.entries(inputOverrides)) {
      if (rawValue === '') continue
      const path = nodeIdToPath[nodeId]
      if (!path) continue
      let value: unknown
      try {
        value = JSON.parse(rawValue)
      } catch {
        value = rawValue
      }

      if (inputNodes.some((n) => n.id === nodeId)) {
        inputs[path] = value
      } else {
        overrides[path] = value
      }
    }

    const json: Record<string, unknown> = {}
    if (Object.keys(inputs).length > 0) json.inputs = inputs
    if (Object.keys(overrides).length > 0) json.overrides = overrides

    setJsonText(JSON.stringify(json, null, 2))
    setSection('json', true)
  }

  // Import: read JSON text box and apply to form
  const handleImport = () => {
    setJsonError(null)
    try {
      const parsed = JSON.parse(jsonText)
      if (typeof parsed !== 'object' || parsed === null) {
        setJsonError('JSON must be an object')
        return
      }
      const allEntries: [string, unknown][] = []
      if (parsed.inputs) {
        allEntries.push(
          ...Object.entries(parsed.inputs as Record<string, unknown>)
        )
      }
      if (parsed.overrides) {
        allEntries.push(
          ...Object.entries(parsed.overrides as Record<string, unknown>)
        )
      }
      if (allEntries.length === 0) {
        allEntries.push(...Object.entries(parsed as Record<string, unknown>))
      }
      for (const [key, value] of allEntries) {
        const nodeId = pathToNodeId[key]
        if (nodeId) {
          setInputOverride(
            nodeId,
            typeof value === 'string' ? value : JSON.stringify(value)
          )
        }
      }
    } catch {
      setJsonError('Invalid JSON')
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold">Execute Rules</h2>
        {executionResults && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearExecution}
            className="h-7 text-xs"
          >
            Clear results
          </Button>
        )}
      </div>

      {/* Status banners */}
      {executionError && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b">
          {executionError}
        </div>
      )}
      {missingRequired.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 text-amber-700 text-xs border-b">
          {missingRequired.length} required{' '}
          {missingRequired.length === 1 ? 'input' : 'inputs'} missing
        </div>
      )}
      {executionResults && (
        <div className="px-4 py-2 bg-emerald-50 text-emerald-700 text-xs border-b">
          {Object.keys(executionResults).length} nodes computed
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── INPUTS ── */}
        {(inputNodes.length > 0 || collectionNames.length > 0) && (
          <div className="p-4 border-b">
            <div className="flex items-center">
              <button
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1"
                onClick={() => setSection('inputs', !showInputs)}
              >
                {showInputs ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                Inputs
                {inputCount === inputNodes.length && (collectionNames.length === 0 || totalCollectionRows > 0) ? (
                  <span className="font-normal text-emerald-600">All set</span>
                ) : inputCount > 0 || totalCollectionRows > 0 ? (
                  <span className="font-normal">
                    {inputCount} of {inputNodes.length}
                    {totalCollectionRows > 0 && ` + ${totalCollectionRows} items`}
                  </span>
                ) : (
                  <span className="font-normal">({inputNodes.length}{collectionNames.length > 0 ? ' + collections' : ''})</span>
                )}
              </button>
              {inputCount > 0 && (
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={clearInputs}
                >
                  Clear
                </button>
              )}
            </div>
            {showInputs && (
              <div className="mt-3 space-y-3">
                {inputNodes.map((node) => {
                  const nodeDefault = getDefault(node)
                  return (
                    <NodeField
                      key={node.id}
                      node={node}
                      value={inputOverrides[node.id] ?? ''}
                      onChange={(val) => setInputOverride(node.id, val)}
                      onClear={() => clearInputOverride(node.id)}
                      onBlur={runOnBlur}
                      result={executionResults?.[node.id]?.value}
                      required={!nodeDefault}
                      defaultValue={nodeDefault}
                      colorScheme="input"
                    />
                  )
                })}

                {/* Collection editors inline under inputs */}
                {collectionNames.map((collectionName) => {
                  const fields = collectionInputs[collectionName]
                  const rows = entityData[collectionName] ?? []
                  return (
                    <EntityEditor
                      key={collectionName}
                      entityName={collectionName}
                      fields={fields}
                      rows={rows}
                      onChange={(newRows) =>
                        setEntityData((prev) => ({
                          ...prev,
                          [collectionName]: newRows,
                        }))
                      }
                      onBlur={runOnBlur}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── OVERRIDES ── */}
        {(constantNodes.length > 0 || computedNodes.length > 0) && (
          <div className="p-4 border-b">
            <div className="flex items-center">
              <button
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1"
                onClick={() => setSection('overrides', !showOverrides)}
              >
                {showOverrides ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                Overrides
                {totalOverrideCount > 0 && (
                  <span className="font-normal text-amber-600">
                    {totalOverrideCount} active
                  </span>
                )}
              </button>
              {totalOverrideCount > 0 && (
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={clearOverrides}
                >
                  Clear
                </button>
              )}
            </div>

            {showOverrides && (
              <div className="mt-3 space-y-4">
                {/* Constants */}
                {constantNodes.length > 0 && (
                  <div>
                    <button
                      className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground w-full mb-2"
                      onClick={() => setSection('constants', !showConstants)}
                    >
                      {showConstants ? (
                        <ChevronDown className="size-2.5" />
                      ) : (
                        <ChevronRight className="size-2.5" />
                      )}
                      Constants ({constantNodes.length})
                      {constantOverrideCount > 0 && (
                        <span className="ml-auto text-amber-600">
                          {constantOverrideCount} overridden
                        </span>
                      )}
                    </button>
                    {showConstants && (
                      <div className="space-y-3 pl-2">
                        {constantNodes.map((node) => (
                          <NodeField
                            key={node.id}
                            node={node}
                            value={inputOverrides[node.id] ?? ''}
                            onChange={(val) => setInputOverride(node.id, val)}
                            onClear={() => clearInputOverride(node.id)}
                            onBlur={runOnBlur}
                            result={executionResults?.[node.id]?.value}
                            defaultValue={getDefault(node)}
                            colorScheme="override"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Computed nodes */}
                {computedNodes.length > 0 && (
                  <div>
                    <button
                      className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground w-full mb-2"
                      onClick={() => setSection('computed', !showComputed)}
                    >
                      {showComputed ? (
                        <ChevronDown className="size-2.5" />
                      ) : (
                        <ChevronRight className="size-2.5" />
                      )}
                      Computed ({computedNodes.length})
                      {computedOverrideCount > 0 && (
                        <span className="ml-auto text-amber-600">
                          {computedOverrideCount} pinned
                        </span>
                      )}
                    </button>
                    {showComputed && (
                      <div className="space-y-3 pl-2">
                        {computedNodes.map((node) => (
                          <NodeField
                            key={node.id}
                            node={node}
                            value={inputOverrides[node.id] ?? ''}
                            onChange={(val) => setInputOverride(node.id, val)}
                            onClear={() => clearInputOverride(node.id)}
                            onBlur={runOnBlur}
                            result={executionResults?.[node.id]?.value}
                            colorScheme="override"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── JSON ── */}
        <div className="p-4">
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-full"
            onClick={() => setSection('json', !showJson)}
          >
            {showJson ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            JSON
          </button>
          {showJson && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  className="gap-1.5 h-7 text-xs flex-1"
                >
                  <Download className="size-3" />
                  Generate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImport}
                  className="gap-1.5 h-7 text-xs flex-1"
                >
                  <Upload className="size-3" />
                  Apply
                </Button>
              </div>
              <Textarea
                className="font-mono text-xs min-h-[100px]"
                placeholder={
                  '{\n  "inputs": { "path": value },\n  "overrides": { "path": value }\n}'
                }
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  setJsonError(null)
                }}
              />
              {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Node field ---

type NodeFieldProps = {
  node: ModelNode
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onBlur?: () => void
  result?: unknown
  required?: boolean
  defaultValue?: string
  colorScheme?: 'input' | 'override'
}

function NodeField({
  node,
  value,
  onChange,
  onClear,
  onBlur,
  result,
  required,
  defaultValue,
  colorScheme = 'input',
}: NodeFieldProps) {
  const typeHint = getTypeHint(node)
  const hasValue = value !== ''

  const ringClass = hasValue
    ? colorScheme === 'input'
      ? 'border-blue-400 ring-1 ring-blue-400'
      : 'border-amber-400 ring-1 ring-amber-400'
    : ''

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium truncate" title={node.name}>
          {node.name}
          {typeHint && (
            <span className="ml-1 text-muted-foreground font-normal">
              ({typeHint})
            </span>
          )}
          {required && !hasValue && (
            <span className="ml-1 text-red-400">*</span>
          )}
        </label>
        {hasValue && (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={onClear}
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
      <Input
        className={cn('h-7 text-xs font-mono', ringClass)}
        placeholder={defaultValue ?? (required ? 'required' : 'default')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {result !== undefined && (
        <p className="text-xs font-mono text-emerald-700 truncate">
          = {formatValue(result)}
        </p>
      )}
    </div>
  )
}

/** Get the default value string for a node, or undefined if none declared */
function getDefault(node: ModelNode): string | undefined {
  const c = node.content
  if (c.format === 'rac' && c.type === 'variable' && c.default) return c.default
  if (
    c.format === 'factGraph' &&
    c.type === 'derived' &&
    c.role === 'constant' &&
    c.logic
  ) {
    const match = c.logic.match(/>([^<]+)<\//)
    if (match) return match[1]
  }
  return undefined
}

// --- Entity editor ---

type EntityField = {
  nodeId: string
  path: string
  fieldName: string
  default?: string
  typeHint?: string
}

type EntityEditorProps = {
  entityName: string
  fields: EntityField[]
  rows: Record<string, string>[]
  onChange: (rows: Record<string, string>[]) => void
  onBlur: () => void
}

function EntityEditor({ entityName, fields, rows, onChange, onBlur }: EntityEditorProps) {
  const addRow = () => {
    const newRow: Record<string, string> = {}
    for (const field of fields) {
      if (field.default) newRow[field.path] = field.default
    }
    onChange([...rows, newRow])
  }

  const updateField = (rowIdx: number, fieldPath: string, value: string) => {
    const updated = rows.map((row, i) =>
      i === rowIdx ? { ...row, [fieldPath]: value } : row
    )
    onChange(updated)
  }

  const removeRow = (rowIdx: number) => {
    onChange(rows.filter((_, i) => i !== rowIdx))
  }

  // Clean up display name: strip leading / for Fact Graph paths
  const displayName = entityName.startsWith('/')
    ? entityName.slice(1).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : entityName

  return (
    <div className="border-t pt-3 mt-3">
      <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
        <Users className="size-3" />
        {displayName}
        {rows.length > 0 && (
          <span className="font-normal text-blue-600">{rows.length}</span>
        )}
      </div>
      <div className="space-y-3">
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className="border rounded-md p-2 space-y-1.5 bg-blue-50/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                #{rowIdx + 1}
              </span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => removeRow(rowIdx)}
              >
                <Trash2 className="size-2.5" />
              </button>
            </div>
            {fields.map((field) => (
              <div key={field.path} className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground w-24 shrink-0 truncate" title={field.path}>
                  {field.fieldName}
                  {field.typeHint && (
                    <span className="ml-0.5 opacity-60">({field.typeHint})</span>
                  )}
                </span>
                <Input
                  className={cn(
                    'h-6 text-xs font-mono flex-1',
                    row[field.path] && 'border-blue-400 ring-1 ring-blue-400'
                  )}
                  placeholder={field.default ?? field.typeHint?.toLowerCase() ?? 'value'}
                  value={row[field.path] ?? ''}
                  onChange={(e) => updateField(rowIdx, field.path, e.target.value)}
                  onBlur={onBlur}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={addRow}
        className="mt-2 h-7 text-xs gap-1.5 w-full"
      >
        <Plus className="size-3" />
        Add {displayName}
      </Button>
    </div>
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    // Show per-member values inline
    return value.map((v) => String(v)).join(', ')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
