import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['microphone'] });

test('voice input: spoken note lands in the note box as an editable draft, nothing saved', async ({ page }) => {
  const db = service();
  const { data: c } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single();
  let sent = '';
  await page.route('**/api/voice/dictate', async (route) => {
    sent = route.request().postData() || '';
    await route.fulfill({ json: { clean_text: 'She wants the Power BI batch on weekends.', summary: 'Wants weekend Power BI.', outcome: null, follow_up: null, follow_up_when: null, transcript: 'aame power bi weekend batch kavali' } });
  });
  await login(page, 'harsha');
  await page.goto('/p/candidate?person=candidate:' + c!.id);
  await page.getByRole('button', { name: 'Add note' }).click();
  const box = page.getByLabel('Note', { exact: true });
  await box.fill('Called today.');
  await page.getByRole('button', { name: 'Speak instead of typing' }).click();
  await expect(page.getByText(/Listening/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop and turn into text' }).click();
  await expect(box).toHaveValue('Called today. She wants the Power BI batch on weekends.');
  expect(sent).toContain('name="context"');
  await page.getByRole('button', { name: 'Show what I said' }).click();
  await expect(page.getByTestId('voice-raw')).toContainText('power bi');
  await box.fill('Edited draft');
  await expect(box).toHaveValue('Edited draft');
  // nothing saved by the mic
  const { count } = await db.from('note').select('id', { count: 'exact', head: true }).like('body', '%Power BI batch on weekends%');
  expect(count).toBe(0);
});

test('voice input: Esc cancels and empty audio says it could not hear', async ({ page }) => {
  await page.route('**/api/voice/dictate', (route) => route.fulfill({ json: { empty: true, transcript: '' } }));
  const db = service();
  const { data: c } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single();
  await login(page, 'harsha');
  await page.goto('/p/candidate?person=candidate:' + c!.id);
  await page.getByRole('button', { name: 'Add note' }).click();
  const mic = page.getByRole('button', { name: 'Speak instead of typing' });
  await mic.click();
  await expect(page.getByText(/Listening/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(mic).toBeVisible();
  await mic.click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Stop and turn into text' }).click();
  await expect(page.getByText(/Couldn’t hear that/)).toBeVisible();
});
