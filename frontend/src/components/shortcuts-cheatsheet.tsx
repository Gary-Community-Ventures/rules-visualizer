import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

/** A keystroke as displayed: `keys` reads like "Shift+P" or just "p". */
type Shortcut = {
  keys: string
  description: string
}

const GROUPS: { name: string; items: Shortcut[] }[] = [
  {
    name: 'Panels',
    items: [
      { keys: 'p', description: 'Open the policy panel' },
      { keys: 't', description: 'Open the tests panel' },
      { keys: 'b', description: 'Open the builder (tasks) panel' },
      { keys: 'i', description: 'Open the inputs / execution panel' },
      { keys: 'a', description: 'Toggle the AI panel' },
    ],
  },
  {
    name: 'Navigation',
    items: [
      { keys: '↑ / ↓', description: 'Step through workspace items' },
      { keys: '← / →', description: 'Step through node history' },
      { keys: '1 – 9', description: 'Jump to workspace slot' },
      { keys: 'h', description: 'Toggle history dropdown' },
      { keys: 'e', description: 'Toggle workspace dropdown' },
      { keys: '/  or  k', description: 'Focus search' },
      { keys: 'Esc', description: 'Close panel / dialog / open node' },
    ],
  },
  {
    name: 'Open node',
    items: [
      { keys: 'w', description: 'Add or remove from workspace' },
      { keys: 'f', description: 'Add or remove from filter' },
      { keys: 'x', description: 'Toggle expand-children' },
      {
        keys: 'Shift+P',
        description: 'Open the policy panel and link a section to this node',
      },
    ],
  },
  {
    name: 'This dialog',
    items: [{ keys: '?', description: 'Show this cheatsheet' }],
  },
]

export function ShortcutsCheatsheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {GROUPS.map((group) => (
            <div key={group.name}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                {group.name}
              </p>
              <ul className="space-y-1">
                {group.items.map((s) => (
                  <li
                    key={s.keys}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-foreground/80">{s.description}</span>
                    <kbd className="shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded border bg-muted text-muted-foreground">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
