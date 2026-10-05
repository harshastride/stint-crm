import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const DEV = process.env.NODE_ENV === 'development';
// Pages that may show inside a frame on our pages: the Activepieces builder (BUILDER_FRAME_ORIGINS, space separated).
const FRAME_ORIGINS = (process.env.BUILDER_FRAME_ORIGINS || (DEV ? 'http://localhost:8081' : '')).trim();

function csp(nonce: string) {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, // React style={} attributes need inline styles
    `font-src 'self' data: https://fonts.gstatic.com`,
    `img-src 'self' data: blob:`,
    `media-src 'self' blob:`,
    `connect-src 'self'${DEV ? ' ws: wss:' : ''}`,
    `frame-src 'self' blob:${FRAME_ORIGINS ? ' ' + FRAME_ORIGINS : ''}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(DEV ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

function isLocal(req: NextRequest) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.get('host') || '') || req.nextUrl.hostname.endsWith('.localhost');
}

/** Security headers on every response this middleware handles (static ones are also set in next.config.mjs). */
function secure(res: NextResponse, req: NextRequest, policy: string) {
  res.headers.set('Content-Security-Policy', policy);
  if (!isLocal(req)) res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return res;
}

// Adds security headers, keeps the login fresh and sends visitors who are not logged in to /login.
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);

  // password sign-in must go through /api/auth/sign-in (wrong-password lockout); refresh tokens still pass.
  if (path.startsWith('/supabase/auth/v1/token') && request.nextUrl.searchParams.get('grant_type') === 'password') {
    return secure(NextResponse.json({ error: 'Use /api/auth/sign-in' }, { status: 403 }), request, policy);
  }
  if (path.startsWith('/api/') || path.startsWith('/supabase/')) return secure(NextResponse.next(), request, policy);

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy); // Next.js reads the nonce from here and puts it on its own scripts

  const cookieDefaults = { sameSite: 'lax' as const, secure: !isLocal(request), path: '/' };
  let response = NextResponse.next({ request: { headers } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: 'sb-stint-auth-token', ...cookieDefaults },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        headers.set('cookie', request.cookies.toString());
        response = NextResponse.next({ request: { headers } });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, ...cookieDefaults }));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && path !== '/login') return secure(NextResponse.redirect(new URL('/login', request.url)), request, policy);
  if (data.user && path === '/login') return secure(NextResponse.redirect(new URL('/', request.url)), request, policy);
  return secure(response, request, policy);
}

// public files (logo, icons) skip the login check and get headers from next.config.mjs
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|icons/|sw\\.js|manifest\\.webmanifest|offline|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'] };
