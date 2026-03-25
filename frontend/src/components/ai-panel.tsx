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
import { Button } from './ui/button'
import { X, Send, ChevronRight, Copy, Check } from 'lucide-react'
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

type ChatMessage = UserMessage | AIMessage

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
    'AI chat coming soon. This panel will help you understand and explore rules.',
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
        <ChatScrollArea />
        <ChatBox />
      </div>
    </ChatProvider>
  )
}

function ChatBox() {
  const { addMessage, setShouldAutoScroll } = useChatContext()
  const [message, setMessage] = useState('')

  const handleSubmit = () => {
    if (!message.trim()) return
    setShouldAutoScroll(true)
    addMessage({
      type: 'userMessage',
      message: message.trim(),
    })
    // TODO: Wire up to AI backend
    setMessage('')
  }

  return (
    <div className="border-t p-3 shrink-0 flex flex-col gap-2">
      <textarea
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        rows={3}
        placeholder="Ask about your rules..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
          }
        }}
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
  }
}

const URL_PATTERN = /(https?:\/\/[^\s<>)"']+)/g

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
    const nodePattern = new RegExp(`(${escaped.join('|')})`, 'gi')

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
          <Check className="size-3.5 text-emerald-500" />
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
