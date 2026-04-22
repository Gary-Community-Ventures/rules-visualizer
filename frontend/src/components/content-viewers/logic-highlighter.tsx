/**
 * Syntax-highlighted rendering for rule logic expressions.
 *
 * Design: a shared <LogicHighlighter> dispatches to format-specific renderers.
 * Each renderer converts the raw logic string into colored, indented output.
 *
 * Color scheme (uses Tailwind classes):
 *   keyword  — blue   (if, else, switch, and, or, operators)
 *   path     — purple (dependency references like /grossEarnedIncome)
 *   literal  — amber  (numbers, true/false, strings)
 *   muted    — gray   (structural labels)
 */

import type { ReactNode } from 'react'

// --- Shared color classes ---
const C = {
  keyword: 'text-blue-700',
  path: 'text-violet-700',
  literal: 'text-amber-700',
  muted: 'text-gray-500',
  op: 'text-blue-700',
} as const

// --- Public component ---

type Props = {
  format: 'rac' | 'factGraph'
  logic: string
  /** Called when a path/variable reference is clicked. */
  onNavigate?: (path: string) => void
}

export function LogicHighlighter({ format, logic, onNavigate }: Props) {
  const content =
    format === 'factGraph'
      ? renderFactGraph(logic, onNavigate)
      : renderRac(logic, onNavigate)

  return (
    <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono leading-relaxed">
      {content}
    </pre>
  )
}

// ============================================================
// Fact Graph — XML syntax highlighting (preserves original XML)
// ============================================================

type XmlToken = {
  type: 'tag' | 'attr-name' | 'attr-value' | 'text' | 'bracket' | 'path'
  value: string
}

/** Tokenize XML string into spans for syntax highlighting. */
function tokenizeXml(xml: string): XmlToken[] {
  const tokens: XmlToken[] = []
  let pos = 0
  while (pos < xml.length) {
    // Text content between tags
    if (xml[pos] !== '<') {
      const start = pos
      while (pos < xml.length && xml[pos] !== '<') pos++
      const text = xml.slice(start, pos)
      if (text.trim()) tokens.push({ type: 'text', value: text })
      else tokens.push({ type: 'bracket', value: text }) // whitespace
      continue
    }

    // Tag start: < or </
    const isClose = xml[pos + 1] === '/'
    const bracketEnd = isClose ? pos + 2 : pos + 1
    tokens.push({ type: 'bracket', value: xml.slice(pos, bracketEnd) })
    pos = bracketEnd

    // Tag name
    const nameStart = pos
    while (pos < xml.length && /[\w.-]/.test(xml[pos])) pos++
    if (pos > nameStart) {
      tokens.push({ type: 'tag', value: xml.slice(nameStart, pos) })
    }

    // Attributes and closing bracket
    while (
      pos < xml.length &&
      xml[pos] !== '>' &&
      !(xml[pos] === '/' && xml[pos + 1] === '>')
    ) {
      // Whitespace
      if (/\s/.test(xml[pos])) {
        const ws = pos
        while (pos < xml.length && /\s/.test(xml[pos])) pos++
        tokens.push({ type: 'bracket', value: xml.slice(ws, pos) })
        continue
      }
      // Attribute name
      const aStart = pos
      while (
        pos < xml.length &&
        xml[pos] !== '=' &&
        xml[pos] !== '>' &&
        xml[pos] !== '/' &&
        !/\s/.test(xml[pos])
      )
        pos++
      if (pos > aStart) {
        tokens.push({ type: 'attr-name', value: xml.slice(aStart, pos) })
      }
      // = and quoted value
      if (xml[pos] === '=') {
        tokens.push({ type: 'bracket', value: '=' })
        pos++
        if (xml[pos] === '"') {
          const qStart = pos
          pos++ // opening "
          while (pos < xml.length && xml[pos] !== '"') pos++
          pos++ // closing "
          const raw = xml.slice(qStart, pos)
          const inner = raw.slice(1, -1)
          // Highlight path attributes specially
          tokens.push({
            type: inner.startsWith('/') ? 'path' : 'attr-value',
            value: raw,
          })
        }
      }
    }

    // Self-closing /> or closing >
    if (xml[pos] === '/' && xml[pos + 1] === '>') {
      tokens.push({ type: 'bracket', value: '/>' })
      pos += 2
    } else if (xml[pos] === '>') {
      tokens.push({ type: 'bracket', value: '>' })
      pos++
    }
  }

  return tokens
}

const XML_COLORS: Record<XmlToken['type'], string> = {
  tag: C.keyword,
  'attr-name': C.muted,
  'attr-value': C.literal,
  path: C.path,
  text: C.literal,
  bracket: C.muted,
}

function renderFactGraph(
  logic: string,
  onNavigate?: (path: string) => void
): ReactNode {
  try {
    const tokens = tokenizeXml(logic)
    if (tokens.length === 0) return logic
    return tokens.map((t, i) => {
      if (t.type === 'path' && onNavigate) {
        // Extract the inner path (strip surrounding quotes)
        const inner = t.value.replace(/^"|"$/g, '')
        return (
          <span
            key={i}
            className={`${XML_COLORS.path} cursor-pointer hover:text-violet-900 hover:underline`}
            onClick={() => onNavigate(inner)}
            title={`Go to ${inner}`}
          >
            {t.value}
          </span>
        )
      }
      return (
        <span key={i} className={XML_COLORS[t.type]}>
          {t.value}
        </span>
      )
    })
  } catch {
    return logic
  }
}

// ============================================================
// RAC — keyword/variable/literal highlighting
// ============================================================

type RacToken = {
  type: 'keyword' | 'literal' | 'variable' | 'operator' | 'text'
  value: string
}

const RAC_KEYWORDS = new Set([
  'if',
  'elif',
  'else',
  'and',
  'or',
  'not',
  'max',
  'min',
  'sum',
  'ceil',
  'floor',
  'abs',
  'true',
  'false',
  'True',
  'False',
])

function tokenizeRac(logic: string): RacToken[] {
  const tokens: RacToken[] = []
  const re =
    /(-?\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_][a-zA-Z0-9_]*\b)|(<=|>=|!=|==|[+\-*\/<>=:])|(\s+)|(.)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(logic)) !== null) {
    const [full, num, word, op] = m
    if (num) {
      tokens.push({ type: 'literal', value: num })
    } else if (word) {
      if (RAC_KEYWORDS.has(word)) {
        const type =
          word === 'true' ||
          word === 'false' ||
          word === 'True' ||
          word === 'False'
            ? 'literal'
            : 'keyword'
        tokens.push({ type, value: word })
      } else {
        tokens.push({ type: 'variable', value: word })
      }
    } else if (op) {
      tokens.push({ type: op === ':' ? 'text' : 'operator', value: op })
    } else {
      tokens.push({ type: 'text', value: full })
    }
  }
  return tokens
}

const RAC_COLORS: Record<RacToken['type'], string> = {
  keyword: C.keyword,
  literal: C.literal,
  variable: C.path,
  operator: C.op,
  text: '',
}

function renderRac(
  logic: string,
  onNavigate?: (path: string) => void
): ReactNode {
  const tokens = tokenizeRac(logic)
  return tokens.map((t, i) => {
    if (t.type === 'variable' && onNavigate) {
      return (
        <span
          key={i}
          className={`${RAC_COLORS.variable} cursor-pointer hover:text-violet-900 hover:underline`}
          onClick={() => onNavigate(t.value)}
          title={`Go to ${t.value}`}
        >
          {t.value}
        </span>
      )
    }
    const cls = RAC_COLORS[t.type]
    return cls ? (
      <span key={i} className={cls}>
        {t.value}
      </span>
    ) : (
      <span key={i}>{t.value}</span>
    )
  })
}
