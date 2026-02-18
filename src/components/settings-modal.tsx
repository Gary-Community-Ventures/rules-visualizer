import { useState } from 'react'
import { Settings, Copy, Check } from 'lucide-react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from './ui/dialog'

const DOCKER_COMMAND =
  'docker run -p 8347:8080 docker.io/apache/incubator-kie-kogito-jit-runner:10.0.x-20241208'

export function SettingsModal() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(DOCKER_COMMAND)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>KIE Server Setup</DialogTitle>
          <DialogDescription>
            Run the following command to start the KIE JIT Executor:
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <pre className="bg-muted p-3 pr-10 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all">
              {DOCKER_COMMAND}
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1.5 right-1.5 h-7 w-7"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="size-3.5 text-green-600" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The server will be available at http://localhost:8347
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
