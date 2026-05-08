import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  addCasesToPopulation,
  configureSimulation,
  getPopulationById,
  removeCaseFromPopulation,
  type CollectionConfig,
  type FieldConfig,
  type Population,
  type PopulationCase,
  type SimulationConfig,
} from '@/lib/api/simulation-api'
import {
  listRulesets,
  type RulesetSummary,
} from '@/lib/api/rules-api'
import { setPendingScenario } from '@/lib/simulation-bridge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function PopulationPage() {
  const { populationId } = useParams({ from: '/populations/$populationId' })
  const navigate = useNavigate()

  const [population, setPopulation] = useState<Population | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)
  const [rulesets, setRulesets] = useState<RulesetSummary[]>([])
  const [previewRulesetId, setPreviewRulesetId] = useState('')
  const [expandedCaseId, setExpandedCaseId] = useState<number | null>(null)

  const reload = useCallback(() => {
    return getPopulationById(populationId)
      .then((p) => {
        setPopulation(p)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [populationId])

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))

    listRulesets()
      .then((rs) => {
        const fg = rs.filter((r) => r.format === 'factGraph')
        setRulesets(fg)
        if (fg.length > 0) setPreviewRulesetId(fg[0].id)
      })
      .catch(() => {})
  }, [reload])

  useEffect(() => {
    if (population) {
      document.title = `${population.name} — Population`
    }
  }, [population])

  const openCaseInVisualizer = (
    rulesetId: string,
    caseRow: PopulationCase
  ) => {
    setPendingScenario({
      rulesetId,
      inputs: caseRow.inputs,
      entities: caseRow.entities,
      label: `${population?.name ?? 'population'} — case #${caseRow.id}`,
    })
    window.open(`/ruleset/${rulesetId}?sim=1`, '_blank')
  }

  const handleRemoveCase = async (caseId: number) => {
    try {
      const updated = await removeCaseFromPopulation(populationId, caseId)
      setPopulation(updated)
      if (expandedCaseId === caseId) setExpandedCaseId(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleAddCase = async (newCase: PopulationCase) => {
    try {
      const updated = await addCasesToPopulation(populationId, [newCase])
      setPopulation(updated)
      setShowManualForm(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading population...
      </div>
    )
  }

  if (!population) {
    return (
      <div className="p-6 text-sm text-red-700">
        {error ?? 'Population not found'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => navigate({ to: '/' })}
        >
          <ArrowLeft className="size-4" />
        </button>
        <Users className="size-4 text-muted-foreground" />
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-semibold truncate">{population.name}</h1>
          <span className="text-xs text-muted-foreground shrink-0">
            {population.cases.length} case
            {population.cases.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          className="text-xs gap-1"
          onClick={() => setShowManualForm(true)}
        >
          <Plus className="size-3" />
          Add case
        </Button>
      </div>

      {error && (
        <div className="px-6 py-2 bg-red-50 text-red-700 text-xs border-b flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          {/* Description */}
          <div className="space-y-1">
            {population.description && (
              <p className="text-xs text-muted-foreground">
                {population.description}
              </p>
            )}
            <div className="text-[10px] text-muted-foreground">
              Created {new Date(population.createdAt).toLocaleString()} ·
              Updated {new Date(population.updatedAt).toLocaleString()}
            </div>
          </div>

          {/* Open-in-ruleset selector — applies to all "open" buttons */}
          {rulesets.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <label className="text-muted-foreground">
                Open cases in:
              </label>
              <select
                className="h-7 text-xs border rounded px-2 bg-background"
                value={previewRulesetId}
                onChange={(e) => setPreviewRulesetId(e.target.value)}
              >
                {rulesets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Cases */}
          {population.cases.length === 0 ? (
            <div className="border rounded-lg p-8 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                This population has no cases yet.
              </p>
              <Button
                size="sm"
                className="text-xs gap-1"
                onClick={() => setShowManualForm(true)}
              >
                <Plus className="size-3" />
                Add the first case
              </Button>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-12">#</th>
                    <th className="text-left px-3 py-2 font-medium">Inputs</th>
                    <th className="text-left px-3 py-2 font-medium w-24">
                      Members
                    </th>
                    <th className="px-3 py-2 w-32" />
                  </tr>
                </thead>
                <tbody>
                  {population.cases.map((c) => {
                    const isExpanded = expandedCaseId === c.id
                    const inputCount = Object.keys(c.inputs).length
                    const collSummary = c.entities
                      ? Object.entries(c.entities)
                          .map(([k, v]) => `${k}: ${v.length}`)
                          .join(', ')
                      : '—'
                    return (
                      <Fragment key={c.id}>
                        <tr
                          className={cn(
                            'border-t hover:bg-muted/30 cursor-pointer',
                            isExpanded && 'bg-muted/30'
                          )}
                          onClick={() =>
                            setExpandedCaseId(isExpanded ? null : c.id)
                          }
                        >
                          <td className="px-3 py-2 font-mono">{c.id}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {inputCount} field{inputCount !== 1 ? 's' : ''}
                            {c.name && (
                              <span className="ml-2 text-foreground">
                                {c.name}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono">
                            {collSummary}
                          </td>
                          <td
                            className="px-3 py-2 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-1">
                              {previewRulesetId && (
                                <button
                                  className="p-1 text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    openCaseInVisualizer(previewRulesetId, c)
                                  }
                                  title={`Open in ${previewRulesetId}`}
                                >
                                  <ExternalLink className="size-3" />
                                </button>
                              )}
                              <button
                                className="p-1 text-muted-foreground hover:text-red-600"
                                onClick={() => handleRemoveCase(c.id)}
                                title="Remove case"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t bg-muted/10">
                            <td colSpan={4} className="px-6 py-3">
                              <CaseInputs caseRow={c} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Manual case form modal */}
      {showManualForm && (
        <ManualCaseForm
          rulesets={rulesets}
          existingIds={population.cases.map((c) => c.id)}
          onCancel={() => setShowManualForm(false)}
          onSubmit={handleAddCase}
        />
      )}
    </div>
  )
}

// --- Case inputs (expanded row) ---

function CaseInputs({ caseRow }: { caseRow: PopulationCase }) {
  return (
    <div className="space-y-3">
      {Object.keys(caseRow.inputs).length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase">
            Scalar inputs
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
            {Object.entries(caseRow.inputs).map(([path, value]) => (
              <div key={path} className="flex gap-2 min-w-0">
                <span className="text-muted-foreground truncate">{path}</span>
                <span className="shrink-0">{JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {caseRow.entities &&
        Object.entries(caseRow.entities).map(([coll, rows]) => (
          <div key={coll} className="space-y-1">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase">
              {coll} ({rows.length})
            </div>
            <div className="space-y-1.5">
              {rows.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded border bg-background px-3 py-1.5"
                >
                  <div className="text-[10px] text-muted-foreground mb-0.5">
                    member {idx}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
                    {Object.entries(row).map(([path, value]) => (
                      <div key={path} className="flex gap-2 min-w-0">
                        <span className="text-muted-foreground truncate">
                          {path}
                        </span>
                        <span className="shrink-0">
                          {JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}

// --- Manual case form ---

function ManualCaseForm({
  rulesets,
  existingIds,
  onCancel,
  onSubmit,
}: {
  rulesets: RulesetSummary[]
  existingIds: number[]
  onCancel: () => void
  onSubmit: (c: PopulationCase) => Promise<void>
}) {
  const [schemaRulesetId, setSchemaRulesetId] = useState(
    rulesets[0]?.id ?? ''
  )
  const [config, setConfig] = useState<SimulationConfig | null>(null)
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [name, setName] = useState('')
  const [scalars, setScalars] = useState<Record<string, unknown>>({})
  const [collections, setCollections] = useState<
    Record<string, Record<string, unknown>[]>
  >({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Load schema when ruleset changes
  useEffect(() => {
    if (!schemaRulesetId) return
    setLoadingSchema(true)
    setFormError(null)
    configureSimulation(schemaRulesetId)
      .then((c) => {
        setConfig(c)
        // Seed defaults
        const seedScalars: Record<string, unknown> = {}
        for (const f of c.scalarFields) {
          seedScalars[f.path] = defaultValue(f)
        }
        setScalars(seedScalars)
        const seedCollections: Record<string, Record<string, unknown>[]> = {}
        for (const coll of c.collections) {
          seedCollections[coll.collectionPath] = [emptyMember(coll)]
        }
        setCollections(seedCollections)
      })
      .catch((e: Error) => setFormError(e.message))
      .finally(() => setLoadingSchema(false))
  }, [schemaRulesetId])

  const nextId = useMemo(() => {
    return existingIds.length === 0 ? 0 : Math.max(...existingIds) + 1
  }, [existingIds])

  const submit = async () => {
    setSubmitting(true)
    setFormError(null)
    try {
      const filteredScalars = Object.fromEntries(
        Object.entries(scalars).filter(([, v]) => v !== '' && v !== null)
      )
      const filteredCollections: Record<string, Record<string, unknown>[]> = {}
      for (const [collPath, rows] of Object.entries(collections)) {
        if (rows.length === 0) continue
        filteredCollections[collPath] = rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([, v]) => v !== '' && v !== null)
          )
        )
      }

      const newCase: PopulationCase = {
        id: nextId,
        name: name.trim() || undefined,
        inputs: filteredScalars,
        entities:
          Object.keys(filteredCollections).length > 0
            ? filteredCollections
            : undefined,
      }

      await onSubmit(newCase)
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center gap-3 shrink-0">
          <h2 className="text-sm font-semibold">Add manual case</h2>
          <div className="flex-1" />
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={onCancel}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Schema source */}
          <div className="space-y-1">
            <label className="text-xs font-medium">Schema source</label>
            <select
              className="w-full h-8 text-xs border rounded px-2 bg-background"
              value={schemaRulesetId}
              onChange={(e) => setSchemaRulesetId(e.target.value)}
            >
              <option value="">Pick a ruleset to load input fields...</option>
              {rulesets.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              The fields below come from this ruleset's input schema. The case
              works against any compatible ruleset.
            </p>
          </div>

          {/* Optional name */}
          <div className="space-y-1">
            <label className="text-xs font-medium">
              Case name (optional)
            </label>
            <Input
              className="h-8 text-xs"
              placeholder="e.g. Single parent + 2 kids in poverty"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {formError && (
            <div className="px-3 py-2 bg-red-50 text-red-700 text-xs rounded">
              {formError}
            </div>
          )}

          {loadingSchema && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading schema...
            </div>
          )}

          {!loadingSchema && config && (
            <>
              {/* Scalar fields */}
              {config.scalarFields.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Scalar inputs
                  </div>
                  <div className="border rounded divide-y">
                    {config.scalarFields.map((f) => (
                      <FieldInput
                        key={f.path}
                        field={f}
                        value={scalars[f.path]}
                        onChange={(v) =>
                          setScalars({ ...scalars, [f.path]: v })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Collections */}
              {config.collections.map((coll) => (
                <CollectionEditor
                  key={coll.collectionPath}
                  config={coll}
                  rows={collections[coll.collectionPath] ?? []}
                  onChange={(rows) =>
                    setCollections({
                      ...collections,
                      [coll.collectionPath]: rows,
                    })
                  }
                />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-end gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs"
            disabled={!config || submitting}
            onClick={submit}
          >
            {submitting ? 'Adding...' : 'Add case'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Collection editor ---

function CollectionEditor({
  config,
  rows,
  onChange,
}: {
  config: CollectionConfig
  rows: Record<string, unknown>[]
  onChange: (rows: Record<string, unknown>[]) => void
}) {
  const addRow = () => onChange([...rows, emptyMember(config)])
  const removeRow = (idx: number) =>
    onChange(rows.filter((_, i) => i !== idx))
  const updateRow = (idx: number, path: string, value: unknown) => {
    const next = [...rows]
    next[idx] = { ...next[idx], [path]: value }
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase">
          {config.collectionPath} ({rows.length})
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] gap-1"
          onClick={addRow}
        >
          <Plus className="size-2.5" />
          Add member
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground px-2">
          No members. Click "Add member" to create one.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="border rounded overflow-hidden"
            >
              <div className="bg-muted/30 px-3 py-1 flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">
                  member {idx}
                </span>
                <div className="flex-1" />
                <button
                  className="text-muted-foreground hover:text-red-600"
                  onClick={() => removeRow(idx)}
                  title="Remove member"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              <div className="divide-y">
                {config.fields.map((f) => (
                  <FieldInput
                    key={f.path}
                    field={f}
                    value={row[f.path]}
                    onChange={(v) => updateRow(idx, f.path, v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Single field input ---

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldConfig
  value: unknown
  onChange: (v: unknown) => void
}) {
  const isNumeric =
    field.type === 'Dollar' ||
    field.type === 'Int' ||
    field.type === 'Short' ||
    field.type === 'Byte'

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span
        className="text-xs font-mono w-64 truncate shrink-0"
        title={field.path}
      >
        {field.path}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        ({field.type})
      </span>
      <div className="flex-1 flex justify-end">
        {field.type === 'Boolean' ? (
          <select
            className="h-6 text-xs border rounded px-1 bg-background"
            value={value === true ? 'true' : value === false ? 'false' : ''}
            onChange={(e) => {
              const v = e.target.value
              onChange(v === '' ? null : v === 'true')
            }}
          >
            <option value="">—</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : field.type === 'Enum' ? (
          <select
            className="h-6 text-xs border rounded px-1 bg-background"
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) =>
              onChange(e.target.value === '' ? null : e.target.value)
            }
          >
            <option value="">—</option>
            {field.enumOptions?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : isNumeric ? (
          <Input
            className="h-6 w-32 text-xs font-mono"
            type="number"
            placeholder={
              field.min !== undefined && field.max !== undefined
                ? `${field.min}–${field.max}`
                : ''
            }
            value={
              value === undefined || value === null ? '' : String(value)
            }
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') onChange(null)
              else {
                const n = Number(raw)
                onChange(isNaN(n) ? null : n)
              }
            }}
          />
        ) : (
          <Input
            className="h-6 w-48 text-xs font-mono"
            value={
              value === undefined || value === null ? '' : String(value)
            }
            onChange={(e) =>
              onChange(e.target.value === '' ? null : e.target.value)
            }
          />
        )}
      </div>
    </div>
  )
}

// --- Helpers ---

function defaultValue(f: FieldConfig): unknown {
  switch (f.type) {
    case 'Boolean':
      return null
    case 'Enum':
      return null
    case 'Dollar':
    case 'Int':
    case 'Short':
    case 'Byte':
      return null
    default:
      return null
  }
}

function emptyMember(coll: CollectionConfig): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const f of coll.fields) row[f.path] = defaultValue(f)
  return row
}
