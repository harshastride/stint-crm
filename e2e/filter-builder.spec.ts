import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// always remove views this test saved, even if it stops half way
test.afterAll(async () => { await service().from('saved_view').delete().like('name', 'Adv test %'); });

// Advanced filter: field / operator / values, AND-OR groups, live count from the database, saved with a view.
test('admin builds an advanced filter on leads, sees a live count, and saves it in a view', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: /^Advanced/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Advanced filter' });
  await expect(dlg).toBeVisible();
  // contact details are never offered as filter fields
  await dlg.getByRole('button', { name: 'Add condition' }).click();
  const fieldOpts = await dlg.getByLabel('Field').first().locator('option').allTextContents();
  expect(fieldOpts.join(' ')).not.toMatch(/mobile|email|phone/i);
  // pick the first value of the first list field
  await expect(dlg.getByTestId('adv-count')).toHaveText(/match/);
  const box = dlg.getByRole('checkbox').first();
  if (await box.count()) {
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', 'true');
  }
  await expect(dlg.getByTestId('adv-count')).toHaveText(/\d+ match/);
  await dlg.getByRole('button', { name: 'Add group' }).click();
  await dlg.getByRole('radio', { name: /Any match/ }).first().click();
  await dlg.getByRole('button', { name: 'Remove group 2' }).click();
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: /^Advanced · 1/ })).toBeVisible();

  const name = 'Adv test ' + Date.now();
  await page.getByRole('button', { name: /^View/ }).click();   // Save this view lives in the View menu
  await page.getByRole('button', { name: 'Save this view' }).click();
  await page.getByLabel('View name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();

  // clearing and re-applying the view brings the advanced filter back
  await page.getByRole('button', { name: /^Advanced/ }).click();
  await page.getByRole('dialog', { name: 'Advanced filter' }).getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('button', { name: /^Advanced$/ })).toBeVisible();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: /^Advanced · 1/ })).toBeVisible();

  // tidy up
  await page.getByRole('button', { name: 'Delete view ' + name }).click();
  await page.getByRole('button', { name: 'Remove' }).click();
});
