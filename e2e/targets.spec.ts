import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Monthly target ring on the dashboard: "X / Y enrolments this month", pace colour, and "need X more, ~Y per day".
test('Admin sees the monthly target ring when a target is set', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/');
  const ring = page.getByTestId('target-ring');
  if (!(await ring.count())) { await page.waitForTimeout(3000); }
  test.skip(!(await ring.count()), 'No target set for this month in the demo data');
  await expect(ring).toContainText('enrolments this month');
  await expect(ring.getByRole('img')).toHaveAttribute('aria-label', /of \d+ enrolments this month/);
  expect(['done', 'on-track', 'behind']).toContain(await ring.getAttribute('data-pace'));
  await expect(page.getByTestId('target-need')).toContainText(/Need \d+ more|Well done/);
});

test('Ring skips the animation for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'harsha');
  await page.goto('/');
  const ring = page.getByTestId('target-ring');
  await page.waitForTimeout(3000);
  test.skip(!(await ring.count()), 'No target set for this month in the demo data');
  const style = await ring.locator('circle').nth(1).getAttribute('style');
  expect(style).toContain('none');
});
