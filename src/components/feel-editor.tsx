import { useRef, useMemo } from 'react'
import {
  EditorView,
  keymap,
  ViewPlugin,
  Decoration,
  type DecorationSet,
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
  '.cm-unknown-name': { textDecoration: 'wavy underline red' },
})

function nameHighlighter(knownNames: string[]): Extension {
  if (knownNames.length === 0) return []

  const nameSet = new Set(knownNames)

  // Build regex matching any identifier-like token (letters, digits, underscores)
  const escaped = knownNames.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  )
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'g')

  const knownMark = Decoration.mark({ class: 'cm-known-name' })

  const matcher = new MatchDecorator({
    regexp: pattern,
    decoration: (match) => {
      if (nameSet.has(match[0])) return knownMark
      return Decoration.mark({})
    },
  })

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view)
      }
      update(update: import('@codemirror/view').ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations)
      }
    },
    { decorations: (instance) => instance.decorations }
  )
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
      const newDoc = tr.newDoc.toString()
      if (newDoc.includes('\n')) {
        return {
          ...tr,
          changes: {
            from: 0,
            to: tr.startState.doc.length,
            insert: newDoc.replace(/\n/g, ''),
          },
        }
      }
      return tr
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
