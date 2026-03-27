import type { NodeContent } from '@/lib/model'
import { useMainContext } from '@/context'

type Props = {
  content: Extract<NodeContent, { format: 'rac'; type: 'variable' }>
}

/**
 * Parse a logic string containing `from YYYY-MM-DD:` blocks into
 * individual blocks with their start dates and body text.
 */
function parseFromBlocks(
  logic: string
): { date: string; body: string }[] {
  const blocks: { date: string; body: string }[] = []
  const lines = logic.split('\n')
  let currentDate: string | null = null
  let bodyLines: string[] = []

  for (const line of lines) {
    const match = line.match(/^\s*from\s+(\d{4}-\d{2}-\d{2})\s*:/)
    if (match) {
      if (currentDate !== null) {
        blocks.push({ date: currentDate, body: bodyLines.join('\n').trim() })
      }
      currentDate = match[1]
      bodyLines = []
    } else if (currentDate !== null) {
      bodyLines.push(line)
    }
  }

  if (currentDate !== null) {
    blocks.push({ date: currentDate, body: bodyLines.join('\n').trim() })
  }

  return blocks
}

/**
 * Given a list of from-blocks and a year, return the block that applies:
 * the one with the latest start date that is <= Jan 1 of the year.
 */
function getBlockForYear(
  blocks: { date: string; body: string }[],
  year: number
): { date: string; body: string } | null {
  const target = `${year}-01-01`
  let best: { date: string; body: string } | null = null
  for (const block of blocks) {
    if (block.date <= target) {
      if (!best || block.date > best.date) {
        best = block
      }
    }
  }
  return best
}

export function RacVariableViewer({ content }: Props) {
  const { logicYear } = useMainContext()

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
              <span className="text-xs font-normal">
                (from {active.date})
              </span>
            </span>
            <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">
              {active.body}
            </pre>
          </div>
        )
      }
    } else {
      // No from blocks parsed — show raw
      logicDisplay = (
        <div>
          <span className="text-muted-foreground font-medium">Logic</span>
          <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">
            {content.logic}
          </pre>
        </div>
      )
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {content.label && <Field label="Label" value={content.label} />}
      <Field label="Path" value={content.path} />
      {content.entity && <Field label="Entity" value={content.entity} />}
      {content.unit && <Field label="Unit" value={content.unit} />}
      {content.default && <Field label="Default" value={content.default} />}
      {logicDisplay ?? (
        <>
          {content.expression && (
            <div>
              <span className="text-muted-foreground font-medium">Expression</span>
              <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                {content.expression}
              </pre>
            </div>
          )}
          {content.source && <Field label="Source" value={content.source} />}
        </>
      )}
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
