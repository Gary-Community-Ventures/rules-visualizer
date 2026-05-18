import { spawn, type ChildProcess } from 'node:child_process'
import { finishLastIteration, patchTask, readTask } from './store.js'
import type { AgentContext, AgentRunner, TaskSource } from './types.js'
import {
  formatSources,
  parseSummaryMarker,
  shellQuote,
  SUMMARY_MARKER_START,
  SYSTEM_PROMPT,
} from './common.js'

const inflight = new Map<string, ChildProcess>()
const cancelledThreads = new Set<string>()
const DEFAULT_AGENT = 'rules-visualizer-task'

/** AgentRunner backed by the `opencode run` CLI. */
export const openCodeRunner: AgentRunner = {
  async start(threadId, prompt, ctx, sources) {
    await spawnOpenCode(threadId, prompt, ctx, false, sources)
  },

  async follow(threadId, prompt, ctx, sources) {
    await spawnOpenCode(threadId, prompt, ctx, true, sources)
  },

  async cancel(threadId) {
    const proc = inflight.get(threadId)
    if (proc) {
      cancelledThreads.add(threadId)
      proc.kill('SIGTERM')
      inflight.delete(threadId)
    }
  },

  resumeCommand(threadId, ctx) {
    const sessionId = readTask(ctx.rulesetId, threadId)?.sessionId ?? threadId
    const bin = process.env.OPENCODE_BIN || 'opencode'
    return `cd ${shellQuote(ctx.cwd)} && ${shellQuote(bin)} --session ${shellQuote(sessionId)}`
  },
}

function buildPrompt(prompt: string, sources?: TaskSource[]): string {
  return `${prompt}${formatSources(sources)}`
}

async function spawnOpenCode(
  threadId: string,
  prompt: string,
  ctx: AgentContext,
  resume: boolean,
  sources?: TaskSource[]
): Promise<void> {
  const task = readTask(ctx.rulesetId, threadId)
  const sessionId = task?.sessionId
  const bin = process.env.OPENCODE_BIN || 'opencode'
  const args = [
    'run',
    '--format',
    'json',
    '--dir',
    ctx.cwd,
    '--dangerously-skip-permissions',
  ]

  const model = process.env.OPENCODE_MODEL
  if (model) args.push('--model', model)
  const variant = process.env.OPENCODE_VARIANT
  if (variant) args.push('--variant', variant)
  const agent = process.env.OPENCODE_AGENT || DEFAULT_AGENT
  args.push('--agent', agent)
  if (resume && sessionId) args.push('--session', sessionId)

  args.push(buildPrompt(prompt, sources))

  const proc = spawn(bin, args, {
    cwd: ctx.cwd,
    env: openCodeEnv(agent),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  inflight.set(threadId, proc)

  let stdoutBuf = ''
  let stderrBuf = ''
  let rawStdout = ''
  let lastAssistantText = ''
  let providerSessionId = sessionId

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    rawStdout += text
    stdoutBuf += text
    let nl: number
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim()
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (!line) continue
      try {
        const evt = JSON.parse(line) as Record<string, unknown>
        providerSessionId = readSessionId(evt) ?? providerSessionId
        lastAssistantText =
          readAssistantText(evt) ?? readMarkerText(evt) ?? lastAssistantText
      } catch {
        // tolerate non-JSON lines even when --format=json is requested
      }
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8')
  })

  proc.on('error', (err) => {
    inflight.delete(threadId)
    finishLastIteration(
      ctx.rulesetId,
      threadId,
      { status: 'failed', error: err.message, modifiedPaths: [] },
      'failed'
    )
  })

  proc.on('close', (code) => {
    inflight.delete(threadId)
    if (providerSessionId) {
      patchTask(ctx.rulesetId, threadId, { sessionId: providerSessionId })
    }
    if (cancelledThreads.has(threadId)) {
      cancelledThreads.delete(threadId)
      finishLastIteration(
        ctx.rulesetId,
        threadId,
        { status: 'failed', error: 'Stopped by user', modifiedPaths: [] },
        'failed'
      )
      return
    }
    if (code === 0) {
      const output = lastAssistantText || rawStdout
      const parsed = parseSummaryMarker(output)
      finishLastIteration(
        ctx.rulesetId,
        threadId,
        {
          status: 'ready',
          summary: parsed?.summary ?? output,
          modifiedPaths: parsed?.modifiedPaths ?? [],
        },
        'ready'
      )
    } else {
      finishLastIteration(
        ctx.rulesetId,
        threadId,
        {
          status: 'failed',
          error: stderrBuf.slice(-2000) || `exited with code ${code}`,
          modifiedPaths: [],
        },
        'failed'
      )
    }
  })
}

function openCodeEnv(agent: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...parseConfigContent(process.env.OPENCODE_CONFIG_CONTENT),
      agent: {
        ...parseConfigContent(process.env.OPENCODE_CONFIG_CONTENT).agent,
        [agent]: {
          ...parseConfigContent(process.env.OPENCODE_CONFIG_CONTENT).agent?.[
            agent
          ],
          description: 'Edits the selected rules visualizer fact graph ruleset',
          mode: 'primary',
          prompt: SYSTEM_PROMPT,
        },
      },
    }),
  }
}

function parseConfigContent(raw: string | undefined): {
  agent?: Record<string, Record<string, unknown>>
  [key: string]: unknown
} {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { agent?: Record<string, Record<string, unknown>> })
      : {}
  } catch {
    return {}
  }
}

function readSessionId(evt: Record<string, unknown>): string | undefined {
  for (const key of ['session_id', 'sessionID', 'sessionId']) {
    if (typeof evt[key] === 'string') return evt[key]
  }
  const session = evt.session
  if (session && typeof session === 'object') {
    const id = (session as Record<string, unknown>).id
    if (typeof id === 'string') return id
  }
  if (
    typeof evt.id === 'string' &&
    String(evt.type ?? '').includes('session')
  ) {
    return evt.id
  }
  return undefined
}

function readAssistantText(evt: Record<string, unknown>): string | undefined {
  const role = String(evt.role ?? '')
  const type = String(evt.type ?? '')
  const message = evt.message

  if (role === 'assistant') return collectText(evt).join('\n') || undefined
  if (type === 'assistant') return collectText(evt).join('\n') || undefined
  if (message && typeof message === 'object') {
    const msg = message as Record<string, unknown>
    if (msg.role === 'assistant')
      return collectText(msg).join('\n') || undefined
  }
  return undefined
}

function collectText(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(collectText)
  const obj = value as Record<string, unknown>
  const text = obj.text
  if (typeof text === 'string') return [text]
  const content = obj.content
  if (typeof content === 'string') return [content]
  const parts: string[] = []
  for (const key of ['content', 'parts', 'message']) {
    parts.push(...collectText(obj[key]))
  }
  return parts
}

function readMarkerText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.includes(SUMMARY_MARKER_START) ? value : undefined
  }
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readMarkerText(item)
      if (text) return text
    }
    return undefined
  }
  for (const item of Object.values(value)) {
    const text = readMarkerText(item)
    if (text) return text
  }
  return undefined
}
