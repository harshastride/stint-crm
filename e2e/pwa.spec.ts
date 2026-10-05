import { test, expect } from '@playwright/test';

test('manifest is served with installable icons and shortcuts', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m.name).toBe('Stint CRM');
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('/');
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  expect(m.shortcuts.map((s: { name: string }) => s.name)).toEqual(['New enquiry', 'My follow-ups', 'Leads']);
  for (const i of m.icons) {
    const r = await request.get(i.src);
    expect(r.status(), i.src).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
  }
});

test('service worker is served as JavaScript and not cached long', async ({ request }) => {
  const res = await request.get('/sw.js');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('javascript');
  expect(res.headers()['cache-control'] || '').toMatch(/no-cache|no-store|max-age=0/);
  const body = await res.text();
  expect(body).toContain("req.mode === 'navigate'");
  expect(body).not.toMatch(/caches\.open[^\n]*\/supabase/);
});

test('offline page renders without signing in', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByText("Your changes aren't lost")).toBeVisible();
});

test('offline banner appears when the connection drops', async ({ page, context }) => {
  await page.goto('/offline');
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toBeVisible();
  await context.setOffline(false);
});
