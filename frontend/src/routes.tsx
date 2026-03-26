import { useEffect, useRef } from 'react'
import {
  Outlet,
  Router,
  createRootRoute,
  createRoute,
  useMatch,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { AppProvider, ModelProvider, useAppContext, type Tab } from '@/context'
import { HomePage } from './pages/home'
import { RulesetListPage } from './pages/ruleset-list'
import { TabBar } from './components/tab-bar'

function RootLayout() {
  const { tabs } = useAppContext()

  const matchRuleset = useMatch({
    from: '/ruleset/$rulesetId',
    shouldThrow: false,
  })
  const activeRulesetId = matchRuleset?.params.rulesetId ?? null

  const hasMatchingTab = tabs.some((t: Tab) => t.rulesetId === activeRulesetId)
  const showOutlet = activeRulesetId === null || !hasMatchingTab

  return (
    <main className="flex flex-col h-screen">
      {tabs.length > 0 && <TabBar activeRulesetId={activeRulesetId} />}
      {tabs.map((tab: Tab) => (
        <div
          key={tab.rulesetId}
          style={{
            display: tab.rulesetId === activeRulesetId ? 'flex' : 'none',
          }}
          className="flex-1 flex-col min-h-0"
        >
          <ModelProvider rulesetId={tab.rulesetId}>
            <HomePage />
          </ModelProvider>
        </div>
      ))}
      {showOutlet && <Outlet />}
    </main>
  )
}

function RulesetActivator() {
  const { rulesetId } = useParams({
    from: '/ruleset/$rulesetId',
  })
  const { openTab, closedTabs } = useAppContext()
  const navigate = useNavigate()

  const didOpen = useRef(false)
  useEffect(() => {
    didOpen.current = false
  }, [rulesetId])

  useEffect(() => {
    // Don't reopen a tab that the user just closed
    if (closedTabs.has(rulesetId)) {
      navigate({ to: '/' })
      return
    }
    if (!didOpen.current) {
      didOpen.current = true
      openTab(rulesetId, 'Loading...')
    }
  }, [rulesetId, openTab, closedTabs, navigate])

  return null
}

const rootRoute = createRootRoute({
  component: () => (
    <AppProvider>
      <RootLayout />
    </AppProvider>
  ),
})

const rulesetListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: RulesetListPage,
})

const rulesetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ruleset/$rulesetId',
  component: RulesetActivator,
})

export const routeTree = rootRoute.addChildren([rulesetListRoute, rulesetRoute])

export const router = new Router({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
