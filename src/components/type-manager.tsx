import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Trash2, Pencil, X } from 'lucide-react'
import type { CustomType, CustomTypeField } from '@/lib/model'
import { FEEL_DATA_TYPES } from '@/lib/model'
import {
  listCustomTypes,
  createCustomType,
  updateCustomType,
  deleteCustomType,
} from '@/lib/api/dmn-api'

type TypeManagerProps = {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TypeManager({
  projectId,
  open,
  onOpenChange,
}: TypeManagerProps) {
  const [types, setTypes] = useState<CustomType[]>([])
  const [loading, setLoading] = useState(true)
  const [editingType, setEditingType] = useState<CustomType | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listCustomTypes(projectId)
      setTypes(result)
      return result
    } catch (err) {
      console.error('Failed to load types:', err)
      return undefined
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) {
      refresh()
      setConfirmDeleteId(null)
      setDeleteError(null)
    }
  }, [open, refresh])

  const notifyTypesChanged = (updatedTypes: CustomType[]) => {
    window.dispatchEvent(
      new CustomEvent('custom-types-changed', { detail: updatedTypes })
    )
  }

  const handleDelete = async (typeId: string) => {
    if (confirmDeleteId !== typeId) {
      setConfirmDeleteId(typeId)
      setDeleteError(null)
      return
    }
    setConfirmDeleteId(null)
    setDeleteError(null)
    try {
      await deleteCustomType(projectId, typeId)
      const updated = await refresh()
      if (updated) notifyTypesChanged(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete type'
      setDeleteError(message)
    }
  }

  const handleEdit = (type: CustomType) => {
    setEditingType(type)
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditingType(null)
    setShowForm(true)
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingType(null)
  }

  const handleFormSave = async () => {
    handleFormClose()
    const updated = await refresh()
    if (updated) notifyTypesChanged(updated)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Custom Types</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {deleteError && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-2">
              {deleteError}
            </div>
          )}
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : types.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No custom types defined yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {types.map((type) => (
                <div
                  key={type.id}
                  className="flex items-start justify-between rounded-lg border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{type.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {type.fields.length === 0
                        ? 'No fields'
                        : type.fields
                            .map((f) => `${f.name}: ${f.typeRef}`)
                            .join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleEdit(type)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    {confirmDeleteId === type.id ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleDelete(type.id)}
                        onBlur={() => setConfirmDeleteId(null)}
                      >
                        Confirm
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(type.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleCreate}>
            <Plus className="size-4" />
            New Type
          </Button>
        </DialogFooter>

        {showForm && (
          <TypeForm
            projectId={projectId}
            existingType={editingType}
            existingTypeNames={types
              .filter((t) => t.id !== editingType?.id)
              .map((t) => t.name)}
            onClose={handleFormClose}
            onSave={handleFormSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type TypeFormProps = {
  projectId: string
  existingType: CustomType | null
  existingTypeNames: string[]
  onClose: () => void
  onSave: () => void
}

function TypeForm({
  projectId,
  existingType,
  existingTypeNames,
  onClose,
  onSave,
}: TypeFormProps) {
  const [name, setName] = useState(existingType?.name ?? '')
  const [fields, setFields] = useState<CustomTypeField[]>(
    existingType?.fields ?? [{ name: '', typeRef: 'string' }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addField = () => {
    setFields([...fields, { name: '', typeRef: 'string' }])
  }

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index))
  }

  const updateField = (
    index: number,
    key: keyof CustomTypeField,
    value: string
  ) => {
    const updated = [...fields]
    updated[index] = { ...updated[index], [key]: value }
    setFields(updated)
  }

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required')
      return
    }

    if (existingTypeNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())) {
      setError('A type with this name already exists')
      return
    }

    const validFields = fields.filter((f) => f.name.trim())
    if (validFields.length === 0) {
      setError('At least one field is required')
      return
    }

    const cleanFields = validFields.map((f) => ({
      name: f.name.trim(),
      typeRef: f.typeRef,
    }))

    const fieldNames = cleanFields.map((f) => f.name)
    if (new Set(fieldNames).size !== fieldNames.length) {
      setError('Field names must be unique')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (existingType) {
        await updateCustomType(projectId, existingType.id, trimmedName, cleanFields)
      } else {
        await createCustomType(projectId, trimmedName, cleanFields)
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existingType ? 'Edit Type' : 'New Type'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">Name</label>
            <input
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              placeholder="Address"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s/g, '_'))}
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Fields</label>
            <div className="flex flex-col gap-2">
              {fields.map((field, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 border rounded-md px-3 py-1.5 text-sm bg-background"
                    placeholder="field name"
                    value={field.name}
                    onChange={(e) =>
                      updateField(i, 'name', e.target.value.replace(/\s/g, '_'))
                    }
                  />
                  <select
                    className="border rounded-md px-2 py-1.5 text-sm bg-background"
                    value={field.typeRef}
                    onChange={(e) => updateField(i, 'typeRef', e.target.value)}
                  >
                    <optgroup label="Built-in">
                      {FEEL_DATA_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                    {existingTypeNames.length > 0 && (
                      <optgroup label="Custom">
                        {existingTypeNames.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removeField(i)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={addField}
              >
                <Plus className="size-3.5" />
                Add Field
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : existingType ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
