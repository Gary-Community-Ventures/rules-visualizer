import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { AiChatMessage } from '@/lib/ai-chat-types'

/**
 * Side-panel state that needs to outlive the panel itself.
 *
 * The right-bar panels (Tasks, AI, etc.) unmount when the user closes them,
 * which drops their local state. PanelContext is a small dedicated bag for
 * the bits worth carrying across — kept separate from ModelContext so the
 * core model surface doesn't grow unboundedly. Add new panel-scoped state
 * here when you need it, not in ModelContext.
 */

/**
 * The builder stores section IDs only — text/comment/document metadata are
 * resolved live from the policy references on render and at submit time, so
 * edits to a section (drag, resize, comment) show up immediately in the chip
 * without any cross-panel sync plumbing.
 */
export type TaskBuilderSource = {
  sectionId: string
}

/** A follow-up the user composed while the agent was busy; gets sent
 *  automatically once the task transitions out of running. */
export type QueuedFollowUp = {
  /** Stable id for React keys + targeted removal. */
  id: string
  prompt: string
  sources: TaskBuilderSource[]
}

/** Where new "Use in task" attachments should be routed. The new-task builder
 *  by default; a specific task's follow-up while the user is composing one. */
export type AttachTarget =
  | { kind: 'new' }
  | { kind: 'follow-up'; threadId: string }

/** A profile being edited in the execution panel. Tracks identity + the
 *  current draft of the renameable fields; the value edits live in the
 *  execution panel's existing inputOverrides / entityData state. */
export type EditingProfile = {
  source: 'file' | 'local'
  id: string
  name: string
  description?: string
}

export type AiSendMessageArgs = {
  rulesetId: string
  message: string
  password: string
  history: { role: string; content: string }[]
}
export type AiSendMessage = (args: AiSendMessageArgs) => void

type PanelContextValue = {
  /** Tasks panel — in-progress prompt + attached sources for the new task. */
  taskBuilderDraft: string
  setTaskBuilderDraft: Dispatch<SetStateAction<string>>
  taskBuilderSources: TaskBuilderSource[]
  addTaskBuilderSource: (source: TaskBuilderSource) => void
  removeTaskBuilderSource: (sectionId: string) => void
  clearTaskBuilder: () => void

  /** Per-thread follow-up sources, keyed by task threadId. Cleared on submit. */
  followUpSources: Record<string, TaskBuilderSource[]>
  addFollowUpSource: (threadId: string, source: TaskBuilderSource) => void
  removeFollowUpSource: (threadId: string, sectionId: string) => void
  clearFollowUpSources: (threadId: string) => void

  /** Per-thread follow-up queue. Items are submitted in FIFO order whenever
   *  the task isn't already running. */
  followUpQueue: Record<string, QueuedFollowUp[]>
  enqueueFollowUp: (threadId: string, item: QueuedFollowUp) => void
  removeQueuedFollowUp: (threadId: string, id: string) => void

  /** Routing for the policy panel's "Use in task" button. Defaults to 'new'. */
  attachTarget: AttachTarget
  setAttachTarget: (target: AttachTarget) => void

  /** Profile currently being edited in the execution panel — its values
   *  are live in inputOverrides / entityData while the banner is shown,
   *  and "Save changes" overwrites the underlying file/local profile. */
  editingProfile: EditingProfile | null
  setEditingProfile: (p: EditingProfile | null) => void

  /** AI sidebar chat — survives close/reopen of the AI panel. */
  aiChatMessages: AiChatMessage[]
  setAiChatMessages: Dispatch<SetStateAction<AiChatMessage[]>>
  aiChatLoading: boolean
  setAiChatLoading: Dispatch<SetStateAction<boolean>>
  /** Stable handle the WS-stream hook (mounted at HomePage level) writes
   *  on installation; ChatBox dereferences it on submit. Ref instead of
   *  state because the function is opaque to renders — UI doesn't need
   *  to react when it changes. Default is a no-op so handleSubmit before
   *  the listener is installed is safe. */
  aiSendMessageRef: { current: AiSendMessage }
}

const PanelContext = createContext<PanelContextValue | undefined>(undefined)

export function PanelProvider({ children }: { children: ReactNode }) {
  const [taskBuilderDraft, setTaskBuilderDraft] = useState('')
  const [taskBuilderSources, setTaskBuilderSources] = useState<
    TaskBuilderSource[]
  >([])
  const [followUpSources, setFollowUpSources] = useState<
    Record<string, TaskBuilderSource[]>
  >({})
  const [followUpQueue, setFollowUpQueue] = useState<
    Record<string, QueuedFollowUp[]>
  >({})
  const [attachTarget, setAttachTarget] = useState<AttachTarget>({
    kind: 'new',
  })
  const [editingProfile, setEditingProfile] = useState<EditingProfile | null>(
    null
  )
  const [aiChatMessages, setAiChatMessages] = useState<AiChatMessage[]>([
    {
      type: 'aiMessage',
      message:
        'Ask me about the rules in this ruleset. I can explain how nodes are connected, what inputs are needed, or how a computation works.',
    },
  ])
  const [aiChatLoading, setAiChatLoading] = useState(false)
  // Stable ref overwritten by useAiChatStream on mount (HomePage). No-op
  // default keeps ChatBox safe before that effect has fired.
  const aiSendMessageRef = useRef<AiSendMessage>(() => {})

  const addTaskBuilderSource = useCallback((source: TaskBuilderSource) => {
    setTaskBuilderSources((prev) =>
      prev.some((s) => s.sectionId === source.sectionId)
        ? prev
        : [...prev, source]
    )
  }, [])

  const removeTaskBuilderSource = useCallback((sectionId: string) => {
    setTaskBuilderSources((prev) =>
      prev.filter((s) => s.sectionId !== sectionId)
    )
  }, [])

  const clearTaskBuilder = useCallback(() => {
    setTaskBuilderDraft('')
    setTaskBuilderSources([])
  }, [])

  const addFollowUpSource = useCallback(
    (threadId: string, source: TaskBuilderSource) => {
      setFollowUpSources((prev) => {
        const existing = prev[threadId] ?? []
        if (existing.some((s) => s.sectionId === source.sectionId)) return prev
        return { ...prev, [threadId]: [...existing, source] }
      })
    },
    []
  )

  const removeFollowUpSource = useCallback(
    (threadId: string, sectionId: string) => {
      setFollowUpSources((prev) => {
        const existing = prev[threadId]
        if (!existing) return prev
        const filtered = existing.filter((s) => s.sectionId !== sectionId)
        if (filtered.length === existing.length) return prev
        return { ...prev, [threadId]: filtered }
      })
    },
    []
  )

  const clearFollowUpSources = useCallback((threadId: string) => {
    setFollowUpSources((prev) => {
      if (!(threadId in prev)) return prev
      const next = { ...prev }
      delete next[threadId]
      return next
    })
  }, [])

  const enqueueFollowUp = useCallback(
    (threadId: string, item: QueuedFollowUp) => {
      setFollowUpQueue((prev) => ({
        ...prev,
        [threadId]: [...(prev[threadId] ?? []), item],
      }))
    },
    []
  )

  const removeQueuedFollowUp = useCallback((threadId: string, id: string) => {
    setFollowUpQueue((prev) => {
      const existing = prev[threadId]
      if (!existing) return prev
      const filtered = existing.filter((q) => q.id !== id)
      if (filtered.length === existing.length) return prev
      if (filtered.length === 0) {
        const next = { ...prev }
        delete next[threadId]
        return next
      }
      return { ...prev, [threadId]: filtered }
    })
  }, [])

  const value = useMemo<PanelContextValue>(
    () => ({
      taskBuilderDraft,
      setTaskBuilderDraft,
      taskBuilderSources,
      addTaskBuilderSource,
      removeTaskBuilderSource,
      clearTaskBuilder,
      followUpSources,
      addFollowUpSource,
      removeFollowUpSource,
      clearFollowUpSources,
      followUpQueue,
      enqueueFollowUp,
      removeQueuedFollowUp,
      attachTarget,
      setAttachTarget,
      editingProfile,
      setEditingProfile,
      aiChatMessages,
      setAiChatMessages,
      aiChatLoading,
      setAiChatLoading,
      aiSendMessageRef,
    }),
    [
      taskBuilderDraft,
      taskBuilderSources,
      addTaskBuilderSource,
      removeTaskBuilderSource,
      clearTaskBuilder,
      followUpSources,
      addFollowUpSource,
      removeFollowUpSource,
      clearFollowUpSources,
      followUpQueue,
      enqueueFollowUp,
      removeQueuedFollowUp,
      attachTarget,
      editingProfile,
      aiChatMessages,
      aiChatLoading,
    ]
  )

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
}

export function usePanelContext(): PanelContextValue {
  const ctx = useContext(PanelContext)
  if (!ctx) throw new Error('usePanelContext must be used within PanelProvider')
  return ctx
}
