/**
 * Agent runner abstraction. The Tasks side-panel talks to whichever runner
 * is registered, so swapping the underlying agent (currently the Claude CLI)
 * later only requires implementing this interface — no UI/route changes.
 */

export type TaskStatus =
  | 'running'
  | 'ready' // finished, awaiting human review
  | 'complete' // user reviewed and accepted
  | 'archived' // user gave up / dismissed
  | 'failed'

/**
 * One round-trip with the agent: the user's prompt plus whatever the agent
 * reported back when that run finished. Tasks accumulate iterations as the
 * user follows up, so the full history is preserved instead of overwritten.
 */
export type TaskIteration = {
  prompt: string
  status: 'running' | 'ready' | 'failed'
  /** Short human-readable summary the agent emitted for this iteration. */
  summary?: string
  /** Fact paths the agent reported it touched in this iteration. */
  modifiedPaths: string[]
  /** Tail of stderr if this iteration failed. */
  error?: string
  startedAt: string
  completedAt?: string
}

export type Task = {
  threadId: string
  rulesetId: string
  /** Initial prompt + follow-ups, each paired with the response that run produced. */
  iterations: TaskIteration[]
  /** Overall task status — usually mirrors the latest iteration, plus
   *  user-driven complete/archived. */
  status: TaskStatus
  /** Provider-specific session id used to resume the same thread. */
  sessionId?: string
  /**
   * Shell command the user can paste to attach to this thread in their own
   * terminal. Provided by the active AgentRunner — different runners (Claude,
   * Codex, etc.) emit different commands. Derived at the API boundary, not
   * persisted, so swapping the runner takes effect immediately.
   */
  resumeCommand?: string
  createdAt: string // ISO
  updatedAt: string // ISO
}

export type AgentContext = {
  rulesetId: string
  /** Working directory the agent should operate inside (the ruleset folder). */
  cwd: string
  /** Where the runner should persist task state for this thread. */
  taskDir: string
}

export interface AgentRunner {
  /**
   * Kick off a new thread. The caller mints the threadId (so the task
   * record exists in the store before the runner starts writing status
   * updates back to it). The runner uses the same id as the provider
   * session id when applicable.
   */
  start(threadId: string, prompt: string, ctx: AgentContext): Promise<void>

  /**
   * Send a follow-up prompt to an existing thread. Resumes the same agent
   * session so the agent retains context.
   */
  follow(threadId: string, prompt: string, ctx: AgentContext): Promise<void>

  /** Best-effort cancellation of an in-flight task. */
  cancel(threadId: string): Promise<void>

  /**
   * Shell command the user can paste into their terminal to attach to the
   * same thread (for observation or hand-off). Each runner knows its own CLI
   * shape — Claude uses `--resume`, Codex would use whatever it uses.
   */
  resumeCommand(threadId: string, ctx: AgentContext): string
}
