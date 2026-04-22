import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NODE_TYPE_CONFIG } from './node'

const LEGEND_ITEMS = ['input', 'constant', 'computed'] as const

export function Legend() {
  const [open, setOpen] = useState(false)

  return (
    <div className="absolute bottom-4 left-4 z-[4]">
      <div
        className={cn(
          'bg-background/95 backdrop-blur-sm border rounded-md shadow-sm',
          open ? 'p-2' : 'p-0'
        )}
      >
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          Legend
        </button>
        {open && (
          <div className="flex flex-col gap-1 mt-1">
            {LEGEND_ITEMS.map((type) => {
              const config = NODE_TYPE_CONFIG[type]
              const Icon = config.icon
              return (
                <div key={type} className="flex items-center gap-2 px-2 py-1">
                  <div
                    className={cn(
                      'w-5 h-5 rounded border flex items-center justify-center',
                      config.bg,
                      config.border
                    )}
                  >
                    <Icon className="size-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs">{config.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
