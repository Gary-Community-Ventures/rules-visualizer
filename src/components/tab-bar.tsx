import { useAppContext } from '@/context'
import { useNavigate } from '@tanstack/react-router'
import { X, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabBarProps = {
  activeModelId: string | null
  activeProjectId: string | null
}

export function TabBar({ activeModelId, activeProjectId }: TabBarProps) {
  const { tabs, closeTab } = useAppContext()
  const navigate = useNavigate()

  const projectId =
    activeProjectId ?? tabs[0]?.projectId ?? null

  return (
    <div className="border-b bg-muted/40 flex items-center gap-0.5 px-1 h-9 shrink-0 overflow-x-auto">
      {/* Breadcrumb: Projects > Models */}
      <button
        onClick={() => navigate({ to: '/' })}
        className="px-2 h-7 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title="All projects"
      >
        Projects
      </button>

      {projectId && (
        <>
          <ChevronRight className="size-3 text-muted-foreground/50 shrink-0" />
          <button
            onClick={() =>
              navigate({
                to: '/project/$projectId',
                params: { projectId },
              })
            }
            className="px-2 h-7 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            title="Project models"
          >
            Models
          </button>
        </>
      )}

      {tabs.length > 0 && (
        <div className="w-px h-4 bg-border mx-1 shrink-0" />
      )}

      {tabs.map((tab) => {
        const isActive = tab.modelId === activeModelId
        return (
          <div
            key={tab.modelId}
            className={cn(
              'flex items-center gap-1 px-2.5 h-7 rounded text-xs transition-colors shrink-0 group',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <button
              className="truncate max-w-[140px]"
              onClick={() =>
                navigate({
                  to: '/project/$projectId/model/$modelId',
                  params: { projectId: tab.projectId, modelId: tab.modelId },
                })
              }
              title={tab.modelName}
            >
              {tab.modelName || 'Untitled'}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                const idx = tabs.findIndex(
                  (t) => t.modelId === tab.modelId
                )
                closeTab(tab.modelId)
                if (isActive) {
                  const remaining = tabs.filter(
                    (t) => t.modelId !== tab.modelId
                  )
                  if (remaining.length > 0) {
                    const nextIdx = Math.min(idx, remaining.length - 1)
                    const next = remaining[nextIdx]
                    navigate({
                      to: '/project/$projectId/model/$modelId',
                      params: { projectId: next.projectId, modelId: next.modelId },
                    })
                  } else {
                    // No tabs left — go to the closed tab's project
                    navigate({
                      to: '/project/$projectId',
                      params: { projectId: tab.projectId },
                    })
                  }
                }
              }}
              className="opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 rounded p-0.5 transition-opacity"
              title="Close tab"
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
