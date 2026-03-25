import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './routes'
import './index.css'
import { LanguageWrapper } from './translations/wrapper'
import { LoadingPage } from './components/loading'
import { NotFoundPage } from './components/not-found'
import ErrorFallback from './components/error'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageWrapper>
      <App />
    </LanguageWrapper>
  </StrictMode>
)

function App() {
  return (
    <ErrorBoundary>
      <RouterProvider
        router={router}
        defaultPendingMs={300}
        defaultPendingComponent={LoadingPage}
        defaultNotFoundComponent={NotFoundPage}
        defaultStaleTime={5 * 60 * 1000}
      />
    </ErrorBoundary>
  )
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Uncaught error:', error, info)
  }

  render() {
    if (this.state.error !== null) {
      return <ErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}
