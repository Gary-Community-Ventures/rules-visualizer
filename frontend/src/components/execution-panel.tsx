import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useMainContext } from '@/context'
import { getNodePath, isInputNode, isConstantNode } from '@/context/model-context'
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
} from 'lucide-react'
import type { ModelNode } from '@/lib/model'

export function ExecutionPanel() {
  const {
    model,
    inputOverrides,
    setInputOverride,
    clearInputOverride,
    executionResults,
    isExecuting,
    executionError,
    runExecution,
    runOnBlur,
    clearExecution,
  } = useMainContext()

  const [showConstants, setShowConstants] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Separate nodes by role
  const inputNodes: ModelNode[] = []
  const constantNodes: ModelNode[] = []
  for (const node of Object.values(model.nodes)) {
    if (isInputNode(node)) inputNodes.push(node)
    else if (isConstantNode(node)) constantNodes.push(node)
  }
  inputNodes.sort((a, b) => a.name.localeCompare(b.name))
  constantNodes.sort((a, b) => a.name.localeCompare(b.name))

  const inputCount = Object.entries(inputOverrides).filter(
    ([id, v]) => v !== '' && inputNodes.some((n) => n.id === id)
  ).length
  const constantOverrideCount = Object.entries(inputOverrides).filter(
    ([id, v]) => v !== '' && constantNodes.some((n) => n.id === id)
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
      const entries =
        parsed.inputs || parsed.entities
          ? Object.entries((parsed.inputs ?? {}) as Record<string, unknown>)
          : Object.entries(parsed as Record<string, unknown>)
      for (const [key, value] of entries) {
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
        {/* Inputs — required, user must provide */}
        {inputNodes.length > 0 && (
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Inputs ({inputNodes.length})
              </h3>
              {inputCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {inputCount} / {inputNodes.length} set
                </span>
              )}
            </div>
            <div className="space-y-3">
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
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Constants — optional overrides for simulation */}
        {constantNodes.length > 0 && (
          <div className="p-4 border-b">
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-full"
              onClick={() => setShowConstants(!showConstants)}
            >
              {showConstants ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Constants ({constantNodes.length})
              {constantOverrideCount > 0 && (
                <span className="ml-auto font-normal">
                  {constantOverrideCount} overridden
                </span>
              )}
            </button>
            {showConstants && (
              <div className="mt-3 space-y-3">
                {constantNodes.map((node) => {
                  const content = node.content
                  const defaultVal =
                    content.type !== 'entity' && content.format === 'rac'
                      ? content.default
                      : content.type === 'derived' &&
                          content.format === 'factGraph'
                        ? content.logic
                        : undefined
                  return (
                    <NodeField
                      key={node.id}
                      node={node}
                      value={inputOverrides[node.id] ?? ''}
                      onChange={(val) => setInputOverride(node.id, val)}
                      onClear={() => clearInputOverride(node.id)}
                      onBlur={runOnBlur}
                      result={executionResults?.[node.id]?.value}
                      defaultValue={defaultVal}
                    />
                  )
                })}
              </div>
            )}
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
                placeholder={'{\n  "variable_path": value,\n  ...\n}'}
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
}: NodeFieldProps) {
  const content = node.content
  const unit =
    content.format === 'rac' && content.type === 'variable'
      ? content.unit
      : undefined

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium truncate" title={node.name}>
          {node.name}
          {unit && (
            <span className="ml-1 text-muted-foreground">({unit})</span>
          )}
          {required && !value && (
            <span className="ml-1 text-red-400">*</span>
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
        className={cn(
          'h-7 text-xs font-mono',
          value !== '' && 'border-amber-400 ring-1 ring-amber-400'
        )}
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
  return undefined
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${value.length} items]`
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
