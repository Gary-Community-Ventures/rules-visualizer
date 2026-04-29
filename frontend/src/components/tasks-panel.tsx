import { useEffect, useMemo, useRef, useState } from 'react'
import { useMainContext, usePanelContext } from '@/context'
import type { TaskBuilderSource } from '@/context/panel-context'
import {
  cancelTask,
  createTask,
  followTask,
  listTasks,
  setTaskStatus,
  type Task,
  type TaskIteration,
  type TaskStatus,
  type TaskSource,
} from '@/lib/api/tasks-api'
import { getReferences } from '@/lib/api/rules-api'
import type { PolicyReferences } from '@/lib/model'
import { Button } from './ui/button'
import { NodeAutocompleteInput } from './node-autocomplete-input'
import { cn } from '@/lib/utils'
import {
  Hammer,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronRight,
  Terminal,
  Check,
  X,
  FilePlus,
  FileText,
  MoreHorizontal,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

// Display priority for the panel: ready-for-review first (user action), then
// failed (also needs attention), then running (in flight), then complete and
// archived (done with).
const STATUS_ORDER: Record<TaskStatus, number> = {
  ready: 0,
  failed: 1,
  running: 2,
  complete: 3,
  archived: 4,
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const sec = Math.round(diffMs / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

type ResolvedSource = {
  sectionId: string
  documentId: string
  text: string
  comment?: string
  documentTitle?: string
  documentFile?: string
  page?: number
}

/** Resolve an attached source ID to live section + document data. Returns
 *  null if the section has since been deleted. */
function resolveSource(
  refs: PolicyReferences | null,
  sectionId: string
): ResolvedSource | null {
  const sec = refs?.sections.find((s) => s.id === sectionId)
  if (!sec) return null
  const doc = refs?.documents.find((d) => d.id === sec.documentId)
  return {
    sectionId,
    documentId: sec.documentId,
    text: sec.text ?? '',
    comment: sec.comment,
    documentTitle: doc?.title,
    documentFile: doc?.file,
    page: sec.page,
  }
}

/** Resolve+strip the internal documentId, leaving the wire-format TaskSource
 *  the backend expects. */
function resolveForSubmit(
  refs: PolicyReferences | null,
  sources: TaskBuilderSource[]
): TaskSource[] {
  return sources
    .map((s) => resolveSource(refs, s.sectionId))
    .filter((s): s is ResolvedSource => s !== null)
    .map(({ documentId: _id, ...rest }) => rest)
}

// Compact "1h 02m 35s" / "2m 05s" / "12s" — meant for agent run durations,
// which are typically seconds-to-minutes.
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m ${remSec.toString().padStart(2, '0')}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `${hr}h ${remMin.toString().padStart(2, '0')}m ${remSec.toString().padStart(2, '0')}s`
}

/** Removable, expandable list of attached sources. Used by the new-task
 *  builder and by each TaskCard's follow-up composer — both bind to a list
 *  of {sectionId} entries and resolve live data from `refs`. */
function SourceChipList({
  sources,
  refs,
  onRemove,
  onOpenSection,
}: {
  sources: TaskBuilderSource[]
  refs: PolicyReferences | null
  onRemove: (sectionId: string) => void
  onOpenSection: (page: number, sectionId: string, documentId: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (sectionId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })

  if (sources.length === 0) return null

  return (
    <ul className="space-y-1">
      {sources.map((s) => {
        const isOpen = expanded.has(s.sectionId)
        const live = resolveSource(refs, s.sectionId)
        return (
          <li
            key={s.sectionId}
            className="text-[11px] border rounded bg-muted/40"
          >
            <div className="flex items-center gap-1 px-2 py-1">
              <button
                type="button"
                className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => toggle(s.sectionId)}
                title={isOpen ? 'Collapse' : 'Expand'}
              >
                {isOpen ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </button>
              <FileText className="size-3 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="flex-1 min-w-0 truncate text-left hover:underline disabled:no-underline disabled:cursor-default"
                disabled={!live || live.page === undefined}
                onClick={() => {
                  if (!live || live.page === undefined) return
                  onOpenSection(live.page, s.sectionId, live.documentId)
                }}
                title={
                  live && live.page !== undefined
                    ? 'Open in policy panel'
                    : undefined
                }
              >
                {live?.documentTitle ? (
                  <>
                    <span className="font-medium">{live.documentTitle}</span>
                    {live.page ? ` · p.${live.page}` : ''}
                  </>
                ) : live ? (
                  live.comment || live.text.slice(0, 60)
                ) : (
                  <span className="text-muted-foreground italic">
                    (section deleted)
                  </span>
                )}
              </button>
              <button
                className="p-0.5 text-muted-foreground hover:text-red-600 shrink-0"
                onClick={() => onRemove(s.sectionId)}
                title="Remove source"
              >
                <X className="size-3" />
              </button>
            </div>
            {isOpen && live && (
              <div className="border-t px-2 py-1.5 space-y-1">
                {live.comment && (
                  <p className="text-muted-foreground italic whitespace-pre-wrap">
                    {live.comment}
                  </p>
                )}
                <p className="whitespace-pre-wrap text-foreground/90">
                  {live.text || '(no text captured)'}
                </p>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function TasksPanel() {
  const { rulesetId, model, setOpenNode, setRightBar, openPolicyAtPage } =
    useMainContext()
  const {
    taskBuilderDraft: draft,
    setTaskBuilderDraft: setDraft,
    taskBuilderSources: sources,
    removeTaskBuilderSource,
    clearTaskBuilder,
    setAttachTarget,
  } = usePanelContext()
  const [tasks, setTasks] = useState<Task[]>([])
  const [refs, setRefs] = useState<PolicyReferences | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Poll while any task is running so the user sees status flip from
  // "running" to "ready" without needing to refresh. Also re-pulls policy
  // references so attached-source chips show the latest text/comment when
  // the user edits a section's box in the policy panel.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const [{ tasks: list }, r] = await Promise.all([
          listTasks(rulesetId),
          getReferences(rulesetId).catch(() => null),
        ])
        if (cancelled) return
        setTasks(list)
        if (r) setRefs(r)
      } catch {
        // ignore; the panel just won't refresh
      }
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [rulesetId])

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 99
      const sb = STATUS_ORDER[b.status] ?? 99
      if (sa !== sb) return sa - sb
      // Newer first within the same status group.
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [tasks])

  async function submit() {
    const prompt = draft.trim()
    if (!prompt) return
    setSubmitting(true)
    setError(null)
    try {
      const resolved = resolveForSubmit(refs, sources)
      const { task } = await createTask(
        rulesetId,
        prompt,
        resolved.length > 0 ? resolved : undefined
      )
      setTasks((prev) => [task, ...prev])
      clearTaskBuilder()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <Hammer className="size-4" />
        <span className="text-sm font-medium">Tasks</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 ml-auto"
          onClick={() => setRightBar(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="p-4 border-b shrink-0 space-y-2">
        <NodeAutocompleteInput
          placeholder="Describe a fact-graph change…"
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          disabled={submitting}
          rows={4}
        />
        <SourceChipList
          sources={sources}
          refs={refs}
          onRemove={removeTaskBuilderSource}
          onOpenSection={(page, sectionId, documentId) =>
            openPolicyAtPage(page, [sectionId], documentId)
          }
        />
        {error && <p className="text-xs text-orange-700">{error}</p>}
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => {
              setAttachTarget({ kind: 'new' })
              setRightBar('policy')
            }}
            title="Open the policy panel and pick a section to attach"
          >
            <FilePlus className="size-3.5" />
            Attach source
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!draft.trim() || submitting}
            className="flex-1"
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Spawning…
              </>
            ) : (
              'Spawn agent'
            )}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground text-center">
            No tasks yet.
          </p>
        ) : (
          sortedTasks.map((t) => (
            <TaskCard
              key={t.threadId}
              task={t}
              nodes={model.nodes}
              refs={refs}
              onOpenNode={setOpenNode}
              onOpenSection={(page, sectionId, documentId) =>
                openPolicyAtPage(page, [sectionId], documentId)
              }
              onChange={(next) =>
                setTasks((prev) =>
                  prev.map((p) => (p.threadId === next.threadId ? next : p))
                )
              }
            />
          ))
        )}
      </div>
    </div>
  )
}

function IterationView({
  iteration,
  index,
  total,
  nodes,
  refs,
  onOpenNode,
  onOpenSection,
  muted,
  onStop,
  stopDisabled,
}: {
  iteration: TaskIteration
  index: number
  total: number
  nodes: Record<string, { name: string }>
  refs: PolicyReferences | null
  onOpenNode: (id: string | null) => void
  onOpenSection: (page: number, sectionId: string, documentId: string) => void
  /** Cancels the running agent. Only meaningful while iteration.status ===
   *  'running'; the Stop control next to "Running…" is the only entry
   *  point the UI exposes. */
  onStop?: () => void
  stopDisabled?: boolean
  muted?: boolean
}) {
  const { setWorkspaceItems, setSelectedNodes, setShowChildren } =
    useMainContext()
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())
  const toggleSource = (id: string) =>
    setExpandedSources((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Live-tick the duration once a second while the iteration is still running
  // so the user sees how long the agent has been working.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (iteration.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [iteration.status])

  const startedMs = new Date(iteration.startedAt).getTime()
  const endMs = iteration.completedAt
    ? new Date(iteration.completedAt).getTime()
    : iteration.status === 'running'
      ? now
      : startedMs
  const durationLabel =
    Number.isFinite(startedMs) && endMs >= startedMs
      ? formatDuration(endMs - startedMs)
      : ''

  return (
    <div
      className={cn(
        'rounded border bg-muted/30 p-2 space-y-1.5',
        muted && 'opacity-70'
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {index === 1 ? 'Prompt' : 'Follow-up'} {index}/{total}
        </p>
        {durationLabel && (
          <p
            className="text-[10px] tabular-nums text-muted-foreground"
            title={`Started ${new Date(iteration.startedAt).toLocaleString()}${
              iteration.completedAt
                ? ` · ended ${new Date(iteration.completedAt).toLocaleString()}`
                : ''
            }`}
          >
            {iteration.status === 'running' ? 'running ' : 'ran '}
            {durationLabel}
          </p>
        )}
      </div>
      <div className="text-xs whitespace-pre-wrap rounded border bg-background px-2 py-1.5">
        {iteration.prompt}
      </div>
      {iteration.sources && iteration.sources.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">
            Sources
          </p>
          <ul className="space-y-1">
            {iteration.sources.map((src) => {
              const isOpen = expandedSources.has(src.sectionId)
              const liveSec = refs?.sections.find((s) => s.id === src.sectionId)
              const canNavigate = !!liveSec && liveSec.page !== undefined
              return (
                <li
                  key={src.sectionId}
                  className="text-[11px] border rounded bg-background"
                >
                  <div className="flex items-center gap-1 px-1.5 py-1">
                    <button
                      type="button"
                      className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => toggleSource(src.sectionId)}
                      title={isOpen ? 'Collapse' : 'Expand'}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      )}
                    </button>
                    <FileText className="size-3 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      className="flex-1 min-w-0 truncate text-left hover:underline disabled:no-underline disabled:cursor-default"
                      disabled={!canNavigate}
                      onClick={() => {
                        if (!liveSec || liveSec.page === undefined) return
                        onOpenSection(
                          liveSec.page,
                          src.sectionId,
                          liveSec.documentId
                        )
                      }}
                      title={
                        canNavigate
                          ? 'Open in policy panel'
                          : 'Section no longer exists'
                      }
                    >
                      {src.documentTitle ? (
                        <>
                          <span className="font-medium">
                            {src.documentTitle}
                          </span>
                          {src.page ? ` · p.${src.page}` : ''}
                        </>
                      ) : (
                        src.comment || src.text.slice(0, 60)
                      )}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="border-t px-2 py-1.5 space-y-1">
                      {src.comment && (
                        <p className="text-muted-foreground italic whitespace-pre-wrap">
                          {src.comment}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap text-foreground/90">
                        {src.text || '(no text captured)'}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {iteration.status === 'running' && (
        <div className="flex items-center gap-1.5 text-[11px] text-blue-700">
          <Loader2 className="size-3 animate-spin" />
          <span>Running…</span>
          {onStop && (
            <button
              type="button"
              className="size-2.5 rounded-[2px] bg-red-600 disabled:opacity-50"
              onClick={onStop}
              disabled={stopDisabled}
              title="Stop the running agent"
              aria-label="Stop"
            />
          )}
        </div>
      )}
      {iteration.summary && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          {iteration.summary}
        </p>
      )}
      {iteration.error && (
        <pre className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5 overflow-auto">
          {iteration.error}
        </pre>
      )}
      {iteration.modifiedPaths.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              Modified
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-5 px-1.5 text-[10px] gap-1"
              onClick={() => {
                const ids = iteration.modifiedPaths
                // Add to workspace (de-duped, preserving prior order; new
                // entries appended) so the user keeps whatever else they
                // were already reviewing.
                setWorkspaceItems((prev) => {
                  const seen = new Set(prev)
                  const additions = ids.filter((id) => !seen.has(id))
                  return additions.length === 0 ? prev : [...prev, ...additions]
                })
                // Selection is intentionally an override — review focus is
                // exactly the paths the agent reported it touched.
                setSelectedNodes(ids)
                setShowChildren((prev) => {
                  const next = { ...prev }
                  for (const id of ids) next[id] = true
                  return next
                })
              }}
              title="Add modified nodes to the workspace, select them, and expand their children"
            >
              Review
            </Button>
          </div>
          <ul className="space-y-0.5">
            {iteration.modifiedPaths.map((p) => (
              <li key={p}>
                <button
                  className="text-xs font-mono text-blue-700 hover:underline"
                  onClick={() => onOpenNode(p)}
                  title={nodes[p] ? `Open ${nodes[p].name}` : p}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function statusIcon(status: TaskStatus) {
  switch (status) {
    case 'running':
      return <Loader2 className="size-3.5 animate-spin text-blue-600" />
    case 'ready':
      return <CheckCircle2 className="size-3.5 text-amber-600" />
    case 'complete':
      return <CheckCircle2 className="size-3.5 text-emerald-600" />
    case 'archived':
      return <Archive className="size-3.5 text-muted-foreground" />
    case 'failed':
      return <AlertCircle className="size-3.5 text-red-600" />
  }
}

function TaskCard({
  task,
  nodes,
  refs,
  onOpenNode,
  onOpenSection,
  onChange,
}: {
  task: Task
  nodes: Record<string, { name: string }>
  refs: PolicyReferences | null
  onOpenNode: (id: string | null) => void
  onOpenSection: (page: number, sectionId: string, documentId: string) => void
  onChange: (task: Task) => void
}) {
  const { setRightBar } = useMainContext()
  const {
    followUpSources,
    removeFollowUpSource,
    clearFollowUpSources,
    setAttachTarget,
    followUpQueue,
    enqueueFollowUp,
    removeQueuedFollowUp,
  } = usePanelContext()
  const cardSources = followUpSources[task.threadId] ?? []
  const cardQueue = followUpQueue[task.threadId] ?? []
  const [expanded, setExpanded] = useState(
    task.status === 'ready' || cardSources.length > 0 || cardQueue.length > 0
  )
  const [showHistory, setShowHistory] = useState(false)
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const isArchived = task.status === 'archived'
  const isRunning = task.status === 'running'
  const iterations = task.iterations
  const latestIteration = iterations[iterations.length - 1]
  const headerPrompt = iterations[0]?.prompt ?? ''

  async function copyResumeCommand() {
    if (!task.resumeCommand) return
    try {
      await navigator.clipboard.writeText(task.resumeCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  async function sendFollowUp() {
    const trimmed = followUp.trim()
    if (!trimmed || busy) return
    // While the agent is busy, queue the follow-up instead of blocking on
    // it; the drain effect below will fire it once the task transitions
    // out of running. The queued snapshot captures both the prompt and
    // the currently-attached sources together.
    if (isRunning) {
      enqueueFollowUp(task.threadId, {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        prompt: trimmed,
        sources: cardSources,
      })
      setFollowUp('')
      clearFollowUpSources(task.threadId)
      return
    }
    setBusy(true)
    try {
      const resolved = resolveForSubmit(refs, cardSources)
      const { task: next } = await followTask(
        task.rulesetId,
        task.threadId,
        trimmed,
        resolved.length > 0 ? resolved : undefined
      )
      onChange(next)
      setFollowUp('')
      clearFollowUpSources(task.threadId)
    } finally {
      setBusy(false)
    }
  }

  // Drain queued follow-ups whenever the task isn't running and isn't being
  // submitted. The ref-lock keeps a re-render mid-send from double-firing
  // the head item.
  const drainingRef = useRef(false)
  useEffect(() => {
    if (drainingRef.current || busy || isRunning) return
    const head = cardQueue[0]
    if (!head) return
    drainingRef.current = true
    ;(async () => {
      try {
        removeQueuedFollowUp(task.threadId, head.id)
        const resolved = resolveForSubmit(refs, head.sources)
        const { task: next } = await followTask(
          task.rulesetId,
          task.threadId,
          head.prompt,
          resolved.length > 0 ? resolved : undefined
        )
        onChange(next)
      } finally {
        drainingRef.current = false
      }
    })()
  }, [
    busy,
    isRunning,
    cardQueue,
    refs,
    task.rulesetId,
    task.threadId,
    onChange,
    removeQueuedFollowUp,
  ])

  return (
    <div
      className={cn('border-b px-3 py-2 text-sm', isArchived && 'opacity-60')}
    >
      <button
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="shrink-0">{statusIcon(task.status)}</span>
        <span
          className={cn(
            'flex-1 min-w-0 text-xs leading-snug truncate',
            isArchived && 'line-through'
          )}
        >
          {headerPrompt}
        </span>
        <span
          className="text-[10px] text-muted-foreground shrink-0 tabular-nums"
          title={new Date(task.updatedAt).toLocaleString()}
        >
          {formatRelativeTime(task.updatedAt)}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 ml-5 space-y-2">
          {iterations.length > 1 && (
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {showHistory
                ? 'Hide previous iterations'
                : `Show ${iterations.length - 1} previous iteration${
                    iterations.length - 1 === 1 ? '' : 's'
                  }`}
            </button>
          )}
          {showHistory &&
            iterations
              .slice(0, -1)
              .map((it, i) => (
                <IterationView
                  key={i}
                  iteration={it}
                  index={i + 1}
                  total={iterations.length}
                  nodes={nodes}
                  refs={refs}
                  onOpenNode={onOpenNode}
                  onOpenSection={onOpenSection}
                  muted
                />
              ))}
          {latestIteration && (
            <IterationView
              iteration={latestIteration}
              index={iterations.length}
              total={iterations.length}
              nodes={nodes}
              refs={refs}
              onOpenNode={onOpenNode}
              onOpenSection={onOpenSection}
              onStop={async () => {
                setBusy(true)
                try {
                  const { task: next } = await cancelTask(
                    task.rulesetId,
                    task.threadId
                  )
                  onChange(next)
                } finally {
                  setBusy(false)
                }
              }}
              stopDisabled={busy}
            />
          )}
          {!isArchived && task.status !== 'complete' && (
            <div className="space-y-1.5">
              {cardQueue.length > 0 && (
                <ul className="space-y-1">
                  {cardQueue.map((q) => (
                    <li
                      key={q.id}
                      className="flex items-start gap-1 text-[11px] border border-dashed rounded bg-muted/30 px-2 py-1"
                    >
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 mt-0.5">
                        Queued
                      </span>
                      <span className="flex-1 min-w-0 whitespace-pre-wrap">
                        {q.prompt}
                        {q.sources.length > 0 && (
                          <span className="ml-1 text-muted-foreground">
                            ({q.sources.length} source
                            {q.sources.length === 1 ? '' : 's'})
                          </span>
                        )}
                      </span>
                      <button
                        className="p-0.5 text-muted-foreground hover:text-red-600 shrink-0"
                        onClick={() =>
                          removeQueuedFollowUp(task.threadId, q.id)
                        }
                        title="Remove queued follow-up"
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <NodeAutocompleteInput
                placeholder={
                  isRunning
                    ? 'Queue a follow-up to send when the agent finishes…'
                    : 'Follow up to refine this thread…'
                }
                value={followUp}
                onChange={setFollowUp}
                onSubmit={sendFollowUp}
                disabled={busy}
                rows={2}
                className="text-xs"
              />
              <SourceChipList
                sources={cardSources}
                refs={refs}
                onRemove={(sectionId) =>
                  removeFollowUpSource(task.threadId, sectionId)
                }
                onOpenSection={onOpenSection}
              />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={busy}
                  onClick={() => {
                    setAttachTarget({
                      kind: 'follow-up',
                      threadId: task.threadId,
                    })
                    setRightBar('policy')
                  }}
                  title="Attach a policy source to this follow-up"
                >
                  <FilePlus className="size-3" />
                  Attach source
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy || !followUp.trim()}
                  onClick={sendFollowUp}
                  title={
                    isRunning
                      ? 'Agent is running — this will queue and send when it finishes'
                      : undefined
                  }
                >
                  {isRunning ? 'Queue follow-up' : 'Send follow-up'}
                </Button>
                {(task.status === 'ready' || task.status === 'failed') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const { task: next } = await setTaskStatus(
                          task.rulesetId,
                          task.threadId,
                          'complete'
                        )
                        onChange(next)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    Mark complete
                  </Button>
                )}
                <TaskOverflowMenu
                  task={task}
                  busy={busy}
                  copied={copied}
                  onCopyResume={copyResumeCommand}
                  destructiveAction={
                    // While running, the inline "Stop" button is the
                    // destructive action; Archive only makes sense once
                    // the agent isn't holding the thread open.
                    isRunning
                      ? undefined
                      : {
                          label: 'Archive',
                          run: async () => {
                            setBusy(true)
                            try {
                              const { task: next } = await setTaskStatus(
                                task.rulesetId,
                                task.threadId,
                                'archived'
                              )
                              onChange(next)
                            } finally {
                              setBusy(false)
                            }
                          },
                        }
                  }
                />
              </div>
            </div>
          )}
          {(isArchived || task.status === 'complete') && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const { task: next } = await setTaskStatus(
                      task.rulesetId,
                      task.threadId,
                      'ready'
                    )
                    onChange(next)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {isArchived ? 'Unarchive' : 'Reopen'}
              </Button>
              <TaskOverflowMenu
                task={task}
                busy={busy}
                copied={copied}
                onCopyResume={copyResumeCommand}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Per-task "..." menu — currently bundles "Copy resume" and a destructive
 *  Cancel/Archive action. Pass `destructiveAction` only when the task is
 *  in a state that allows it (running → Cancel, ready/failed → Archive). */
function TaskOverflowMenu({
  task,
  busy,
  copied,
  onCopyResume,
  destructiveAction,
}: {
  task: Task
  busy: boolean
  copied: boolean
  onCopyResume: () => void
  destructiveAction?: { label: string; run: () => void | Promise<void> }
}) {
  // Nothing to show — keep the trigger off the screen entirely.
  if (!task.resumeCommand && !destructiveAction) return null
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 ml-auto text-muted-foreground"
          disabled={busy}
          title="More options"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[180px] bg-popover border rounded-md shadow-md p-1 text-popover-foreground animate-in fade-in-0 zoom-in-95"
          sideOffset={4}
          align="end"
        >
          {task.resumeCommand && (
            <DropdownMenu.Item
              className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm cursor-pointer outline-none hover:bg-accent focus:bg-accent"
              onSelect={onCopyResume}
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <Terminal className="size-3.5 text-muted-foreground" />
              )}
              {copied ? 'Copied' : 'Copy resume command'}
            </DropdownMenu.Item>
          )}
          {destructiveAction && (
            <DropdownMenu.Item
              className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm cursor-pointer outline-none text-red-600 hover:bg-red-50 focus:bg-red-50"
              onSelect={destructiveAction.run}
            >
              <Archive className="size-3.5" />
              {destructiveAction.label}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
