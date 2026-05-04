import type { Profile } from '@/lib/api/profiles-api'

/**
 * Per-ruleset localStorage profile store. Uses the same Profile shape as
 * the file-backed store so callers can treat the two interchangeably; the
 * only differences are where they live and that local profiles aren't
 * shareable across browsers.
 */

const key = (rulesetId: string) => `profiles:local:${rulesetId}`

export function readLocalProfiles(rulesetId: string): Profile[] {
  try {
    const raw = localStorage.getItem(key(rulesetId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeLocalProfiles(
  rulesetId: string,
  profiles: Profile[]
): void {
  try {
    localStorage.setItem(key(rulesetId), JSON.stringify(profiles))
  } catch {
    // Quota / private browsing — silent best-effort.
  }
}

export function addLocalProfile(
  rulesetId: string,
  body: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>
): Profile {
  const now = new Date().toISOString()
  const profile: Profile = {
    id: `local-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    ...body,
  }
  const profiles = readLocalProfiles(rulesetId)
  writeLocalProfiles(rulesetId, [...profiles, profile])
  return profile
}

export function updateLocalProfile(
  rulesetId: string,
  id: string,
  patch: Partial<Profile>
): Profile | null {
  const profiles = readLocalProfiles(rulesetId)
  const idx = profiles.findIndex((p) => p.id === id)
  if (idx === -1) return null
  const updated: Profile = {
    ...profiles[idx],
    ...patch,
    id,
    createdAt: profiles[idx].createdAt,
    updatedAt: new Date().toISOString(),
  }
  profiles[idx] = updated
  writeLocalProfiles(rulesetId, profiles)
  return updated
}

export function deleteLocalProfile(rulesetId: string, id: string): boolean {
  const profiles = readLocalProfiles(rulesetId)
  const filtered = profiles.filter((p) => p.id !== id)
  if (filtered.length === profiles.length) return false
  writeLocalProfiles(rulesetId, filtered)
  return true
}
