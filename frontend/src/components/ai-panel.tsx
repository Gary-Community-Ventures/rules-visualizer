import {
  useState,
  useMemo,
  useRef,
  useEffect,
  createContext,
  useContext,
  isValidElement,
  cloneElement,
  type ReactNode,
  type ReactElement,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useMainContext } from '@/context'
import { cn } from '@/lib/utils'
import { onAiEvent, sendWsMessage, type AiEvent } from '@/lib/api/live-reload'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { X, Send, ChevronRight, Copy, Check, Lock } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SnakeLoader } from './snake-game'

type UserMessage = {
  type: 'userMessage'
  message: string
}

type AIMessage = {
  type: 'aiMessage'
  message: string
}

type ToolCallMessage = {
  type: 'toolCall'
  name: string
  id: string
  status: 'pending' | 'success' | 'error'
  result?: string
}

type ChatMessage = UserMessage | AIMessage | ToolCallMessage

type ChatContextType = {
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  addMessage: (message: ChatMessage) => void
  scrollToBottom: () => void
  setScrollRef: (ref: HTMLDivElement | null) => void
  shouldAutoScroll: boolean
  setShouldAutoScroll: Dispatch<SetStateAction<boolean>>
  isLoading: boolean
  setIsLoading: Dispatch<SetStateAction<boolean>>
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

function useChatContext() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider')
  }
  return context
}

const GREETING: AIMessage = {
  type: 'aiMessage',
  message:
    'Ask me about the rules in this ruleset. I can explain how nodes are connected, what inputs are needed, or how a computation works.',
}

function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [isLoading, setIsLoading] = useState(false)

  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const addMessage = (message: ChatMessage) => {
    setMessages((prev) => [...prev, message])
  }

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }

  const setScrollRef = (ref: HTMLDivElement | null) => {
    scrollRef.current = ref
  }

  return (
    <ChatContext.Provider
      value={{
        messages,
        setMessages,
        addMessage,
        scrollToBottom,
        setScrollRef,
        shouldAutoScroll,
        setShouldAutoScroll,
        isLoading,
        setIsLoading,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function AIPanel() {
  const { setRightBar } = useMainContext()
  const [hasPassword, setHasPassword] = useState(
    () => !!localStorage.getItem('ai-password')
  )

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
      {hasPassword ? (
        <ChatProvider>
          <ChatScrollArea />
          <ChatBox onPasswordError={() => setHasPassword(false)} />
        </ChatProvider>
      ) : (
        <PasswordGate onSubmit={() => setHasPassword(true)} />
      )}
    </div>
  )
}

function PasswordGate({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('')
  const handleSubmit = () => {
    if (!value.trim()) return
    localStorage.setItem('ai-password', value.trim())
    setValue('')
    onSubmit()
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
      <Lock className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground text-center">
        Enter the AI password to use the assistant
      </p>
      <form
        className="flex gap-2 w-full max-w-64"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <Input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
          className="h-8 text-sm"
          autoFocus
        />
        <Button size="sm" type="submit" disabled={!value.trim()}>
          Go
        </Button>
      </form>
    </div>
  )
}

function ChatBox({ onPasswordError }: { onPasswordError: () => void }) {
  const {
    messages,
    addMessage,
    setMessages,
    setShouldAutoScroll,
    isLoading,
    setIsLoading,
  } = useChatContext()
  const { model } = useMainContext()
  const [message, setMessage] = useState('')
  const requestIdRef = useRef(0)
  const aiContentRef = useRef('')

  // Listen for AI WebSocket events
  useEffect(() => {
    return onAiEvent((event: AiEvent) => {
      const currentId = String(requestIdRef.current)
      if (event.requestId !== currentId) return

      switch (event.type) {
        case 'ai-chunk':
          aiContentRef.current += event.content
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.type === 'aiMessage') {
              return [
                ...prev.slice(0, -1),
                { type: 'aiMessage', message: aiContentRef.current },
              ]
            }
            return [
              ...prev,
              { type: 'aiMessage', message: aiContentRef.current },
            ]
          })
          break
        case 'ai-tool-start':
          aiContentRef.current = ''
          setMessages((prev) => [
            ...prev,
            {
              type: 'toolCall',
              name: event.name,
              id: event.id,
              status: 'pending',
            },
          ])
          break
        case 'ai-tool-end':
          setMessages((prev) =>
            prev.map((m) =>
              m.type === 'toolCall' && m.id === event.id
                ? { ...m, status: 'success' as const, result: event.result }
                : m
            )
          )
          break
        case 'ai-done':
          setIsLoading(false)
          break
        case 'ai-error':
          if (event.content === 'Invalid AI password') {
            localStorage.removeItem('ai-password')
            onPasswordError()
            setIsLoading(false)
            return
          }
          setMessages((prev) => [
            ...prev,
            { type: 'aiMessage', message: `Error: ${event.content}` },
          ])
          setIsLoading(false)
          break
      }
    })
  }, [setMessages, setIsLoading])

  const handleSubmit = () => {
    if (!message.trim() || isLoading) return
    const userMsg = message.trim()
    setShouldAutoScroll(true)
    addMessage({ type: 'userMessage', message: userMsg })
    setMessage('')
    setIsLoading(true)
    aiContentRef.current = ''

    // Build history from existing messages (include tool call summaries)
    const history: { role: string; content: string }[] = []
    for (const m of messages) {
      if (m === GREETING) continue
      if (m.type === 'userMessage') {
        history.push({ role: 'user', content: m.message })
      } else if (m.type === 'aiMessage') {
        history.push({ role: 'assistant', content: m.message })
      } else if (m.type === 'toolCall' && m.status === 'success' && m.result) {
        // Summarize tool results so the model retains context.
        // Truncate large results to avoid blowing up the context.
        const truncated =
          m.result.length > 500
            ? m.result.slice(0, 500) + '... (truncated)'
            : m.result
        history.push({
          role: 'assistant',
          content: `[Tool: ${m.name}] ${truncated}`,
        })
      }
    }

    const reqId = ++requestIdRef.current

    sendWsMessage({
      type: 'ai-chat',
      requestId: String(reqId),
      rulesetId: model.id,
      message: userMsg,
      password: localStorage.getItem('ai-password') ?? '',
      history,
    })
  }

  return (
    <div className="border-t p-3 shrink-0 flex flex-col gap-2">
      <ChatInput
        value={message}
        onChange={setMessage}
        onSubmit={handleSubmit}
        placeholder="Ask about your rules..."
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!message.trim() || isLoading}
        >
          <Send className="size-4 mr-1" />
          Send
        </Button>
      </div>
    </div>
  )
}

function ChatScrollArea() {
  const {
    messages,
    setScrollRef,
    scrollToBottom,
    shouldAutoScroll,
    setShouldAutoScroll,
  } = useChatContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  useEffect(() => {
    setScrollRef(containerRef.current)
  }, [setScrollRef])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 50
    setIsAtBottom(atBottom)
    setShouldAutoScroll(atBottom)
  }

  useEffect(() => {
    if (shouldAutoScroll && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages, shouldAutoScroll])

  const handleScrollToBottom = () => {
    setShouldAutoScroll(true)
    scrollToBottom()
  }

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto p-4"
      >
        <ChatContent />
      </div>
      {!isAtBottom && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute bottom-2 right-4 rounded-full shadow-md h-8 w-8"
          onClick={handleScrollToBottom}
        >
          <ChevronRight className="size-4 rotate-90" />
        </Button>
      )}
    </div>
  )
}

function ChatContent() {
  const { messages, isLoading } = useChatContext()

  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg, index) => (
        <ChatMessageView key={index} message={msg} />
      ))}
      {isLoading && (
        <div className="text-muted-foreground">
          <SnakeLoader />
        </div>
      )}
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
  }
}

function ToolCallView({ message }: { message: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = !!message.result

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
          <span className="text-xs text-emerald-700">Done</span>
        )}
        {message.status === 'error' && (
          <span className="text-xs text-orange-700">Error</span>
        )}
      </button>
      {expanded && message.result && (
        <div className="px-3 py-2 font-mono text-xs whitespace-pre-wrap bg-muted/20">
          {message.result}
        </div>
      )}
    </div>
  )
}

function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
}) {
  const { model } = useMainContext()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const nodeNames = useMemo(
    () => Object.values(model.nodes).map((n) => n.name),
    [model.nodes]
  )

  // Get the current word being typed (after last space or start)
  const currentWord = useMemo(() => {
    const textarea = textareaRef.current
    if (!textarea) return ''
    const pos = textarea.selectionStart
    const textBefore = value.slice(0, pos)
    const match = textBefore.match(/\S+$/)
    return match ? match[0] : ''
  }, [value])

  const suggestions = useMemo(() => {
    if (currentWord.length < 2) return []
    const q = currentWord.toLowerCase()
    return nodeNames
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [currentWord, nodeNames])

  useEffect(() => {
    setShowSuggestions(suggestions.length > 0)
    setSelectedIndex(0)
  }, [suggestions])

  const applySuggestion = (name: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart
    const textBefore = value.slice(0, pos)
    const wordStart = textBefore.search(/\S+$/)
    const newValue =
      value.slice(0, wordStart === -1 ? pos : wordStart) +
      name +
      ' ' +
      value.slice(pos)
    onChange(newValue)
    setShowSuggestions(false)
    textarea.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        applySuggestion(suggestions[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        rows={3}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
      />
      {showSuggestions && (
        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md z-50">
          {suggestions.map((name, i) => (
            <button
              key={name}
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-left transition-colors',
                i === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                applySuggestion(name)
              }}
            >
              <span className="font-mono truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const URL_PATTERN = /(https?:\/\/[^\s<>)"']+)/g

function ClickableNodeText({ text }: { text: string }) {
  const { model, setOpenNode } = useMainContext()

  const nameToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [id, node] of Object.entries(model.nodes)) {
      map.set(node.name, id)
    }
    return map
  }, [model.nodes])

  const parts = useMemo(() => {
    type Part = { type: 'text' | 'node' | 'url'; content: string }
    const result: Part[] = []

    const urlParts: { type: 'text' | 'url'; content: string }[] = []
    let lastIndex = 0
    let match

    URL_PATTERN.lastIndex = 0
    while ((match = URL_PATTERN.exec(text)) !== null) {
      if (match.index > lastIndex) {
        urlParts.push({
          type: 'text',
          content: text.slice(lastIndex, match.index),
        })
      }
      urlParts.push({ type: 'url', content: match[1] })
      lastIndex = URL_PATTERN.lastIndex
    }
    if (lastIndex < text.length) {
      urlParts.push({ type: 'text', content: text.slice(lastIndex) })
    }
    if (urlParts.length === 0) {
      urlParts.push({ type: 'text', content: text })
    }

    const nodeNames = Object.values(model.nodes).map((n) => n.name)
    if (nodeNames.length === 0) {
      return urlParts as Part[]
    }

    const sorted = [...nodeNames].sort((a, b) => b.length - a.length)
    const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const nodePattern = new RegExp(`(${escaped.join('|')})`, 'g')

    for (const part of urlParts) {
      if (part.type === 'url') {
        result.push(part)
      } else {
        let nodeLastIndex = 0
        nodePattern.lastIndex = 0
        while ((match = nodePattern.exec(part.content)) !== null) {
          if (match.index > nodeLastIndex) {
            result.push({
              type: 'text',
              content: part.content.slice(nodeLastIndex, match.index),
            })
          }
          result.push({ type: 'node', content: match[1] })
          nodeLastIndex = nodePattern.lastIndex
        }
        if (nodeLastIndex < part.content.length) {
          result.push({
            type: 'text',
            content: part.content.slice(nodeLastIndex),
          })
        }
      }
    }

    return result.length > 0
      ? result
      : [{ type: 'text' as const, content: text }]
  }, [text, model.nodes])

  return (
    <>
      {parts.map((part, i) =>
        part.type === 'url' ? (
          <a
            key={i}
            href={part.content}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {part.content}
          </a>
        ) : part.type === 'node' ? (
          <button
            key={i}
            onClick={() => {
              const id = nameToId.get(part.content)
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

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const text = extractText(children)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 p-1.5 rounded bg-muted/80 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600" />
        ) : (
          <Copy className="size-3.5 text-muted-foreground" />
        )}
      </button>
      <pre>{children}</pre>
    </div>
  )
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    return extractText(
      (node as ReactElement<{ children?: ReactNode }>).props.children
    )
  }
  return ''
}

function processClickableNodes(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    return <ClickableNodeText text={node} />
  }
  if (typeof node === 'number') {
    return <ClickableNodeText text={String(node)} />
  }
  if (!node) {
    return null
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => {
      const processed = processClickableNodes(child)
      if (isValidElement(processed)) {
        return cloneElement(processed, { key: i })
      }
      return processed
    })
  }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>
    return cloneElement(el, {
      children: processClickableNodes(el.props.children),
    })
  }
  return node
}

function WithClickableNodes({ children }: { children: ReactNode }): ReactNode {
  return processClickableNodes(children)
}

function AIMessageView({ message }: { message: AIMessage }) {
  return (
    <div className="bg-background border rounded-lg px-3 py-2 text-sm max-w-[85%] prose prose-sm prose-neutral dark:prose-invert prose-p:my-1 prose-pre:bg-muted prose-pre:text-foreground">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p>
              <WithClickableNodes>{children}</WithClickableNodes>
            </p>
          ),
          li: ({ children }) => (
            <li>
              <WithClickableNodes>{children}</WithClickableNodes>
            </li>
          ),
          strong: ({ children }) => (
            <strong>
              <WithClickableNodes>{children}</WithClickableNodes>
            </strong>
          ),
          em: ({ children }) => (
            <em>
              <WithClickableNodes>{children}</WithClickableNodes>
            </em>
          ),
          h1: ({ children }) => (
            <h1>
              <WithClickableNodes>{children}</WithClickableNodes>
            </h1>
          ),
          h2: ({ children }) => (
            <h2>
              <WithClickableNodes>{children}</WithClickableNodes>
            </h2>
          ),
          h3: ({ children }) => (
            <h3>
              <WithClickableNodes>{children}</WithClickableNodes>
            </h3>
          ),
          h4: ({ children }) => (
            <h4>
              <WithClickableNodes>{children}</WithClickableNodes>
            </h4>
          ),
          h5: ({ children }) => (
            <h5>
              <WithClickableNodes>{children}</WithClickableNodes>
            </h5>
          ),
          h6: ({ children }) => (
            <h6>
              <WithClickableNodes>{children}</WithClickableNodes>
            </h6>
          ),
          code: ({ children, className }) => {
            const isInline = !className
            return isInline ? (
              <code>
                <WithClickableNodes>{children}</WithClickableNodes>
              </code>
            ) : (
              <code className={className}>
                <WithClickableNodes>{children}</WithClickableNodes>
              </code>
            )
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {extractText(children)}
            </a>
          ),
          td: ({ children }) => (
            <td>
              <WithClickableNodes>{children}</WithClickableNodes>
            </td>
          ),
          th: ({ children }) => (
            <th>
              <WithClickableNodes>{children}</WithClickableNodes>
            </th>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {message.message}
      </Markdown>
    </div>
  )
}
