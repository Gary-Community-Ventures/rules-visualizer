import { useEffect, useState } from 'react'
import { useMainContext } from '@/context'
import {
  cancelTask,
  createTask,
  followTask,
  listTasks,
  setTaskStatus,
  type Task,
  type TaskStatus,
} from '@/lib/api/tasks-api'
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
} from 'lucide-react'

export function TasksPanel() {
  const { rulesetId, model, setOpenNode, setRightBar } = useMainContext()
  const [tasks, setTasks] = useState<Task[]>([])
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Poll while any task is running so the user sees status flip from
  // "running" to "ready" without needing to refresh.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const { tasks: list } = await listTasks(rulesetId)
        if (!cancelled) setTasks(list)
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

  async function submit() {
    const prompt = draft.trim()
    if (!prompt) return
    setSubmitting(true)
    setError(null)
    try {
      const { task } = await createTask(rulesetId, prompt)
      setTasks((prev) => [task, ...prev])
      setDraft('')
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
        {error && <p className="text-xs text-orange-700">{error}</p>}
        <Button
          size="sm"
          onClick={submit}
          disabled={!draft.trim() || submitting}
          className="w-full"
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
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground text-center">
            No tasks yet.
          </p>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.threadId}
              task={t}
              nodes={model.nodes}
              onOpenNode={setOpenNode}
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
  onOpenNode,
  onChange,
}: {
  task: Task
  nodes: Record<string, { name: string }>
  onOpenNode: (id: string | null) => void
  onChange: (task: Task) => void
}) {
  const [expanded, setExpanded] = useState(task.status === 'ready')
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const isArchived = task.status === 'archived'
  const isRunning = task.status === 'running'

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
    if (!trimmed || busy || isRunning) return
    setBusy(true)
    try {
      const { task: next } = await followTask(
        task.rulesetId,
        task.threadId,
        trimmed
      )
      onChange(next)
      setFollowUp('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn('border-b px-3 py-2 text-sm', isArchived && 'opacity-60')}
    >
      <button
        className="w-full flex items-start gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <span className="mt-0.5 shrink-0">{statusIcon(task.status)}</span>
        <span
          className={cn(
            'flex-1 text-xs leading-snug line-clamp-2',
            isArchived && 'line-through'
          )}
        >
          {task.prompt}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 ml-5 space-y-2">
          {task.resumeCommand && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 font-mono"
              onClick={copyResumeCommand}
              title={task.resumeCommand}
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <Terminal className="size-3.5" />
              )}
              {copied ? 'Copied' : 'Copy resume command'}
            </Button>
          )}
          {task.summary && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
              {task.summary}
            </p>
          )}
          {task.error && (
            <pre className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5 overflow-auto">
              {task.error}
            </pre>
          )}
          {task.modifiedPaths.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">
                Modified
              </p>
              <ul className="space-y-0.5">
                {task.modifiedPaths.map((p) => (
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
          {!isArchived && task.status !== 'complete' && (
            <div className="space-y-1.5">
              <NodeAutocompleteInput
                placeholder="Follow up to refine this thread…"
                value={followUp}
                onChange={setFollowUp}
                onSubmit={sendFollowUp}
                disabled={busy || isRunning}
                rows={2}
                className="text-xs"
              />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy || isRunning || !followUp.trim()}
                  onClick={sendFollowUp}
                >
                  Send follow-up
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const { task: next } = isRunning
                        ? await cancelTask(task.rulesetId, task.threadId)
                        : await setTaskStatus(
                            task.rulesetId,
                            task.threadId,
                            'archived'
                          )
                      onChange(next)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {isRunning ? 'Cancel' : 'Archive'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
