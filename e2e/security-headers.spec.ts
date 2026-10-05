import { test, expect } from '@playwright/test';

test('security headers on pages and api routes', async ({ request }) => {
  for (const path of ['/login', '/', '/api/auth/sign-in']) {
    const res = await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy'], path).toContain("object-src 'none'");
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy'], path).toContain('microphone=(self)');
    expect(h['cross-origin-opener-policy'], path).toBe('same-origin');
  }
});

test('direct password sign-in through the proxy is blocked', async ({ request }) => {
  const res = await request.post('/supabase/auth/v1/token?grant_type=password', { data: { email: 'x@y.z', password: 'nope' } });
  expect(res.status()).toBe(403);
});

test('app cannot be framed and login page has no CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(violations).toEqual([]);
  await page.setContent('<iframe id="f" src="http://localhost:3100/login" style="width:400px;height:300px"></iframe>');
  await page.waitForTimeout(1500);
  const framed = page.frame({ url: /\/login/ });
  const body = framed ? await framed.evaluate(() => document.body?.innerText || '').catch(() => '') : '';
  expect(body).not.toContain('Welcome back');
  expect(violations.some((v) => v.includes('frame-ancestors'))).toBe(true);
});
