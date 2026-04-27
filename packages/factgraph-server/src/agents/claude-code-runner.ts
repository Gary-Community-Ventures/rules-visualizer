import { spawn, type ChildProcess } from 'node:child_process'
import { patchTask, setStatus } from './store.js'
import type { AgentContext, AgentRunner } from './types.js'

const SUMMARY_MARKER_START = '<<TASK_RESULT>>'
const SUMMARY_MARKER_END = '<<TASK_END>>'

const SYSTEM_PROMPT = `You are editing fact-graph XML rulesets in the current working directory.

When you finish, print exactly one line in this form (and nothing after it):
${SUMMARY_MARKER_START}{"summary":"<one-sentence summary>","modifiedPaths":["/factPath",...]}${SUMMARY_MARKER_END}

Only include fact paths you actually added or edited. The visualizer parses this line to surface what you touched.`

const ALLOWED_TOOLS = ['Edit', 'Write', 'Read', 'Glob', 'Grep'] as const

const inflight = new Map<string, ChildProcess>()

/**
 * Implementation of AgentRunner backed by the `claude` CLI installed on the
 * developer's machine. Runs `claude --print --output-format=stream-json` as
 * a child process with cwd locked to the ruleset directory and tools
 * restricted to file edits inside that directory.
 */
export const claudeCodeRunner: AgentRunner = {
  async start(threadId, prompt, ctx) {
    await spawnClaude(threadId, prompt, ctx, false)
  },

  async follow(threadId, prompt, ctx) {
    await spawnClaude(threadId, prompt, ctx, true)
  },

  async cancel(threadId) {
    const proc = inflight.get(threadId)
    if (proc) {
      proc.kill('SIGTERM')
      inflight.delete(threadId)
    }
  },

  resumeCommand(threadId, ctx) {
    return `cd ${shellQuote(ctx.cwd)} && claude --resume ${threadId}`
  },
}

// Single-quote-safe POSIX quoting: end-quote, backslash-escape the quote,
// re-open. Lets the user paste straight into bash/zsh.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

async function spawnClaude(
  threadId: string,
  prompt: string,
  ctx: AgentContext,
  resume: boolean
): Promise<void> {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--allowed-tools',
    ALLOWED_TOOLS.join(','),
    '--append-system-prompt',
    SYSTEM_PROMPT,
  ]
  if (resume) {
    args.push('--resume', threadId)
  } else {
    args.push('--session-id', threadId)
  }
  args.push(prompt)

  const proc = spawn('claude', args, {
    cwd: ctx.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  inflight.set(threadId, proc)

  let stdoutBuf = ''
  let stderrBuf = ''
  let lastAssistantText = ''
  let providerSessionId: string | undefined = resume ? threadId : undefined

  proc.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf-8')
    let nl: number
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim()
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (!line) continue
      try {
        const evt = JSON.parse(line) as Record<string, unknown>
        if (typeof evt.session_id === 'string') {
          providerSessionId = evt.session_id
        }
        // Capture the most recent assistant text in case the agent skips
        // emitting the structured marker line.
        if (
          evt.type === 'assistant' &&
          typeof evt.message === 'object' &&
          evt.message
        ) {
          const content = (evt.message as { content?: unknown }).content
          if (Array.isArray(content)) {
            for (const c of content) {
              if (
                c &&
                typeof c === 'object' &&
                (c as Record<string, unknown>).type === 'text' &&
                typeof (c as Record<string, unknown>).text === 'string'
              ) {
                lastAssistantText = (c as Record<string, unknown>)
                  .text as string
              }
            }
          }
        }
      } catch {
        // tolerate non-JSON lines (shouldn't happen with stream-json but ok)
      }
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8')
  })

  proc.on('error', (err) => {
    inflight.delete(threadId)
    setStatus(ctx.rulesetId, threadId, 'failed', {
      error: err.message,
    })
  })

  proc.on('close', (code) => {
    inflight.delete(threadId)
    if (code === 0) {
      const parsed = parseSummaryMarker(lastAssistantText)
      setStatus(ctx.rulesetId, threadId, 'ready', {
        summary: parsed?.summary ?? lastAssistantText.slice(0, 240),
        modifiedPaths: parsed?.modifiedPaths ?? [],
        sessionId: providerSessionId,
      })
    } else {
      setStatus(ctx.rulesetId, threadId, 'failed', {
        error: stderrBuf.slice(-2000) || `exited with code ${code}`,
        sessionId: providerSessionId,
      })
    }
  })

  // Mark the existing thread as running again on follow-up.
  if (resume) {
    patchTask(ctx.rulesetId, threadId, { status: 'running' })
  }
}

function parseSummaryMarker(
  text: string
): { summary: string; modifiedPaths: string[] } | undefined {
  const start = text.lastIndexOf(SUMMARY_MARKER_START)
  if (start < 0) return undefined
  const end = text.indexOf(SUMMARY_MARKER_END, start)
  if (end < 0) return undefined
  const json = text.slice(start + SUMMARY_MARKER_START.length, end).trim()
  try {
    const parsed = JSON.parse(json)
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      modifiedPaths: Array.isArray(parsed.modifiedPaths)
        ? parsed.modifiedPaths.filter(
            (p: unknown): p is string => typeof p === 'string'
          )
        : [],
    }
  } catch {
    return undefined
  }
}
