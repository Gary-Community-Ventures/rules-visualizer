import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { listProjects, createProject } from '@/lib/api/dmn-api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'

type ProjectSummary = {
  id: string
  name: string
  updated_at: string
}

export function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    listProjects()
      .then((data) => setProjects(data.projects))
      .catch((err) => console.error('Failed to load projects:', err))
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const result = await createProject(newName.trim())
      setShowCreate(false)
      setNewName('')
      navigate({
        to: '/project/$projectId',
        params: { projectId: result.id },
      })
    } catch (err) {
      console.error('Failed to create project:', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="size-4" />
          Create Project
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No projects yet. Create one to get started.
        </p>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <button
              key={p.id}
              className="text-left rounded-lg border bg-card p-4 hover:border-foreground/30 hover:shadow-sm transition-all"
              onClick={() =>
                navigate({
                  to: '/project/$projectId',
                  params: { projectId: p.id },
                })
              }
            >
              <h2 className="font-medium text-sm truncate">{p.name}</h2>
              {p.updated_at && (
                <p className="text-xs text-muted-foreground mt-2">
                  Updated{' '}
                  {new Date(p.updated_at).toLocaleDateString(undefined, {
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
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                placeholder="My Project"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
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
