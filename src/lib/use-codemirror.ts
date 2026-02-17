import { useEffect, useRef, useState, type RefObject } from 'react'
import { EditorView } from '@codemirror/view'
import {
  EditorState,
  type Extension,
  Annotation,
  Compartment,
} from '@codemirror/state'

const ExternalUpdate = Annotation.define<boolean>()

export function useCodeMirror(options: {
  containerRef: RefObject<HTMLDivElement | null>
  value: string
  onChange: (value: string) => void
  extensions: Extension[]
}): EditorView | null {
  const { containerRef, value, extensions } = options
  const [view, setView] = useState<EditorView | null>(null)
  const onChangeRef = useRef(options.onChange)
  onChangeRef.current = options.onChange
  const compartmentRef = useRef(new Compartment())

  // Create EditorView on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const compartment = compartmentRef.current

    const state = EditorState.create({
      doc: value,
      extensions: [
        compartment.of(extensions),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((tr) => tr.annotation(ExternalUpdate))
          ) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const editorView = new EditorView({ state, parent: container })
    setView(editorView)

    return () => {
      editorView.destroy()
      setView(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef])

  // Reconfigure extensions when they change
  useEffect(() => {
    if (!view) return
    view.dispatch({
      effects: compartmentRef.current.reconfigure(extensions),
    })
  }, [view, extensions])

  // Sync external value changes into the editor
  useEffect(() => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: ExternalUpdate.of(true),
      })
    }
  }, [view, value])

  return view
}
