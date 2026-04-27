export type TaskStatus =
  | 'running'
  | 'ready'
  | 'complete'
  | 'archived'
  | 'failed'

export type Task = {
  threadId: string
  rulesetId: string
  prompt: string
  followUps: string[]
  resumeCommand?: string
  status: TaskStatus
  sessionId?: string
  summary?: string
  modifiedPaths: string[]
  error?: string
  createdAt: string
  updatedAt: string
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`)
  }
  return res.json()
}

export function listTasks(rulesetId: string): Promise<{ tasks: Task[] }> {
  return api(`/api/rulesets/${encodeURIComponent(rulesetId)}/tasks`)
}

export function getTask(rulesetId: string, threadId: string): Promise<Task> {
  return api(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/tasks/${threadId}`
  )
}

export function createTask(
  rulesetId: string,
  prompt: string
): Promise<{ task: Task }> {
  return api(`/api/rulesets/${encodeURIComponent(rulesetId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
}

export function followTask(
  rulesetId: string,
  threadId: string,
  prompt: string
): Promise<{ task: Task }> {
  return api(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/tasks/${threadId}/follow`,
    { method: 'POST', body: JSON.stringify({ prompt }) }
  )
}

export function setTaskStatus(
  rulesetId: string,
  threadId: string,
  status: 'ready' | 'complete' | 'archived'
): Promise<{ task: Task }> {
  return api(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/tasks/${threadId}/status`,
    { method: 'POST', body: JSON.stringify({ status }) }
  )
}

export function cancelTask(
  rulesetId: string,
  threadId: string
): Promise<{ task: Task }> {
  return api(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/tasks/${threadId}/cancel`,
    { method: 'POST' }
  )
}
