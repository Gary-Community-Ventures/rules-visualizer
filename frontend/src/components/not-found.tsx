import { Button } from '@/components/ui/button'
import { Text } from '@/translations/wrapper'
import { translations } from '@/translations/text'

export const NotFoundPage = () => {
  const t = translations.general.notFoundPage

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
      <div className="text-center">
        <h1 className="text-9xl font-bold text-gray-400">
          <Text text={t.fourOhFour} />
        </h1>
        <p className="text-2xl mt-4">
          <Text text={t.notFound} />
        </p>
        <p className="text-lg text-gray-600 mt-2">
          <Text text={t.notFoundDescription} />
        </p>
        <Button className="mt-6" onClick={() => window.history.back()}>
          <Text text={t.goBack} />
        </Button>
      </div>
    </div>
  )
}
