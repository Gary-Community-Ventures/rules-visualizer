import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  GripVertical,
  Loader2,
  Play,
  Settings,
  Shuffle,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TypedValueInput } from '@/components/typed-value-input'
import {
  getRuleset,
  executeRuleset,
  type ExecutionResults,
} from '@/lib/api/rules-api'
import {
  configureSimulation,
  type FieldConfig,
  type SimulationConfig,
} from '@/lib/api/simulation-api'
import type { Model, ModelNode } from '@/lib/model'
import { cn } from '@/lib/utils'

type NodeCondition = {
  op: 'always' | 'truthy' | 'equals' | 'gt' | 'lt'
  value: string
}

type InterfaceSettings = {
  selectedPaths: string[]
  conditions: Record<string, NodeCondition>
  config: SimulationConfig
}

export function FactGraphInterfacePage() {
  const { rulesetId } = useParams({ from: '/interface/$rulesetId' })
  const [model, setModel] = useState<Model | null>(null)
  const [config, setConfig] = useState<SimulationConfig | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [entities, setEntities] = useState<
    Record<string, Record<string, string>[]>
  >({})
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [conditions, setConditions] = useState<Record<string, NodeCondition>>(
    {}
  )
  const [results, setResults] = useState<ExecutionResults | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputVersion, setInputVersion] = useState(0)
  const runIdRef = useRef(0)

  useEffect(() => {
    document.title = `Interface ${rulesetId} - Rules Visualizer`
    Promise.all([getRuleset(rulesetId), configureSimulation(rulesetId)])
      .then(([nextModel, nextConfig]) => {
        const settings = loadInterfaceSettings(rulesetId, nextConfig)
        setModel(nextModel)
        setConfig(settings.config)
        setSelectedPaths(settings.selectedPaths)
        setConditions(settings.conditions)
      })
      .catch((e) => setError((e as Error).message))
  }, [rulesetId])

  useEffect(() => {
    const refresh = () => {
      configureSimulation(rulesetId)
        .then((nextConfig) => {
          const settings = loadInterfaceSettings(rulesetId, nextConfig)
          setConfig(settings.config)
          setSelectedPaths(settings.selectedPaths)
          setConditions(settings.conditions)
        })
        .catch(() => {})
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [rulesetId])

  const pathToNode = useMemo(() => {
    const map = new Map<string, ModelNode>()
    if (!model) return map
    for (const node of Object.values(model.nodes)) {
      if (node.content.type !== 'entity') map.set(node.content.path, node)
    }
    return map
  }, [model])

  const writableByPath = useMemo(() => {
    const map = new Map<string, ModelNode>()
    if (!model) return map
    for (const node of Object.values(model.nodes)) {
      if (
        node.content.format === 'factGraph' &&
        node.content.type === 'writable'
      ) {
        map.set(node.content.path, node)
      }
    }
    return map
  }, [model])

  const markInputsChanged = () => setInputVersion((v) => v + 1)

  const generateRandomInputs = () => {
    if (!config) return
    const rng = mulberry32(Date.now())
    const nextInputs: Record<string, string> = {}
    for (const field of config.scalarFields) {
      const value = generateValue(field, rng)
      if (value !== null) nextInputs[field.path] = String(value)
    }

    const nextEntities: Record<string, Record<string, string>[]> = {}
    for (const collection of config.collections) {
      const min = Math.max(0, collection.minMembers)
      const max = Math.max(min, collection.maxMembers)
      const count = min + Math.floor(rng() * (max - min + 1))
      nextEntities[collection.collectionPath] = Array.from(
        { length: count },
        () => {
          const row: Record<string, string> = {}
          for (const field of collection.fields) {
            const value = generateValue(field, rng)
            if (value !== null) row[field.path] = String(value)
          }
          return row
        }
      )
    }

    setInputs(nextInputs)
    setEntities(nextEntities)
    setResults(null)
    setError(null)
    markInputsChanged()
  }

  const run = useCallback(async () => {
    const runId = ++runIdRef.current
    setIsExecuting(true)
    setError(null)
    try {
      const nextResults = await executeRuleset(
        rulesetId,
        parseRecord(inputs),
        parseEntities(entities)
      )
      if (runId === runIdRef.current) setResults(nextResults)
    } catch (e) {
      if (runId === runIdRef.current) setError((e as Error).message)
    } finally {
      if (runId === runIdRef.current) setIsExecuting(false)
    }
  }, [rulesetId, inputs, entities])

  useEffect(() => {
    if (inputVersion === 0) return
    const timer = window.setTimeout(() => {
      void run()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [inputVersion, run])

  if (!model || !config) {
    return (
      <div className="flex-1 p-8 text-sm text-muted-foreground">
        {error ?? 'Loading interface...'}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Rulesets
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {model.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              Custom fact graph interface
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/interface/$rulesetId/settings" params={{ rulesetId }}>
                <Settings className="mr-2 size-4" /> Settings
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <div className="space-y-4">
            <InputEditor
              config={config}
              inputs={inputs}
              setInputs={setInputs}
              entities={entities}
              setEntities={setEntities}
              writableByPath={writableByPath}
              onGenerateRandom={generateRandomInputs}
              onRun={run}
              isExecuting={isExecuting}
              onInputsChanged={markInputsChanged}
            />
          </div>

          <section className="rounded-xl border bg-background p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Readable Results</h2>
                <p className="text-xs text-muted-foreground">
                  Configure visible nodes and display conditions in Settings.
                </p>
              </div>
              {results && (
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                  {Object.keys(results).length} computed
                </span>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border">
              {selectedPaths.map((path) => {
                const node = pathToNode.get(path)
                const value = node ? results?.[node.id]?.value : undefined
                const condition = conditions[path] ?? {
                  op: 'always',
                  value: '',
                }
                if (!passesCondition(value, condition)) return null
                return (
                  <div
                    key={path}
                    className="grid gap-2 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {node?.content.type !== 'entity' && node?.content.label
                          ? node.content.label
                          : readablePath(path)}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {path}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-semibold sm:text-right">
                      {formatValue(value)}
                    </div>
                  </div>
                )
              })}
              {selectedPaths.length === 0 && (
                <div className="p-6 text-sm text-muted-foreground">
                  No visible nodes selected. Open Settings to choose the facts
                  this interface should display.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export function FactGraphInterfaceSettingsPage() {
  const { rulesetId } = useParams({ from: '/interface/$rulesetId/settings' })
  const [model, setModel] = useState<Model | null>(null)
  const [config, setConfig] = useState<SimulationConfig | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [conditions, setConditions] = useState<Record<string, NodeCondition>>(
    {}
  )
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = `Interface Settings ${rulesetId} - Rules Visualizer`
    Promise.all([getRuleset(rulesetId), configureSimulation(rulesetId)])
      .then(([nextModel, nextConfig]) => {
        const settings = loadInterfaceSettings(rulesetId, nextConfig)
        setModel(nextModel)
        setConfig(settings.config)
        setSelectedPaths(settings.selectedPaths)
        setConditions(settings.conditions)
      })
      .catch((e) => setError((e as Error).message))
  }, [rulesetId])

  useEffect(() => {
    if (!config) return
    saveInterfaceSettings(rulesetId, { selectedPaths, conditions, config })
  }, [rulesetId, selectedPaths, conditions, config])

  const allPaths = useMemo(() => {
    if (!model) return []
    return Object.values(model.nodes)
      .flatMap((node) =>
        node.content.type === 'entity' ? [] : [node.content.path]
      )
      .sort()
  }, [model])

  const pathToNode = useMemo(() => {
    const map = new Map<string, ModelNode>()
    if (!model) return map
    for (const node of Object.values(model.nodes)) {
      if (node.content.type !== 'entity') map.set(node.content.path, node)
    }
    return map
  }, [model])

  if (!model || !config) {
    return (
      <div className="flex-1 p-8 text-sm text-muted-foreground">
        {error ?? 'Loading settings...'}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              to="/interface/$rulesetId"
              params={{ rulesetId }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Back to interface
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Interface Settings
            </h1>
            <p className="text-sm text-muted-foreground">{model.name}</p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/interface/$rulesetId" params={{ rulesetId }}>
              Done
            </Link>
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
            {error}
          </div>
        )}

        <VisibleNodesSettings
          allPaths={allPaths}
          selectedPaths={selectedPaths}
          setSelectedPaths={setSelectedPaths}
          conditions={conditions}
          setConditions={setConditions}
          pathToNode={pathToNode}
          search={search}
          setSearch={setSearch}
        />

        <GeneratorSettings config={config} setConfig={setConfig} />
      </div>
    </div>
  )
}

function VisibleNodesSettings({
  allPaths,
  selectedPaths,
  setSelectedPaths,
  conditions,
  setConditions,
  pathToNode,
  search,
  setSearch,
}: {
  allPaths: string[]
  selectedPaths: string[]
  setSelectedPaths: (paths: string[]) => void
  conditions: Record<string, NodeCondition>
  setConditions: (conditions: Record<string, NodeCondition>) => void
  pathToNode: Map<string, ModelNode>
  search: string
  setSearch: (search: string) => void
}) {
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const draggingPathRef = useRef<string | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const selectedPathsRef = useRef(selectedPaths)
  selectedPathsRef.current = selectedPaths

  const setSelectedPathsAnimated = useCallback(
    (paths: string[]) => {
      flushSync(() => setSelectedPaths(paths))
    },
    [setSelectedPaths]
  )

  const reorderFromPointer = useCallback(
    (clientY: number) => {
      const activePath = draggingPathRef.current
      if (!activePath) return

      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-visible-node-row]')
      )
      const current = selectedPathsRef.current
      const activeIndex = current.indexOf(activePath)
      if (activeIndex < 0) return

      let insertIndex = current.length - 1
      for (const row of rows) {
        const path = row.dataset.path
        if (!path || path === activePath) continue
        const rect = row.getBoundingClientRect()
        if (clientY < rect.top + rect.height / 2) {
          insertIndex = current.indexOf(path)
          break
        }
        insertIndex = current.indexOf(path) + 1
      }

      const next = current.filter((path) => path !== activePath)
      if (activeIndex < insertIndex) insertIndex -= 1
      insertIndex = Math.max(0, Math.min(next.length, insertIndex))
      next.splice(insertIndex, 0, activePath)
      if (next.join('\n') === current.join('\n')) return
      setSelectedPathsAnimated(next)
    },
    [setSelectedPathsAnimated]
  )

  const stopDragging = useCallback(() => {
    draggingPathRef.current = null
    dragPointerIdRef.current = null
    setDraggingPath(null)
  }, [])

  useEffect(() => {
    if (!draggingPath) return

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerIdRef.current) return
      event.preventDefault()
      reorderFromPointer(event.clientY)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerIdRef.current) return
      stopDragging()
    }

    window.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      document.body.style.userSelect = ''
    }
  }, [draggingPath, reorderFromPointer, stopDragging])

  const filteredPaths = search
    ? allPaths.filter(
        (path) =>
          !selectedPaths.includes(path) &&
          path.toLowerCase().includes(search.toLowerCase())
      )
    : []

  return (
    <section className="rounded-xl border bg-background p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Visible Nodes</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Pick the facts the interface should show and define when each result is
        visible.
      </p>
      <Input
        className="mt-3 h-8 text-xs font-mono"
        placeholder="Search paths to add..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filteredPaths.length > 0 && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border bg-background">
          {filteredPaths.slice(0, 40).map((path) => (
            <button
              key={path}
              className="block w-full px-2 py-1.5 text-left font-mono text-xs hover:bg-muted"
              onClick={() => {
                setSelectedPaths([...selectedPaths, path])
                setSearch('')
              }}
            >
              {path}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 space-y-2">
        {selectedPaths.map((path) => {
          const node = pathToNode.get(path)
          const condition = conditions[path] ?? { op: 'always', value: '' }
          return (
            <div
              key={path}
              data-visible-node-row
              data-path={path}
              className={cn(
                'grid gap-2 rounded-lg border p-3 transition-all duration-200 ease-out sm:grid-cols-[auto_1fr_auto_auto] sm:items-center',
                draggingPath === path
                  ? 'scale-[0.99] border-blue-300 bg-blue-50/60 opacity-70 shadow-sm'
                  : 'hover:border-foreground/20 hover:shadow-sm'
              )}
            >
              <button
                className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                onPointerDown={(e) => {
                  e.preventDefault()
                  draggingPathRef.current = path
                  dragPointerIdRef.current = e.pointerId
                  setDraggingPath(path)
                }}
                title="Drag to reorder"
              >
                <GripVertical className="size-4" />
              </button>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {node?.content.type !== 'entity' && node?.content.label
                    ? node.content.label
                    : readablePath(path)}
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {path}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Show when</span>
                <select
                  className="h-7 rounded border bg-background px-2 text-xs"
                  value={condition.op}
                  onChange={(e) =>
                    setConditions({
                      ...conditions,
                      [path]: {
                        ...condition,
                        op: e.target.value as NodeCondition['op'],
                      },
                    })
                  }
                >
                  <option value="always">always</option>
                  <option value="truthy">true / present</option>
                  <option value="equals">equals</option>
                  <option value="gt">greater than</option>
                  <option value="lt">less than</option>
                </select>
                {condition.op !== 'always' && condition.op !== 'truthy' && (
                  <Input
                    className="h-7 w-24 text-xs"
                    value={condition.value}
                    onChange={(e) =>
                      setConditions({
                        ...conditions,
                        [path]: { ...condition, value: e.target.value },
                      })
                    }
                  />
                )}
              </div>
              <button
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:justify-self-end"
                onClick={() => {
                  setSelectedPaths(selectedPaths.filter((p) => p !== path))
                  const nextConditions = { ...conditions }
                  delete nextConditions[path]
                  setConditions(nextConditions)
                }}
              >
                <X className="size-3" /> Remove
              </button>
            </div>
          )
        })}
        {selectedPaths.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Search for a node above to add it to the interface.
          </div>
        )}
      </div>
    </section>
  )
}

function GeneratorSettings({
  config,
  setConfig,
}: {
  config: SimulationConfig
  setConfig: (config: SimulationConfig) => void
}) {
  return (
    <section className="rounded-xl border bg-background p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Simulation Settings</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Controls the values generated by the random input button.
      </p>

      <div className="mt-4 space-y-3">
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Scalar fields ({config.scalarFields.length})
          </summary>
          <div className="mt-2 space-y-1.5 pl-4">
            {config.scalarFields.map((field, index) => (
              <GeneratorFieldRow
                key={field.path}
                field={field}
                onChange={(next) => {
                  const fields = [...config.scalarFields]
                  fields[index] = next
                  setConfig({ ...config, scalarFields: fields })
                }}
              />
            ))}
          </div>
        </details>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Collections ({config.collections.length})
          </summary>
          <div className="mt-2 space-y-3 pl-4">
            {config.collections.map((collection, collectionIndex) => (
              <div key={collection.collectionPath} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">
                    {collection.collectionPath}
                  </span>
                  <NumberInput
                    className="h-6 w-12 text-[11px] font-mono"
                    value={collection.minMembers}
                    onChange={(value) => {
                      const collections = [...config.collections]
                      collections[collectionIndex] = {
                        ...collection,
                        minMembers: value,
                      }
                      setConfig({ ...config, collections })
                    }}
                  />
                  <span className="text-muted-foreground">-</span>
                  <NumberInput
                    className="h-6 w-12 text-[11px] font-mono"
                    value={collection.maxMembers}
                    onChange={(value) => {
                      const collections = [...config.collections]
                      collections[collectionIndex] = {
                        ...collection,
                        maxMembers: value,
                      }
                      setConfig({ ...config, collections })
                    }}
                  />
                  <span className="text-muted-foreground">members</span>
                </div>
                {collection.fields.map((field, fieldIndex) => (
                  <GeneratorFieldRow
                    key={field.path}
                    field={field}
                    className="pl-4"
                    onChange={(next) => {
                      const collections = [...config.collections]
                      const fields = [...collection.fields]
                      fields[fieldIndex] = next
                      collections[collectionIndex] = { ...collection, fields }
                      setConfig({ ...config, collections })
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  )
}

function GeneratorFieldRow({
  field,
  onChange,
  className,
}: {
  field: FieldConfig
  onChange: (field: FieldConfig) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 font-mono', className)}>
      <span className="w-48 shrink-0 truncate" title={field.path}>
        {field.path}
      </span>
      <span className="shrink-0 text-muted-foreground">({field.type})</span>
      {(field.type === 'Dollar' ||
        field.type === 'Int' ||
        field.type === 'Short' ||
        field.type === 'Byte') && (
        <>
          <NumberInput
            className="h-6 w-20 text-[11px] font-mono"
            value={field.min ?? 0}
            onChange={(value) => onChange({ ...field, min: value })}
          />
          <span className="text-muted-foreground">-</span>
          <NumberInput
            className="h-6 w-20 text-[11px] font-mono"
            value={field.max ?? 0}
            onChange={(value) => onChange({ ...field, max: value })}
          />
        </>
      )}
      {field.type === 'Boolean' && (
        <BooleanProbabilitySlider
          value={field.trueProbability}
          onChange={(value) => onChange({ ...field, trueProbability: value })}
        />
      )}
      {field.type === 'Day' && (
        <>
          <Input
            className="h-6 w-32 text-[11px] font-mono"
            type="date"
            value={field.minDate ?? currentYearStart()}
            onChange={(e) => onChange({ ...field, minDate: e.target.value })}
          />
          <span className="text-muted-foreground">-</span>
          <Input
            className="h-6 w-32 text-[11px] font-mono"
            type="date"
            value={field.maxDate ?? currentYearEnd()}
            onChange={(e) => onChange({ ...field, maxDate: e.target.value })}
          />
        </>
      )}
      {(field.type === 'Enum' || field.type === 'MultiEnum') && (
        <EnumProbabilityEditor field={field} onChange={onChange} />
      )}
    </div>
  )
}

function EnumProbabilityEditor({
  field,
  onChange,
}: {
  field: FieldConfig
  onChange: (field: FieldConfig) => void
}) {
  if (!field.enumOptions?.length) {
    return <span className="text-muted-foreground">no static options</span>
  }
  const probabilities = field.enumProbabilities ?? {}
  return (
    <details className="min-w-64">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        option percentages
      </summary>
      <div className="mt-1 space-y-1 rounded border bg-background p-2">
        {field.enumOptions.map((option) => {
          const pct = Math.round(
            (probabilities[option] ?? defaultEnumProbability(field)) * 100
          )
          return (
            <label key={option} className="flex items-center gap-2">
              <span className="w-32 truncate" title={option}>
                {option}
              </span>
              <Input
                className="h-6 w-14 text-[11px] font-mono"
                type="number"
                min={0}
                max={100}
                value={pct}
                onChange={(e) => {
                  const next =
                    Math.max(0, Math.min(100, Number(e.target.value) || 0)) /
                    100
                  onChange({
                    ...field,
                    enumProbabilities: {
                      ...probabilities,
                      [option]: next,
                    },
                  })
                }}
              />
              <span className="text-muted-foreground">%</span>
            </label>
          )
        })}
      </div>
    </details>
  )
}

function defaultEnumProbability(field: FieldConfig) {
  if (field.type === 'MultiEnum') return 0.35
  return field.enumOptions?.length ? 1 / field.enumOptions.length : 0
}

function BooleanProbabilitySlider({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
}) {
  const pct = Math.round(((value ?? 0.5) * 100 + Number.EPSILON) * 10) / 10
  const setPct = (next: number) => {
    const clamped = Math.max(0, Math.min(100, next))
    if (Math.abs(clamped - 50) < 0.05) onChange(undefined)
    else onChange(clamped / 100)
  }
  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        className="w-24 accent-foreground"
        title="% true"
      />
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        className="h-6 w-12 rounded border bg-background px-1 text-[11px] font-mono"
      />
      <span className="text-[10px] text-muted-foreground">% true</span>
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  className,
}: {
  value: number
  onChange: (value: number) => void
  className?: string
}) {
  return (
    <Input
      className={className}
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  )
}

function currentYearStart() {
  return `${new Date().getFullYear()}-01-01`
}

function currentYearEnd() {
  return `${new Date().getFullYear()}-12-31`
}

function InputEditor({
  config,
  inputs,
  setInputs,
  entities,
  setEntities,
  writableByPath,
  onGenerateRandom,
  onRun,
  isExecuting,
  onInputsChanged,
}: {
  config: SimulationConfig
  inputs: Record<string, string>
  setInputs: (inputs: Record<string, string>) => void
  entities: Record<string, Record<string, string>[]>
  setEntities: (entities: Record<string, Record<string, string>[]>) => void
  writableByPath: Map<string, ModelNode>
  onGenerateRandom: () => void
  onRun: () => void
  isExecuting: boolean
  onInputsChanged: () => void
}) {
  return (
    <section className="rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Inputs</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Edits run automatically after a short pause.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onGenerateRandom}>
            <Shuffle className="mr-2 size-4" /> Generate
          </Button>
          <Button size="sm" onClick={onRun} disabled={isExecuting}>
            {isExecuting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Play className="mr-2 size-4" />
            )}
            Run
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {config.scalarFields.map((field) => (
          <FieldValueRow
            key={field.path}
            field={field}
            value={inputs[field.path] ?? ''}
            onChange={(value) => {
              setInputs({ ...inputs, [field.path]: value })
              onInputsChanged()
            }}
            node={writableByPath.get(field.path)}
          />
        ))}
      </div>

      {config.collections.map((collection) => {
        const rows = entities[collection.collectionPath] ?? []
        return (
          <details
            key={collection.collectionPath}
            className="mt-4 rounded-lg border p-3 text-xs"
            open
          >
            <summary className="cursor-pointer font-medium">
              {collection.collectionPath} ({rows.length} rows)
            </summary>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => {
                  setEntities({
                    ...entities,
                    [collection.collectionPath]: [...rows, {}],
                  })
                  onInputsChanged()
                }}
              >
                Add row
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              {rows.map((row, rowIndex) => (
                <div key={rowIndex} className="rounded-md bg-muted/40 p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">Row {rowIndex + 1}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEntities({
                          ...entities,
                          [collection.collectionPath]: rows.filter(
                            (_, i) => i !== rowIndex
                          ),
                        })
                        onInputsChanged()
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="space-y-2">
                    {collection.fields.map((field) => (
                      <FieldValueRow
                        key={field.path}
                        field={field}
                        value={row[field.path] ?? ''}
                        onChange={(value) => {
                          const nextRows = rows.map((r, i) =>
                            i === rowIndex ? { ...r, [field.path]: value } : r
                          )
                          setEntities({
                            ...entities,
                            [collection.collectionPath]: nextRows,
                          })
                          onInputsChanged()
                        }}
                        node={writableByPath.get(field.path)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )
      })}
    </section>
  )
}

function FieldValueRow({
  field,
  value,
  onChange,
  node,
  compact,
}: {
  field: FieldConfig
  value: string
  onChange: (value: string) => void
  node?: ModelNode
  compact?: boolean
}) {
  const content = node?.content.type !== 'entity' ? node?.content : undefined
  const typeName =
    content?.format === 'factGraph' && content.type === 'writable'
      ? content.typeName
      : field.type
  const enumOptions =
    content?.format === 'factGraph' && content.type === 'writable'
      ? content.enumOptions
      : field.enumOptions
  return (
    <div
      className={cn(
        'grid gap-1',
        compact ? 'grid-cols-1' : 'sm:grid-cols-[1fr_150px] sm:items-center'
      )}
    >
      <label className="min-w-0">
        <span className="block truncate text-xs font-medium">
          {content?.label ?? readablePath(field.path)}
        </span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">
          {field.path}
        </span>
      </label>
      <TypedValueInput
        className="h-8 text-xs"
        typeName={typeName}
        enumOptions={enumOptions}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}

function settingsKey(rulesetId: string) {
  return `factGraphInterface:${rulesetId}`
}

function defaultInterfaceSettings(config: SimulationConfig): InterfaceSettings {
  return {
    selectedPaths: config.outcomeNodes.slice(0, 8),
    conditions: {},
    config: { ...config, caseCount: 1 },
  }
}

function loadInterfaceSettings(
  rulesetId: string,
  defaultConfig: SimulationConfig
): InterfaceSettings {
  const defaults = defaultInterfaceSettings(defaultConfig)
  try {
    const stored = localStorage.getItem(settingsKey(rulesetId))
    if (!stored) return defaults
    const parsed = JSON.parse(stored) as Partial<InterfaceSettings>
    return {
      selectedPaths: Array.isArray(parsed.selectedPaths)
        ? parsed.selectedPaths
        : defaults.selectedPaths,
      conditions:
        parsed.conditions && typeof parsed.conditions === 'object'
          ? parsed.conditions
          : defaults.conditions,
      config: parsed.config
        ? { ...defaults.config, ...parsed.config }
        : defaults.config,
    }
  } catch {
    return defaults
  }
}

function saveInterfaceSettings(rulesetId: string, settings: InterfaceSettings) {
  localStorage.setItem(settingsKey(rulesetId), JSON.stringify(settings))
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generateValue(field: FieldConfig, rng: () => number): unknown {
  switch (field.type) {
    case 'Boolean':
      return rng() < (field.trueProbability ?? 0.5)
    case 'Dollar':
      return (
        Math.round(
          ((field.min ?? 0) +
            rng() * ((field.max ?? 10000) - (field.min ?? 0))) *
            100
        ) / 100
      )
    case 'Int':
    case 'Short':
    case 'Byte':
      return Math.floor(
        (field.min ?? 0) + rng() * ((field.max ?? 100) - (field.min ?? 0) + 1)
      )
    case 'Enum':
      return pickEnumOption(field, rng)
    case 'MultiEnum': {
      if (!field.enumOptions?.length) return []
      return field.enumOptions.filter(
        (option) => rng() < (field.enumProbabilities?.[option] ?? 0.35)
      )
    }
    case 'Day':
      return generateDate(field, rng)
    case 'Rational':
      return `${Math.floor(1 + rng() * 5)}/${Math.floor(2 + rng() * 10)}`
    case 'String':
      return generateString(field, rng)
    case 'CollectionItem':
      return null
    default:
      return generateString(field, rng)
  }
}

function pickEnumOption(field: FieldConfig, rng: () => number): string | null {
  if (!field.enumOptions?.length) return null
  const weights = field.enumOptions.map((option) =>
    Math.max(0, field.enumProbabilities?.[option] ?? 1)
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return field.enumOptions[0]
  let cursor = rng() * total
  for (let i = 0; i < field.enumOptions.length; i++) {
    cursor -= weights[i]
    if (cursor <= 0) return field.enumOptions[i]
  }
  return field.enumOptions[field.enumOptions.length - 1]
}

function generateDate(field: FieldConfig, rng: () => number): string {
  const year = new Date().getFullYear()
  const min = Date.parse(field.minDate ?? `${year}-01-01`)
  const max = Date.parse(field.maxDate ?? `${year}-12-31`)
  const start = Number.isNaN(min) ? Date.parse(`${year}-01-01`) : min
  const end = Number.isNaN(max) ? Date.parse(`${year}-12-31`) : max
  const value = start + rng() * Math.max(0, end - start)
  return new Date(value).toISOString().slice(0, 10)
}

function generateString(field: FieldConfig, rng: () => number): string {
  if (field.stringOptions?.length) {
    return field.stringOptions[Math.floor(rng() * field.stringOptions.length)]
  }
  return `value-${Math.floor(rng() * 1000)}`
}

function parseRecord(record: Record<string, string>): Record<string, unknown> {
  const parsed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === '') continue
    parsed[key] = parseValue(value)
  }
  return parsed
}

function parseEntities(
  entities: Record<string, Record<string, string>[]>
): Record<string, Record<string, unknown>[]> {
  const parsed: Record<string, Record<string, unknown>[]> = {}
  for (const [collection, rows] of Object.entries(entities)) {
    if (rows.length === 0) continue
    parsed[collection] = rows.map(parseRecord)
  }
  return parsed
}

function parseValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

function passesCondition(value: unknown, condition: NodeCondition): boolean {
  if (condition.op === 'always') return true
  if (condition.op === 'truthy') return Boolean(value)
  if (condition.op === 'equals') return String(value) === condition.value
  const n = typeof value === 'number' ? value : Number(value)
  const target = Number(condition.value)
  if (Number.isNaN(n) || Number.isNaN(target)) return false
  if (condition.op === 'gt') return n > target
  return n < target
}

function readablePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .filter((part) => part !== '*')
    .map((part) =>
      part.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
    )
    .join(' ')
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'Not run'
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString()
  if (Array.isArray(value)) return value.map(formatValue).join(', ')
  return String(value)
}
