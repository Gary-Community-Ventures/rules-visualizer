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

  // When the active tab changes, the previously-hidden tab's pan-container
  // goes from display:none to visible. No transform/resize event fires on
  // its own, so viewport virtualization and arrow paths stay stale.
  //
  // Dispatch containerresize twice:
  //   frame 1: updates viewport + flips VirtualNode visibility (async setState)
  //   frame 2: VirtualNodes have re-rendered with refreshed `data-rendered`
  //            attributes, so arrows can now compute paths correctly
  //            (their short-circuit check skips arrows where both endpoints
  //            are virtualized away).
  useEffect(() => {
    if (activeRulesetId === null) return
    let frame2 = 0
    const frame1 = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('containerresize'))
      frame2 = requestAnimationFrame(() => {
        window.dispatchEvent(new Event('containerresize'))
      })
    })
    return () => {
      cancelAnimationFrame(frame1)
      if (frame2) cancelAnimationFrame(frame2)
    }
  }, [activeRulesetId])

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
