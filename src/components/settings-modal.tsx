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

export function getKieServerUrl(): string {
  return localStorage.getItem('kie-server-url') || 'http://localhost:8080'
}

export function SettingsModal() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(() => getKieServerUrl())

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>KIE Server Settings</DialogTitle>
          <DialogDescription>
            Configure the KIE JIT Executor connection.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor="kie-url" className="text-sm font-medium">
            KIE Server URL
          </label>
          <Input
            id="kie-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:8080"
          />
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              localStorage.setItem('kie-server-url', url)
              setOpen(false)
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
