import { Text } from '@/translations/wrapper'
import { translations } from '@/translations/text'
import * as Sentry from '@sentry/react'
import { useRouter } from '@tanstack/react-router'

function ErrorFallback({ error }: { error: unknown }) {
  const router = useRouter()

  Sentry.captureException(error)

  const t = translations.general.errorFallback

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        <h2 className="text-2xl font-bold text-destructive">
          <Text text={t.somethingWentWrong} />
        </h2>
        <p className="text-muted-foreground">
          <Text text={t.weHaveNotified} />
        </p>
        <div className="space-x-4">
          <button
            onClick={() => router.invalidate()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <Text text={t.tryAgain} />
          </button>
          <button
            onClick={() =>
              router.navigate({
                to: '/',
              })
            }
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90"
          >
            <Text text={t.goHome} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default ErrorFallback
