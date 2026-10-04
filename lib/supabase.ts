'use client';
import { createBrowserClient } from '@supabase/ssr';

// One cookie name everywhere (browser, middleware, API routes), whatever address Supabase runs on.
export const AUTH_COOKIE = 'sb-stint-auth-token';

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabase() {
  if (!client) {
    // go through this app's own /supabase proxy (see next.config.mjs)
    client = createBrowserClient(window.location.origin + '/supabase', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookieOptions: { name: AUTH_COOKIE } });
  }
  return client;
}
