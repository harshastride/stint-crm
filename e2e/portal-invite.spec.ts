import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Inviting a student shows the login details once, with copy and WhatsApp share.
test('portal invite shows a login card with copy and share', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { data } = await service().from('candidate').select('id').limit(1).single();
  await login(page, 'harsha');
  await page.goto('/p/candidate?person=candidate:' + data!.id);
  const qp = page.getByRole('complementary', { name: 'Quick panel' });
  await qp.getByRole('tab', { name: /Details/ }).click();
  await qp.getByRole('button', { name: 'Invite or reset portal login' }).click();
  const card = page.getByTestId('invite-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /wa\.me\/\?text=/);
  await card.getByRole('button', { name: 'Copy login details' }).click();
  await expect(card.getByRole('button', { name: 'Copied ✓' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Temporary password:');
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card).toHaveCount(0);
});
