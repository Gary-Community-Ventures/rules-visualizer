import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { claudeCodeRunner } from '../agents/claude-code-runner.js'
import { openCodeRunner } from '../agents/opencode-runner.js'
import {
  finishLastIteration,
  getTaskDir,
  listTasks,
  newThreadId,
  readTask,
  setStatus,
  writeTask,
} from '../agents/store.js'
import { getDataDir } from 'rules-visualizer-factgraph-core'
import type {
  AgentContext,
  AgentRunnerName,
  AgentRunner,
  Task,
  TaskSource,
} from '../agents/types.js'

function parseSources(raw: unknown): TaskSource[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: TaskSource[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.sectionId !== 'string' || typeof o.text !== 'string') continue
    out.push({
      sectionId: o.sectionId,
      text: o.text,
      comment: typeof o.comment === 'string' ? o.comment : undefined,
      documentTitle:
        typeof o.documentTitle === 'string' ? o.documentTitle : undefined,
      documentFile:
        typeof o.documentFile === 'string' ? o.documentFile : undefined,
      page: typeof o.page === 'number' ? o.page : undefined,
    })
  }
  return out.length > 0 ? out : undefined
}

function selectRunner(): { name: AgentRunnerName; runner: AgentRunner } {
  const value = (process.env.TASK_AGENT_RUNNER ?? 'claude').toLowerCase()
  if (value === 'opencode' || value === 'open-code') {
    return { name: 'opencode', runner: openCodeRunner }
  }
  if (value === 'claude' || value === 'claude-code') {
    return { name: 'claude', runner: claudeCodeRunner }
  }
  throw new Error(
    `Invalid TASK_AGENT_RUNNER=${process.env.TASK_AGENT_RUNNER}. Use "claude" or "opencode".`
  )
}

const { name: activeRunnerName, runner } = selectRunner()

function runnerFor(name: AgentRunnerName): AgentRunner {
  return name === 'opencode' ? openCodeRunner : claudeCodeRunner
}

const router = Router()

function rulesetCwd(rulesetId: string): string | undefined {
  const dataDir = getDataDir()
  if (!dataDir) return undefined
  const candidate = path.join(dataDir, rulesetId)
  if (!fs.existsSync(candidate)) return undefined
  return candidate
}

function buildContext(rulesetId: string): AgentContext | undefined {
  const cwd = rulesetCwd(rulesetId)
  if (!cwd) return undefined
  return { rulesetId, cwd, taskDir: getTaskDir(rulesetId) }
}

// resumeCommand is a derived field — overlay it at the API boundary so the
// active runner (Claude, Codex, etc.) decides what the copyable shell command
// looks like. Not persisted, so swapping runners takes effect immediately.
function withRuntime(task: Task): Task {
  const ctx = buildContext(task.rulesetId)
  const agentRunner = task.agentRunner ?? 'claude'
  if (!ctx) return { ...task, agentRunner, activeAgentRunner: activeRunnerName }
  const taskRunner = runnerFor(agentRunner)
  return {
    ...task,
    agentRunner,
    activeAgentRunner: activeRunnerName,
    resumeCommand: taskRunner.resumeCommand(task.threadId, ctx),
  }
}

router.get('/rulesets/:id/tasks', (req, res) => {
  res.json({ tasks: listTasks(req.params.id).map(withRuntime) })
})

router.get('/rulesets/:id/tasks/:threadId', (req, res) => {
  const task = readTask(req.params.id, req.params.threadId)
  if (!task) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  res.json(withRuntime(task))
})

router.post('/rulesets/:id/tasks', async (req, res) => {
  const rulesetId = req.params.id
  const prompt = String(req.body?.prompt ?? '').trim()
  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' })
    return
  }
  const sources = parseSources(req.body?.sources)
  const ctx = buildContext(rulesetId)
  if (!ctx) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  const threadId = newThreadId()
  const now = new Date().toISOString()
  const task: Task = {
    threadId,
    rulesetId,
    iterations: [
      {
        prompt,
        sources,
        status: 'running',
        modifiedPaths: [],
        startedAt: now,
      },
    ],
    status: 'running',
    agentRunner: activeRunnerName,
    createdAt: now,
    updatedAt: now,
  }
  writeTask(task)
  try {
    await runner.start(threadId, prompt, ctx, sources)
    res.json({ task: withRuntime(task) })
  } catch (err) {
    finishLastIteration(
      rulesetId,
      threadId,
      {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        modifiedPaths: [],
      },
      'failed'
    )
    res.status(500).json({ error: 'Failed to start agent' })
  }
})

router.post('/rulesets/:id/tasks/:threadId/follow', async (req, res) => {
  const { id: rulesetId, threadId } = req.params
  const prompt = String(req.body?.prompt ?? '').trim()
  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' })
    return
  }
  const sources = parseSources(req.body?.sources)
  const task = readTask(rulesetId, threadId)
  if (!task) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  const taskRunner = task.agentRunner ?? 'claude'
  if (taskRunner !== activeRunnerName) {
    res.status(409).json({
      error: `This task was run using ${taskRunner}; current task agent is ${activeRunnerName}`,
    })
    return
  }
  const ctx = buildContext(rulesetId)
  if (!ctx) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  const now = new Date().toISOString()
  task.iterations.push({
    prompt,
    sources,
    status: 'running',
    modifiedPaths: [],
    startedAt: now,
  })
  task.status = 'running'
  task.updatedAt = now
  writeTask(task)
  try {
    await runner.follow(threadId, prompt, ctx, sources)
    res.json({ task: withRuntime(task) })
  } catch (err) {
    finishLastIteration(
      rulesetId,
      threadId,
      {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        modifiedPaths: [],
      },
      'failed'
    )
    res.status(500).json({ error: 'Failed to follow up agent' })
  }
})

router.post('/rulesets/:id/tasks/:threadId/status', (req, res) => {
  const { id: rulesetId, threadId } = req.params
  const status = String(req.body?.status ?? '')
  if (status !== 'ready' && status !== 'complete' && status !== 'archived') {
    res.status(400).json({ error: 'invalid status transition' })
    return
  }
  const task = setStatus(rulesetId, threadId, status)
  if (!task) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  res.json({ task: withRuntime(task) })
})

router.post('/rulesets/:id/tasks/:threadId/cancel', async (req, res) => {
  const { id: rulesetId, threadId } = req.params
  const taskBeforeCancel = readTask(rulesetId, threadId)
  await runnerFor(taskBeforeCancel?.agentRunner ?? 'claude').cancel(threadId)
  // Force-finalize a still-running iteration so the UI reflects the stop
  // immediately, instead of waiting for the runner's close handler — and
  // so orphan tasks (proc lost across a server restart, or close event
  // missed) get a clean exit instead of being stuck on "Running…" forever.
  // The runner's close handler writes the same thing again later if the
  // proc was actually killed; the redundant write is harmless.
  let task = readTask(rulesetId, threadId)
  const last = task?.iterations[task.iterations.length - 1]
  if (last?.status === 'running') {
    task = finishLastIteration(
      rulesetId,
      threadId,
      { status: 'failed', error: 'Stopped by user', modifiedPaths: [] },
      'failed'
    )
  }
  res.json({ task: task ? withRuntime(task) : task })
})

export default router
