import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/',
  '/api/search(.*)',
  '/api/resources(.*)',
  '/api/query-log(.*)'
])

export default clerkMiddleware((auth, req) => {
  // Temporarily disable auth protection for testing
  // if (isProtectedRoute(req)) {
  //   auth.protect()
  // }
})

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
