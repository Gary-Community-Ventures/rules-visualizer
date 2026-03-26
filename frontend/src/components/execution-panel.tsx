import { useState } from 'react'
import { useMainContext } from '@/context'
import { getNodePath } from '@/context/model-context'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import {
  Play,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Upload,
  Plus,
} from 'lucide-react'
import type { ScalarInputInfo } from '@/lib/api/rules-api'

export function ExecutionPanel() {
  const {
    model,
    rulesetInputs,
    inputOverrides,
    setInputOverride,
    clearInputOverride,
    entityTables,
    setEntityTables,
    executionResults,
    isExecuting,
    executionError,
    runExecution,
    clearExecution,
  } = useMainContext()

  const [showJson, setShowJson] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const overrideCount = Object.values(inputOverrides).filter(
    (v) => v !== ''
  ).length

  // Build nodeId lookup from path
  const pathToNodeId: Record<string, string> = {}
  for (const node of Object.values(model.nodes)) {
    const path = getNodePath(node.content)
    if (path) pathToNodeId[path] = node.id
  }

  const handleJsonImport = () => {
    setJsonError(null)
    try {
      const parsed = JSON.parse(jsonText)
      if (typeof parsed !== 'object' || parsed === null) {
        setJsonError('JSON must be an object')
        return
      }
      // Check if it has "inputs" and "entities" keys (full format)
      if (parsed.inputs || parsed.entities) {
        if (parsed.inputs) {
          for (const [key, value] of Object.entries(
            parsed.inputs as Record<string, unknown>
          )) {
            const nodeId = pathToNodeId[key]
            if (nodeId) {
              setInputOverride(
                nodeId,
                typeof value === 'string' ? value : JSON.stringify(value)
              )
            }
          }
        }
        if (parsed.entities) {
          setEntityTables(
            parsed.entities as Record<string, Record<string, string>[]>
          )
        }
      } else {
        // Flat format: all keys are paths
        for (const [key, value] of Object.entries(
          parsed as Record<string, unknown>
        )) {
          const nodeId = pathToNodeId[key]
          if (nodeId) {
            setInputOverride(
              nodeId,
              typeof value === 'string' ? value : JSON.stringify(value)
            )
          }
        }
      }
    } catch {
      setJsonError('Invalid JSON')
    }
  }

  if (!rulesetInputs) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h2 className="text-sm font-semibold">Execute Rules</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">
            Loading input metadata...
          </p>
        </div>
      </div>
    )
  }

  if (!rulesetInputs.executable) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h2 className="text-sm font-semibold">Execute Rules</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            This ruleset could not be compiled and is not executable.
          </p>
        </div>
      </div>
    )
  }

  const entities = Object.entries(rulesetInputs.entities)

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold">Execute Rules</h2>
        <div className="flex gap-1.5">
          {executionResults && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearExecution}
              className="h-7 text-xs"
            >
              Clear
            </Button>
          )}
          <Button
            size="sm"
            onClick={runExecution}
            disabled={isExecuting}
            className="h-7 gap-1.5"
          >
            {isExecuting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            Run
          </Button>
        </div>
      </div>

      {/* Error */}
      {executionError && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b">
          {executionError}
        </div>
      )}

      {/* Result summary */}
      {executionResults && (
        <div className="px-4 py-2 bg-emerald-50 text-emerald-700 text-xs border-b">
          {Object.keys(executionResults).length} nodes computed
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Scalar inputs */}
        {rulesetInputs.scalars.length > 0 && (
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Constants ({rulesetInputs.scalars.length})
              </h3>
              {overrideCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {overrideCount} overridden
                </span>
              )}
            </div>
            <div className="space-y-3">
              {rulesetInputs.scalars.map((scalar) => (
                <ScalarField
                  key={scalar.path}
                  scalar={scalar}
                  nodeId={pathToNodeId[scalar.path]}
                  value={inputOverrides[pathToNodeId[scalar.path]] ?? ''}
                  onChange={(val) =>
                    setInputOverride(pathToNodeId[scalar.path], val)
                  }
                  onClear={() =>
                    clearInputOverride(pathToNodeId[scalar.path])
                  }
                  result={
                    executionResults?.[pathToNodeId[scalar.path]]?.value
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Entity tables */}
        {entities.length > 0 && (
          <div className="p-4 border-b">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Entity Data
            </h3>
            <div className="space-y-4">
              {entities.map(([entityName, varPaths]) => (
                <EntityTableEditor
                  key={entityName}
                  entityName={entityName}
                  varPaths={varPaths}
                  rows={entityTables[entityName] ?? []}
                  onChange={(rows) =>
                    setEntityTables((prev) => ({
                      ...prev,
                      [entityName]: rows,
                    }))
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* JSON editor */}
        <div className="p-4">
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-full"
            onClick={() => setShowJson(!showJson)}
          >
            {showJson ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            JSON Input
          </button>
          {showJson && (
            <div className="mt-3 space-y-2">
              <Textarea
                className="font-mono text-xs min-h-[120px]"
                placeholder={
                  '{\n  "inputs": { "path": value },\n  "entities": { "Entity": [{"id": 1}] }\n}'
                }
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  setJsonError(null)
                }}
              />
              {jsonError && (
                <p className="text-xs text-red-600">{jsonError}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleJsonImport}
                className="gap-1.5 h-7 text-xs"
              >
                <Upload className="size-3" />
                Import to form
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Scalar field ---

type ScalarFieldProps = {
  scalar: ScalarInputInfo
  nodeId: string | undefined
  value: string
  onChange: (value: string) => void
  onClear: () => void
  result?: unknown
}

function ScalarField({
  scalar,
  value,
  onChange,
  onClear,
  result,
}: ScalarFieldProps) {
  const defaultStr =
    scalar.default !== undefined && scalar.default !== null
      ? String(scalar.default)
      : undefined

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium truncate" title={scalar.path}>
          {scalar.label ?? scalar.path}
          {scalar.unit && (
            <span className="ml-1 text-muted-foreground">({scalar.unit})</span>
          )}
        </label>
        {value !== '' && (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={onClear}
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
      <Input
        className="h-7 text-xs font-mono"
        placeholder={defaultStr ?? 'value'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {result !== undefined && (
        <p className="text-xs font-mono text-emerald-700 truncate">
          = {formatValue(result)}
        </p>
      )}
    </div>
  )
}

// --- Entity table editor ---

type EntityTableEditorProps = {
  entityName: string
  varPaths: string[]
  rows: Record<string, string>[]
  onChange: (rows: Record<string, string>[]) => void
}

function EntityTableEditor({
  entityName,
  varPaths,
  rows,
  onChange,
}: EntityTableEditorProps) {
  const [expanded, setExpanded] = useState(false)

  const addRow = () => {
    onChange([...rows, { id: String(rows.length + 1) }])
  }

  const updateField = (rowIdx: number, field: string, value: string) => {
    const updated = rows.map((row, i) =>
      i === rowIdx ? { ...row, [field]: value } : row
    )
    onChange(updated)
  }

  const removeRow = (rowIdx: number) => {
    onChange(rows.filter((_, i) => i !== rowIdx))
  }

  return (
    <div className="border rounded-md">
      <button
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          {entityName}
          <span className="ml-1.5 text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'} · {varPaths.length} fields
          </span>
        </span>
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </button>
      {expanded && (
        <div className="border-t px-3 py-2 space-y-3">
          {rows.map((row, rowIdx) => (
            <div key={rowIdx} className="space-y-1.5 border-b pb-3 last:border-b-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Row {rowIdx + 1}
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => removeRow(rowIdx)}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              <div className="space-y-1">
                <div className="flex gap-1.5 items-center">
                  <span className="text-xs text-muted-foreground w-20 shrink-0 truncate">
                    id
                  </span>
                  <Input
                    className="h-6 text-xs font-mono flex-1"
                    placeholder="1"
                    value={row.id ?? ''}
                    onChange={(e) =>
                      updateField(rowIdx, 'id', e.target.value)
                    }
                  />
                </div>
                {varPaths.slice(0, 10).map((path) => {
                  const shortName = path.split('/').pop() ?? path
                  return (
                    <div key={path} className="flex gap-1.5 items-center">
                      <span
                        className="text-xs text-muted-foreground w-20 shrink-0 truncate"
                        title={path}
                      >
                        {shortName}
                      </span>
                      <Input
                        className="h-6 text-xs font-mono flex-1"
                        placeholder="value"
                        value={row[path] ?? ''}
                        onChange={(e) =>
                          updateField(rowIdx, path, e.target.value)
                        }
                      />
                    </div>
                  )
                })}
                {varPaths.length > 10 && (
                  <p className="text-xs text-muted-foreground">
                    +{varPaths.length - 10} more fields (use JSON import)
                  </p>
                )}
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
            className="h-7 text-xs gap-1.5 w-full"
          >
            <Plus className="size-3" />
            Add {entityName}
          </Button>
        </div>
      )}
    </div>
  )
}

// --- Helpers ---

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${value.length} items]`
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
