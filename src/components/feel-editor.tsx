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
import { EditorState, type Extension } from '@codemirror/state'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { feel } from 'lang-feel'
import { useCodeMirror } from '@/lib/use-codemirror'
import { cn } from '@/lib/utils'

export const feelEditorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { padding: '8px', lineHeight: '19px', fontFamily: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { display: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-known-name': { color: '#7c3aed', fontWeight: '600' },
})

// Cache shared plugin instances by serialized name list
const pluginCache = new Map<string, Extension>()

function nameHighlighter(knownNames: string[]): Extension {
  if (knownNames.length === 0) return []

  const cacheKey = knownNames.join('\0')
  const cached = pluginCache.get(cacheKey)
  if (cached) return cached

  // Sort by descending length so longer names match before shorter overlapping ones
  const sorted = [...knownNames].sort((a, b) => b.length - a.length)

  const escaped = sorted.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  )
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'g')

  const knownMark = Decoration.mark({ class: 'cm-known-name' })

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

type FeelEditorProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  dialect?: 'expression' | 'unaryTests'
  knownNames?: string[]
}

export function createFeelExtensions(
  dialect: 'expression' | 'unaryTests' = 'expression',
  knownNames: string[] = []
): Extension[] {
  return [
    feel({ dialect }),
    syntaxHighlighting(defaultHighlightStyle),
    feelEditorTheme,
    nameHighlighter(knownNames),
    keymap.of([{ key: 'Enter', run: () => true }]),
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr
      let hasNewline = false
      tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        if (inserted.toString().includes('\n')) hasNewline = true
      })
      if (!hasNewline) return tr
      // Rebuild changes with newlines stripped from each insertion
      const changes: { from: number; to: number; insert: string }[] = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({
          from: fromA,
          to: toA,
          insert: inserted.toString().replace(/\n/g, ''),
        })
      })
      return { changes }
    }),
    EditorView.lineWrapping,
  ]
}

export function FeelEditor({
  value,
  onChange,
  className,
  dialect = 'expression',
  knownNames = [],
}: FeelEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const stableNames = useMemo(() => knownNames.join('\0'), [knownNames])
  const extensions = useMemo(
    () => createFeelExtensions(dialect, knownNames),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialect, stableNames]
  )

  useCodeMirror({
    containerRef,
    value,
    onChange,
    extensions,
  })

  return <div ref={containerRef} className={cn(className)} />
}
