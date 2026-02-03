import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router, type RouterContext } from './routes'
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react'
import './index.css'
import { LanguageWrapper, useLanguageContext } from './translations/wrapper'
import { enUS, esES } from '@clerk/localizations'
import { useSentryUserContext } from './lib/hooks'
import * as Sentry from '@sentry/react'
import { LoadingPage } from './components/loading'
import { NotFoundPage } from './components/not-found'
import ErrorFallback from './components/error'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Publishable Key')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageWrapper>
      <ClerkWrapper>
        <App />
      </ClerkWrapper>
    </LanguageWrapper>
  </StrictMode>
)

function ClerkWrapper({ children }: { children: React.ReactNode }) {
  const { lang } = useLanguageContext()

  let locale = enUS
  if (lang === 'es') {
    locale = esES
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      localization={locale}
    >
      {children}
    </ClerkProvider>
  )
}

function App() {
  const { user, isLoaded, isSignedIn } = useUser()
  const { getToken } = useAuth()
  const clerk = useClerk()

  useSentryUserContext()

  if (!isLoaded) {
    return null
  }

  const context: RouterContext = {
    user,
    isSignedIn,
    getToken,
    clerk,
  }

  return (
    <Sentry.ErrorBoundary fallback={ErrorFallback} showDialog>
      <RouterProvider
        router={router}
        defaultPendingMs={300}
        defaultPendingComponent={LoadingPage}
        defaultNotFoundComponent={NotFoundPage}
        defaultStaleTime={5 * 60 * 1000}
        context={context}
      />
    </Sentry.ErrorBoundary>
  )
}
