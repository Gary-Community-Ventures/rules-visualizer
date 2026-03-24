import { useAppContext } from '@/context'
import { useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabBarProps = {
  activeRulesetId: string | null
}

export function TabBar({ activeRulesetId }: TabBarProps) {
  const { tabs, closeTab } = useAppContext()
  const navigate = useNavigate()

  return (
    <div className="border-b bg-muted/40 flex items-center gap-0.5 px-1 h-9 shrink-0 overflow-x-auto">
      <button
        onClick={() => navigate({ to: '/' })}
        className="px-2 h-7 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title="All rulesets"
      >
        Rulesets
      </button>

      {tabs.length > 0 && <div className="w-px h-4 bg-border mx-1 shrink-0" />}

      {tabs.map((tab) => {
        const isActive = tab.rulesetId === activeRulesetId
        return (
          <div
            key={tab.rulesetId}
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
                  to: '/ruleset/$rulesetId',
                  params: { rulesetId: tab.rulesetId },
                })
              }
              title={tab.rulesetName}
            >
              {tab.rulesetName || 'Untitled'}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                const idx = tabs.findIndex((t) => t.rulesetId === tab.rulesetId)
                closeTab(tab.rulesetId)
                if (isActive) {
                  const remaining = tabs.filter(
                    (t) => t.rulesetId !== tab.rulesetId
                  )
                  if (remaining.length > 0) {
                    const nextIdx = Math.min(idx, remaining.length - 1)
                    const next = remaining[nextIdx]
                    navigate({
                      to: '/ruleset/$rulesetId',
                      params: { rulesetId: next.rulesetId },
                    })
                  } else {
                    navigate({ to: '/' })
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
