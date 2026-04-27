import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Task, TaskStatus } from './types.js'

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
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Task
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
      tasks.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')))
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
