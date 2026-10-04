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
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 20_000 });
}
