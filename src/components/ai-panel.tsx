import { useState, useRef, useEffect } from 'react'
import { useMainContext } from '@/context'
import { Button } from './ui/button'
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from './ui/combobox'
import { X, Send } from 'lucide-react'

export function AIPanel() {
  const { setRightBar } = useMainContext()

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold">AI Assistant</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setRightBar(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <ChatContent />
      </div>
      <ChatBox />
    </div>
  )
}

function ChatBox() {
  const { model, openNode } = useMainContext()
  const [message, setMessage] = useState('')
  const [activeContext, setActiveContext] = useState<string | null>(null)
  const [additionalContexts, setAdditionalContexts] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const anchorRef = useComboboxAnchor()

  // Sync active context with open node
  useEffect(() => {
    setActiveContext(openNode)
  }, [openNode])

  // All contexts combined for submission
  const allContexts = activeContext
    ? [activeContext, ...additionalContexts.filter((id) => id !== activeContext)]
    : additionalContexts

  const nodeIds = Object.keys(model.nodes)
  const filteredNodeIds = nodeIds.filter(
    (id) =>
      model.nodes[id].name.toLowerCase().includes(search.toLowerCase()) &&
      !allContexts.includes(id)
  )

  const handleSubmit = () => {
    if (!message.trim()) return
    // TODO: Send message with contexts
    console.log('Send:', message, 'Contexts:', allContexts)
    setMessage('')
    setAdditionalContexts([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const maxHeight = 200
      const newHeight = Math.min(textarea.scrollHeight, maxHeight)
      textarea.style.height = `${newHeight}px`
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
    }
  }

  return (
    <div className="border-t p-3 shrink-0 flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={message}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your model..."
        className="resize-none rounded-md border px-3 py-2 text-sm overflow-hidden focus:outline-none focus:ring-1 focus:ring-ring"
        rows={1}
      />
      <div className="flex items-center gap-2">
        <Combobox multiple value={additionalContexts} onValueChange={setAdditionalContexts}>
          <ComboboxChips ref={anchorRef} className="flex-1 min-w-0">
            {activeContext && !additionalContexts.includes(activeContext) && (
              <span className="flex items-center gap-1 h-[calc(var(--spacing)*5.5)] px-1.5 text-xs font-medium rounded-sm bg-muted text-foreground">
                {model.nodes[activeContext]?.name ?? activeContext}
                <button
                  type="button"
                  onClick={() => setActiveContext(null)}
                  className="opacity-50 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {additionalContexts.map((nodeId) => (
              <ComboboxChip key={nodeId} value={nodeId}>
                {model.nodes[nodeId]?.name ?? nodeId}
              </ComboboxChip>
            ))}
            <ComboboxChipsInput
              placeholder={allContexts.length === 0 ? 'Add context...' : ''}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </ComboboxChips>
          <ComboboxContent anchor={anchorRef} side="top">
            <ComboboxList>
              {filteredNodeIds.map((nodeId) => (
                <ComboboxItem key={nodeId} value={nodeId}>
                  {model.nodes[nodeId].name}
                </ComboboxItem>
              ))}
            </ComboboxList>
            {filteredNodeIds.length === 0 && (
              <ComboboxEmpty>No nodes found.</ComboboxEmpty>
            )}
          </ComboboxContent>
        </Combobox>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!message.trim()}
        >
          <Send className="size-4 mr-1" />
          Send
        </Button>
      </div>
    </div>
  )
}

function ChatContent() {
  return (
    <div className="flex flex-col gap-4">
      <UserMessage
        message="Can you help me add a new eligibility rule?"
        contexts={[
          'c0000000-0000-0000-0000-000000000008',
          'c0000000-0000-0000-0000-000000000005',
        ]}
      />
      <AIMessage
        message="I'd be happy to help you add a new eligibility rule. Based on the context you've provided, I can see you're working with Income_Threshold and Age_Eligibility nodes. What kind of rule would you like to add?"
        contexts={[
          'c0000000-0000-0000-0000-000000000008',
          'c0000000-0000-0000-0000-000000000005',
        ]}
      />
      <UserMessage
        message="Add a rule that checks if the applicant has been employed for at least 2 years"
        contexts={[]}
      />
      <ToolCall
        name="create_node"
        status="success"
        result="Created node: Employment_Duration"
        contexts={['c0000000-0000-0000-0000-00000000000a']}
      />
      <AIMessage
        message="I've created a new node called Employment_Duration. Now I'll add it as a dependency to your eligibility factors."
        contexts={['c0000000-0000-0000-0000-00000000000a']}
      />
      <ToolCall name="update_node" status="pending" contexts={[]} />
    </div>
  )
}

function ContextChips({ contexts }: { contexts: string[] }) {
  const { model, setOpenNode } = useMainContext()

  if (contexts.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {contexts.map((nodeId) => {
        const node = model.nodes[nodeId]
        const name = node?.name ?? nodeId
        return (
          <button
            key={nodeId}
            onClick={() => setOpenNode(nodeId)}
            className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200"
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}

type UserMessageProps = {
  message: string
  contexts: string[]
}

export function UserMessage({ message, contexts }: UserMessageProps) {
  return (
    <div className="flex flex-col items-end">
      <div className="bg-muted rounded-lg px-3 py-2 text-sm max-w-[85%]">
        {message}
        <ContextChips contexts={contexts} />
      </div>
    </div>
  )
}

type AIMessageProps = {
  message: string
  contexts?: string[]
}

export function AIMessage({ message, contexts = [] }: AIMessageProps) {
  return (
    <div className="bg-background border rounded-lg px-3 py-2 text-sm max-w-[85%]">
      {message}
      <ContextChips contexts={contexts} />
    </div>
  )
}

type ToolCallProps = {
  name: string
  status: 'pending' | 'success' | 'error'
  result?: string
  contexts?: string[]
}

export function ToolCall({
  name,
  status,
  result,
  contexts = [],
}: ToolCallProps) {
  return (
    <div className="border rounded-lg overflow-hidden text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b">
        <span className="font-mono text-xs">{name}</span>
        {status === 'pending' && (
          <span className="text-xs text-muted-foreground">Running...</span>
        )}
        {status === 'success' && (
          <span className="text-xs text-emerald-600">Done</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-600">Error</span>
        )}
      </div>
      {result && (
        <div className="px-3 py-2 font-mono text-xs whitespace-pre-wrap bg-muted/20">
          {result}
        </div>
      )}
      {contexts.length > 0 && (
        <div className="px-3 py-2 border-t">
          <ContextChips contexts={contexts} />
        </div>
      )}
    </div>
  )
}
