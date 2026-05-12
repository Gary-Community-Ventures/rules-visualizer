import { Fragment, useState, useCallback } from 'react'
import type { NodeContent } from '@/lib/model'
import { useMainContext } from '@/context'
import { getNodePath } from '@/context/model-context'
import { useNodeNavigation } from '@/lib/use-node-navigation'
import { parseFromBlocks, getBlockForYear } from '@/lib/logic'
import { LogicHighlighter } from './logic-highlighter'
import { resolveCitationUrl } from 'rules-visualizer-shared-types/citations'
import { ExternalLink } from 'lucide-react'

type Props = {
  content: Extract<NodeContent, { format: 'rac'; type: 'variable' }>
}

export function RacVariableViewer({ content }: Props) {
  const { logicYear, model } = useMainContext()
  const { setOpenNode } = useNodeNavigation()

  const navigateToPath = useCallback(
    (varName: string) => {
      // RAC variables are referenced by name, which is also the node ID
      if (model.nodes[varName]) {
        setOpenNode(varName)
        return
      }
      // Fallback: search by path
      for (const [nodeId, node] of Object.entries(model.nodes)) {
        if (getNodePath(node.content) === varName) {
          setOpenNode(nodeId)
          return
        }
      }
    },
    [model.nodes, setOpenNode]
  )

  let logicDisplay: React.ReactNode = null
  if (content.logic) {
    const blocks = parseFromBlocks(content.logic)
    if (blocks.length > 0) {
      const active = getBlockForYear(blocks, logicYear)
      if (active) {
        logicDisplay = (
          <div>
            <span className="text-muted-foreground font-medium">
              Logic{' '}
              <span className="text-xs font-normal">(from {active.date})</span>
            </span>
            <LogicHighlighter
              format="rac"
              logic={active.body}
              onNavigate={navigateToPath}
            />
          </div>
        )
      }
    } else {
      logicDisplay = (
        <div>
          <span className="text-muted-foreground font-medium">Logic</span>
          <LogicHighlighter
            format="rac"
            logic={content.logic}
            onNavigate={navigateToPath}
          />
        </div>
      )
    }
  } else if (content.default) {
    logicDisplay = (
      <div>
        <span className="text-muted-foreground font-medium">Logic</span>
        <LogicHighlighter
          format="rac"
          logic={content.default}
          onNavigate={navigateToPath}
        />
      </div>
    )
  }

  const sourceUrl = content.source
    ? resolveCitationUrl(content.source)
    : undefined

  const hasAdvanced = !!(
    content.entity ||
    content.unit ||
    content.dtype ||
    content.period ||
    content.indexedBy
  )

  const citations = content.citations ?? []

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Module summary (regulation context) — shown above formula since
          it explains "what is this rule about" before getting into how. */}
      {content.moduleSummary && (
        <div className="text-xs text-muted-foreground leading-relaxed border-l-2 border-muted pl-3 italic">
          {content.moduleSummary}
        </div>
      )}

      {/* Parameter table — render when `valueTable` is present. This is the
          actual data for nodes like snap_maximum_allotment_table where the
          "formula" is just a lookup. */}
      {content.valueTable && (
        <ValueTableDisplay
          values={content.valueTable}
          indexedBy={content.indexedBy}
        />
      )}

      {logicDisplay}

      {content.source && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground font-medium">Source</span>
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-0.5"
            >
              {content.source}
              <ExternalLink className="size-2.5" />
            </a>
          ) : (
            <span>{content.source}</span>
          )}
        </div>
      )}

      {/* source_relation citations from other regulations (e.g. Colorado
          restatements of federal rules). */}
      {citations.length > 0 && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground font-medium">
            Also {citations[0].type} by
          </span>
          {citations.map((c, i) => (
            <span key={i} className="ml-1">
              · {c.source}
              {c.authority && (
                <span className="text-muted-foreground"> ({c.authority})</span>
              )}
            </span>
          ))}
        </div>
      )}

      {hasAdvanced && (
        <AdvancedSection>
          {content.entity && <Field label="Entity" value={content.entity} />}
          {content.dtype && <Field label="Type" value={content.dtype} />}
          {content.unit && <Field label="Unit" value={content.unit} />}
          {content.period && <Field label="Period" value={content.period} />}
          {content.indexedBy && (
            <Field label="Indexed by" value={content.indexedBy} />
          )}
        </AdvancedSection>
      )}
    </div>
  )
}

/** Render a `valueTable` (e.g. {"1": 298, "2": 546, ...}) as a small
 *  two-column table. Limits to a reasonable display height. */
function ValueTableDisplay({
  values,
  indexedBy,
}: {
  values: Record<string, unknown>
  indexedBy?: string
}) {
  const entries = Object.entries(values)
  // Sort numerically when keys parse as numbers, alphabetically otherwise.
  entries.sort(([a], [b]) => {
    const na = Number(a)
    const nb = Number(b)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
  return (
    <div className="text-xs">
      <div className="text-muted-foreground font-medium mb-1">
        Values
        {indexedBy && (
          <span className="ml-1 text-muted-foreground/70 font-normal">
            (by {indexedBy})
          </span>
        )}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 max-h-48 overflow-y-auto font-mono">
        {entries.map(([k, v]) => (
          <Fragment key={k}>
            <span className="text-muted-foreground text-right">{k}</span>
            <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground font-medium">{label}</span>
      <p className="mt-0.5">{value}</p>
    </div>
  )
}

function AdvancedSection({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t pt-2">
      <button
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? '▾ Advanced' : '▸ Advanced'}
      </button>
      {open && <div className="mt-2 flex flex-col gap-3">{children}</div>}
    </div>
  )
}
