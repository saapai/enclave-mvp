import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/api/search(.*)',
  '/api/resources(.*)',
  '/api/query-log(.*)',
  '/api/upload(.*)',
  '/api/ingest(.*)',
  '/api/admin(.*)'
])

export default clerkMiddleware(async (auth, req) => {
  const isDev = process.env.NODE_ENV !== 'production'
  if (isProtectedRoute(req)) {
    if (!isDev) {
      await auth.protect()
    }
  }
})

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
