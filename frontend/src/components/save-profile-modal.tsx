import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ALLOW_WRITES } from '@/lib/allow-writes'
import { useMainContext } from '@/context'
import { snapshotExecution } from '@/lib/profile-serialize'
import { addLocalProfile } from '@/lib/profile-store'
import { createProfile, type Profile } from '@/lib/api/profiles-api'

/**
 * Saves the current inputs/overrides/entities (+ asOfDate for RAC) as a
 * named profile. With ALLOW_WRITES the user can opt to persist to the
 * git-tracked profiles.json; otherwise the profile lands in localStorage.
 */
export function SaveProfileModal({
  open,
  onOpenChange,
  onSaved,
  initialName,
  initialDescription,
  initialSaveToFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Receives the freshly-created profile so the caller can promote it to
   *  the active edit (banner) state. */
  onSaved?: (profile: Profile, source: 'file' | 'local') => void
  /** Pre-fill values — used by the "Save as new" fork flow from a profile
   *  being edited so the user doesn't have to retype the name from
   *  scratch. */
  initialName?: string
  initialDescription?: string
  initialSaveToFile?: boolean
}) {
  const { rulesetId, model, inputOverrides, entityData, asOfDate } =
    useMainContext()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saveToFile, setSaveToFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open so the modal doesn't show a stale draft after a previous
  // save / cancel.
  useEffect(() => {
    if (open) {
      setName(initialName ?? '')
      setDescription(initialDescription ?? '')
      setSaveToFile(initialSaveToFile ?? false)
      setSaving(false)
      setError(null)
    }
  }, [open, initialName, initialDescription, initialSaveToFile])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const snap = snapshotExecution(model, inputOverrides, entityData)
      const body = {
        name: trimmed,
        description: description.trim() || undefined,
        asOf: model.format === 'rac' ? asOfDate : undefined,
        ...snap,
      }
      let saved: Profile
      let source: 'file' | 'local'
      if (saveToFile && ALLOW_WRITES) {
        saved = await createProfile(rulesetId, body)
        source = 'file'
      } else {
        saved = addLocalProfile(rulesetId, body)
        source = 'local'
      }
      onSaved?.(saved, source)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="3-person elderly household"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Description (optional)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder=""
            />
          </div>
          {ALLOW_WRITES && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={saveToFile}
                onChange={(e) => setSaveToFile(e.target.checked)}
              />
              Save to file
            </label>
          )}
          {error && <p className="text-xs text-orange-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
