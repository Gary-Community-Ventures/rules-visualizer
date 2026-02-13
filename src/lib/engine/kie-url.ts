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

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
