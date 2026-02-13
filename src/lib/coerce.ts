export function coerceNumber(value: unknown): number | string {
  if (typeof value === 'number') return value
  const str = String(value)
  if (str === '') return ''
  const num = Number(str)
  return Number.isNaN(num) ? str : num
}
