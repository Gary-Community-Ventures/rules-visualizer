import {
  useState,
  useMemo,
  createContext,
  useContext,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useMainContext } from '@/context'
import { useSocket } from '@/lib/sockets'
import { Button } from './ui/button'
import { X, Send, ChevronRight } from 'lucide-react'
import { ChatEditor } from './chat-editor'
import { cn } from '@/lib/utils'

type UserMessage = {
  type: 'userMessage'
  message: string
}

type AIMessage = {
  type: 'aiMessage'
  message: string
}

type ToolCall = {
  type: 'toolCall'
  name: string
  status: 'pending' | 'success' | 'error'
  result?: string
  contexts?: string[]
}

type SubAgent = {
  type: 'subAgent'
  name: string
  status: 'pending' | 'success' | 'error'
  messages: ChatMessage[]
}

type ChatMessage = UserMessage | AIMessage | ToolCall | SubAgent

type ChatContextType = {
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  addMessage: (message: ChatMessage) => void
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

function useChatContext() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider')
  }
  return context
}

function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      type: 'userMessage',
      message: 'Can you help me add a new eligibility rule?',
    },
    {
      type: 'aiMessage',
      message:
        "I'd be happy to help you add a new eligibility rule. Based on the context you've provided, I can see you're working with Income_Threshold and Age_Eligibility nodes. What kind of rule would you like to add?",
    },
    {
      type: 'userMessage',
      message:
        'Add a rule that checks if the applicant has been employed for at least 2 years',
    },
    {
      type: 'toolCall',
      name: 'create_node',
      status: 'success',
      result: 'Created node: Employment_Duration',
    },
    {
      type: 'aiMessage',
      message:
        "I've created a new node called Employment_Duration. Now I'll add it as a dependency to your eligibility factors.",
    },
    {
      type: 'subAgent',
      name: 'Research Agent',
      status: 'success',
      messages: [
        {
          type: 'aiMessage',
          message: 'Analyzing existing eligibility rules in the model...',
        },
        {
          type: 'toolCall',
          name: 'read_node',
          status: 'success',
          result: 'Found 3 existing eligibility rules',
        },
        {
          type: 'aiMessage',
          message: 'Research complete. Found patterns for eligibility rules.',
        },
      ],
    },
    {
      type: 'toolCall',
      name: 'update_node',
      status: 'pending',
    },
  ])

  const addMessage = (message: ChatMessage) => {
    setMessages((prev) => [...prev, message])
  }

  return (
    <ChatContext.Provider value={{ messages, setMessages, addMessage }}>
      {children}
    </ChatContext.Provider>
  )
}

export function AIPanel() {
  const { setRightBar } = useMainContext()

  return (
    <ChatProvider>
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
    </ChatProvider>
  )
}

function ChatBox() {
  const { model, setOpenNode } = useMainContext()
  const { addMessage } = useChatContext()
  const [message, setMessage] = useState('')
  const socket = useSocket()

  // Build name -> id map for parsing mentions and clicking
  const nameToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [id, node] of Object.entries(model.nodes)) {
      map.set(node.name.toLowerCase(), id)
    }
    return map
  }, [model.nodes])

  const knownNames = useMemo(
    () => Object.values(model.nodes).map((n) => n.name),
    [model.nodes]
  )

  const handleSubmit = () => {
    if (!message.trim()) return
    addMessage({
      type: 'userMessage',
      message: message.trim(),
    })
    socket.emit('ai-chat', { message: message.trim() })
    setMessage('')
  }

  const handleNodeClick = (name: string) => {
    const id = nameToId.get(name.toLowerCase())
    if (id) setOpenNode(id)
  }

  return (
    <div className="border-t p-3 shrink-0 flex flex-col gap-2">
      <ChatEditor
        value={message}
        onChange={setMessage}
        onSubmit={handleSubmit}
        onNodeClick={handleNodeClick}
        knownNames={knownNames}
        placeholder="Ask about your model..."
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSubmit} disabled={!message.trim()}>
          <Send className="size-4 mr-1" />
          Send
        </Button>
      </div>
    </div>
  )
}

function ChatContent() {
  const { messages } = useChatContext()

  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg, index) => (
        <ChatMessageView key={index} message={msg} />
      ))}
    </div>
  )
}

function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.type) {
    case 'userMessage':
      return <UserMessageView message={message} />
    case 'aiMessage':
      return <AIMessageView message={message} />
    case 'toolCall':
      return <ToolCallView message={message} />
    case 'subAgent':
      return <SubAgentView message={message} />
  }
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

function ClickableNodeText({ text }: { text: string }) {
  const { model, setOpenNode } = useMainContext()

  const nameToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [id, node] of Object.entries(model.nodes)) {
      map.set(node.name.toLowerCase(), id)
    }
    return map
  }, [model.nodes])

  const parts = useMemo(() => {
    const nodeNames = Object.values(model.nodes).map((n) => n.name)
    if (nodeNames.length === 0) return [{ type: 'text' as const, content: text }]

    // Sort by length descending to match longer names first
    const sorted = [...nodeNames].sort((a, b) => b.length - a.length)
    const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')

    const result: { type: 'text' | 'node'; content: string }[] = []
    let lastIndex = 0
    let match

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', content: text.slice(lastIndex, match.index) })
      }
      result.push({ type: 'node', content: match[1] })
      lastIndex = pattern.lastIndex
    }

    if (lastIndex < text.length) {
      result.push({ type: 'text', content: text.slice(lastIndex) })
    }

    return result.length > 0 ? result : [{ type: 'text' as const, content: text }]
  }, [text, model.nodes])

  return (
    <>
      {parts.map((part, i) =>
        part.type === 'node' ? (
          <button
            key={i}
            onClick={() => {
              const id = nameToId.get(part.content.toLowerCase())
              if (id) setOpenNode(id)
            }}
            className="text-violet-600 font-semibold hover:underline"
          >
            {part.content}
          </button>
        ) : (
          <span key={i}>{part.content}</span>
        )
      )}
    </>
  )
}

function UserMessageView({ message }: { message: UserMessage }) {
  return (
    <div className="flex flex-col items-end">
      <div className="bg-muted rounded-lg px-3 py-2 text-sm max-w-[85%]">
        <ClickableNodeText text={message.message} />
      </div>
    </div>
  )
}

function AIMessageView({ message }: { message: AIMessage }) {
  return (
    <div className="bg-background border rounded-lg px-3 py-2 text-sm max-w-[85%]">
      <ClickableNodeText text={message.message} />
    </div>
  )
}

function ToolCallView({ message }: { message: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = message.result || (message.contexts && message.contexts.length > 0)

  return (
    <div className="border rounded-lg overflow-hidden text-sm">
      <button
        type="button"
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 bg-muted/50 w-full text-left',
          hasContent && 'cursor-pointer hover:bg-muted/70',
          expanded && 'border-b'
        )}
        onClick={() => hasContent && setExpanded(!expanded)}
        disabled={!hasContent}
      >
        {hasContent && (
          <ChevronRight
            className={cn(
              'size-3 transition-transform',
              expanded && 'rotate-90'
            )}
          />
        )}
        <span className="font-mono text-xs">{message.name}</span>
        {message.status === 'pending' && (
          <span className="text-xs text-muted-foreground">Running...</span>
        )}
        {message.status === 'success' && (
          <span className="text-xs text-emerald-600">Done</span>
        )}
        {message.status === 'error' && (
          <span className="text-xs text-red-600">Error</span>
        )}
      </button>
      {expanded && (
        <>
          {message.result && (
            <div className="px-3 py-2 font-mono text-xs whitespace-pre-wrap bg-muted/20">
              {message.result}
            </div>
          )}
          {message.contexts && message.contexts.length > 0 && (
            <div className="px-3 py-2 border-t">
              <ContextChips contexts={message.contexts} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SubAgentView({ message }: { message: SubAgent }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-dashed rounded-lg overflow-hidden text-sm">
      <button
        type="button"
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 bg-muted/50 w-full text-left',
          'cursor-pointer hover:bg-muted/70',
          expanded && 'border-b'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            'size-3 transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <span className="text-xs font-medium">{message.name}</span>
        {message.status === 'pending' && (
          <span className="text-xs text-muted-foreground">Running...</span>
        )}
        {message.status === 'success' && (
          <span className="text-xs text-emerald-600">Done</span>
        )}
        {message.status === 'error' && (
          <span className="text-xs text-red-600">Error</span>
        )}
      </button>
      {expanded && (
        <div className="p-3 flex flex-col gap-3">
          {message.messages.map((msg, index) => (
            <ChatMessageView key={index} message={msg} />
          ))}
        </div>
      )}
    </div>
  )
}
