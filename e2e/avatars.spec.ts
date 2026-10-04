import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test('batch rows show the trainer and student count as faces with a tooltip', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/batch');
  const stack = page.getByTestId('avatar-stack').first();
  await expect(stack).toBeVisible({ timeout: 15_000 });
  await stack.locator('[tabindex="0"]').first().focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
});

test('Candidate 360 shows who worked with the candidate', async ({ page }) => {
  await login(page, 'harsha');
  const { data } = await service().from('candidate').select('id').not('poc_id', 'is', null).limit(1).single();
  await page.goto('/candidate/' + data!.id);
  await expect(page.getByRole('group', { name: 'Staff who worked with this candidate' })).toBeVisible({ timeout: 15_000 });
});
