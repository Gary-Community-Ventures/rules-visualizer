/**
 * Format a value for display. Used consistently across node badges,
 * test panel, and execution panel.
 *
 * - Booleans: "true" / "false"
 * - Numbers: localized, max 4 decimal places
 * - Arrays: comma-separated values (e.g. "150, 275, 0" or "true, false")
 * - Single-element arrays: unwrapped (e.g. "true" not "[true]")
 * - null/undefined: "null"
 */
export function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString()
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((v) => formatDisplayValue(v)).join(', ')
    return `[${items}]`
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Compact format for node badges — shorter than formatDisplayValue
 * for use in small spaces on the graph.
 */
export function formatBadgeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString()
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((v) => formatBadgeValue(v)).join(', ')
    return `[${items}]`
  }
  return String(value)
}
