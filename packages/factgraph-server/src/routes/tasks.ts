import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { claudeCodeRunner } from '../agents/claude-code-runner.js'
import {
  finishLastIteration,
  getTaskDir,
  listTasks,
  newThreadId,
  readTask,
  setStatus,
  writeTask,
} from '../agents/store.js'
import { getDataDir } from '../store.js'
import type { AgentContext, AgentRunner, Task } from '../agents/types.js'

// DI seam — swap this if we add another agent backend.
const runner: AgentRunner = claudeCodeRunner

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
  if (!ctx) return task
  return { ...task, resumeCommand: runner.resumeCommand(task.threadId, ctx) }
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
      { prompt, status: 'running', modifiedPaths: [], startedAt: now },
    ],
    status: 'running',
    createdAt: now,
    updatedAt: now,
  }
  writeTask(task)
  try {
    await runner.start(threadId, prompt, ctx)
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
  const task = readTask(rulesetId, threadId)
  if (!task) {
    res.status(404).json({ error: 'Task not found' })
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
    status: 'running',
    modifiedPaths: [],
    startedAt: now,
  })
  task.status = 'running'
  task.updatedAt = now
  writeTask(task)
  try {
    await runner.follow(threadId, prompt, ctx)
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
  await runner.cancel(threadId)
  const task = setStatus(rulesetId, threadId, 'archived')
  res.json({ task: task ? withRuntime(task) : task })
})

export default router
