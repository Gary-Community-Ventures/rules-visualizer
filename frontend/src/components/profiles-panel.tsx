import { useCallback, useEffect, useState } from 'react'
import { useMainContext, usePanelContext } from '@/context'
import { getNodePath } from '@/context/model-context'
import { Button } from './ui/button'
import { Users, X, Trash2, ArrowRight, HardDrive, FileText } from 'lucide-react'
import {
  listProfiles,
  deleteProfile,
  type Profile,
} from '@/lib/api/profiles-api'
import {
  readLocalProfiles,
  deleteLocalProfile,
} from '@/lib/profile-store'
import { applySnapshot } from '@/lib/profile-serialize'
import { useInputActions } from '@/lib/use-input-actions'
import { useExecutionRunner } from '@/lib/use-execution-runner'
import { onReload } from '@/lib/api/live-reload'

type Source = 'file' | 'local'
type ProfileWithSource = Profile & { __source: Source }

function tag(profile: Profile, source: Source): ProfileWithSource {
  return { ...profile, __source: source }
}

export function ProfilesPanel() {
  const { rulesetId, model, setRightBar, setEntityData, setAsOfDate } =
    useMainContext()
  const { setInputOverride, clearAll } = useInputActions()
  const { runExecution } = useExecutionRunner()
  const { editingProfile, setEditingProfile } = usePanelContext()
  const [profiles, setProfiles] = useState<ProfileWithSource[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const fileProfiles = await listProfiles(rulesetId).catch(() => [])
      const local = readLocalProfiles(rulesetId)
      setProfiles([
        ...fileProfiles.map((p) => tag(p, 'file')),
        ...local.map((p) => tag(p, 'local')),
      ])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [rulesetId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Refresh when the backend reloads the ruleset (e.g. profiles.json was
  // edited externally — agent, manual edit, etc.).
  useEffect(() => {
    return onReload((changed) => {
      if (!changed || changed === rulesetId) void refresh()
    })
  }, [rulesetId, refresh])

  const loadProfile = (profile: ProfileWithSource) => {
    // Wipe both buckets so the profile is the complete state, then apply
    // the snapshot. Build the next inputOverrides/entityData ourselves
    // (mirroring applySnapshot) and pass them straight to runExecution
    // — refs mirror committed state on the next render, but we want the
    // run to use the JUST-applied data, not last render's snapshot.
    clearAll()
    setEntityData({})
    if (profile.asOf) setAsOfDate(profile.asOf)
    applySnapshot(model.nodes, profile, setInputOverride, setEntityData)

    const nextInputOverrides: Record<string, string> = {}
    const applyBag = (bag: Record<string, unknown> | undefined) => {
      if (!bag) return
      for (const [path, value] of Object.entries(bag)) {
        for (const [nodeId, node] of Object.entries(model.nodes)) {
          if (getNodePath(node.content) === path) {
            nextInputOverrides[nodeId] =
              typeof value === 'string' ? value : JSON.stringify(value)
            break
          }
        }
      }
    }
    applyBag(profile.inputs)
    applyBag(profile.overrides)
    const nextEntityData: Record<string, Record<string, string>[]> = {}
    if (profile.entities) {
      for (const [entity, rows] of Object.entries(profile.entities)) {
        nextEntityData[entity] = rows.map((row) => {
          const stringRow: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) {
            stringRow[k] = typeof v === 'string' ? v : JSON.stringify(v)
          }
          return stringRow
        })
      }
    }
    runExecution({
      inputOverrides: nextInputOverrides,
      entityData: nextEntityData,
      asOfDate: profile.asOf,
    })
  }

  // Edit = load profile values into the execution panel + flip the panel
  // into "editing this profile" mode (banner with Save/Cancel) so any
  // tweaks the user makes can be written back to the underlying record.
  const editProfile = (profile: ProfileWithSource) => {
    loadProfile(profile)
    setEditingProfile({
      source: profile.__source,
      id: profile.id,
      name: profile.name,
      description: profile.description,
    })
    setRightBar('execution')
  }

  const removeProfile = async (profile: ProfileWithSource) => {
    try {
      if (profile.__source === 'file') {
        await deleteProfile(rulesetId, profile.id)
      } else {
        deleteLocalProfile(rulesetId, profile.id)
      }
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <Users className="size-4" />
        <span className="text-sm font-medium">Profiles</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 ml-auto"
          onClick={() => setRightBar(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
      {error && (
        <div className="px-4 py-2 bg-orange-100 text-orange-800 text-xs border-b">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {profiles.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground text-center">
            No profiles yet. Use "Save profile" in the inputs panel to capture
            the current setup.
          </p>
        ) : (
          <ul className="divide-y">
            {profiles.map((p) => {
              const isActive =
                editingProfile?.id === p.id &&
                editingProfile.source === p.__source
              return (
              <li
                key={`${p.__source}:${p.id}`}
                className="group relative"
              >
                <button
                  type="button"
                  onClick={() => editProfile(p)}
                  className={
                    isActive
                      ? 'w-full text-left px-4 py-3 bg-amber-50 hover:bg-amber-100 border-l-2 border-amber-400 transition-colors flex items-center gap-3'
                      : 'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-center gap-3'
                  }
                >
                  <ArrowRight className="size-4 text-muted-foreground/60 group-hover:text-foreground shrink-0" />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    {p.description && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.description}
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                      {p.__source === 'file' ? (
                        <>
                          <FileText className="size-2.5" />
                          file
                        </>
                      ) : (
                        <>
                          <HardDrive className="size-2.5" />
                          local
                        </>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeProfile(p)
                  }}
                  className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  <Trash2 className="size-3" />
                </button>
                {isActive && (
                  <span className="absolute top-2 right-9 text-[9px] uppercase tracking-wide text-amber-700 font-medium pointer-events-none">
                    Active
                  </span>
                )}
              </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
