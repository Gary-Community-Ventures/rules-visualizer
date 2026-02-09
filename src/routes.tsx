import {
  Outlet,
  Router,
  createRootRoute,
  createRoute,
} from '@tanstack/react-router'
import { HomePage } from './pages/home'
import { Wrapper } from './context'
// import type { UserResource, GetToken, LoadedClerk } from '@clerk/types'

// export type RouterContext = {
//   // user: UserResource | null
//   // isSignedIn: boolean
//   // getToken: GetToken
//   // clerk: LoadedClerk | null
// }

const rootRoute = createRootRoute({
  component: () => (
    <Wrapper>
      <main>
        <Outlet />
      </main>
    </Wrapper>
  ),
})

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

export const routeTree = rootRoute.addChildren([homeRoute])

export const router = new Router({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
