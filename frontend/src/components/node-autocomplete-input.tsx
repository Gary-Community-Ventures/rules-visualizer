import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMainContext } from '@/context'
import { cn } from '@/lib/utils'

/**
 * Textarea with node-name autocomplete that anchors the suggestion dropdown
 * to the caret (like a code editor). Trigger: type at least two non-space
 * characters; suggestions filter by substring match against node names.
 * Tab/Enter applies, Arrow keys navigate, Esc dismisses, plain Enter (no
 * Shift) submits.
 */
export function NodeAutocompleteInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  rows = 3,
  className,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  rows?: number
  className?: string
}) {
  const { model } = useMainContext()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [caretRect, setCaretRect] = useState<CaretRect | null>(null)
  const [placeAbove, setPlaceAbove] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const nodeNames = useMemo(
    () => Object.values(model.nodes).map((n) => n.name),
    [model.nodes]
  )

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

  const updateCaretRect = () => {
    const ta = textareaRef.current
    if (!ta) return
    setCaretRect(getViewportCaretRect(ta, ta.selectionStart))
  }

  // Reposition the dropdown whenever the value changes or suggestions appear.
  useLayoutEffect(() => {
    if (showSuggestions) updateCaretRect()
  }, [showSuggestions, value])

  // Decide flip direction from the actually rendered dropdown height. Runs
  // before paint, so the caller never sees the dropdown in the wrong slot.
  useLayoutEffect(() => {
    if (!showSuggestions || !caretRect || !dropdownRef.current) return
    const dropdownHeight = dropdownRef.current.offsetHeight
    const spaceBelow = window.innerHeight - (caretRect.top + caretRect.height)
    setPlaceAbove(spaceBelow < dropdownHeight && caretRect.top > spaceBelow)
  }, [showSuggestions, caretRect, suggestions.length])

  // Track scroll/resize on ancestors so the dropdown stays glued to the caret.
  useEffect(() => {
    if (!showSuggestions) return
    const handler = () => updateCaretRect()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [showSuggestions])

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
        setSelectedIndex((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(
          (i) => (i - 1 + suggestions.length) % suggestions.length
        )
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
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
        className={cn(
          'w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onSelect={updateCaretRect}
        onClick={updateCaretRect}
        onFocus={updateCaretRect}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        disabled={disabled}
      />
      {showSuggestions &&
        caretRect &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md z-50 min-w-40"
            style={
              placeAbove
                ? {
                    bottom: window.innerHeight - caretRect.top,
                    left: caretRect.left,
                  }
                : {
                    top: caretRect.top + caretRect.height,
                    left: caretRect.left,
                  }
            }
          >
            {suggestions.map((name, i) => (
              <button
                key={name}
                type="button"
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
          </div>,
          document.body
        )}
    </div>
  )
}


type CaretRect = { top: number; left: number; height: number }

// Style props that affect text wrapping/measurement; we copy these from the
// textarea onto a hidden mirror div so we can measure where the caret would
// land in screen pixels. Standard "mirror div" technique.
const MIRROR_PROPS: (keyof CSSStyleDeclaration)[] = [
  'boxSizing',
  'width',
  'height',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'tabSize',
]

function getViewportCaretRect(
  textarea: HTMLTextAreaElement,
  position: number
): CaretRect {
  const div = document.createElement('div')
  document.body.appendChild(div)
  const computed = window.getComputedStyle(textarea)
  const s = div.style

  s.position = 'absolute'
  s.visibility = 'hidden'
  s.whiteSpace = 'pre-wrap'
  s.wordWrap = 'break-word'
  s.top = '0'
  s.left = '-9999px'

  for (const prop of MIRROR_PROPS) {
    // CSSStyleDeclaration is index-able by camelCase property name.
    ;(s as unknown as Record<string, string>)[prop as string] = computed[
      prop
    ] as string
  }

  div.textContent = textarea.value.slice(0, position)
  const span = document.createElement('span')
  // Non-empty text so the span renders with a measurable height even when
  // the caret is at the end of the content.
  span.textContent = textarea.value.slice(position) || '.'
  div.appendChild(span)

  const lineHeight =
    parseFloat(computed.lineHeight) ||
    parseFloat(computed.fontSize) * 1.2

  const localTop =
    span.offsetTop + parseFloat(computed.borderTopWidth) - textarea.scrollTop
  const localLeft =
    span.offsetLeft + parseFloat(computed.borderLeftWidth) - textarea.scrollLeft

  document.body.removeChild(div)

  const rect = textarea.getBoundingClientRect()
  return {
    top: rect.top + localTop,
    left: rect.left + localLeft,
    height: lineHeight,
  }
}
