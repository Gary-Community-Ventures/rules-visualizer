import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from './ui/dialog'
import { getKieDisplayUrl, setKieBaseUrl } from '@/lib/engine'

export function SettingsModal() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(() => getKieDisplayUrl())
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          setUrl(getKieDisplayUrl())
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>KIE Server Settings</DialogTitle>
          <DialogDescription>
            Configure the KIE JIT Executor connection. Leave empty to use the
            default.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor="kie-url" className="text-sm font-medium">
            KIE Server URL
          </label>
          <Input
            id="kie-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
            placeholder="http://localhost:8080"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              try {
                setKieBaseUrl(url)
                setOpen(false)
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Invalid URL')
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
