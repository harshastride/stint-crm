import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

export const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
export const service = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const PASSWORD = env.DEMO_PASSWORD || 'stint-demo-1234';

export async function login(page: Page, who: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@demo.stint.local`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /^Account menu/ })).toBeVisible({ timeout: 20_000 });
}

/** Before a test signs in as the demo student: put the demo password back and clear any sign-in lockout,
 *  so one earlier test (or a stray wrong try) cannot lock Priya out for the rest of the run. */
export async function freshDemoStudent() {
  const db = service();
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 500 });
  const u = data.users.find((x) => x.email === 'priya@demo.stint.local');
  if (u) await db.auth.admin.updateUserById(u.id, { password: PASSWORD });
  await db.from('login_attempt').delete().eq('email', 'priya@demo.stint.local');
}
