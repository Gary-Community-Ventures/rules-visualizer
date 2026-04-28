import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Task, TaskIteration, TaskStatus } from './types.js'

// Old (pre-iterations) on-disk shape we still need to migrate from.
type LegacyTask = {
  threadId: string
  rulesetId: string
  prompt?: string
  followUps?: string[]
  status: TaskStatus
  sessionId?: string
  summary?: string
  modifiedPaths?: string[]
  error?: string
  createdAt: string
  updatedAt: string
  iterations?: TaskIteration[]
}

function migrateTask(raw: LegacyTask): Task {
  if (Array.isArray(raw.iterations)) {
    // Already migrated.
    return raw as unknown as Task
  }
  const prompts = [raw.prompt ?? '', ...(raw.followUps ?? [])]
  const iterations: TaskIteration[] = prompts.map((p, i) => {
    const isLast = i === prompts.length - 1
    return {
      prompt: p,
      // Old format stored only the latest run's outcome; attribute it to the
      // last iteration. Earlier iterations are silently 'ready' with no body.
      status: isLast
        ? raw.status === 'running' || raw.status === 'failed'
          ? raw.status
          : 'ready'
        : 'ready',
      summary: isLast ? raw.summary : undefined,
      modifiedPaths: isLast ? raw.modifiedPaths ?? [] : [],
      error: isLast ? raw.error : undefined,
      startedAt: raw.createdAt,
      completedAt: isLast ? raw.updatedAt : raw.updatedAt,
    }
  })
  return {
    threadId: raw.threadId,
    rulesetId: raw.rulesetId,
    iterations,
    status: raw.status,
    sessionId: raw.sessionId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

const ROOT = path.resolve(process.cwd(), '.claude-tasks')

function rulesetDir(rulesetId: string): string {
  return path.join(ROOT, rulesetId)
}

function taskFile(rulesetId: string, threadId: string): string {
  return path.join(rulesetDir(rulesetId), `${threadId}.json`)
}

export function newThreadId(): string {
  return randomUUID()
}

export function getTaskDir(rulesetId: string): string {
  fs.mkdirSync(rulesetDir(rulesetId), { recursive: true })
  return rulesetDir(rulesetId)
}

export function readTask(
  rulesetId: string,
  threadId: string
): Task | undefined {
  const file = taskFile(rulesetId, threadId)
  if (!fs.existsSync(file)) return undefined
  try {
    return migrateTask(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } catch {
    return undefined
  }
}

export function writeTask(task: Task): void {
  fs.mkdirSync(rulesetDir(task.rulesetId), { recursive: true })
  fs.writeFileSync(
    taskFile(task.rulesetId, task.threadId),
    JSON.stringify(task, null, 2)
  )
}

export function listTasks(rulesetId: string): Task[] {
  const dir = rulesetDir(rulesetId)
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const tasks: Task[] = []
  for (const f of files) {
    try {
      tasks.push(migrateTask(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))))
    } catch {
      // skip malformed files
    }
  }
  // newest first
  tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return tasks
}

export function patchTask(
  rulesetId: string,
  threadId: string,
  patch: Partial<Task>
): Task | undefined {
  const existing = readTask(rulesetId, threadId)
  if (!existing) return undefined
  const next: Task = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  writeTask(next)
  return next
}

export function setStatus(
  rulesetId: string,
  threadId: string,
  status: TaskStatus,
  extra?: Partial<Task>
): Task | undefined {
  return patchTask(rulesetId, threadId, { ...extra, status })
}

/**
 * Update the most recently appended iteration (the one currently running)
 * with what the agent reported back. Also bumps top-level task status to
 * mirror the iteration's outcome.
 */
export function finishLastIteration(
  rulesetId: string,
  threadId: string,
  patch: Partial<TaskIteration>,
  outerStatus: TaskStatus
): Task | undefined {
  const existing = readTask(rulesetId, threadId)
  if (!existing) return undefined
  const last = existing.iterations[existing.iterations.length - 1]
  if (!last) return undefined
  const next: Task = {
    ...existing,
    iterations: [
      ...existing.iterations.slice(0, -1),
      { ...last, ...patch, completedAt: new Date().toISOString() },
    ],
    status: outerStatus,
    updatedAt: new Date().toISOString(),
  }
  writeTask(next)
  return next
}
