import { spawn, type ChildProcess } from 'node:child_process'
import { finishLastIteration, patchTask } from './store.js'
import type { AgentContext, AgentRunner, TaskSource } from './types.js'
import {
  formatSources,
  parseSummaryMarker,
  shellQuote,
  SYSTEM_PROMPT,
} from './common.js'

/**
 * The Claude CLI interprets a prompt starting with `/` as a slash command,
 * so "/abawdAgeExemptUpper add a doc string" comes back as
 * "Unknown command: /abawdAgeExemptUpper". Fact paths starting with `/`
 * are the normal way users reference nodes here — escape the leading slash
 * with a backslash so the CLI no longer parses it as a command.
 */
function escapeLeadingSlashCommand(prompt: string): string {
  return prompt.startsWith('/') ? `\\${prompt}` : prompt
}

const ALLOWED_TOOLS = ['Edit', 'Write', 'Read', 'Glob', 'Grep'] as const

const inflight = new Map<string, ChildProcess>()
// Threads we've intentionally killed via the Stop button — used by the
// close handler to skip the "exited with code 143" failure path so the
// iteration doesn't get marked as failed-with-noise after a clean cancel.
const cancelledThreads = new Set<string>()

/**
 * Implementation of AgentRunner backed by the `claude` CLI installed on the
 * developer's machine. Runs `claude --print --output-format=stream-json` as
 * a child process with cwd locked to the ruleset directory and tools
 * restricted to file edits inside that directory.
 */
export const claudeCodeRunner: AgentRunner = {
  async start(threadId, prompt, ctx, sources) {
    await spawnClaude(threadId, prompt, ctx, false, sources)
  },

  async follow(threadId, prompt, ctx, sources) {
    await spawnClaude(threadId, prompt, ctx, true, sources)
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
    return `cd ${shellQuote(ctx.cwd)} && claude --resume ${threadId}`
  },
}

async function spawnClaude(
  threadId: string,
  prompt: string,
  ctx: AgentContext,
  resume: boolean,
  sources?: TaskSource[]
): Promise<void> {
  const fullPrompt = `${escapeLeadingSlashCommand(prompt)}${formatSources(sources)}`
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
  args.push(fullPrompt)

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
    // User pressed Stop — mark the iteration as no-longer-running with a
    // clean "Stopped" note (instead of the SIGTERM exit-code-143 failure
    // noise) and bump the task to 'failed' so it stays in the panel for
    // the user to read, retry, or archive on their own.
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
      const parsed = parseSummaryMarker(lastAssistantText)
      finishLastIteration(
        ctx.rulesetId,
        threadId,
        {
          status: 'ready',
          summary: parsed?.summary ?? lastAssistantText,
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
