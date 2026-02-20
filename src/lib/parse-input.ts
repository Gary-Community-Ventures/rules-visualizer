/** Try to parse as number/boolean/JSON, fall back to string */
export function parseInputValue(raw: string): unknown {
  if (raw === '') return ''
  if (raw === 'true') return true
  if (raw === 'false') return false
  const num = Number(raw)
  if (!isNaN(num) && raw.trim() !== '') return num
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Convert a stored (parsed) value back to the raw string for display */
export function displayInputValue(value: unknown): string {
  if (value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  return String(value)
}
