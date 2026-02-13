const STORAGE_KEY = 'kie-server-url'

const DEV_DEFAULT = '' // Uses Vite proxy
const PROD_DEFAULT = 'http://localhost:8080'

export function getKieBaseUrl(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored
  return import.meta.env.DEV ? DEV_DEFAULT : PROD_DEFAULT
}

export function getKieDisplayUrl(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored
  return PROD_DEFAULT
}

export function setKieBaseUrl(url: string): void {
  const trimmed = url.trim()
  if (trimmed && !isValidUrl(trimmed)) {
    throw new Error('Invalid URL. Must start with http:// or https://')
  }
  if (trimmed) {
    localStorage.setItem(STORAGE_KEY, trimmed)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

/** Check if a URL appears to target a non-local host */
export function isExternalUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    return (
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      host !== '::1' &&
      !host.startsWith('192.168.') &&
      !host.startsWith('10.') &&
      !host.match(/^172\.(1[6-9]|2\d|3[01])\./)
    )
  } catch {
    return false
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
