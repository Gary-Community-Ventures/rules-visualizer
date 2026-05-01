export type Profile = {
  id: string
  name: string
  description?: string
  asOf?: string
  inputs?: Record<string, unknown>
  overrides?: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  createdAt: string
  updatedAt: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`)
  }
  return res.json()
}

export async function listProfiles(rulesetId: string): Promise<Profile[]> {
  const data = await request<{ profiles: Profile[] }>(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/profiles`
  )
  return data.profiles
}

export function createProfile(
  rulesetId: string,
  body: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Profile> {
  return request<Profile>(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/profiles`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export function updateProfile(
  rulesetId: string,
  profileId: string,
  body: Partial<Profile>
): Promise<Profile> {
  return request<Profile>(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/profiles/${profileId}`,
    { method: 'PUT', body: JSON.stringify(body) }
  )
}

export function deleteProfile(
  rulesetId: string,
  profileId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/api/rulesets/${encodeURIComponent(rulesetId)}/profiles/${profileId}`,
    { method: 'DELETE' }
  )
}
