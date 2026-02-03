import { useUser } from '@clerk/clerk-react'
import { useEffect } from 'react'
import * as Sentry from '@sentry/react'

export function useSentryUserContext() {
  const { user, isLoaded, isSignedIn } = useUser()

  useEffect(() => {
    if (isLoaded) {
      if (user && isSignedIn) {
        Sentry.setUser({
          id: user.id,
          email:
            user.primaryEmailAddress?.emailAddress ||
            user.emailAddresses[0]?.emailAddress,
        })
        Sentry.setTag('user.signedIn', 'true')
      } else {
        Sentry.setUser(null)
        Sentry.setTag('user.signedIn', 'false')
      }
    }
  }, [user, isLoaded, isSignedIn])
}
