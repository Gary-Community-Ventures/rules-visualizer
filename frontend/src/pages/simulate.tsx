import { useState, useEffect, useCallback } from 'react'
import { useParams } from '@tanstack/react-router'
import { setPendingScenario } from '@/lib/simulation-bridge'
import {
  configureSimulation,
  runSimulation,
  listSimulations,
  getSimulationRun,
  getSimulationResults,
  deleteSimulation,
  type SimulationConfig,
  type SimulationRun,
  type CaseResult,
} from '@/lib/api/simulation-api'
import { listRulesets, type RulesetSummary } from '@/lib/api/rules-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Play,
  Loader2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  FlaskConical,
  ExternalLink,
} from 'lucide-react'

type View = 'config' | 'dashboard' | 'detail'

export function SimulatePage() {
  const { rulesetId } = useParams({ from: '/simulate/$rulesetId' })
  const [view, setView] = useState<View>('config')
  const [config, setConfig] = useState<SimulationConfig | null>(null)
  const [comparedRulesetId, setComparedRulesetId] = useState('')
  const [availableRulesets, setAvailableRulesets] = useState<RulesetSummary[]>(
    []
  )
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dashboard state
  const [runs, setRuns] = useState<SimulationRun[]>([])
  const [activeRun, setActiveRun] = useState<SimulationRun | null>(null)
  const [results, setResults] = useState<CaseResult[]>([])
  const [resultsTotal, setResultsTotal] = useState(0)
  const [resultsFilter, setResultsFilter] = useState<
    'all' | 'changed' | 'unchanged'
  >('all')
  const [resultsOffset, setResultsOffset] = useState(0)
  const resultsLimit = 50

  // Detail state
  const [detailCase, setDetailCase] = useState<CaseResult | null>(null)

  // Set browser tab title
  useEffect(() => {
    document.title = `Simulate ${rulesetId} — Rules Visualizer`
  }, [rulesetId])

  // Load config and available rulesets on mount
  useEffect(() => {
    configureSimulation(rulesetId)
      .then(setConfig)
      .catch((e) => setError(e.message))
    listRulesets()
      .then((rs) =>
        setAvailableRulesets(
          rs.filter((r) => r.format === 'factGraph' && r.id !== rulesetId)
        )
      )
      .catch(() => {})
  }, [rulesetId])

  // Load past runs
  const loadRuns = useCallback(() => {
    listSimulations(rulesetId)
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [rulesetId])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  const [resultsLoading, setResultsLoading] = useState(false)

  // Load results when active run or filter changes
  useEffect(() => {
    if (!activeRun) return
    setResultsLoading(true)
    getSimulationResults(rulesetId, activeRun.id, {
      offset: resultsOffset,
      limit: resultsLimit,
      filter: resultsFilter,
    })
      .then((data) => {
        setResults(data.results)
        setResultsTotal(data.total)
      })
      .catch(() => setResults([]))
      .finally(() => setResultsLoading(false))
  }, [rulesetId, activeRun, resultsFilter, resultsOffset])

  const [progress, setProgress] = useState<{
    completed: number
    total: number
  } | null>(null)

  const handleRun = async () => {
    if (!config || !comparedRulesetId) return
    setIsRunning(true)
    setError(null)
    setProgress({ completed: 0, total: config.caseCount })
    try {
      // Start the run (returns immediately with status: 'running')
      const pendingRun = await runSimulation(
        rulesetId,
        config,
        comparedRulesetId
      )

      // Poll for progress until complete (max 10 minutes)
      const MAX_POLL_MS = 10 * 60 * 1000
      const pollStart = Date.now()
      const poll = async (): Promise<SimulationRun> => {
        const current = await getSimulationRun(rulesetId, pendingRun.id)
        if (current.progress) {
          setProgress(current.progress)
        }
        if (current.status === 'running') {
          if (Date.now() - pollStart > MAX_POLL_MS) {
            throw new Error('Simulation timed out')
          }
          await new Promise((r) => setTimeout(r, 500))
          return poll()
        }
        return current
      }

      const completedRun = await poll()
      if (completedRun.status === 'failed') {
        throw new Error(completedRun.error ?? 'Simulation failed')
      }
      setActiveRun(completedRun)
      setResultsOffset(0)
      setView('dashboard')
      loadRuns()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsRunning(false)
      setProgress(null)
    }
  }

  const handleLoadRun = (run: SimulationRun) => {
    setActiveRun(run)
    setResultsOffset(0)
    setResultsFilter('all')
    setView('dashboard')
  }

  const handleDeleteRun = async (runId: string) => {
    try {
      await deleteSimulation(rulesetId, runId)
      loadRuns()
      if (activeRun?.id === runId) {
        setActiveRun(null)
        setView('config')
      }
    } catch {
      // ignore
    }
  }

  const handleDrillInto = (caseResult: CaseResult) => {
    setDetailCase(caseResult)
    setView('detail')
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (view === 'detail') setView('dashboard')
            else if (view === 'dashboard') setView('config')
            else window.location.href = '/'
          }}
        >
          <ArrowLeft className="size-4" />
        </button>
        <FlaskConical className="size-4 text-muted-foreground" />
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Simulation — {rulesetId}</h1>
          {view === 'dashboard' && (
            <span className="text-xs text-muted-foreground">/ Results</span>
          )}
          {view === 'detail' && detailCase && (
            <span className="text-xs text-muted-foreground">
              / Results / Case #{detailCase.scenarioId}
            </span>
          )}
        </div>
        <div className="flex-1" />
        {view !== 'config' && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setView('config')}
          >
            New Run
          </Button>
        )}
      </div>

      {error && (
        <div className="px-6 py-2 bg-red-50 text-red-700 text-xs border-b">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === 'config' && (
          <ConfigView
            config={config}
            setConfig={setConfig}
            comparedRulesetId={comparedRulesetId}
            setComparedRulesetId={setComparedRulesetId}
            availableRulesets={availableRulesets}
            isRunning={isRunning}
            progress={progress}
            onRun={handleRun}
            runs={runs}
            onLoadRun={handleLoadRun}
            onDeleteRun={handleDeleteRun}
          />
        )}
        {view === 'dashboard' && activeRun && (
          <DashboardView
            run={activeRun}
            results={results}
            total={resultsTotal}
            filter={resultsFilter}
            setFilter={(f) => {
              setResultsFilter(f)
              setResultsOffset(0)
            }}
            offset={resultsOffset}
            limit={resultsLimit}
            onPageChange={setResultsOffset}
            onDrillInto={handleDrillInto}
            loading={resultsLoading}
          />
        )}
        {view === 'detail' && detailCase && activeRun && (
          <DetailView
            caseResult={detailCase}
            rulesetId={rulesetId}
            comparedRulesetId={activeRun.comparedRulesetId}
          />
        )}
      </div>
    </div>
  )
}

// --- Config View ---

function ConfigView({
  config,
  setConfig,
  comparedRulesetId,
  setComparedRulesetId,
  availableRulesets,
  isRunning,
  progress,
  onRun,
  runs,
  onLoadRun,
  onDeleteRun,
}: {
  config: SimulationConfig | null
  setConfig: (c: SimulationConfig) => void
  comparedRulesetId: string
  setComparedRulesetId: (id: string) => void
  availableRulesets: RulesetSummary[]
  isRunning: boolean
  progress: { completed: number; total: number } | null
  onRun: () => void
  runs: SimulationRun[]
  onLoadRun: (r: SimulationRun) => void
  onDeleteRun: (id: string) => void
}) {
  if (!config) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading configuration...
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="space-y-4">
        <h2 className="text-sm font-semibold">Run Configuration</h2>

        <div className="space-y-2">
          <label className="text-xs font-medium">Compare against</label>
          <select
            className="w-full h-9 text-sm border rounded px-3 bg-background"
            value={comparedRulesetId}
            onChange={(e) => setComparedRulesetId(e.target.value)}
          >
            <option value="">Select a ruleset to compare...</option>
            {availableRulesets.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium">Seed</label>
            <Input
              className="text-xs font-mono"
              type="number"
              value={config.seed}
              onChange={(e) =>
                setConfig({ ...config, seed: parseInt(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Case count</label>
            <Input
              className="text-xs font-mono"
              type="number"
              value={config.caseCount}
              onChange={(e) =>
                setConfig({
                  ...config,
                  caseCount: parseInt(e.target.value) || 100,
                })
              }
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">
            Outcome nodes ({config.outcomeNodes.length})
          </label>
          <div className="flex flex-wrap gap-1">
            {config.outcomeNodes.map((p) => (
              <span
                key={p}
                className="px-1.5 py-0.5 bg-violet-100 text-violet-800 text-[10px] font-mono rounded"
              >
                {p}
              </span>
            ))}
          </div>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Scalar fields ({config.scalarFields.length})
          </summary>
          <div className="mt-2 space-y-1.5 pl-4">
            {config.scalarFields.map((f, idx) => (
              <div key={f.path} className="flex items-center gap-2 font-mono">
                <span className="w-48 truncate shrink-0" title={f.path}>
                  {f.path}
                </span>
                <span className="text-muted-foreground shrink-0">
                  ({f.type})
                </span>
                {(f.type === 'Dollar' ||
                  f.type === 'Int' ||
                  f.type === 'Short' ||
                  f.type === 'Byte') && (
                  <>
                    <Input
                      className="h-6 w-20 text-[11px] font-mono"
                      type="number"
                      value={f.min ?? 0}
                      onChange={(e) => {
                        const fields = [...config.scalarFields]
                        fields[idx] = {
                          ...f,
                          min: parseFloat(e.target.value) || 0,
                        }
                        setConfig({ ...config, scalarFields: fields })
                      }}
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      className="h-6 w-20 text-[11px] font-mono"
                      type="number"
                      value={f.max ?? 100}
                      onChange={(e) => {
                        const fields = [...config.scalarFields]
                        fields[idx] = {
                          ...f,
                          max: parseFloat(e.target.value) || 100,
                        }
                        setConfig({ ...config, scalarFields: fields })
                      }}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </details>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Collections ({config.collections.length})
          </summary>
          <div className="mt-2 space-y-3 pl-4">
            {config.collections.map((coll, collIdx) => (
              <div key={coll.collectionPath} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">
                    {coll.collectionPath}
                  </span>
                  <Input
                    className="h-6 w-12 text-[11px] font-mono"
                    type="number"
                    value={coll.minMembers}
                    onChange={(e) => {
                      const colls = [...config.collections]
                      colls[collIdx] = {
                        ...coll,
                        minMembers: parseInt(e.target.value) || 1,
                      }
                      setConfig({ ...config, collections: colls })
                    }}
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    className="h-6 w-12 text-[11px] font-mono"
                    type="number"
                    value={coll.maxMembers}
                    onChange={(e) => {
                      const colls = [...config.collections]
                      colls[collIdx] = {
                        ...coll,
                        maxMembers: parseInt(e.target.value) || 5,
                      }
                      setConfig({ ...config, collections: colls })
                    }}
                  />
                  <span className="text-muted-foreground">members</span>
                </div>
                {coll.fields.map((f, fIdx) => (
                  <div
                    key={f.path}
                    className="flex items-center gap-2 font-mono pl-4"
                  >
                    <span className="w-44 truncate shrink-0" title={f.path}>
                      {f.path}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      ({f.type})
                    </span>
                    {(f.type === 'Dollar' ||
                      f.type === 'Int' ||
                      f.type === 'Short' ||
                      f.type === 'Byte') && (
                      <>
                        <Input
                          className="h-6 w-20 text-[11px] font-mono"
                          type="number"
                          value={f.min ?? 0}
                          onChange={(e) => {
                            const colls = [...config.collections]
                            const fields = [...coll.fields]
                            fields[fIdx] = {
                              ...f,
                              min: parseFloat(e.target.value) || 0,
                            }
                            colls[collIdx] = { ...coll, fields }
                            setConfig({ ...config, collections: colls })
                          }}
                        />
                        <span className="text-muted-foreground">–</span>
                        <Input
                          className="h-6 w-20 text-[11px] font-mono"
                          type="number"
                          value={f.max ?? 100}
                          onChange={(e) => {
                            const colls = [...config.collections]
                            const fields = [...coll.fields]
                            fields[fIdx] = {
                              ...f,
                              max: parseFloat(e.target.value) || 100,
                            }
                            colls[collIdx] = { ...coll, fields }
                            setConfig({ ...config, collections: colls })
                          }}
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>

        <Button
          onClick={onRun}
          disabled={isRunning || !comparedRulesetId}
          className="w-full"
        >
          {isRunning ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              Running...
            </>
          ) : (
            <>
              <Play className="size-4 mr-2" />
              Run Simulation ({config.caseCount} cases)
            </>
          )}
        </Button>

        {/* Progress bar */}
        {isRunning && progress && (
          <div className="space-y-1">
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{
                  width: `${Math.round((progress.completed / progress.total) * 100)}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              {progress.completed.toLocaleString()} /{' '}
              {progress.total.toLocaleString()} cases (
              {Math.round((progress.completed / progress.total) * 100)}%)
            </p>
          </div>
        )}
      </div>

      {/* Past runs */}
      {runs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Past Runs</h2>
          <div className="space-y-1">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 px-3 py-2 border rounded hover:bg-muted/50 cursor-pointer"
                onClick={() => onLoadRun(run)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono truncate">
                    vs. {run.comparedRulesetId}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString()} —{' '}
                    {run.config.caseCount} cases
                    {run.summary &&
                      ` — ${run.summary.changedCases} changed (${Math.round((run.summary.changedCases / run.summary.totalCases) * 100)}%)`}
                  </div>
                </div>
                <button
                  className="p-1 text-muted-foreground hover:text-red-600"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteRun(run.id)
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Dashboard View ---

function DashboardView({
  run,
  results,
  total,
  filter,
  setFilter,
  offset,
  limit,
  onPageChange,
  onDrillInto,
  loading,
}: {
  run: SimulationRun
  results: CaseResult[]
  total: number
  filter: 'all' | 'changed' | 'unchanged'
  setFilter: (f: 'all' | 'changed' | 'unchanged') => void
  offset: number
  limit: number
  onPageChange: (offset: number) => void
  onDrillInto: (c: CaseResult) => void
  loading: boolean
}) {
  const summary = run.summary
  if (!summary) return <div className="p-6 text-sm">Run has no summary.</div>

  const pct = Math.round((summary.changedCases / summary.totalCases) * 100)
  const pages = Math.ceil(total / limit)
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Summary bar */}
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'px-4 py-3 rounded-lg text-sm font-medium flex-1 text-center',
            summary.changedCases > 0
              ? 'bg-amber-50 text-amber-800'
              : 'bg-emerald-50 text-emerald-800'
          )}
        >
          {summary.changedCases > 0
            ? `${summary.changedCases.toLocaleString()} of ${summary.totalCases.toLocaleString()} cases changed (${pct}%)`
            : `All ${summary.totalCases.toLocaleString()} cases unchanged`}
        </div>
        <div className="text-xs text-muted-foreground">
          {(summary.executionTimeMs / 1000).toFixed(1)}s
        </div>
      </div>

      {/* Top changed nodes */}
      {summary.nodeChanges.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase">
            Most changed nodes
          </h3>
          <div className="space-y-1">
            {summary.nodeChanges.slice(0, 10).map((nc) => (
              <div key={nc.path} className="flex items-center gap-3 text-xs">
                <span className="font-mono flex-1 truncate">{nc.path}</span>
                <span className="text-muted-foreground">
                  {nc.timesChanged}x
                </span>
                {nc.avgDelta !== undefined && (
                  <span
                    className={cn(
                      'font-mono',
                      nc.avgDelta > 0
                        ? 'text-emerald-700'
                        : nc.avgDelta < 0
                          ? 'text-red-700'
                          : 'text-muted-foreground'
                    )}
                  >
                    {nc.avgDelta > 0 ? '+' : ''}
                    {nc.avgDelta}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 border-b pb-2">
        {(['all', 'changed', 'unchanged'] as const).map((f) => (
          <button
            key={f}
            className={cn(
              'px-3 py-1 text-xs rounded',
              filter === f
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setFilter(f)}
          >
            {f === 'all'
              ? `All (${summary.totalCases})`
              : f === 'changed'
                ? `Changed (${summary.changedCases})`
                : `Unchanged (${summary.unchangedCases})`}
          </button>
        ))}
      </div>

      {/* Results table */}
      <div className="border rounded-lg overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">#</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Outcome diffs</th>
              <th className="text-left px-3 py-2 font-medium">All diffs</th>
              <th className="text-right px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.scenarioId}
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => onDrillInto(r)}
              >
                <td className="px-3 py-2 font-mono">{r.scenarioId}</td>
                <td className="px-3 py-2">
                  {r.error ? (
                    <span className="text-red-600">Error</span>
                  ) : r.changed ? (
                    <span className="text-amber-700">Changed</span>
                  ) : (
                    <span className="text-emerald-700">Same</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.outcomeDiffs.length > 0 ? (
                    <div className="space-y-0.5">
                      {r.outcomeDiffs.map((d) => (
                        <div
                          key={d.path}
                          className="flex items-center gap-1.5 font-mono"
                        >
                          <span className="text-muted-foreground truncate max-w-[100px]">
                            {d.path}
                          </span>
                          <span className="text-muted-foreground/60">
                            {formatValue(d.baseValue)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            &rarr;
                          </span>
                          <span className="font-medium">
                            {formatValue(d.editedValue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.allDiffs.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={offset === 0}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
          >
            <ChevronLeft className="size-3" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {currentPage} of {pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={offset + limit >= total}
            onClick={() => onPageChange(offset + limit)}
          >
            <ChevronRight className="size-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

// --- Detail View ---

function DetailView({
  caseResult,
  rulesetId,
  comparedRulesetId,
}: {
  caseResult: CaseResult
  rulesetId: string
  comparedRulesetId: string
}) {
  const openInVisualizer = (targetRulesetId: string, label: string) => {
    setPendingScenario({
      rulesetId: targetRulesetId,
      inputs: caseResult.inputs,
      entities: caseResult.entities,
      label,
    })
    window.open(`/ruleset/${targetRulesetId}?sim=1`, '_blank')
  }

  const openBothInVisualizer = () => {
    openInVisualizer(
      rulesetId,
      `Sim case #${caseResult.scenarioId} (base)`
    )
    openInVisualizer(
      comparedRulesetId,
      `Sim case #${caseResult.scenarioId} (compared)`
    )
  }
  const [showAllNodes, setShowAllNodes] = useState(false)
  const diffPaths = new Set(caseResult.allDiffs.map((d) => d.path))
  const outcomePaths = new Set(caseResult.outcomeDiffs.map((d) => d.path))

  // Build a unified list of all paths, ordered:
  // 1. Outcome diffs first
  // 2. Other diffs
  // 3. Unchanged nodes (alphabetical)
  const allPathsSet = new Set([
    ...Object.keys(caseResult.baseResults),
    ...Object.keys(caseResult.editedResults),
  ])
  const outcomeDiffPaths = Array.from(allPathsSet)
    .filter((p) => outcomePaths.has(p))
    .sort()
  const otherDiffPaths = Array.from(allPathsSet)
    .filter((p) => diffPaths.has(p) && !outcomePaths.has(p))
    .sort()
  const unchangedPaths = Array.from(allPathsSet)
    .filter((p) => !diffPaths.has(p))
    .sort()
  const allPaths = [...outcomeDiffPaths, ...otherDiffPaths, ...unchangedPaths]

  const displayPaths = showAllNodes
    ? allPaths
    : [...outcomeDiffPaths, ...otherDiffPaths]

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Case #{caseResult.scenarioId}</h2>
        {caseResult.changed && (
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
            Changed
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1"
            onClick={() =>
              openInVisualizer(
                rulesetId,
                `Sim case #${caseResult.scenarioId} (base)`
              )
            }
          >
            <ExternalLink className="size-3" />
            Base
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1"
            onClick={() =>
              openInVisualizer(
                comparedRulesetId,
                `Sim case #${caseResult.scenarioId} (compared)`
              )
            }
          >
            <ExternalLink className="size-3" />
            Compared
          </Button>
          <Button
            size="sm"
            className="text-xs gap-1"
            onClick={openBothInVisualizer}
          >
            <ExternalLink className="size-3" />
            Open both
          </Button>
        </div>
      </div>

      {/* Outcome diffs — prominent summary */}
      {caseResult.outcomeDiffs.length > 0 && (
        <div className="border rounded-lg p-4 bg-amber-50/50 space-y-2">
          <h3 className="text-xs font-semibold text-amber-800 uppercase">
            Outcome Changes
          </h3>
          {caseResult.outcomeDiffs.map((d) => (
            <div key={d.path} className="flex items-center gap-3 text-sm">
              <NodeLink
                path={d.path}
                rulesetId={rulesetId}
                comparedRulesetId={comparedRulesetId}
                inputs={caseResult.inputs}
                entities={caseResult.entities}
                scenarioId={caseResult.scenarioId}
              />
              <span className="font-mono text-muted-foreground">
                {formatValue(d.baseValue)}
              </span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="font-mono font-medium">
                {formatValue(d.editedValue)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Inputs */}
      <details>
        <summary className="text-xs font-semibold text-muted-foreground uppercase cursor-pointer">
          Scenario Inputs
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono pl-4">
          {Object.entries(caseResult.inputs).map(([path, value]) => (
            <div key={path} className="flex gap-2">
              <span className="text-muted-foreground truncate">{path}</span>
              <span>{JSON.stringify(value)}</span>
            </div>
          ))}
        </div>
        {caseResult.entities &&
          Object.entries(caseResult.entities).map(([coll, rows]) => (
            <div key={coll} className="mt-2 pl-4">
              <span className="text-xs font-medium">{coll}</span>
              <span className="text-xs text-muted-foreground ml-1">
                ({rows.length} members)
              </span>
            </div>
          ))}
      </details>

      {/* Toggle */}
      <div className="flex items-center gap-2">
        <button
          className={cn(
            'px-3 py-1 text-xs rounded',
            !showAllNodes
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setShowAllNodes(false)}
        >
          Diffs only ({caseResult.allDiffs.length})
        </button>
        <button
          className={cn(
            'px-3 py-1 text-xs rounded',
            showAllNodes
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setShowAllNodes(true)}
        >
          All nodes ({allPaths.length})
        </button>
      </div>

      {/* Side-by-side results */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Path</th>
              <th className="text-left px-3 py-2 font-medium">Base</th>
              <th className="text-left px-3 py-2 font-medium">Edited</th>
              <th className="text-left px-3 py-2 font-medium w-20">Change</th>
            </tr>
          </thead>
          <tbody>
            {displayPaths.map((path) => {
              const baseVal = caseResult.baseResults[path]
              const editedVal = caseResult.editedResults[path]
              const isDiff = diffPaths.has(path)
              const diff = caseResult.allDiffs.find((d) => d.path === path)

              return (
                <tr
                  key={path}
                  className={cn('border-t', isDiff && 'bg-amber-50/50')}
                >
                  <td className="px-3 py-1.5 font-mono max-w-[200px]">
                    <NodeLink
                      path={path}
                      rulesetId={rulesetId}
                      comparedRulesetId={comparedRulesetId}
                      inputs={caseResult.inputs}
                      entities={caseResult.entities}
                      scenarioId={caseResult.scenarioId}
                    />
                  </td>
                  <td className="px-3 py-1.5 font-mono">
                    {formatValue(baseVal)}
                  </td>
                  <td className="px-3 py-1.5 font-mono">
                    {formatValue(editedVal)}
                  </td>
                  <td className="px-3 py-1.5">
                    {diff && (
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded',
                          diff.changeType === 'added'
                            ? 'bg-emerald-100 text-emerald-700'
                            : diff.changeType === 'removed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                        )}
                      >
                        {diff.changeType}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Clickable node path that opens the graph in a new browser tab. */
function NodeLink({
  path,
  rulesetId,
  comparedRulesetId,
  inputs,
  entities,
  scenarioId,
}: {
  path: string
  rulesetId: string
  comparedRulesetId: string
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  scenarioId: number
}) {
  const openNode = (targetRulesetId: string) => {
    setPendingScenario({
      rulesetId: targetRulesetId,
      inputs,
      entities,
      label: `Sim case #${scenarioId}`,
      focusNode: path,
    })
    window.open(`/ruleset/${targetRulesetId}?sim=1`, '_blank')
  }

  return (
    <span className="inline-flex items-center gap-1 group">
      <span className="truncate">{path}</span>
      <button
        className="opacity-0 group-hover:opacity-100 text-blue-600 hover:text-blue-800 shrink-0"
        onClick={() => openNode(rulesetId)}
        title={`Open in base (${rulesetId})`}
      >
        <ExternalLink className="size-2.5" />
      </button>
      <button
        className="opacity-0 group-hover:opacity-100 text-violet-600 hover:text-violet-800 shrink-0"
        onClick={() => openNode(comparedRulesetId)}
        title={`Open in compared (${comparedRulesetId})`}
      >
        <ExternalLink className="size-2.5" />
      </button>
    </span>
  )
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`
  return String(v)
}
