export type FromBlock = { date: string; body: string }

/**
 * Parse a logic string containing `from YYYY-MM-DD:` blocks into
 * individual blocks with their start dates and body text.
 */
function dedent(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return ''
  const minIndent = Math.min(
    ...lines.map((l) => l.match(/^(\s*)/)?.[1].length ?? 0)
  )
  return lines.map((l) => l.slice(minIndent)).join('\n')
}

export function parseFromBlocks(logic: string): FromBlock[] {
  const blocks: FromBlock[] = []
  const lines = logic.split('\n')
  let currentDate: string | null = null
  let bodyLines: string[] = []

  for (const line of lines) {
    const match = line.match(/^\s*from\s+(\d{4}-\d{2}-\d{2})\s*:/)
    if (match) {
      if (currentDate !== null) {
        blocks.push({ date: currentDate, body: dedent(bodyLines.join('\n')) })
      }
      currentDate = match[1]
      bodyLines = []
    } else if (currentDate !== null) {
      bodyLines.push(line)
    }
  }

  if (currentDate !== null) {
    blocks.push({ date: currentDate, body: dedent(bodyLines.join('\n')) })
  }

  return blocks
}

/**
 * Given a list of from-blocks and a year, return the block that applies:
 * the one with the latest start date that is <= Jan 1 of the year.
 */
export function getBlockForYear(
  blocks: FromBlock[],
  year: number
): FromBlock | null {
  const target = `${year}-01-01`
  let best: FromBlock | null = null
  for (const block of blocks) {
    if (block.date <= target) {
      if (!best || block.date > best.date) {
        best = block
      }
    }
  }
  return best
}

/**
 * Resolve the logic text for a RAC variable for a given year.
 * Returns the body of the applicable from-block, or the raw logic string,
 * or the default value.
 */
export function resolveRacLogic(
  logic: string | undefined,
  defaultValue: string | undefined,
  year: number
): string | undefined {
  if (logic) {
    const blocks = parseFromBlocks(logic)
    if (blocks.length > 0) {
      const active = getBlockForYear(blocks, year)
      if (active) return active.body
    }
    return logic
  }
  return defaultValue
}
