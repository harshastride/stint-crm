import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Candidate 360 and the quick panel share one stage control and one next-steps strip.
const SHOTS = process.env.PE_SHOTS || '';
const db = service();
let id = '';
const NAME = 'Venkata Sai Lakshmi Narasimha Bhavani Prasad Profile Test';

test.beforeAll(async () => {
  const { data } = await db.from('candidate').insert({ code: 'STA-PF-' + String(Date.now()).slice(-6), full_name: NAME, stage: 'Mocks' }).select('id').single();
  id = data!.id;
  await db.from('mock_session').insert({ candidate_id: id, status: 'Passed' }); // stage rules: Mocks → Resume needs a passed mock
});
test.afterAll(async () => { if (id) { await db.from('status_history').delete().eq('entity_id', id); await db.from('candidate').delete().eq('id', id); } });

test('full profile: identity, stage, next steps at the top; moves with confirm for Alumni', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/candidate/' + id);
  const top = page.getByRole('region', { name: 'Candidate summary' });
  await expect(top.getByRole('heading', { name: NAME })).toBeVisible();
  const stage = top.getByTestId('stage-control');
  await expect(stage).toContainText('Stage: Mocks');
  await expect(top.getByRole('group', { name: 'Next steps' })).toContainText('Book mock');
  if (SHOTS) await page.screenshot({ path: SHOTS + '-360-desktop.png', fullPage: true });

  // next stage in one keyboard press
  await stage.getByRole('button', { name: 'Move to Resume' }).focus();
  await page.keyboard.press('Enter');
  await expect(stage).toContainText('Stage: Resume');
  await expect.poll(async () => (await db.from('candidate').select('stage').eq('id', id).single()).data!.stage).toBe('Resume');

  // Alumni is consequential: asks first, Cancel keeps the stage
  await stage.getByLabel('Move to another stage').selectOption('Alumni');
  const ask = page.getByRole('alertdialog', { name: 'Move to Alumni?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  expect((await db.from('candidate').select('stage').eq('id', id).single()).data!.stage).toBe('Resume');

  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText(/Mocks|Resume/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/candidate/' + id);
  await expect(top.getByTestId('stage-control')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (SHOTS) await page.screenshot({ path: SHOTS + '-360-phone.png', fullPage: true });
});

test('quick panel uses the same stage control and step names', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/candidate?person=candidate:' + id);
  const panel = page.getByRole('complementary', { name: 'Quick panel' });
  await expect(panel.getByTestId('stage-control')).toContainText('Stage:');
  await expect(panel.getByRole('group', { name: 'Next steps' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: SHOTS + '-panel-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(panel.getByTestId('stage-control')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: SHOTS + '-panel-phone.png' });
});

for (const who of ['kiran', 'suresh', 'teja']) {
  test(`restricted role ${who}: no stage moves offered unless allowed, nothing breaks`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, who);
    const { data: c } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single();
    await page.goto('/candidate/' + c!.id);
    const top = page.getByRole('region', { name: 'Candidate summary' });
    const gone = page.getByText('This candidate does not exist, or your role can’t open it.');
    await expect(top.or(gone)).toBeVisible({ timeout: 15_000 });
    if (await gone.isVisible()) return;
    const stage = top.getByTestId('stage-control');
    const canMove = await stage.getByLabel('Move to another stage').count();
    if (!canMove) await expect(stage.getByRole('note')).toContainText(/can change the stage/);
    if (SHOTS) await page.screenshot({ path: SHOTS + `-360-${who}.png`, fullPage: true });
  });
}
