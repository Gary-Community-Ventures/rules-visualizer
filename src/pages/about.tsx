import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useMainContext } from '@/context'
import { Text } from '@/translations/wrapper'
import { translations } from '@/translations/text'

export function AboutPage() {
  const t = translations.aboutPage
  const { count } = useMainContext()

  return (
    <div className="flex items-center justify-center">
      <Card className="w-lg">
        <CardHeader>
          <CardTitle>
            <Text text={t.title} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            <Text text={t.count} />
            {count}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
