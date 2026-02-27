import { useRef, useMemo } from 'react'
import {
  EditorView,
  keymap,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  MatchDecorator,
} from '@codemirror/view'
import { type Extension } from '@codemirror/state'
import { autocompletion, type CompletionSource } from '@codemirror/autocomplete'
import { useCodeMirror } from '@/lib/use-codemirror'
import { cn } from '@/lib/utils'

const chatEditorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '14px', maxHeight: '50vh' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    padding: '8px 12px',
    lineHeight: '20px',
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { display: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-node-name': {
    color: '#7c3aed',
    fontWeight: '600',
    cursor: 'pointer',
    borderRadius: '2px',
  },
  '.cm-node-name:hover': {
    backgroundColor: '#ede9fe',
  },
})

// Cache shared plugin instances by serialized name list
const pluginCache = new Map<string, Extension>()

function nameHighlighter(knownNames: string[]): Extension {
  const validNames = knownNames.filter((n) => n.length > 0)
  if (validNames.length === 0) return []

  const cacheKey = validNames.join('\0')
  const cached = pluginCache.get(cacheKey)
  if (cached) return cached

  // Sort by descending length so longer names match before shorter overlapping ones
  const sorted = [...validNames].sort((a, b) => b.length - a.length)

  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')

  const knownMark = Decoration.mark({ class: 'cm-node-name' })

  const matcher = new MatchDecorator({
    regexp: pattern,
    decoration: () => knownMark,
  })

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view)
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations)
      }
    },
    { decorations: (instance) => instance.decorations }
  )

  pluginCache.set(cacheKey, plugin)
  return plugin
}

function nameCompletionSource(knownNames: string[]): CompletionSource {
  const validNames = knownNames.filter((n) => n.length > 0)
  return (context) => {
    const word = context.matchBefore(/[\w]+/)
    if (!word || word.text.length < 2) return null
    return {
      from: word.from,
      options: validNames
        .filter((name) => name.toLowerCase().includes(word.text.toLowerCase()))
        .map((name) => ({
          label: name,
          type: 'variable',
        })),
      validFor: /^[\w]*$/,
    }
  }
}

type ChatEditorProps = {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  onNodeClick?: (name: string) => void
  className?: string
  knownNames?: string[]
  placeholder?: string
}

export function ChatEditor({
  value,
  onChange,
  onSubmit,
  onNodeClick,
  className,
  knownNames = [],
  placeholder = '',
}: ChatEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const stableNames = useMemo(() => knownNames.join('\0'), [knownNames])
  const extensions = useMemo(
    () => [
      chatEditorTheme,
      nameHighlighter(knownNames),
      autocompletion({
        override: [nameCompletionSource(knownNames)],
      }),
      EditorView.lineWrapping,
      placeholder ? EditorView.contentAttributes.of({ 'aria-placeholder': placeholder }) : [],
      placeholderExtension(placeholder),
      // Handle Enter to submit (Shift+Enter for newline)
      keymap.of([
        {
          key: 'Enter',
          run: () => {
            onSubmit?.()
            return true
          },
        },
        {
          key: 'Shift-Enter',
          run: (view) => {
            view.dispatch(view.state.replaceSelection('\n'))
            return true
          },
        },
      ]),
      // Click handler for node names
      EditorView.domEventHandlers({
        click: (event) => {
          const target = event.target as HTMLElement
          if (target.classList.contains('cm-node-name')) {
            const name = target.textContent
            if (name && onNodeClick) {
              onNodeClick(name)
            }
          }
          return false
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableNames, placeholder, onSubmit, onNodeClick]
  )

  useCodeMirror({
    containerRef,
    value,
    onChange,
    extensions,
  })

  return (
    <div
      ref={containerRef}
      className={cn(
        'rounded-md border text-sm focus-within:ring-1 focus-within:ring-ring',
        className
      )}
    />
  )
}

function placeholderExtension(text: string): Extension {
  if (!text) return []
  return EditorView.theme({
    '.cm-content:has(.cm-line:only-child:empty)::before': {
      content: `"${text.replace(/"/g, '\\"')}"`,
      color: '#9ca3af',
      position: 'absolute',
      pointerEvents: 'none',
    },
  })
}
