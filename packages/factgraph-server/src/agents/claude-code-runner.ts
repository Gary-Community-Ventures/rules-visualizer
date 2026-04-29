import { spawn, type ChildProcess } from 'node:child_process'
import { finishLastIteration, patchTask } from './store.js'
import type { AgentContext, AgentRunner, TaskSource } from './types.js'

const SUMMARY_MARKER_START = '<<TASK_RESULT>>'
const SUMMARY_MARKER_END = '<<TASK_END>>'

const SYSTEM_PROMPT = `You are editing fact-graph XML rulesets in the current working directory.

If the user attaches policy sources (delimited by <policy-sources> in their
message), they are excerpts from policy PDFs the user wants you to cite as
the basis for your changes. Each source has a sectionId. After you create
or edit a fact node that derives from a source, ALSO add an entry to the
ruleset's references.json mapping the new node's path to that section's
id, so the visualizer surfaces the link on the node:

  // references.json — append to the "mappings" array
  { "nodePath": "/yourNewFactName", "sectionId": "<sectionId from source>" }

(nodePath is the fact's NAME — the same value used in <Fact path="…"> — not
the section's label.) Don't invent new sectionId values; use the ones the
user gave you. If a node already exists with the right mapping, leave it
alone.

When you finish, print exactly one line in this form (and nothing after it):
${SUMMARY_MARKER_START}{"summary":"<one-sentence summary>","modifiedPaths":["/factPath",...]}${SUMMARY_MARKER_END}

Only include fact paths you actually added or edited. The visualizer parses this line to surface what you touched.`

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

/** Render attached sources as a labeled block injected into the user prompt. */
function formatSources(sources: TaskSource[] | undefined): string {
  if (!sources || sources.length === 0) return ''
  const esc = (s: string) => s.replace(/"/g, '&quot;')
  const blocks = sources.map((s, i) => {
    const attrs: string[] = [`index="${i + 1}"`, `sectionId="${s.sectionId}"`]
    if (s.documentTitle) attrs.push(`document="${esc(s.documentTitle)}"`)
    // file + page give the agent enough to locate this source on disk
    // (e.g. via `pdftotext -l N -f N <file>`) for surrounding context.
    if (s.documentFile) attrs.push(`file="${esc(s.documentFile)}"`)
    if (s.page !== undefined) attrs.push(`page="${s.page}"`)
    if (s.comment) attrs.push(`comment="${esc(s.comment)}"`)
    const text = (s.text ?? '').trim()
    return `<source ${attrs.join(' ')}>\n${text || '(no text captured)'}\n</source>`
  })
  return `\n\n<policy-sources>\n${blocks.join('\n')}\n</policy-sources>`
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

// Single-quote-safe POSIX quoting: end-quote, backslash-escape the quote,
// re-open. Lets the user paste straight into bash/zsh.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
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
          summary: parsed?.summary ?? lastAssistantText.slice(0, 240),
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
