import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// Throwaway address that has no login, so demo accounts never get locked.
const EMAIL = `lockout-${Date.now()}@nobody.stint.local`;
const DB = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const cleanup = () => execSync(`psql "${DB}" -c "delete from public.login_attempt where email like 'lockout-%@nobody.stint.local'"`);

test.afterAll(cleanup);

test('5 wrong passwords lock the email for 15 minutes, same answer as a real email', async ({ page }) => {
  await page.goto('/login');
  const email = page.getByLabel('Email'), pass = page.getByLabel('Password', { exact: true });
  for (let i = 1; i <= 5; i++) {
    await email.fill(EMAIL); await pass.fill('wrong-password-' + i);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = page.locator('form [role=alert]');
    if (i < 5) await expect(alert).toContainText('don’t match');
    else await expect(alert).toContainText('paused for 15 minutes');
  }
  // still locked even with any password
  await pass.fill('anything-else-12');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toContainText('paused');
  const n = execSync(`psql "${DB}" -tAc "select count(*) from public.login_attempt where email='${EMAIL}' and not ok"`).toString().trim();
  expect(Number(n)).toBe(5);
});

test('demo login still works through the guarded route', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('harsha@demo.stint.local');
  await page.getByLabel('Password', { exact: true }).fill('stint-demo-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
});
