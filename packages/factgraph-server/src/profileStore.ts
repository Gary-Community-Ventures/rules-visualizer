import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from 'rules-visualizer-factgraph-core'

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

export function getProfilesPath(rulesetId: string): string | null {
  const dataDir = getDataDir()
  if (!dataDir) return null
  return path.join(dataDir, rulesetId, 'profiles.json')
}

export function readProfiles(rulesetId: string): Profile[] {
  const p = getProfilesPath(rulesetId)
  if (!p || !fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return []
  }
}

export function writeProfiles(rulesetId: string, profiles: Profile[]): boolean {
  const p = getProfilesPath(rulesetId)
  if (!p) return false
  fs.writeFileSync(p, JSON.stringify(profiles, null, 2) + '\n')
  return true
}
