import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// QR verification on receipts and quotes: public /v/<code>, no login, no personal data.
test('receipt PDF still works and /v/<code> verifies without login', async ({ page, browser }) => {
  const db = service();
  const { data: pay } = await db.from('fee_payment').select('id, verification_code, candidate:candidate_id(full_name)').eq('status', 'Received').limit(1).single();
  const fullName = (pay!.candidate as unknown as { full_name: string }).full_name;

  await login(page, 'harsha');
  const pdf = await page.request.get(`/api/pdf/receipt/${pay!.id}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  const visitor = await browser.newContext();   // no cookies: a parent or employer scanning the QR
  const v = await visitor.newPage();
  const res = await v.goto(`/v/${pay!.verification_code}`);
  expect(res!.status()).toBe(200);
  expect(v.url()).toContain('/v/');
  await expect(v.getByTestId('verify-genuine')).toBeVisible();
  await expect(v.getByRole('heading', { name: /Genuine .* payment receipt/ })).toBeVisible();
  expect(await v.locator('main').innerText()).not.toContain(fullName);
  expect(await v.content()).not.toContain(fullName);

  await v.goto('/v/0123456789ABCDEF');
  await expect(v.getByTestId('verify-not-found')).toBeVisible();
  await expect(v.getByText('We couldn’t find this document').or(v.getByText("We couldn't find this document"))).toBeVisible();
  await visitor.close();
});
