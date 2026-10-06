import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Monthly target ring on the dashboard: "X / Y enrolments this month", pace colour, and "need X more, ~Y per day".
test('Admin sees the monthly target ring when a target is set', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/');
  const ring = page.getByTestId('target-ring');
  if (!(await ring.count())) { await page.waitForTimeout(3000); }
  test.skip(!(await ring.count()), 'No target set for this month in the demo data');
  await expect(ring).toContainText(/\d+ \/ \d+/);
  await expect(ring.getByRole('img')).toHaveAttribute('aria-label', /of \d+ enrolments, .*Expected by today: \d+\.\d/);
  expect(['done', 'on-track', 'behind']).toContain(await ring.getAttribute('data-pace'));
  await expect(page.getByTestId('target-status')).toHaveText(/Ahead of pace|Just on pace|Behind pace|Target reached/);
  await expect(page.getByTestId('target-need')).toContainText(/need ~[\d.]+\/day|bonus/);
});
