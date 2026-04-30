import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { formatDisplayValue } from '@/lib/format'
import { useMainContext } from '@/context'
import {
  getNodePath,
  getCollectionOverridableFields,
  getCollectionDisplayName,
} from '@/context/model-context'
import { EntityEditor } from './execution-panel'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Play,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Plus,
  Copy,
  Check,
  X,
  CheckCircle,
  XCircle,
  ArrowRight,
  Pencil,
  Filter,
  FileText,
  ClipboardCopy,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  listTests,
  createTest,
  updateTest,
  deleteTest,
  runTests,
  type TestCase,
  type TestRunResult,
} from '@/lib/api/rules-api'

export function TestPanel() {
  const {
    model,
    inputOverrides,
    entityData,
    executionResults,
    setInputOverride,
    setEntityData,
    setRightBar,
    asOfDate,
    setActiveTest,
    selectedNodes,
  } = useMainContext()

  const [tests, setTests] = useState<TestCase[]>([])
  const [results, setResults] = useState<TestRunResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [expandedTest, setExpandedTest] = useState<string | null>(null)
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterByGraph, setFilterByGraph] = useState(true)

  const loadTests = useCallback(() => {
    listTests(model.id)
      .then(setTests)
      .catch(() => setTests([]))
  }, [model.id])

  useEffect(() => {
    loadTests()
  }, [loadTests])

  // Clear graph state when panel closes
  useEffect(() => {
    return () => setActiveTest(null)
  }, [setActiveTest])

  // When a test is selected, load its state onto the graph
  useEffect(() => {
    if (!selectedTestId) {
      setActiveTest(null)
      return
    }
    const test = tests.find((t) => t.id === selectedTestId)
    const result = results.find((r) => r.testId === selectedTestId)
    if (test && result) {
      setActiveTest({
        expectations: result.expectations,
        inputs: { ...(test.inputs ?? {}), ...(test.overrides ?? {}) },
        computedValues: result.computedValues ?? {},
      })
    } else if (test) {
      setActiveTest({
        expectations: {},
        inputs: { ...(test.inputs ?? {}), ...(test.overrides ?? {}) },
        computedValues: {},
      })
    } else {
      setActiveTest(null)
    }
  }, [selectedTestId, tests, results, setActiveTest])

  const handleRunAll = async () => {
    setIsRunning(true)
    setError(null)
    try {
      const r = await runTests(model.id)
      setResults(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsRunning(false)
    }
  }

  const handleRunOne = async (testId: string) => {
    setIsRunning(true)
    setError(null)
    try {
      const r = await runTests(model.id, [testId])
      setResults((prev) => {
        const next = prev.filter((p) => p.testId !== testId)
        return [...next, ...r]
      })
      setSelectedTestId(testId)
      setExpandedTest(testId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsRunning(false)
    }
  }

  const handleSaveAsTest = async () => {
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

    const expect: Record<string, unknown> = {}
    if (executionResults) {
      for (const [nodeId, result] of Object.entries(executionResults)) {
        const node = model.nodes[nodeId]
        if (!node) continue
        const path = getNodePath(node.content)
        if (path) expect[path] = result.value
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

    try {
      const newTest = await createTest(model.id, {
        name: `Test ${tests.length + 1}`,
        asOf: model.format === 'rac' ? asOfDate : undefined,
        inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
        entities,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        expect,
      })
      setTests((prev) => [...prev, newTest])
      setExpandedTest(newTest.id)
      setSelectedTestId(newTest.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleNewTest = async () => {
    try {
      const newTest = await createTest(model.id, {
        name: `Test ${tests.length + 1}`,
        asOf: model.format === 'rac' ? asOfDate : undefined,
        inputs: {},
        expect: {},
      })
      setTests((prev) => [...prev, newTest])
      setExpandedTest(newTest.id)
      setSelectedTestId(newTest.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleDuplicate = async (test: TestCase) => {
    try {
      const newTest = await createTest(model.id, {
        name: `${test.name} (copy)`,
        asOf: test.asOf,
        inputs: test.inputs,
        entities: test.entities,
        overrides: test.overrides,
        expect: test.expect,
      })
      setTests((prev) => [...prev, newTest])
      setExpandedTest(newTest.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleDelete = async (testId: string) => {
    try {
      await deleteTest(model.id, testId)
      setTests((prev) => prev.filter((t) => t.id !== testId))
      setResults((prev) => prev.filter((r) => r.testId !== testId))
      if (selectedTestId === testId) setSelectedTestId(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleUpdateTest = async (
    testId: string,
    updates: Partial<TestCase>
  ) => {
    try {
      const updated = await updateTest(model.id, testId, updates)
      setTests((prev) => prev.map((t) => (t.id === testId ? updated : t)))
      // Auto-rerun the updated test
      handleRunOne(testId)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleLoadIntoExecution = (test: TestCase) => {
    for (const [path, value] of Object.entries(test.inputs ?? {})) {
      for (const [nodeId, node] of Object.entries(model.nodes)) {
        if (getNodePath(node.content) === path) {
          setInputOverride(
            nodeId,
            typeof value === 'string' ? value : JSON.stringify(value)
          )
          break
        }
      }
    }
    for (const [path, value] of Object.entries(test.overrides ?? {})) {
      for (const [nodeId, node] of Object.entries(model.nodes)) {
        if (getNodePath(node.content) === path) {
          setInputOverride(
            nodeId,
            typeof value === 'string' ? value : JSON.stringify(value)
          )
          break
        }
      }
    }
    if (test.entities) {
      const ed: Record<string, Record<string, string>[]> = {}
      for (const [entity, rows] of Object.entries(test.entities)) {
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
    setRightBar('execution')
  }

  // Per-member fields by collection. Includes inputs and overridable
  // derived/constant fields — same set the in-graph collection editor uses.
  const collectionFields = useMemo(
    () => getCollectionOverridableFields(model.nodes),
    [model.nodes]
  )

  // Build available path options for dropdowns
  const inputPaths: { path: string; name: string }[] = []
  const overridePaths: { path: string; name: string }[] = []
  const allPaths: { path: string; name: string }[] = []
  for (const node of Object.values(model.nodes)) {
    const path = getNodePath(node.content)
    if (!path) continue
    allPaths.push({ path, name: node.name })
    if (node.content.type === 'entity') continue
    if (node.content.role === 'input') {
      inputPaths.push({ path, name: node.name })
    } else {
      overridePaths.push({ path, name: node.name })
    }
  }

  // Build the set of paths for currently-selected graph nodes
  const selectedPaths = useMemo(() => {
    if (selectedNodes.length === 0) return null
    const paths = new Set<string>()
    for (const nodeId of selectedNodes) {
      const node = model.nodes[nodeId]
      if (!node) continue
      const path = getNodePath(node.content)
      if (path) paths.add(path)
    }
    return paths.size > 0 ? paths : null
  }, [selectedNodes, model.nodes])

  // Filter tests to those that reference at least one selected node's path
  const visibleTests = useMemo(() => {
    if (!filterByGraph || !selectedPaths) return tests
    return tests.filter((test) => {
      const testPaths = [
        ...Object.keys(test.inputs ?? {}),
        ...Object.keys(test.overrides ?? {}),
        ...Object.keys(test.expect),
      ]
      return testPaths.some((p) => selectedPaths.has(p))
    })
  }, [tests, filterByGraph, selectedPaths])

  const passCount = results.filter((r) => r.passed).length
  const failCount = results.filter((r) => !r.passed).length

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold">Tests</h2>
          {selectedPaths && (
            <Button
              variant={filterByGraph ? 'default' : 'outline'}
              size="sm"
              className="h-5 px-1.5 text-[10px] gap-0.5"
              onClick={() => setFilterByGraph((prev) => !prev)}
              title={
                filterByGraph
                  ? 'Showing tests matching graph filter — click to show all'
                  : 'Showing all tests — click to filter by graph selection'
              }
            >
              <Filter className="size-2.5" />
              {filterByGraph ? `${visibleTests.length}/${tests.length}` : 'All'}
            </Button>
          )}
        </div>
        <div className="flex gap-1.5 mx-auto">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <Plus className="size-3" />
                New
                <ChevronDown className="size-2.5 opacity-50" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-50 min-w-[180px] bg-popover border rounded-md shadow-md p-1 text-popover-foreground animate-in fade-in-0 zoom-in-95"
                sideOffset={4}
                align="end"
              >
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm cursor-pointer outline-none hover:bg-accent focus:bg-accent"
                  onSelect={handleNewTest}
                >
                  <FileText className="size-3.5 text-muted-foreground" />
                  Blank test
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm cursor-pointer outline-none hover:bg-accent focus:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  onSelect={handleSaveAsTest}
                  disabled={!executionResults}
                >
                  <ClipboardCopy className="size-3.5 text-muted-foreground" />
                  From current execution
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Button
            size="sm"
            onClick={handleRunAll}
            disabled={isRunning || tests.length === 0}
            className="h-7 gap-1"
          >
            {isRunning ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            Run all
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setRightBar(null)}
        >
          <X className="size-4" />
        </Button>
      </div>

      {results.length > 0 && (
        <div
          className={cn(
            'px-4 py-2 text-xs border-b',
            failCount === 0
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-orange-100 text-orange-800'
          )}
        >
          {passCount} passed, {failCount} failed
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-orange-100 text-orange-800 text-xs border-b">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {visibleTests.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            {tests.length === 0
              ? 'No tests yet. Run some inputs and click "Save" to create one.'
              : 'No tests match the current graph filter.'}
          </div>
        ) : (
          <div className="divide-y">
            {visibleTests.map((test) => (
              <TestItem
                key={test.id}
                test={test}
                result={results.find((r) => r.testId === test.id)}
                isExpanded={expandedTest === test.id}
                isSelected={selectedTestId === test.id}
                onToggle={() =>
                  setExpandedTest(expandedTest === test.id ? null : test.id)
                }
                onSelect={() => {
                  if (selectedTestId === test.id) {
                    setSelectedTestId(null)
                  } else {
                    setSelectedTestId(test.id)
                    setExpandedTest(test.id)
                    // Run the test so results show on graph
                    handleRunOne(test.id)
                  }
                }}
                onRun={() => handleRunOne(test.id)}
                onDuplicate={() => handleDuplicate(test)}
                onDelete={() => handleDelete(test.id)}
                onLoadIntoExecution={() => handleLoadIntoExecution(test)}
                onUpdate={(updates) => handleUpdateTest(test.id, updates)}
                isRunning={isRunning}
                inputPaths={inputPaths}
                overridePaths={overridePaths}
                allPaths={allPaths}
                collectionFields={collectionFields}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type Section = 'input' | 'override' | 'expect'

type CollectionFieldMap = ReturnType<typeof getCollectionOverridableFields>

type TestItemProps = {
  test: TestCase
  result?: TestRunResult
  isExpanded: boolean
  isSelected: boolean
  onToggle: () => void
  onSelect: () => void
  onRun: () => void
  onDuplicate: () => void
  onDelete: () => void
  onLoadIntoExecution: () => void
  onUpdate: (updates: Partial<TestCase>) => void
  isRunning: boolean
  inputPaths: { path: string; name: string }[]
  overridePaths: { path: string; name: string }[]
  allPaths: { path: string; name: string }[]
  collectionFields: CollectionFieldMap
}

function TestItem({
  test,
  result,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onRun,
  onDuplicate,
  onDelete,
  onLoadIntoExecution,
  onUpdate,
  isRunning,
  inputPaths,
  overridePaths,
  allPaths,
  collectionFields,
}: TestItemProps) {
  const itemRef = useRef<HTMLDivElement>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(test.name)
  const [editingField, setEditingField] = useState<{
    section: Section
    path: string
  } | null>(null)
  const [fieldValue, setFieldValue] = useState('')
  const [addingField, setAddingField] = useState<Section | null>(null)
  const [newPath, setNewPath] = useState('')
  const [newValue, setNewValue] = useState('')

  // Local mirror of test.entities as string-rows (matches EntityEditor's
  // contract). Synced from the persisted test on test.id / entities change;
  // edits flow through here and only commit to the API on blur.
  //
  // commitEntities runs from onBlur which can fire in the same event tick as
  // a preceding onChange. To avoid reading stale state, mirror localEntities
  // through a ref that's updated synchronously by handleEntityChange and the
  // prop-sync effect; commitEntities reads the ref. Same pattern model-
  // context's runOnBlur uses for inputOverrides/entityData.
  const [localEntities, setLocalEntities] = useState<
    Record<string, Record<string, string>[]>
  >(() => entitiesToStringRows(test.entities))
  const localEntitiesRef = useRef(localEntities)
  useEffect(() => {
    const next = entitiesToStringRows(test.entities)
    localEntitiesRef.current = next
    setLocalEntities(next)
  }, [test.id, test.entities])

  const handleEntityChange = (
    collection: string,
    rows: Record<string, string>[]
  ) => {
    const next = { ...localEntitiesRef.current, [collection]: rows }
    localEntitiesRef.current = next
    setLocalEntities(next)
  }

  const commitEntities = () => {
    const parsed = stringRowsToEntities(localEntitiesRef.current)
    const currentJSON = JSON.stringify(test.entities ?? {})
    const nextJSON = JSON.stringify(parsed)
    if (currentJSON === nextJSON) return
    const isEmpty = Object.keys(parsed).length === 0
    onUpdate({ entities: isEmpty ? undefined : parsed })
  }

  useEffect(() => {
    if (isSelected && isExpanded && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected, isExpanded])

  const saveName = () => {
    if (nameValue.trim() && nameValue !== test.name) {
      onUpdate({ name: nameValue.trim() })
    }
    setEditingName(false)
  }

  const parseValue = (raw: string): unknown => {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  const writeField = (
    section: Section,
    path: string,
    value: unknown,
    remove = false
  ) => {
    if (section === 'expect') {
      const next = { ...test.expect }
      if (remove) delete next[path]
      else next[path] = value
      onUpdate({ expect: next })
    } else if (section === 'override') {
      const next = { ...(test.overrides ?? {}) }
      if (remove) delete next[path]
      else next[path] = value
      onUpdate({ overrides: next })
    } else {
      const next = { ...(test.inputs ?? {}) }
      if (remove) delete next[path]
      else next[path] = value
      onUpdate({ inputs: next })
    }
  }

  const saveField = (section: Section, path: string) => {
    writeField(section, path, parseValue(fieldValue))
    setEditingField(null)
  }

  const removeField = (section: Section, path: string) => {
    writeField(section, path, undefined, true)
  }

  const addField = (section: Section) => {
    if (!newPath.trim()) return
    writeField(section, newPath.trim(), parseValue(newValue))
    setNewPath('')
    setNewValue('')
    setAddingField(null)
  }

  return (
    <div
      ref={itemRef}
      className={cn('px-4 py-2', isSelected && 'bg-blue-50/50')}
    >
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1.5 flex-1 text-left min-w-0"
          onClick={() => {
            onSelect()
            onToggle()
          }}
        >
          {isExpanded ? (
            <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground shrink-0" />
          )}
          {result &&
            (result.passed ? (
              <CheckCircle className="size-3.5 text-emerald-700 shrink-0" />
            ) : (
              <XCircle className="size-3.5 text-orange-700 shrink-0" />
            ))}
          {editingName ? (
            <Input
              className="h-5 text-xs flex-1"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setEditingName(false)
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-xs font-medium truncate">{test.name}</span>
          )}
        </button>
        <div className="flex gap-0.5 shrink-0">
          {!editingName && (
            <button
              className="p-1 text-muted-foreground hover:text-foreground rounded"
              onClick={(e) => {
                e.stopPropagation()
                setEditingName(true)
                setNameValue(test.name)
              }}
              title="Edit name"
            >
              <Pencil className="size-2.5" />
            </button>
          )}
          <button
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            onClick={onRun}
            disabled={isRunning}
            title="Run"
          >
            <Play className="size-3" />
          </button>
          <button
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            onClick={onLoadIntoExecution}
            title="Load into execution"
          >
            <ArrowRight className="size-3" />
          </button>
          <button
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            onClick={onDuplicate}
            title="Duplicate"
          >
            <Copy className="size-3" />
          </button>
          <button
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-2 ml-5 space-y-3">
          {test.description && (
            <p className="text-[11px] text-muted-foreground -mt-1">
              {test.description}
            </p>
          )}
          {(
            [
              {
                section: 'input' as const,
                label: 'Inputs',
                entries: Object.entries(test.inputs ?? {}),
                paths: inputPaths,
                result: null as TestRunResult | null | undefined,
              },
              {
                section: 'override' as const,
                label: 'Overrides',
                entries: Object.entries(test.overrides ?? {}),
                paths: overridePaths,
                result: null as TestRunResult | null | undefined,
              },
              {
                section: 'expect' as const,
                label: 'Expectations',
                entries: Object.entries(test.expect),
                paths: allPaths,
                result,
              },
            ] as const
          ).map(({ section, label, entries, paths, result: sectionResult }) => (
            <EditableSection
              key={section}
              label={label}
              entries={entries}
              editingField={
                editingField?.section === section ? editingField.path : null
              }
              fieldValue={fieldValue}
              result={sectionResult}
              onEdit={(path) => {
                setEditingField({ section, path })
                const src =
                  section === 'expect'
                    ? test.expect
                    : section === 'override'
                      ? (test.overrides ?? {})
                      : (test.inputs ?? {})
                setFieldValue(JSON.stringify(src[path]))
              }}
              onSave={(path) => saveField(section, path)}
              onRemove={(path) => removeField(section, path)}
              onFieldValueChange={setFieldValue}
              onCancelEdit={() => setEditingField(null)}
              adding={addingField === section}
              onStartAdd={() => {
                setAddingField(section)
                setNewPath('')
                setNewValue('')
              }}
              onCancelAdd={() => {
                setAddingField(null)
                setNewPath('')
                setNewValue('')
              }}
              onAdd={() => addField(section)}
              newPath={newPath}
              newValue={newValue}
              availablePaths={paths}
              onNewPathChange={setNewPath}
              onNewValueChange={setNewValue}
            />
          ))}

          {/* Entities — one editor per collection in the model. Empty
              collections still render so users can add the first member. */}
          {Object.keys(collectionFields).length > 0 && (
            <div className="space-y-3">
              {Object.entries(collectionFields).map(([collection, fields]) => {
                const rows = localEntities[collection] ?? []
                return (
                  <div key={collection}>
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                      {getCollectionDisplayName(collection)} ({rows.length})
                    </span>
                    <div className="mt-1">
                      <EntityEditor
                        entityName={collection}
                        fields={fields}
                        rows={rows}
                        onChange={(newRows) =>
                          handleEntityChange(collection, newRows)
                        }
                        onBlur={commitEntities}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {result?.error && (
            <p className="text-xs text-orange-700">Error: {result.error}</p>
          )}
        </div>
      )}
    </div>
  )
}

type EditableSectionProps = {
  label: string
  entries: [string, unknown][]
  editingField: string | null
  fieldValue: string
  result: TestRunResult | null | undefined
  onEdit: (path: string) => void
  onSave: (path: string) => void
  onRemove: (path: string) => void
  onFieldValueChange: (value: string) => void
  onCancelEdit: () => void
  adding: boolean
  onStartAdd: () => void
  onCancelAdd: () => void
  onAdd: () => void
  newPath: string
  newValue: string
  availablePaths: { path: string; name: string }[]
  onNewPathChange: (value: string) => void
  onNewValueChange: (value: string) => void
}

function EditableSection({
  label,
  entries,
  editingField,
  fieldValue,
  result,
  onEdit,
  onSave,
  onRemove,
  onFieldValueChange,
  onCancelEdit,
  adding,
  onStartAdd,
  onCancelAdd,
  onAdd,
  availablePaths,
  newPath,
  newValue,
  onNewPathChange,
  onNewValueChange,
}: EditableSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">
          {label}
        </span>
        <button
          className="p-0.5 text-muted-foreground hover:text-foreground"
          onClick={onStartAdd}
          title={`Add ${label.toLowerCase()}`}
        >
          <Plus className="size-2.5" />
        </button>
      </div>
      <div className="mt-0.5 space-y-1">
        {entries.map(([path, value]) => {
          const exp = result?.expectations[path]
          const isEditing = editingField === path
          return (
            <div
              key={path}
              className={cn(
                'text-xs font-mono',
                exp && !exp.passed && 'text-orange-800'
              )}
            >
              <div className="flex items-center gap-1">
                {exp &&
                  (exp.passed ? (
                    <Check className="size-3 text-emerald-700 shrink-0" />
                  ) : (
                    <X className="size-3 text-orange-700 shrink-0" />
                  ))}
                <span className="text-muted-foreground truncate flex-1">
                  {path}
                </span>
                {!isEditing && (
                  <>
                    <button
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => onEdit(path)}
                      title="Edit"
                    >
                      <Pencil className="size-2.5" />
                    </button>
                    <button
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => onRemove(path)}
                      title="Remove"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </>
                )}
              </div>
              {isEditing ? (
                <div className="flex gap-1 mt-0.5 ml-4">
                  <Input
                    className="h-5 text-xs font-mono flex-1"
                    value={fieldValue}
                    onChange={(e) => onFieldValueChange(e.target.value)}
                    onBlur={() => onSave(path)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSave(path)
                      if (e.key === 'Escape') onCancelEdit()
                    }}
                    autoFocus
                  />
                </div>
              ) : exp && !exp.passed ? (
                <div className="ml-4 flex items-center gap-1.5">
                  <span className="text-muted-foreground/60 line-through">
                    {formatDisplayValue(value)}
                  </span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="text-orange-700 font-medium">
                    {formatDisplayValue(exp.actual)}
                  </span>
                </div>
              ) : (
                <div className="ml-4">
                  <span>= {formatDisplayValue(value)}</span>
                </div>
              )}
            </div>
          )
        })}

        {/* Add new field */}
        {adding && (
          <div className="space-y-1">
            {(() => {
              const listId = `test-paths-${label.toLowerCase().replace(/\s+/g, '-')}`
              const remaining = availablePaths.filter(
                (p) => !entries.some(([ep]) => ep === p.path)
              )
              return (
                <>
                  <Input
                    className="h-6 text-xs font-mono"
                    list={listId}
                    placeholder="Type to search paths..."
                    value={newPath}
                    onChange={(e) => onNewPathChange(e.target.value)}
                    autoFocus
                  />
                  <datalist id={listId}>
                    {remaining.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.name}
                      </option>
                    ))}
                  </datalist>
                </>
              )
            })()}
            <div className="flex gap-1 items-center">
              <Input
                className="h-5 text-xs font-mono flex-1"
                placeholder="value"
                value={newValue}
                onChange={(e) => onNewValueChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onAdd()
                }}
              />
              <button
                className="p-0.5 text-emerald-700 hover:text-emerald-800 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={onAdd}
                disabled={!newPath.trim()}
                title="Add"
              >
                <Check className="size-3" />
              </button>
              <button
                className="p-0.5 text-muted-foreground hover:text-foreground"
                onClick={onCancelAdd}
                title="Cancel"
              >
                <X className="size-3" />
              </button>
            </div>
          </div>
        )}

        {entries.length === 0 && !adding && (
          <span className="text-[10px] text-muted-foreground italic">None</span>
        )}
      </div>
    </div>
  )
}

// --- Entity row <-> persisted-test conversions ---
// EntityEditor edits string values; test.entities stores parsed JSON values
// (booleans/numbers/strings). Same conventions as handleSaveAsTest /
// handleLoadIntoExecution use for the execution-panel round-trip.

function entitiesToStringRows(
  entities: Record<string, Record<string, unknown>[]> | undefined
): Record<string, Record<string, string>[]> {
  if (!entities) return {}
  const out: Record<string, Record<string, string>[]> = {}
  for (const [collection, rows] of Object.entries(entities)) {
    out[collection] = rows.map((row) => {
      const r: Record<string, string> = {}
      for (const [k, v] of Object.entries(row)) {
        r[k] = typeof v === 'string' ? v : JSON.stringify(v)
      }
      return r
    })
  }
  return out
}

function stringRowsToEntities(
  local: Record<string, Record<string, string>[]>
): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {}
  for (const [collection, rows] of Object.entries(local)) {
    if (rows.length === 0) continue
    out[collection] = rows.map((row) => {
      const r: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        if (v === '') continue
        try {
          r[k] = JSON.parse(v)
        } catch {
          r[k] = v
        }
      }
      return r
    })
  }
  return out
}
