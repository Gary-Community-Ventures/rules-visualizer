import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { setPendingScenario } from '@/lib/simulation-bridge'
import {
  configureSimulation,
  runSimulation,
  listSimulations,
  getSimulationRun,
  getSimulationResults,
  updateSimulationRun,
  deleteSimulation,
  listPopulations,
  createPopulation,
  createPopulationFromRun,
  addCasesToPopulation,
  addCasesToPopulationFromRun,
  deletePopulationApi,
  type SimulationConfig,
  type SimulationRun,
  type CaseResult,
  type FromRunSpec,
  type NodeChangeStats,
  type Population,
  type PopulationCase,
} from '@/lib/api/simulation-api'
import {
  listRulesets,
  getRuleset,
  getRulesetDefaultValues,
  type RulesetSummary,
} from '@/lib/api/rules-api'
import type { Model } from '@/lib/model'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SimulationSettings } from '@/components/simulation-settings'
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
  X,
  Users,
  Check,
  Pencil,
} from 'lucide-react'

type View = 'config' | 'dashboard' | 'detail'

export function SimulatePage() {
  const { rulesetId } = useParams({ from: '/simulate/$rulesetId' })
  const navigate = useNavigate()
  const [view, setView] = useState<View>('config')
  const [config, setConfig] = useState<SimulationConfig | null>(null)
  const [comparedRulesetId, setComparedRulesetId] = useState('')
  const [availableRulesets, setAvailableRulesets] = useState<RulesetSummary[]>(
    []
  )
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Population state
  type CaseSource = 'generate' | 'population'
  const [caseSource, setCaseSource] = useState<CaseSource>('generate')
  const [selectedPopulationId, setSelectedPopulationId] = useState('')
  const [populations, setPopulations] = useState<Population[]>([])

  // Per-side overrides (path → value). Merged into every scenario's inputs
  // before execution on that side. Lets you compare A vs A+overrides for
  // what-if analysis, or A vs B with overrides on both for controlled diffs.
  const [baseOverrides, setBaseOverrides] = useState<Record<string, unknown>>(
    {}
  )
  const [comparedOverrides, setComparedOverrides] = useState<
    Record<string, unknown>
  >({})

  const loadPopulations = useCallback(() => {
    listPopulations()
      .then(setPopulations)
      .catch(() => setPopulations([]))
  }, [])

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

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const goToPopulation = useCallback(
    (id: string) => {
      navigate({
        to: '/populations/$populationId',
        params: { populationId: id },
      })
    },
    [navigate]
  )

  // Load config, rulesets, and populations on mount
  useEffect(() => {
    configureSimulation(rulesetId)
      .then(setConfig)
      .catch((e) => setError(e.message))
    listRulesets()
      .then((rs) =>
        setAvailableRulesets(rs.filter((r) => r.format === 'factGraph'))
      )
      .catch(() => {})
    loadPopulations()
  }, [rulesetId, loadPopulations])

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
        comparedRulesetId,
        {
          populationId:
            caseSource === 'population' ? selectedPopulationId : undefined,
          baseOverrides:
            Object.keys(baseOverrides).length > 0 ? baseOverrides : undefined,
          comparedOverrides:
            Object.keys(comparedOverrides).length > 0
              ? comparedOverrides
              : undefined,
        }
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

  const handleRenameRun = async (runId: string, name: string | null) => {
    try {
      const updated = await updateSimulationRun(rulesetId, runId, { name })
      loadRuns()
      if (activeRun?.id === runId) setActiveRun(updated)
    } catch (e) {
      setError((e as Error).message)
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
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-semibold shrink-0">
            Simulation — {rulesetId}
          </h1>
          {view !== 'config' && activeRun && (
            <>
              <span className="text-xs text-muted-foreground shrink-0">/</span>
              <span
                className="text-xs font-medium truncate"
                title={activeRun.name}
              >
                {activeRun.name ?? autoRunLabel(activeRun)}
              </span>
            </>
          )}
          {view === 'detail' && detailCase && (
            <span className="text-xs text-muted-foreground shrink-0">
              / Case #{detailCase.scenarioId}
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
        <div className="px-6 py-2 bg-red-50 text-red-700 text-xs border-b flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="size-3" />
          </button>
        </div>
      )}
      {toast && (
        <div className="px-6 py-2 bg-emerald-50 text-emerald-800 text-xs border-b flex items-center gap-2">
          <Check className="size-3" />
          <span className="flex-1">{toast}</span>
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
            onRenameRun={handleRenameRun}
            caseSource={caseSource}
            setCaseSource={setCaseSource}
            populations={populations}
            selectedPopulationId={selectedPopulationId}
            setSelectedPopulationId={setSelectedPopulationId}
            onDeletePopulation={async (id) => {
              try {
                await deletePopulationApi(id)
                loadPopulations()
                if (selectedPopulationId === id) setSelectedPopulationId('')
                setToast('Population deleted')
              } catch (e) {
                setError((e as Error).message)
              }
            }}
            onOpenPopulation={goToPopulation}
            onImportCsv={async (name, cases) => {
              try {
                const created = await createPopulation(name, cases)
                loadPopulations()
                setToast(
                  `Imported ${cases.length} cases into "${created.name}"`
                )
              } catch (e) {
                setError((e as Error).message)
              }
            }}
            baseRulesetId={rulesetId}
            baseOverrides={baseOverrides}
            setBaseOverrides={setBaseOverrides}
            comparedOverrides={comparedOverrides}
            setComparedOverrides={setComparedOverrides}
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
            populations={populations}
            onSavePopulationFromRun={async (
              name,
              fromRun,
              count,
              existingId
            ) => {
              const label = `${count.toLocaleString()} case${count !== 1 ? 's' : ''}`
              try {
                if (existingId) {
                  const pop = await addCasesToPopulationFromRun(
                    existingId,
                    fromRun
                  )
                  setToast(`Added ${label} to "${pop.name}"`)
                } else {
                  const pop = await createPopulationFromRun(name, fromRun)
                  setToast(`Created "${pop.name}" with ${label}`)
                }
                loadPopulations()
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          />
        )}
        {view === 'detail' && detailCase && activeRun && (
          <DetailView
            caseResult={detailCase}
            rulesetId={rulesetId}
            comparedRulesetId={activeRun.comparedRulesetId}
            baseOverrides={activeRun.baseOverrides}
            comparedOverrides={activeRun.comparedOverrides}
            populations={populations}
            onSaveToPopulation={async (name, existingId) => {
              const cases: PopulationCase[] = [
                {
                  id: detailCase.scenarioId,
                  inputs: detailCase.inputs,
                  entities: detailCase.entities,
                },
              ]
              try {
                if (existingId) {
                  const pop = await addCasesToPopulation(existingId, cases)
                  setToast(
                    `Added case #${detailCase.scenarioId} to "${pop.name}"`
                  )
                } else {
                  const pop = await createPopulation(name, cases)
                  setToast(
                    `Created "${pop.name}" with case #${detailCase.scenarioId}`
                  )
                }
                loadPopulations()
              } catch (e) {
                setError((e as Error).message)
              }
            }}
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
  onRenameRun,
  caseSource,
  setCaseSource,
  populations,
  selectedPopulationId,
  setSelectedPopulationId,
  onDeletePopulation,
  onOpenPopulation,
  onImportCsv,
  baseRulesetId,
  baseOverrides,
  setBaseOverrides,
  comparedOverrides,
  setComparedOverrides,
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
  onRenameRun: (id: string, name: string | null) => Promise<void>
  caseSource: 'generate' | 'population'
  setCaseSource: (s: 'generate' | 'population') => void
  populations: Population[]
  selectedPopulationId: string
  setSelectedPopulationId: (id: string) => void
  onDeletePopulation: (id: string) => Promise<void>
  onOpenPopulation: (id: string) => void
  onImportCsv: (name: string, cases: PopulationCase[]) => Promise<void>
  baseRulesetId: string
  baseOverrides: Record<string, unknown>
  setBaseOverrides: (o: Record<string, unknown>) => void
  comparedOverrides: Record<string, unknown>
  setComparedOverrides: (o: Record<string, unknown>) => void
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

        <div className="grid grid-cols-2 gap-3">
          <SidePanel
            label="Base"
            rulesetId={baseRulesetId}
            availableRulesets={null}
            overrides={baseOverrides}
            setOverrides={setBaseOverrides}
          />
          <SidePanel
            label="Compared"
            rulesetId={comparedRulesetId}
            setRulesetId={setComparedRulesetId}
            availableRulesets={availableRulesets}
            overrides={comparedOverrides}
            setOverrides={setComparedOverrides}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium">Case source</label>
          <div className="flex gap-2">
            <button
              className={cn(
                'px-3 py-1.5 text-xs rounded border',
                caseSource === 'generate'
                  ? 'bg-foreground text-background border-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setCaseSource('generate')}
            >
              Generate random
            </button>
            <button
              className={cn(
                'px-3 py-1.5 text-xs rounded border',
                caseSource === 'population'
                  ? 'bg-foreground text-background border-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setCaseSource('population')}
            >
              Saved population
            </button>
          </div>
          {caseSource === 'population' && (
            <select
              className="w-full h-9 text-sm border rounded px-3 bg-background"
              value={selectedPopulationId}
              onChange={(e) => setSelectedPopulationId(e.target.value)}
            >
              <option value="">Select a population...</option>
              {populations.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.cases.length} cases)
                </option>
              ))}
            </select>
          )}
          {caseSource === 'population' && (
            <div className="flex items-center gap-2">
              {populations.length === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  No populations yet.
                </p>
              )}
              <CsvImporter onImport={onImportCsv} />
            </div>
          )}
        </div>

        {caseSource === 'generate' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium">Seed</label>
              <NumberInput
                className="text-xs font-mono"
                parser={parseInt}
                value={config.seed}
                onChange={(v) => setConfig({ ...config, seed: v })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Case count</label>
              <NumberInput
                className="text-xs font-mono"
                parser={parseInt}
                value={config.caseCount}
                onChange={(v) => setConfig({ ...config, caseCount: v })}
              />
            </div>
          </div>
        )}

        <OutcomeNodeEditor config={config} setConfig={setConfig} />

        {caseSource === 'generate' && (
          <section className="rounded-xl border bg-background p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Simulation Settings</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Controls the values generated for each random case.
            </p>
            <div className="mt-4">
              <SimulationSettings config={config} setConfig={setConfig} />
            </div>
          </section>
        )}

        <Button
          onClick={onRun}
          disabled={
            isRunning ||
            !comparedRulesetId ||
            (caseSource === 'population' && !selectedPopulationId)
          }
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
              <PastRunRow
                key={run.id}
                run={run}
                onLoad={() => onLoadRun(run)}
                onDelete={() => onDeleteRun(run.id)}
                onRename={(name) => onRenameRun(run.id, name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Population management */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="size-3.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Populations</h2>
        </div>
        {populations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No populations yet. Run a simulation and save cases, or import a
            CSV.
          </p>
        ) : (
          <div className="space-y-1">
            {populations.map((pop) => (
              <div
                key={pop.id}
                className="flex items-center gap-3 px-3 py-2 border rounded hover:bg-muted/50 cursor-pointer group"
                onClick={() => onOpenPopulation(pop.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{pop.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {pop.cases.length} cases
                    {pop.description && ` — ${pop.description}`}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
                  Manage →
                </span>
                <button
                  className="p-1 text-muted-foreground hover:text-red-600"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (
                      confirm(
                        `Delete population "${pop.name}" and all ${pop.cases.length} cases?`
                      )
                    ) {
                      onDeletePopulation(pop.id)
                    }
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// --- CSV Importer ---

function CsvImporter({
  onImport,
}: {
  onImport: (name: string, cases: PopulationCase[]) => Promise<void>
}) {
  const [importing, setImporting] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    try {
      const text = await file.text()
      const lines = text.split('\n').filter((l) => l.trim())
      if (lines.length < 2)
        throw new Error('CSV must have a header row and at least one data row')

      const headers = lines[0].split(',').map((h) => h.trim())
      const cases: PopulationCase[] = []

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim())
        const inputs: Record<string, unknown> = {}

        for (let j = 0; j < headers.length; j++) {
          const header = headers[j]
          const raw = values[j] ?? ''
          if (!raw) continue

          // Auto-detect types
          if (raw === 'true' || raw === 'false') {
            inputs[header] = raw === 'true'
          } else if (!isNaN(Number(raw))) {
            inputs[header] = Number(raw)
          } else {
            inputs[header] = raw
          }
        }

        cases.push({ id: i - 1, inputs })
      }

      const name = file.name.replace(/\.csv$/i, '')
      await onImport(name, cases)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  return (
    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded cursor-pointer hover:bg-muted/50">
      {importing ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <ArrowLeft className="size-3 rotate-90" />
      )}
      {importing ? 'Importing...' : 'Import CSV'}
      <input
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
        disabled={importing}
      />
    </label>
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
  populations,
  onSavePopulationFromRun,
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
  populations: Population[]
  onSavePopulationFromRun: (
    name: string,
    fromRun: FromRunSpec,
    count: number,
    existingId?: string
  ) => Promise<void>
}) {
  const [selectedCases, setSelectedCases] = useState<Set<number>>(new Set())
  const [savingPop, setSavingPop] = useState(false)

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
      <NodeChangesPanel
        nodeChanges={summary.nodeChanges}
        outcomeNodes={run.config.outcomeNodes}
        totalCases={summary.totalCases}
      />

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

      {/* Save to population bar */}
      <SaveToPopulationBar
        selectedCount={selectedCases.size}
        totalCount={summary.totalCases}
        changedCount={summary.changedCases}
        unchangedCount={summary.unchangedCases}
        populations={populations}
        saving={savingPop}
        onSave={async (name, source, existingId) => {
          setSavingPop(true)
          try {
            const baseSpec = { rulesetId: run.rulesetId, runId: run.id }
            let fromRun: FromRunSpec
            let count: number
            if (source === 'selected') {
              const ids = Array.from(selectedCases)
              fromRun = { ...baseSpec, scenarioIds: ids }
              count = ids.length
            } else {
              fromRun = { ...baseSpec, filter: source }
              count =
                source === 'changed'
                  ? summary.changedCases
                  : source === 'unchanged'
                    ? summary.unchangedCases
                    : summary.totalCases
            }
            await onSavePopulationFromRun(name, fromRun, count, existingId)
            setSelectedCases(new Set())
          } catch {
            // error handled by parent
          }
          setSavingPop(false)
        }}
      />

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
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={
                    results.length > 0 &&
                    results.every((r) => selectedCases.has(r.scenarioId))
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedCases(
                        new Set(results.map((r) => r.scenarioId))
                      )
                    } else {
                      setSelectedCases(new Set())
                    }
                  }}
                />
              </th>
              <th className="text-left px-3 py-2 font-medium">#</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Outcome diffs</th>
              <th className="text-left px-3 py-2 font-medium">All diffs</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.scenarioId}
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => onDrillInto(r)}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={selectedCases.has(r.scenarioId)}
                    onChange={(e) => {
                      const next = new Set(selectedCases)
                      if (e.target.checked) next.add(r.scenarioId)
                      else next.delete(r.scenarioId)
                      setSelectedCases(next)
                    }}
                  />
                </td>
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
  baseOverrides,
  comparedOverrides,
  populations,
  onSaveToPopulation,
}: {
  caseResult: CaseResult
  rulesetId: string
  comparedRulesetId: string
  baseOverrides?: Record<string, unknown>
  comparedOverrides?: Record<string, unknown>
  populations: Population[]
  onSaveToPopulation: (name: string, existingId?: string) => Promise<void>
}) {
  const [showAddPop, setShowAddPop] = useState(false)
  const [addPopName, setAddPopName] = useState('')
  const [savingPop, setSavingPop] = useState(false)

  // Pick the right side's overrides based on which ruleset we're opening.
  // Same ruleset on both sides + only one has overrides → still picks the
  // correct side because the caller passes whether it's base or compared.
  const overridesFor = (
    targetRulesetId: string,
    side: 'base' | 'compared'
  ): Record<string, unknown> | undefined => {
    void targetRulesetId
    return side === 'base' ? baseOverrides : comparedOverrides
  }

  const openInVisualizer = (
    targetRulesetId: string,
    side: 'base' | 'compared',
    label: string
  ) => {
    const ov = overridesFor(targetRulesetId, side)
    setPendingScenario({
      rulesetId: targetRulesetId,
      inputs:
        ov && Object.keys(ov).length > 0
          ? { ...caseResult.inputs, ...ov }
          : caseResult.inputs,
      entities: caseResult.entities,
      label,
    })
    window.open(`/ruleset/${targetRulesetId}?sim=1`, '_blank')
  }

  const openBothInVisualizer = () => {
    openInVisualizer(
      rulesetId,
      'base',
      `Sim case #${caseResult.scenarioId} (base)`
    )
    openInVisualizer(
      comparedRulesetId,
      'compared',
      `Sim case #${caseResult.scenarioId} (compared)`
    )
  }
  const openNodeInGraph = (
    targetRulesetId: string,
    side: 'base' | 'compared',
    nodePath: string
  ) => {
    const ov = overridesFor(targetRulesetId, side)
    setPendingScenario({
      rulesetId: targetRulesetId,
      inputs:
        ov && Object.keys(ov).length > 0
          ? { ...caseResult.inputs, ...ov }
          : caseResult.inputs,
      entities: caseResult.entities,
      label: `Sim case #${caseResult.scenarioId}`,
      focusNode: nodePath,
    })
    window.open(`/ruleset/${targetRulesetId}?sim=1`, '_blank')
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
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">Case #{caseResult.scenarioId}</h2>
        {caseResult.changed && (
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
            Changed
          </span>
        )}
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <RulesetWithOverrides
            rulesetId={rulesetId}
            overrides={baseOverrides}
          />
          <span className="text-muted-foreground shrink-0">vs</span>
          <RulesetWithOverrides
            rulesetId={comparedRulesetId}
            overrides={comparedOverrides}
          />
        </div>
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 gap-1"
            onClick={() => setShowAddPop(!showAddPop)}
          >
            <Users className="size-3" />
            Save to population
          </Button>
          {showAddPop && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowAddPop(false)}
              />
              <div className="absolute top-full right-0 mt-1 z-20 bg-popover border rounded-lg shadow-lg p-3 w-64 space-y-2">
                {populations.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                      Add to existing
                    </label>
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {populations.map((p) => (
                        <button
                          key={p.id}
                          disabled={savingPop}
                          className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
                          onClick={async () => {
                            setSavingPop(true)
                            try {
                              await onSaveToPopulation('', p.id)
                            } finally {
                              setSavingPop(false)
                            }
                            setShowAddPop(false)
                          }}
                        >
                          {p.name} ({p.cases.length})
                        </button>
                      ))}
                    </div>
                    <div className="border-t my-1" />
                  </div>
                )}
                <div className="flex gap-1">
                  <Input
                    className="h-6 text-xs flex-1"
                    placeholder="New population name..."
                    value={addPopName}
                    onChange={(e) => setAddPopName(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="h-6 text-[10px]"
                    disabled={!addPopName.trim() || savingPop}
                    onClick={async () => {
                      setSavingPop(true)
                      try {
                        await onSaveToPopulation(addPopName.trim())
                      } finally {
                        setSavingPop(false)
                      }
                      setAddPopName('')
                      setShowAddPop(false)
                    }}
                  >
                    Create
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1"
            onClick={() =>
              openInVisualizer(
                rulesetId,
                'base',
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
                'compared',
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
              <span className="font-mono font-medium">{d.path}</span>
              <span className="font-mono text-muted-foreground group inline-flex items-center gap-1">
                {formatValue(d.baseValue)}
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  onClick={() => openNodeInGraph(rulesetId, 'base', d.path)}
                  title={`Open in ${rulesetId}`}
                >
                  <ExternalLink className="size-2.5" />
                </button>
              </span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="font-mono font-medium group inline-flex items-center gap-1">
                {formatValue(d.editedValue)}
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    openNodeInGraph(comparedRulesetId, 'compared', d.path)
                  }
                  title={`Open in ${comparedRulesetId}`}
                >
                  <ExternalLink className="size-2.5" />
                </button>
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
        <table className="w-full text-xs table-fixed">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-[30%] truncate">
                Path
              </th>
              <th className="text-left px-3 py-2 font-medium w-[25%] truncate">
                <RulesetWithOverrides
                  rulesetId={rulesetId}
                  overrides={baseOverrides}
                />
              </th>
              <th className="text-left px-3 py-2 font-medium w-[25%] truncate">
                <RulesetWithOverrides
                  rulesetId={comparedRulesetId}
                  overrides={comparedOverrides}
                />
              </th>
              <th className="text-right px-3 py-2 font-medium w-[20%]">
                Change
              </th>
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
                  <td className="px-3 py-1.5 font-mono truncate" title={path}>
                    {path}
                  </td>
                  <td className="px-3 py-1.5 font-mono">
                    <span className="inline-flex items-center gap-1 group">
                      {formatValue(baseVal)}
                      <button
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          openNodeInGraph(rulesetId, 'base', path)
                        }}
                        title={`Open in ${rulesetId}`}
                      >
                        <ExternalLink className="size-2.5" />
                      </button>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono">
                    <span className="inline-flex items-center gap-1 group">
                      {formatValue(editedVal)}
                      <button
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          openNodeInGraph(comparedRulesetId, 'compared', path)
                        }}
                        title={`Open in ${comparedRulesetId}`}
                      >
                        <ExternalLink className="size-2.5" />
                      </button>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {diff && (
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-mono',
                          diff.changeType === 'added'
                            ? 'bg-blue-100 text-blue-700'
                            : diff.changeType === 'removed'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-amber-100 text-amber-700'
                        )}
                      >
                        {diff.changeType === 'added'
                          ? 'added'
                          : diff.changeType === 'removed'
                            ? 'removed'
                            : typeof diff.baseValue === 'number' &&
                                typeof diff.editedValue === 'number'
                              ? `${diff.editedValue - diff.baseValue > 0 ? '+' : ''}${Math.round((diff.editedValue - diff.baseValue) * 100) / 100}`
                              : `→ ${formatValue(diff.editedValue)}`}
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
function SaveToPopulationBar({
  selectedCount,
  totalCount,
  changedCount,
  unchangedCount,
  populations,
  saving,
  onSave,
}: {
  selectedCount: number
  totalCount: number
  changedCount: number
  unchangedCount: number
  populations: Population[]
  saving: boolean
  onSave: (
    name: string,
    source: 'selected' | 'changed' | 'unchanged' | 'all',
    existingId?: string
  ) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('')
  const [existingId, setExistingId] = useState('')
  const [source, setSource] = useState<
    'selected' | 'changed' | 'unchanged' | 'all'
  >(selectedCount > 0 ? 'selected' : 'all')

  // Update source when selection changes
  useEffect(() => {
    if (selectedCount > 0) setSource('selected')
  }, [selectedCount])

  const sourceCount =
    source === 'selected'
      ? selectedCount
      : source === 'changed'
        ? changedCount
        : source === 'unchanged'
          ? unchangedCount
          : totalCount

  const canSave =
    sourceCount > 0 &&
    !saving &&
    (mode === 'new' ? name.trim() !== '' : existingId !== '')

  return (
    <div className="flex items-center gap-2 text-xs">
      {selectedCount > 0 && (
        <span className="text-muted-foreground">{selectedCount} selected</span>
      )}
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setOpen(!open)}
        >
          <Users className="size-3" />
          Save to population
        </Button>
        {open && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpen(false)}
            />
            <div className="absolute top-full left-0 mt-1 z-20 bg-popover border rounded-lg shadow-lg p-3 w-72 space-y-2">
              {/* Source */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Cases to save
                </label>
                <div className="flex gap-1">
                  {selectedCount > 0 && (
                    <button
                      className={cn(
                        'px-2 py-0.5 text-[10px] rounded border',
                        source === 'selected'
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground'
                      )}
                      onClick={() => setSource('selected')}
                    >
                      Selected ({selectedCount})
                    </button>
                  )}
                  {changedCount > 0 && (
                    <button
                      className={cn(
                        'px-2 py-0.5 text-[10px] rounded border',
                        source === 'changed'
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground'
                      )}
                      onClick={() => setSource('changed')}
                    >
                      Changed ({changedCount})
                    </button>
                  )}
                  {unchangedCount > 0 && (
                    <button
                      className={cn(
                        'px-2 py-0.5 text-[10px] rounded border',
                        source === 'unchanged'
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground'
                      )}
                      onClick={() => setSource('unchanged')}
                    >
                      Unchanged ({unchangedCount})
                    </button>
                  )}
                  <button
                    className={cn(
                      'px-2 py-0.5 text-[10px] rounded border',
                      source === 'all'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground'
                    )}
                    onClick={() => setSource('all')}
                  >
                    All ({totalCount})
                  </button>
                </div>
              </div>

              {/* Destination */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Destination
                </label>
                <div className="flex gap-1">
                  <button
                    className={cn(
                      'px-2 py-0.5 text-[10px] rounded border',
                      mode === 'new'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground'
                    )}
                    onClick={() => setMode('new')}
                  >
                    New population
                  </button>
                  {populations.length > 0 && (
                    <button
                      className={cn(
                        'px-2 py-0.5 text-[10px] rounded border',
                        mode === 'existing'
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground'
                      )}
                      onClick={() => setMode('existing')}
                    >
                      Existing
                    </button>
                  )}
                </div>
                {mode === 'new' ? (
                  <Input
                    className="h-7 text-xs"
                    placeholder="Population name..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                ) : (
                  <select
                    className="w-full h-7 text-xs border rounded px-2 bg-background"
                    value={existingId}
                    onChange={(e) => setExistingId(e.target.value)}
                  >
                    <option value="">Select...</option>
                    {populations.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.cases.length})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex gap-1.5 justify-end pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-[10px]"
                  disabled={!canSave}
                  onClick={async () => {
                    await onSave(
                      mode === 'new' ? name.trim() : '',
                      source,
                      mode === 'existing' ? existingId : undefined
                    )
                    setOpen(false)
                    setName('')
                  }}
                >
                  {saving
                    ? 'Saving...'
                    : `Save ${sourceCount} case${sourceCount !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Inline override count next to a ruleset id. Tooltip shows the overrides. */
function RulesetWithOverrides({
  rulesetId,
  overrides,
}: {
  rulesetId: string
  overrides?: Record<string, unknown>
}) {
  const count = overrides ? Object.keys(overrides).length : 0
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <span className="font-mono truncate">{rulesetId}</span>
      {count > 0 && (
        <span
          className="text-[10px] px-1 py-0.5 rounded shrink-0 bg-blue-100 text-blue-800"
          title={Object.entries(overrides ?? {})
            .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
            .join('\n')}
        >
          +{count}
        </span>
      )}
    </span>
  )
}

/** Past-runs row: editable name, auto-format subtitle, delete button. */
function PastRunRow({
  run,
  onLoad,
  onDelete,
  onRename,
}: {
  run: SimulationRun
  onLoad: () => void
  onDelete: () => void
  onRename: (name: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const actualCount = run.summary?.totalCases ?? run.config.caseCount
  const baseOvCount = run.baseOverrides
    ? Object.keys(run.baseOverrides).length
    : 0
  const compOvCount = run.comparedOverrides
    ? Object.keys(run.comparedOverrides).length
    : 0
  const sourceLabel = run.populationId
    ? `pop: ${run.populationName ?? run.populationId}`
    : 'random'

  const startEdit = () => {
    setDraft(run.name ?? '')
    setEditing(true)
  }
  const commit = async () => {
    const next = draft.trim()
    if (next === (run.name ?? '')) {
      setEditing(false)
      return
    }
    await onRename(next === '' ? null : next)
    setEditing(false)
  }

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 border rounded hover:bg-muted/50 group cursor-pointer"
      onClick={() => {
        if (!editing) onLoad()
      }}
    >
      <div className="flex-1 min-w-0">
        {/* Primary line: name (editable) OR auto-format with per-side badges */}
        <div className="flex items-center gap-2">
          {editing ? (
            <Input
              autoFocus
              className="h-6 text-xs flex-1"
              value={draft}
              placeholder="Run name (leave blank for auto)"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={commit}
            />
          ) : run.name ? (
            <span className="text-xs font-medium truncate">{run.name}</span>
          ) : (
            <div className="flex items-center gap-1.5 text-xs min-w-0">
              <RulesetWithOverrides
                rulesetId={run.rulesetId}
                overrides={run.baseOverrides}
              />
              <span className="text-muted-foreground shrink-0">vs</span>
              <RulesetWithOverrides
                rulesetId={run.comparedRulesetId}
                overrides={run.comparedOverrides}
              />
            </div>
          )}
        </div>

        {/* Subtitle: date + counts. If named, also surface auto-format. */}
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
          <span>
            {new Date(run.startedAt).toLocaleString()} —{' '}
            {actualCount.toLocaleString()} case
            {actualCount !== 1 ? 's' : ''}
          </span>
          {run.summary && (
            <span>
              · {run.summary.changedCases} changed (
              {Math.round(
                (run.summary.changedCases /
                  Math.max(1, run.summary.totalCases)) *
                  100
              )}
              %)
            </span>
          )}
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded',
              run.populationId
                ? 'bg-violet-100 text-violet-800'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {sourceLabel}
          </span>
          {run.name && (
            <span className="font-mono">
              {run.rulesetId}
              {baseOvCount > 0 && ` +${baseOvCount}`} vs {run.comparedRulesetId}
              {compOvCount > 0 && ` +${compOvCount}`}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {!editing && (
          <button
            className="p-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              startEdit()
            }}
            title={run.name ? 'Rename' : 'Set a name'}
          >
            <Pencil className="size-3" />
          </button>
        )}
        <button
          className="p-1 text-muted-foreground hover:text-red-600"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="Delete run"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  )
}

function NodeChangesPanel({
  nodeChanges,
  outcomeNodes,
  totalCases,
}: {
  nodeChanges: NodeChangeStats[]
  outcomeNodes: string[]
  totalCases: number
}) {
  const [scope, setScope] = useState<'outcomes' | 'all'>('outcomes')
  const outcomeSet = new Set(outcomeNodes)

  const filtered =
    scope === 'outcomes'
      ? nodeChanges.filter((nc) => outcomeSet.has(nc.path))
      : nodeChanges

  if (nodeChanges.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">
          Most changed {scope === 'outcomes' ? 'outcomes' : 'nodes'}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          across {totalCases.toLocaleString()} case
          {totalCases !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <div className="flex gap-1">
          <button
            className={cn(
              'px-2 py-0.5 text-[10px] rounded border',
              scope === 'outcomes'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setScope('outcomes')}
          >
            Outcomes (
            {nodeChanges.filter((nc) => outcomeSet.has(nc.path)).length})
          </button>
          <button
            className={cn(
              'px-2 py-0.5 text-[10px] rounded border',
              scope === 'all'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setScope('all')}
          >
            All nodes ({nodeChanges.length})
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No outcome-node changes — try "All nodes" to see intermediate-node
          diffs, or edit outcome nodes on the run config.
        </p>
      ) : (
        <div className="space-y-1">
          {filtered.slice(0, 10).map((nc) => {
            const pct = Math.round(
              (nc.timesChanged / Math.max(1, totalCases)) * 100
            )
            return (
              <div key={nc.path} className="flex items-center gap-3 text-xs">
                <span className="font-mono flex-1 truncate">{nc.path}</span>
                <span className="text-muted-foreground">
                  {nc.timesChanged.toLocaleString()} ({pct}%)
                </span>
                {nc.avgDelta !== undefined && (
                  <span
                    className="flex items-center gap-1"
                    title={`Average delta across ${nc.timesChanged.toLocaleString()} changed case${nc.timesChanged !== 1 ? 's' : ''}: edited − base = ${nc.avgDelta > 0 ? '+' : ''}${nc.avgDelta} on average`}
                  >
                    <span className="text-[10px] text-muted-foreground">
                      avg
                    </span>
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
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type OverridablePath = {
  path: string
  type: string
  enumOptions?: string[]
}

/**
 * Per-side block in the run config: ruleset (fixed for Base, dropdown for
 * Compared) + an editable overrides map applied to every scenario on that
 * side before execution.
 */
function SidePanel({
  label,
  rulesetId,
  setRulesetId,
  availableRulesets,
  overrides,
  setOverrides,
}: {
  label: string
  rulesetId: string
  setRulesetId?: (id: string) => void
  availableRulesets: RulesetSummary[] | null
  overrides: Record<string, unknown>
  setOverrides: (o: Record<string, unknown>) => void
}) {
  const overrideCount = Object.keys(overrides).length
  const [expanded, setExpanded] = useState(overrideCount > 0)

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase">
        {label}
      </div>
      {availableRulesets ? (
        <select
          className="w-full h-8 text-xs border rounded px-2 bg-background"
          value={rulesetId}
          onChange={(e) => setRulesetId?.(e.target.value)}
        >
          <option value="">Select a ruleset...</option>
          {availableRulesets.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="px-2 py-1.5 text-xs font-mono bg-muted/50 rounded">
          {rulesetId}
        </div>
      )}
      <button
        className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        onClick={() => setExpanded(!expanded)}
        disabled={!rulesetId}
      >
        <ChevronRight
          className={cn('size-3 transition-transform', expanded && 'rotate-90')}
        />
        Overrides ({overrideCount})
      </button>
      {expanded && rulesetId && (
        <OverridesEditor
          rulesetId={rulesetId}
          overrides={overrides}
          setOverrides={setOverrides}
        />
      )}
    </div>
  )
}

/**
 * Edit a path → value override map for one side of a comparison. Loads the
 * ruleset's model to expose typed inputs and a searchable path picker.
 * Skips collection-scoped paths (those with /*) for v1 — entity-level
 * override merging is a separate problem.
 */
function OverridesEditor({
  rulesetId,
  overrides,
  setOverrides,
}: {
  rulesetId: string
  overrides: Record<string, unknown>
  setOverrides: (o: Record<string, unknown>) => void
}) {
  const [search, setSearch] = useState('')
  const [model, setModel] = useState<Model | null>(null)
  const [defaults, setDefaults] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (!rulesetId) return
    let cancelled = false
    getRuleset(rulesetId)
      .then((m) => {
        if (!cancelled) setModel(m)
      })
      .catch(() => {})
    getRulesetDefaultValues(rulesetId)
      .then((v) => {
        if (!cancelled) setDefaults(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [rulesetId])

  const overridablePaths = useMemo<OverridablePath[]>(() => {
    if (!model) return []
    const out: OverridablePath[] = []
    for (const node of Object.values(model.nodes)) {
      const c = node.content
      if (c.format !== 'factGraph') continue
      // Skip collection structural nodes and collection-scoped paths
      if (c.type === 'writable') {
        if (c.typeName === 'Collection' || c.typeName === 'CollectionItem')
          continue
      }
      if (c.path.includes('/*')) continue
      const type = c.type === 'writable' ? c.typeName : (c.dataType ?? 'String')
      out.push({ path: c.path, type, enumOptions: c.enumOptions })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }, [model])

  const overrideKeys = Object.keys(overrides)
  const overrideSet = new Set(overrideKeys)
  const filtered = search
    ? overridablePaths
        .filter(
          (p) =>
            p.path.toLowerCase().includes(search.toLowerCase()) &&
            !overrideSet.has(p.path)
        )
        .slice(0, 15)
    : []

  const lookup = useMemo(() => {
    const m = new Map<string, OverridablePath>()
    for (const p of overridablePaths) m.set(p.path, p)
    return m
  }, [overridablePaths])

  return (
    <div className="space-y-1.5">
      {overrideKeys.length > 0 && (
        <div className="space-y-1">
          {overrideKeys.map((path) => {
            const meta = lookup.get(path)
            const current = defaults[path]
            return (
              <div key={path} className="flex items-center gap-1.5 text-xs">
                <span className="font-mono flex-1 truncate" title={path}>
                  {path}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({meta?.type ?? '?'})
                </span>
                {current !== undefined && (
                  <span
                    className="text-[10px] text-muted-foreground font-mono shrink-0"
                    title="Default value (empty-inputs execution)"
                  >
                    was {formatDefaultValue(current)} →
                  </span>
                )}
                <OverrideValueInput
                  type={meta?.type ?? 'String'}
                  enumOptions={meta?.enumOptions}
                  value={overrides[path]}
                  onChange={(v) => setOverrides({ ...overrides, [path]: v })}
                />
                <button
                  className="text-muted-foreground hover:text-red-600 shrink-0"
                  onClick={() => {
                    const next = { ...overrides }
                    delete next[path]
                    setOverrides(next)
                  }}
                  title="Remove override"
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <Input
        className="h-7 text-xs font-mono"
        placeholder={model ? 'Search paths to override...' : 'Loading model...'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={!model}
      />
      {search && filtered.length > 0 && (
        <div className="border rounded max-h-32 overflow-y-auto bg-background">
          {filtered.map((p) => {
            const current = defaults[p.path]
            return (
              <button
                key={p.path}
                className="w-full text-left px-2 py-1 text-xs font-mono hover:bg-muted flex items-center gap-2"
                onClick={() => {
                  // Pre-seed with the current default value so the user can
                  // tweak from a known baseline instead of starting at 0/blank.
                  const seed =
                    current !== undefined && isOverrideSeedSafe(p.type, current)
                      ? current
                      : defaultOverrideValue(p.type)
                  setOverrides({ ...overrides, [p.path]: seed })
                  setSearch('')
                }}
              >
                <span className="flex-1 truncate">{p.path}</span>
                {current !== undefined && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    = {formatDefaultValue(current)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {p.type}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {search && filtered.length === 0 && model && (
        <p className="text-[10px] text-muted-foreground px-1">
          No matching paths
        </p>
      )}
    </div>
  )
}

function defaultOverrideValue(type: string): unknown {
  if (type === 'Boolean') return false
  if (
    type === 'Dollar' ||
    type === 'Int' ||
    type === 'Short' ||
    type === 'Byte' ||
    type === 'Rational'
  )
    return 0
  return ''
}

/**
 * Numeric input that keeps a local string draft so the user can backspace
 * to empty without the controlled `value` immediately re-rendering `0`.
 * Parent state still gets `0` when the field is empty; the input stays
 * visually empty until the user types again.
 */
function NumberInput({
  value,
  onChange,
  className,
  parser = parseFloat,
}: {
  value: number
  onChange: (v: number) => void
  className?: string
  parser?: (s: string) => number
}) {
  const [draft, setDraft] = useState<string>(String(value))

  // Resync draft from external value when it's changed elsewhere
  // (sibling input, config reload, etc.). Avoid trampling the user's
  // own typing — `parser(draft) === value` means we're already in sync;
  // `draft === '' && value === 0` is the "user just cleared the field"
  // intermediate state.
  useEffect(() => {
    const parsed = parser(draft)
    const sameValue = !isNaN(parsed) && parsed === value
    const editingToZero = draft === '' && value === 0
    if (!sameValue && !editingToZero) setDraft(String(value))
  }, [value, draft, parser])

  return (
    <Input
      className={className}
      type="number"
      value={draft}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw === '') {
          onChange(0)
          return
        }
        const parsed = parser(raw)
        if (!isNaN(parsed)) onChange(parsed)
      }}
    />
  )
}

function OverrideValueInput({
  type,
  enumOptions,
  value,
  onChange,
}: {
  type: string
  enumOptions?: string[]
  value: unknown
  onChange: (v: unknown) => void
}) {
  const isNumeric =
    type === 'Dollar' || type === 'Int' || type === 'Short' || type === 'Byte'

  if (type === 'Boolean') {
    return (
      <select
        className="h-6 text-xs border rounded px-1 bg-background"
        value={value === true ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    )
  }

  if (type === 'Enum' && enumOptions && enumOptions.length > 0) {
    return (
      <select
        className="h-6 text-xs border rounded px-1 bg-background"
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {enumOptions.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  if (isNumeric) {
    return (
      <Input
        className="h-6 w-24 text-xs font-mono"
        type="number"
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') onChange(null)
          else {
            const n = Number(raw)
            onChange(isNaN(n) ? null : n)
          }
        }}
      />
    )
  }

  return (
    <Input
      className="h-6 w-32 text-xs font-mono"
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function OutcomeNodeEditor({
  config,
  setConfig,
}: {
  config: SimulationConfig
  setConfig: (c: SimulationConfig) => void
}) {
  const { rulesetId } = useParams({ from: '/simulate/$rulesetId' })
  const [search, setSearch] = useState('')
  const [allPaths, setAllPaths] = useState<string[]>([])

  // Load all node paths from the model
  useEffect(() => {
    getRuleset(rulesetId)
      .then((model) => {
        const paths = Object.values(model.nodes)
          .filter((n) => n.content.type !== 'entity')
          .map((n) => n.name)
          .sort()
        setAllPaths(paths)
      })
      .catch(() => {})
  }, [rulesetId])

  const outcomeSet = new Set(config.outcomeNodes)
  const filtered = search
    ? allPaths.filter(
        (p) =>
          p.toLowerCase().includes(search.toLowerCase()) && !outcomeSet.has(p)
      )
    : []

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">
        Outcome nodes ({config.outcomeNodes.length})
      </label>
      <div className="flex flex-wrap gap-1">
        {config.outcomeNodes.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-100 text-violet-800 text-[10px] font-mono rounded cursor-pointer hover:bg-violet-200"
            onClick={() =>
              setConfig({
                ...config,
                outcomeNodes: config.outcomeNodes.filter((n) => n !== p),
              })
            }
            title="Click to remove"
          >
            {p}
            <X className="size-2.5" />
          </span>
        ))}
      </div>
      <Input
        className="h-7 text-xs font-mono"
        placeholder="Search nodes to add..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search && filtered.length > 0 && (
        <div className="border rounded max-h-32 overflow-y-auto bg-background">
          {filtered.slice(0, 15).map((p) => (
            <button
              key={p}
              className="w-full text-left px-2 py-1 text-xs font-mono hover:bg-muted"
              onClick={() => {
                setConfig({
                  ...config,
                  outcomeNodes: [...config.outcomeNodes, p],
                })
                setSearch('')
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      {search && filtered.length === 0 && (
        <p className="text-[10px] text-muted-foreground px-1">
          No matching nodes
        </p>
      )}
    </div>
  )
}

function autoRunLabel(run: SimulationRun): string {
  const baseN = run.baseOverrides ? Object.keys(run.baseOverrides).length : 0
  const compN = run.comparedOverrides
    ? Object.keys(run.comparedOverrides).length
    : 0
  const left = baseN > 0 ? `${run.rulesetId} +${baseN}` : run.rulesetId
  const right =
    compN > 0 ? `${run.comparedRulesetId} +${compN}` : run.comparedRulesetId
  return `${left} vs ${right}`
}

/** Short rendering of a default value for the override hints. Stays
 *  one-line; arrays/objects collapse to a brief summary. */
function formatDefaultValue(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    return v.length > 24 ? `${v.slice(0, 24)}…` : v
  }
  if (Array.isArray(v)) return `[${v.length}]`
  return typeof v
}

/** Whether the executor-returned default value can be safely fed back into
 *  the override input. Numbers/booleans/enums-as-strings are fine; arrays
 *  (collection aggregates) and Rational strings like "1/5" are not — the
 *  input would silently coerce or reject them. */
function isOverrideSeedSafe(type: string, value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return false
  switch (type) {
    case 'Boolean':
      return typeof value === 'boolean'
    case 'Dollar':
    case 'Int':
    case 'Short':
    case 'Byte':
      return typeof value === 'number'
    case 'Enum':
      return typeof value === 'string'
    case 'String':
      return typeof value === 'string'
    default:
      return false
  }
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`
  return String(v)
}
