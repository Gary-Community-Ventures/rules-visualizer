import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useMainContext } from '@/context'
import { Text } from '@/translations/wrapper'
import { translations } from '@/translations/text'

export function HomePage() {
  const t = translations.homePage
  const { setCount } = useMainContext()

  return (
    <div className="flex items-center justify-center">
      <Card className="w-lg">
        <CardHeader>
          <CardTitle>
            <Text text={t.title} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setCount((count) => count + 1)}>
            <Text text={t.increment} />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
