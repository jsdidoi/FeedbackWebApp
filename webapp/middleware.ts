import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Function to update session and handle cookies
async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // If the cookie is set, update the request cookies and response cookies
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          // If the cookie is removed, update the request cookies and response cookies
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  // Refresh session if expired - required for Server Components
  // https://supabase.com/docs/guides/auth/auth-helpers/nextjs#managing-session-with-middleware
  // IMPORTANT: Avoid multiple getSession calls in the same request flow
  // Read session from Supabase client
  const { data: { session } } = await supabase.auth.getSession();

  return { response, session };
}

export async function middleware(request: NextRequest) {
  // Update session and get response and session objects
  const { response, session } = await updateSession(request);

  // Define protected and public routes
  const { pathname } = request.nextUrl;

  // *** START DEBUG LOGGING ***
  console.log(`[Middleware] Pathname: ${pathname}`);
  console.log(`[Middleware] Session found:`, session ? !!session : false);
  // console.log("[Middleware] Session details:", session); // Optional: Log full session for more detail
  // *** END DEBUG LOGGING ***

  const publicPaths = ['/sign-in', '/sign-up', '/reset-password']; // Add other public paths if needed

  // Check if the current path is public
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path));

  // If it's not a public path and there's no session, redirect to sign-in
  if (!isPublicPath && !session) {
    // Store the intended URL before redirecting
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/sign-in';
    // Optionally add the original path as a query parameter for redirecting back later
    // redirectUrl.searchParams.set('redirectedFrom', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // If user is logged in and tries to access auth pages, redirect to home
  if (isPublicPath && session) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Otherwise, allow the request to proceed
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more exceptions.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
} 