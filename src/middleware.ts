import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/api/search(.*)',
  '/api/resources(.*)',
  '/api/query-log(.*)',
  '/api/upload(.*)',
  '/api/ingest(.*)',
  '/api/admin(.*)'
])

export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) {
    auth.protect()
  }
})

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
