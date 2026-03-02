import { useEffect, useRef } from 'react'
import {
  Outlet,
  Router,
  createRootRoute,
  createRoute,
  useMatch,
  useParams,
} from '@tanstack/react-router'
import { AppProvider, ModelProvider, useAppContext, type Tab } from '@/context'
import { HomePage } from './pages/home'
import { ProjectListPage } from './pages/project-list'
import { ModelListPage } from './pages/model-list'
import { TabBar } from './components/tab-bar'

function RootLayout() {
  const { tabs } = useAppContext()

  // Derive activeModelId synchronously from the current URL — fixes all
  // three tab bugs (stale state on first render, twitch, white screen).
  const matchModel = useMatch({
    from: '/project/$projectId/model/$modelId',
    shouldThrow: false,
  })
  const matchProject = useMatch({
    from: '/project/$projectId',
    shouldThrow: false,
  })
  const activeModelId = matchModel?.params.modelId ?? null
  const activeProjectId =
    matchModel?.params.projectId ?? matchProject?.params.projectId ?? null

  // Show Outlet when no model is active, OR when the active model has no
  // matching tab (e.g. brief frame after closing the last tab before
  // navigation completes).
  const hasMatchingTab = tabs.some((t: Tab) => t.modelId === activeModelId)
  const showOutlet = activeModelId === null || !hasMatchingTab

  return (
    <main className="flex flex-col h-screen">
      {tabs.length > 0 && (
        <TabBar activeModelId={activeModelId} activeProjectId={activeProjectId} />
      )}
      {tabs.map((tab: Tab) => (
        <div
          key={tab.modelId}
          style={{
            display: tab.modelId === activeModelId ? 'flex' : 'none',
          }}
          className="flex-1 flex-col min-h-0"
        >
          <ModelProvider modelId={tab.modelId}>
            <HomePage />
          </ModelProvider>
        </div>
      ))}
      {showOutlet && <Outlet />}
    </main>
  )
}

function ModelActivator() {
  const { projectId, modelId } = useParams({
    from: '/project/$projectId/model/$modelId',
  })
  const { openTab } = useAppContext()

  // Use a ref to avoid re-running when tabs changes (openTab mutates tabs,
  // which would cause an infinite effect loop if tabs were in the dep array).
  const didOpen = useRef(false)
  useEffect(() => {
    didOpen.current = false
  }, [projectId, modelId])

  useEffect(() => {
    if (!didOpen.current) {
      didOpen.current = true
      openTab(projectId, modelId, 'Loading...')
    }
  }, [projectId, modelId, openTab])

  return null
}

const rootRoute = createRootRoute({
  component: () => (
    <AppProvider>
      <RootLayout />
    </AppProvider>
  ),
})

const projectListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ProjectListPage,
})

const modelListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/project/$projectId',
  component: ModelListPage,
})

const modelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/project/$projectId/model/$modelId',
  component: ModelActivator,
})

export const routeTree = rootRoute.addChildren([
  projectListRoute,
  modelListRoute,
  modelRoute,
])

export const router = new Router({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
