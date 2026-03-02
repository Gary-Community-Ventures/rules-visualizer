import { useEffect, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useAppContext } from '@/context'
import { listProjectModels, createProjectModel } from '@/lib/api/dmn-api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, ArrowLeft } from 'lucide-react'

type ModelSummary = {
  id: string
  name: string
  namespace: string
  updated_at: string
}

export function ModelListPage() {
  const { projectId } = useParams({ from: '/project/$projectId' })
  const [models, setModels] = useState<ModelSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNamespace, setNewNamespace] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const { openTab } = useAppContext()

  useEffect(() => {
    listProjectModels(projectId)
      .then((data) => setModels(data.models))
      .catch((err) => console.error('Failed to load models:', err))
      .finally(() => setLoading(false))
  }, [projectId])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const result = await createProjectModel(
        projectId,
        newName.trim(),
        newNamespace.trim() || `https://example.com/${newName.trim().toLowerCase().replace(/\s+/g, '-')}`
      )
      setShowCreate(false)
      setNewName('')
      setNewNamespace('')
      openTab(projectId, result.id, result.name)
      navigate({
        to: '/project/$projectId/model/$modelId',
        params: { projectId, modelId: result.id },
      })
    } catch (err) {
      console.error('Failed to create model:', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: '/' })}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Back to projects"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="text-xl font-semibold">Models</h1>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="size-4" />
          Create Model
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : models.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No models yet. Create one to get started.
        </p>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((m) => (
            <button
              key={m.id}
              className="text-left rounded-lg border bg-card p-4 hover:border-foreground/30 hover:shadow-sm transition-all"
              onClick={() => {
                openTab(projectId, m.id, m.name)
                navigate({
                  to: '/project/$projectId/model/$modelId',
                  params: { projectId, modelId: m.id },
                })
              }}
            >
              <h2 className="font-medium text-sm truncate">{m.name}</h2>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {m.namespace}
              </p>
              {m.updated_at && (
                <p className="text-xs text-muted-foreground mt-2">
                  Updated{' '}
                  {new Date(m.updated_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Model</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                placeholder="My_Model"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Namespace
              </label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                placeholder="https://example.com/my-model"
                value={newNamespace}
                onChange={(e) => setNewNamespace(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
