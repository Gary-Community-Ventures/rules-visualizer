import { Loader2 } from 'lucide-react'
import { Text } from '@/translations/wrapper'
import { translations } from '@/translations/text'

export const LoadingPage = () => {
  const t = translations.general.loadingPage
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
      <Loader2 className="h-16 w-16 animate-spin text-tertiary" />
      <p className="text-xl text-gray-700 mt-4">
        <Text text={t.loading} />
      </p>
    </div>
  )
}
