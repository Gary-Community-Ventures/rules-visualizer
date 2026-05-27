import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  ExternalLink,
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
import { setPendingScenario } from '@/lib/simulation-bridge'
import { cn } from '@/lib/utils'

type NodeCondition = {
  op: 'always' | 'equals' | 'gt' | 'lt'
  value: string
  effect?: ConditionEffect
  color?: ConditionColor
  dependsOn?: string
  attached?: AttachedVisibilityCondition[]
}

type ConditionEffect = 'visibility' | 'color' | 'both'
type ConditionColor = 'red' | 'yellow' | 'blue' | 'green'

type AttachedVisibilityCondition = {
  id: string
  type: 'node-visible' | 'node-value'
  path: string
  op?: Exclude<NodeCondition['op'], 'always'>
  value?: string
  effect?: ConditionEffect
  color?: ConditionColor
}

type InterfaceSettings = {
  selectedPaths: string[]
  conditions: Record<string, NodeCondition>
  config: SimulationConfig
}

type SimulationConfigWithInterfaceDefaults = SimulationConfig & {
  interfaceDefaults?: {
    selectedPaths?: string[]
    conditions?: Record<string, NodeCondition>
  }
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
        () => ({})
      )
    }

    for (const collection of config.collections) {
      const rows = nextEntities[collection.collectionPath] ?? []
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        for (const field of collection.fields) {
          const value = generateValue(
            field,
            rng,
            nextEntities,
            collection.collectionPath,
            index
          )
          if (value !== null) row[field.path] = String(value)
        }
      }
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

  const openInVisualizer = () => {
    setPendingScenario({
      rulesetId,
      inputs: parseRecord(inputs),
      entities: parseEntities(entities),
      label: 'Fact graph interface run',
    })
    window.open(`/ruleset/${rulesetId}?sim=1`, '_blank')
  }

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
            <Button variant="outline" onClick={openInVisualizer}>
              <ExternalLink className="mr-2 size-4" /> Open in visualizer
            </Button>
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
                const presentation = getResultPresentation(
                  path,
                  selectedPaths,
                  conditions,
                  pathToNode,
                  results
                )
                if (!presentation.visible) return null
                return (
                  <div
                    key={path}
                    className={cn(
                      'grid gap-2 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(220px,45%)] sm:items-center',
                      conditionColorClass(presentation.color)
                    )}
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
                    <div className="min-w-0 font-mono text-sm font-semibold sm:text-right">
                      <ResultValue value={value} />
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

  const resetToDefaults = async () => {
    try {
      const nextConfig = await configureSimulation(rulesetId)
      const settings = defaultInterfaceSettings(nextConfig)
      setConfig(settings.config)
      setSearch('')
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

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

  const updateConditions = useCallback(
    (nextConditions: Record<string, NodeCondition>) => {
      setConditions(nextConditions)
      if (config) {
        saveInterfaceSettings(rulesetId, {
          selectedPaths,
          conditions: nextConditions,
          config,
        })
      }
    },
    [config, rulesetId, selectedPaths]
  )

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
          setConditions={updateConditions}
          pathToNode={pathToNode}
          search={search}
          setSearch={setSearch}
        />

        <GeneratorSettings
          config={config}
          setConfig={setConfig}
          onResetDefaults={resetToDefaults}
        />
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
  const [attachingPath, setAttachingPath] = useState<string | null>(null)
  const [insertAfterPath, setInsertAfterPath] = useState<string | null>(null)
  const [inlineSearch, setInlineSearch] = useState('')
  const [draftCondition, setDraftCondition] = useState<{
    path: string
    type: 'node-value' | 'other-node'
    op: Exclude<NodeCondition['op'], 'always'> | 'visible'
    value: string
    effect: ConditionEffect
    color?: ConditionColor
  } | null>(null)
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

  const addSelectedPath = (path: string, afterPath = insertAfterPath) => {
    const insertAfterIndex = afterPath
      ? selectedPaths.indexOf(afterPath)
      : -1
    const nextPaths = [...selectedPaths]
    nextPaths.splice(insertAfterIndex + 1, 0, path)
    setSelectedPaths(nextPaths)
    setInsertAfterPath(null)
    setInlineSearch('')
    setSearch('')
  }

  return (
    <section className="rounded-xl border bg-background p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Visible Nodes</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Pick the facts the interface should show and define when each result is
        visible.
      </p>
      <Input
        className="mt-3 h-8 text-xs font-mono"
        placeholder={
          insertAfterPath
            ? `Search to add below ${readablePath(insertAfterPath)}...`
            : 'Search paths to add...'
        }
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {insertAfterPath && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-900">
          <span className="truncate">
            Adding next node below {readablePath(insertAfterPath)}
          </span>
          <button
            className="ml-auto rounded px-2 py-0.5 hover:bg-blue-100"
            onClick={() => setInsertAfterPath(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {filteredPaths.length > 0 && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border bg-background">
          {filteredPaths.slice(0, 40).map((path) => (
            <button
              key={path}
              className="block w-full px-2 py-1.5 text-left font-mono text-xs hover:bg-muted"
              onClick={() => addSelectedPath(path)}
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
          const conditionOptions = getConditionOptions(node)
          const attachedConditions = getAttachedConditions(condition)
          const hasValueCondition = condition.op !== 'always'
          const inlineFilteredPaths =
            insertAfterPath === path && inlineSearch
              ? allPaths.filter(
                  (candidatePath) =>
                    !selectedPaths.includes(candidatePath) &&
                    candidatePath
                      .toLowerCase()
                      .includes(inlineSearch.toLowerCase())
                )
              : []
          return (
            <div
              key={path}
              data-visible-node-row
              data-path={path}
              className={cn(
                'rounded-lg border p-3 transition-all duration-200 ease-out',
                attachingPath && attachingPath !== path
                  ? 'cursor-pointer border-blue-200 hover:border-blue-400 hover:bg-blue-50/50'
                  : '',
                attachingPath === path ? 'border-blue-400 bg-blue-50/70' : '',
                draggingPath === path
                  ? 'scale-[0.99] border-blue-300 bg-blue-50/60 opacity-70 shadow-sm'
                  : 'hover:border-foreground/20 hover:shadow-sm'
              )}
              onClick={() => {
                if (!attachingPath || attachingPath === path) return
                const sourceCondition = conditions[attachingPath] ?? {
                  op: 'always',
                  value: '',
                }
                const sourceAttached = getAttachedConditions(sourceCondition)
                const sourceDraft = draftCondition?.path === attachingPath ? draftCondition : null
                setConditions({
                  ...conditions,
                  [attachingPath]: {
                    ...sourceCondition,
                    dependsOn: undefined,
                    attached: [
                      ...sourceAttached,
                      {
                        id: createConditionId(),
                        type:
                          sourceDraft?.type === 'other-node' &&
                          sourceDraft.op !== 'visible'
                            ? 'node-value'
                            : 'node-visible',
                        path,
                        op:
                          sourceDraft?.op && sourceDraft.op !== 'visible'
                            ? sourceDraft.op
                            : undefined,
                        value:
                          sourceDraft?.op && sourceDraft.op !== 'visible'
                            ? sourceDraft.value
                            : undefined,
                      effect: sourceDraft?.effect ?? 'both',
                        color: sourceDraft?.color,
                      },
                    ],
                  },
                })
                setAttachingPath(null)
                if (draftCondition?.path === attachingPath) setDraftCondition(null)
              }}
            >
              <div className="flex items-start gap-2">
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
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {node?.content.type !== 'entity' && node?.content.label
                      ? node.content.label
                      : readablePath(path)}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {path}
                  </div>
                </div>
                <button
                  className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation()
                    setInsertAfterPath(insertAfterPath === path ? null : path)
                    setInlineSearch('')
                  }}
                >
                  Add below
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDraftCondition({
                      path,
                      type: 'other-node',
                      op: 'visible',
                      value: condition.value,
                      effect: 'both',
                    })
                    setAttachingPath(path)
                  }}
                >
                  Add condition
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedPaths(selectedPaths.filter((p) => p !== path))
                    const nextConditions = { ...conditions }
                    delete nextConditions[path]
                    for (const selectedPath of selectedPaths) {
                      const selectedCondition = nextConditions[selectedPath]
                      if (!selectedCondition) continue
                      nextConditions[selectedPath] = {
                        ...selectedCondition,
                        dependsOn:
                          selectedCondition.dependsOn === path
                            ? undefined
                            : selectedCondition.dependsOn,
                        attached: getAttachedConditions(selectedCondition).filter(
                          (item) => item.path !== path
                        ),
                      }
                    }
                    setConditions(nextConditions)
                    if (attachingPath === path) setAttachingPath(null)
                    if (draftCondition?.path === path) setDraftCondition(null)
                  }}
                >
                  <X className="size-3" /> Remove
                </button>
              </div>

              {insertAfterPath === path && (
                <div
                  className="mt-2 rounded-lg border border-blue-200 bg-blue-50/60 p-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-8 flex-1 bg-background font-mono text-xs"
                      autoFocus
                      placeholder="Search node to insert below..."
                      value={inlineSearch}
                      onChange={(e) => setInlineSearch(e.target.value)}
                    />
                    <button
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-blue-100 hover:text-foreground"
                      onClick={() => {
                        setInsertAfterPath(null)
                        setInlineSearch('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {inlineFilteredPaths.length > 0 && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-md border bg-background">
                      {inlineFilteredPaths.slice(0, 30).map((candidatePath) => (
                        <button
                          key={candidatePath}
                          className="block w-full px-2 py-1.5 text-left font-mono text-xs hover:bg-muted"
                          onClick={() => addSelectedPath(candidatePath, path)}
                        >
                          {candidatePath}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(draftCondition?.path === path ||
                hasValueCondition ||
                attachedConditions.length > 0) && (
                <div
                  className="mt-2 space-y-2"
                  onClick={(e) => e.stopPropagation()}
                >
                {draftCondition?.path === path && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-2 text-xs shadow-sm">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800">
                      new
                    </span>
                    <select
                      className="h-7 rounded border bg-background px-2 text-xs"
                      value={draftCondition.type}
                      onChange={(e) => {
                        const type = e.target.value as typeof draftCondition.type
                        if (type === 'node-value') {
                          const nextAttached = [
                            ...attachedConditions,
                            {
                              id: createConditionId(),
                              type: 'node-value' as const,
                              path,
                              op: 'equals' as const,
                              value: '',
                              effect: 'both' as const,
                            },
                          ]
                          setConditions({
                            ...conditions,
                            [path]: {
                              ...condition,
                              attached: nextAttached,
                            },
                          })
                          setDraftCondition(null)
                          setAttachingPath(null)
                          return
                        }
                        setDraftCondition({
                          ...draftCondition,
                          type,
                          op: type === 'other-node' ? 'visible' : 'equals',
                        })
                        setAttachingPath(type === 'other-node' ? path : null)
                      }}
                    >
                      <option value="node-value">this node value</option>
                      <option value="other-node">another node</option>
                    </select>
                    <select
                      className="h-7 rounded border bg-background px-2 text-xs"
                      value={draftCondition.op}
                      onChange={(e) =>
                        setDraftCondition({
                          ...draftCondition,
                          op: e.target.value as typeof draftCondition.op,
                        })
                      }
                    >
                      <option value="visible">is showing</option>
                      <option value="equals">equals</option>
                      <option value="gt">greater than</option>
                      <option value="lt">less than</option>
                    </select>
                    {draftCondition.op !== 'visible' && (
                      <Input
                        className="h-7 w-32 text-xs"
                        value={draftCondition.value}
                        onChange={(e) =>
                          setDraftCondition({
                            ...draftCondition,
                            value: e.target.value,
                          })
                        }
                        placeholder="value"
                      />
                    )}
                    <ColorOnlyCheckbox
                      checked={draftCondition.effect === 'color'}
                      onChange={(checked) =>
                        setDraftCondition({
                          ...draftCondition,
                          effect: checked ? 'color' : 'both',
                        })
                      }
                    />
                    <ConditionColorSelect
                      value={draftCondition.color}
                      onChange={(color) =>
                        setDraftCondition({ ...draftCondition, color })
                      }
                    />
                    <span className="rounded-full bg-background px-2.5 py-1 text-xs text-blue-800 shadow-sm">
                      Click target card
                    </span>
                    <button
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDraftCondition(null)
                        if (attachingPath === path) setAttachingPath(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {hasValueCondition || attachedConditions.length > 0 ? (
                  <div className="space-y-2">
                    {hasValueCondition && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/90 px-2.5 py-2 text-xs shadow-sm">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                          condition
                        </span>
                        <span className="rounded border bg-background px-2 py-1.5 text-xs text-foreground">
                          this node value
                        </span>
                        <select
                          className="h-7 rounded border bg-background px-2 text-xs"
                          value={condition.op}
                          onChange={(e) => {
                            const op = e.target.value as NodeCondition['op']
                            setConditions({
                              ...conditions,
                              [path]: {
                                ...condition,
                                op,
                                value: op === 'always' ? '' : condition.value,
                              },
                            })
                          }}
                        >
                          {conditionOptions
                            .filter((option) => option.value !== 'always')
                            .map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                        </select>
                        <ConditionValueInput
                          node={node}
                          condition={condition}
                          onChange={(value) =>
                            setConditions({
                              ...conditions,
                              [path]: { ...condition, value },
                            })
                          }
                        />
                        <ColorOnlyCheckbox
                          checked={condition.effect === 'color'}
                          onChange={(checked) =>
                            setConditions({
                              ...conditions,
                              [path]: {
                                ...condition,
                                effect: checked ? 'color' : 'both',
                              },
                            })
                          }
                        />
                        <ConditionColorSelect
                          value={condition.color}
                          onChange={(color) =>
                            setConditions({
                              ...conditions,
                              [path]: { ...condition, color },
                            })
                          }
                        />
                        <button
                          className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            setConditions({
                              ...conditions,
                              [path]: { ...condition, op: 'always', value: '' },
                            })
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    {attachedConditions.map((attachedCondition) => (
                      <div
                        key={attachedCondition.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/90 px-2.5 py-2 text-xs shadow-sm"
                      >
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                          condition
                        </span>
                        <span className="max-w-64 truncate rounded border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground">
                          {attachedCondition.path === path
                            ? 'this node value'
                            : attachedCondition.path}
                        </span>
                        <select
                          className="h-7 rounded border bg-background px-2 text-xs"
                          value={
                            attachedCondition.type === 'node-visible'
                              ? 'visible'
                              : (attachedCondition.op ?? 'equals')
                          }
                          onChange={(e) => {
                            const value = e.target.value
                            const nextAttached = attachedConditions.map(
                              (item) => {
                                if (item.id !== attachedCondition.id) return item
                                if (value === 'visible') {
                                  return {
                                    id: item.id,
                                    type: 'node-visible' as const,
                                    path: item.path,
                                    effect: item.effect,
                                    color: item.color,
                                  }
                                }
                                return {
                                  ...item,
                                  type: 'node-value' as const,
                                  op: value as Exclude<
                                    NodeCondition['op'],
                                    'always'
                                  >,
                                  value: item.value ?? '',
                                }
                              }
                            )
                            setConditions({
                              ...conditions,
                              [path]: {
                                ...condition,
                                attached: nextAttached,
                              },
                            })
                          }}
                        >
                          <option value="visible">is showing</option>
                          {getConditionOptions(pathToNode.get(attachedCondition.path))
                            .filter((option) => option.value !== 'always')
                            .map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                        </select>
                        {attachedCondition.type === 'node-value' && (
                          <ConditionValueInput
                            node={pathToNode.get(attachedCondition.path)}
                            condition={{
                              op: attachedCondition.op ?? 'equals',
                              value: attachedCondition.value ?? '',
                            }}
                            onChange={(value) => {
                              const nextAttached = attachedConditions.map(
                                (item) =>
                                  item.id === attachedCondition.id
                                    ? { ...item, value }
                                    : item
                              )
                              setConditions({
                                ...conditions,
                                [path]: {
                                  ...condition,
                                  attached: nextAttached,
                                },
                              })
                            }}
                          />
                        )}
                        <ColorOnlyCheckbox
                          checked={attachedCondition.effect === 'color'}
                          onChange={(checked) => {
                            const nextAttached = attachedConditions.map(
                              (item) =>
                                item.id === attachedCondition.id
                                  ? {
                                      ...item,
                                      effect: (checked
                                        ? 'color'
                                        : 'both') as ConditionEffect,
                                    }
                                  : item
                            )
                            setConditions({
                              ...conditions,
                              [path]: { ...condition, attached: nextAttached },
                            })
                          }}
                        />
                        <ConditionColorSelect
                          value={attachedCondition.color}
                          onChange={(color) => {
                            const nextAttached = attachedConditions.map(
                              (item) =>
                                item.id === attachedCondition.id
                                  ? { ...item, color }
                                  : item
                            )
                            setConditions({
                              ...conditions,
                              [path]: { ...condition, attached: nextAttached },
                            })
                          }}
                        />
                        <button
                          className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            setConditions({
                              ...conditions,
                              [path]: {
                                ...condition,
                                attached: attachedConditions.filter(
                                  (item) => item.id !== attachedCondition.id
                                ),
                              },
                            })
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                </div>
              )}
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

function ConditionValueInput({
  node,
  condition,
  onChange,
}: {
  node?: ModelNode
  condition: NodeCondition
  onChange: (value: string) => void
}) {
  const typeName = getConditionTypeName(node)
  const enumOptions = getConditionEnumOptions(node)
  const isNumericComparison = condition.op === 'gt' || condition.op === 'lt'
  return (
    <TypedValueInput
      className={cn('h-7 text-xs', isNumericComparison ? 'w-24' : 'w-40')}
      typeName={isNumericComparison ? orderedConditionType(typeName) : typeName}
      enumOptions={enumOptions}
      value={condition.value}
      onChange={onChange}
    />
  )
}

function ColorOnlyCheckbox({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        className="size-3 accent-foreground"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Color only
    </label>
  )
}

function ConditionColorSelect({
  value,
  onChange,
}: {
  value?: ConditionColor
  onChange: (value: ConditionColor | undefined) => void
}) {
  return (
    <select
      className="h-7 rounded border bg-background px-2 text-xs"
      value={value ?? ''}
      onChange={(e) =>
        onChange(
          e.target.value ? (e.target.value as ConditionColor) : undefined
        )
      }
    >
      <option value="">no color</option>
      <option value="red">red</option>
      <option value="yellow">yellow</option>
      <option value="blue">blue</option>
      <option value="green">green</option>
    </select>
  )
}

function getConditionOptions(
  node?: ModelNode
): { value: NodeCondition['op']; label: string }[] {
  const typeName = getConditionTypeName(node)
  const base: { value: NodeCondition['op']; label: string }[] = [
    { value: 'always', label: 'always' },
  ]

  if (typeName !== 'Collection') {
    base.push({ value: 'equals', label: 'equals' })
  }

  if (supportsOrderedComparison(typeName)) {
    base.push(
      { value: 'gt', label: 'greater than' },
      { value: 'lt', label: 'less than' }
    )
  }

  return base
}

function supportsOrderedComparison(typeName?: string) {
  switch (typeName) {
    case 'Dollar':
    case 'Int':
    case 'Short':
    case 'Byte':
    case 'Rational':
    case 'Day':
      return true
    default:
      return false
  }
}

function getConditionTypeName(node?: ModelNode): string | undefined {
  const content = node?.content
  if (!content || content.type === 'entity') return undefined
  if (content.format === 'factGraph') {
    if (content.type === 'writable') return content.typeName
    return content.dataType
  }
  return undefined
}

function getConditionEnumOptions(node?: ModelNode): string[] | undefined {
  const content = node?.content
  if (!content || content.type === 'entity') return undefined
  if (content.format !== 'factGraph') return undefined
  return content.enumOptions
}

function orderedConditionType(typeName?: string): string | undefined {
  switch (typeName) {
    case 'Day':
    case 'Dollar':
    case 'Int':
    case 'Short':
    case 'Byte':
    case 'Rational':
      return typeName
    default:
      return 'Dollar'
  }
}

function GeneratorSettings({
  config,
  setConfig,
  onResetDefaults,
}: {
  config: SimulationConfig
  setConfig: (config: SimulationConfig) => void
  onResetDefaults: () => void
}) {
  return (
    <section className="rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Simulation Settings</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Controls the values generated by the random input button.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onResetDefaults}
        >
          Reset to defaults
        </Button>
      </div>

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
  const [inputSearch, setInputSearch] = useState('')
  const matchesInputSearch = (field: FieldConfig) => {
    if (!inputSearch) return true
    const query = inputSearch.toLowerCase()
    const node = writableByPath.get(field.path)
    const label =
      node?.content.type !== 'entity' && node?.content.label
        ? node.content.label
        : ''
    return (
      field.path.toLowerCase().includes(query) ||
      label.toLowerCase().includes(query) ||
      field.type.toLowerCase().includes(query)
    )
  }
  const visibleScalarFields = config.scalarFields.filter(matchesInputSearch)
  const visibleCollections = config.collections
    .map((collection) => ({
      ...collection,
      fields: collection.fields.filter(matchesInputSearch),
    }))
    .filter(
      (collection) =>
        collection.fields.length > 0 ||
        collection.collectionPath
          .toLowerCase()
          .includes(inputSearch.toLowerCase())
    )

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

      <Input
        className="mt-4 h-8 text-xs"
        placeholder="Search inputs by label, path, or type..."
        value={inputSearch}
        onChange={(e) => setInputSearch(e.target.value)}
      />

      <div className="mt-4 space-y-3">
        {visibleScalarFields.map((field) => (
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

      {visibleCollections.map((collection) => {
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
  const interfaceDefaults = (config as SimulationConfigWithInterfaceDefaults)
    .interfaceDefaults
  return {
    selectedPaths:
      interfaceDefaults?.selectedPaths ?? config.outcomeNodes.slice(0, 8),
    conditions: interfaceDefaults?.conditions ?? {},
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

function generateValue(
  field: FieldConfig,
  rng: () => number,
  entities?: Record<string, Record<string, string>[]>,
  currentCollectionPath?: string,
  currentRowIndex?: number
): unknown {
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
    case 'CollectionItem': {
      if (rng() >= (field.linkProbability ?? 1)) return null
      const targetRows = field.collectionItemPath
        ? (entities?.[field.collectionItemPath] ?? [])
        : []
      if (targetRows.length === 0) return null
      const options = targetRows
        .map((_, index) => index)
        .filter(
          (index) =>
            field.collectionItemPath !== currentCollectionPath ||
            index !== currentRowIndex
        )
      if (options.length === 0) return null
      return `#${options[Math.floor(rng() * options.length)]}`
    }
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

function createConditionId() {
  return `condition-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getAttachedConditions(
  condition: NodeCondition
): AttachedVisibilityCondition[] {
  const attached = condition.attached ?? []
  if (!condition.dependsOn) return attached
  return [
    ...attached,
    {
      id: `legacy-${condition.dependsOn}`,
      type: 'node-visible',
      path: condition.dependsOn,
    },
  ]
}

function getResultPresentation(
  path: string,
  selectedPaths: string[],
  conditions: Record<string, NodeCondition>,
  pathToNode: Map<string, ModelNode>,
  results: ExecutionResults | null,
  seen = new Set<string>()
): { visible: boolean; color?: ConditionColor } {
  if (!selectedPaths.includes(path)) return { visible: false }
  if (seen.has(path)) return { visible: false }
  seen.add(path)

  const node = pathToNode.get(path)
  const value = node ? results?.[node.id]?.value : undefined
  const condition = conditions[path] ?? { op: 'always', value: '' }
  let color: ConditionColor | undefined

  if (condition.op !== 'always') {
    const passed = passesCondition(value, condition)
    if (!passed && conditionAffectsVisibility(condition)) {
      return { visible: false }
    }
    if (passed && conditionAffectsColor(condition)) color = condition.color
  }

  for (const attachedCondition of getAttachedConditions(condition)) {
    const passed = passesAttachedCondition(
      attachedCondition,
      selectedPaths,
      conditions,
      pathToNode,
      results,
      seen
    )
    if (!passed && conditionAffectsVisibility(attachedCondition)) {
      return { visible: false }
    }
    if (passed && conditionAffectsColor(attachedCondition)) {
      color = color ?? attachedCondition.color
    }
  }

  return { visible: true, color }
}

function passesAttachedCondition(
  condition: AttachedVisibilityCondition,
  selectedPaths: string[],
  conditions: Record<string, NodeCondition>,
  pathToNode: Map<string, ModelNode>,
  results: ExecutionResults | null,
  seen: Set<string>
): boolean {
  if (condition.type === 'node-value') {
    const node = pathToNode.get(condition.path)
    const value = node ? results?.[node.id]?.value : undefined
    return passesCondition(value, {
      op: condition.op ?? 'equals',
      value: condition.value ?? '',
    })
  }

  return getResultPresentation(
    condition.path,
    selectedPaths,
    conditions,
    pathToNode,
    results,
    new Set(seen)
  ).visible
}

function conditionAffectsVisibility(condition: {
  effect?: ConditionEffect
}): boolean {
  return (condition.effect ?? 'both') !== 'color'
}

function conditionAffectsColor(condition: {
  effect?: ConditionEffect
  color?: ConditionColor
}): boolean {
  const effect = condition.effect ?? 'both'
  return Boolean(condition.color) && (effect === 'color' || effect === 'both')
}

function passesCondition(value: unknown, condition: NodeCondition): boolean {
  if (condition.op === 'always') return true
  if (condition.op === 'equals') return valuesEqual(value, condition.value)
  const n = typeof value === 'number' ? value : Number(value)
  const target = Number(condition.value)
  if (Number.isNaN(n) || Number.isNaN(target)) return false
  if (condition.op === 'gt') return n > target
  return n < target
}

function valuesEqual(value: unknown, rawCondition: string): boolean {
  if (typeof value === 'boolean') return rawCondition === String(value)
  if (typeof value === 'number') return value === Number(rawCondition)
  if (Array.isArray(value)) return value.map(String).includes(rawCondition)
  return String(value) === rawCondition
}

function conditionColorClass(color?: ConditionColor): string {
  switch (color) {
    case 'red':
      return 'bg-red-50 text-red-950'
    case 'yellow':
      return 'bg-amber-50 text-amber-950'
    case 'blue':
      return 'bg-blue-50 text-blue-950'
    case 'green':
      return 'bg-emerald-50 text-emerald-950'
    default:
      return ''
  }
}

function ResultValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1 sm:justify-end">
        {value.map((item, index) => (
          <span
            key={index}
            className="min-w-0 max-w-full break-words rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium"
          >
            {formatValue(item)}
          </span>
        ))}
      </div>
    )
  }
  return <span className="break-words">{formatValue(value)}</span>
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
