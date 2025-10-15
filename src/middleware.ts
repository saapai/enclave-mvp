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
  // In Clerk v5, auth() is called to get the auth object
  // We don't need to protect routes in middleware - it's handled in API routes
  // Just let the middleware run without protection checks
  return
})

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
