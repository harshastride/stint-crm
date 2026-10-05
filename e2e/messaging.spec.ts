import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// In-CRM WhatsApp/email: bubbles from the message table, send box, provider absent (route mocked).
const db = service();

test('chat shows WhatsApp bubbles with ticks and the send box handles "not set up"', async ({ page }) => {
  const { data } = await db.from('lead').select('id, mobile').limit(1);
  const lead = data?.[0] as { id: string; mobile: string } | undefined;
  test.skip(!lead, 'no demo lead');
  const ins = await db.from('message').insert([
    { channel: 'whatsapp', direction: 'in', status: 'received', lead_id: lead!.id, body: 'E2E hello from the lead', from_addr: lead!.mobile },
    { channel: 'whatsapp', direction: 'out', status: 'delivered', lead_id: lead!.id, body: 'E2E reply from Stint', to_addr: lead!.mobile },
  ]).select('id');
  const ids = (ins.data || []).map((r) => r.id);
  try {
    await page.route('**/api/messages/send', (r) => r.request().method() === 'GET'
      ? r.fulfill({ json: { whatsapp: false, email: false } })
      : r.fulfill({ status: 503, json: { ok: false, notSetUp: true, error: 'WhatsApp is not set up yet.' } }));
    await login(page, 'harsha');
    await page.goto('/p/lead?person=lead:' + lead!.id);
    const qp = page.getByRole('complementary', { name: 'Quick panel' });
    await qp.getByRole('tab', { name: 'Chat', exact: true }).click();
    const chat = qp.getByTestId('chat');
    await expect(chat).toBeVisible({ timeout: 20_000 });
    const inBubble = chat.locator('[data-kind="wa"]', { hasText: 'E2E hello from the lead' });
    await expect(inBubble).toHaveAttribute('data-side', 'them');
    const outBubble = chat.locator('[data-kind="wa"]', { hasText: 'E2E reply from Stint' });
    await expect(outBubble).toHaveAttribute('data-side', 'me');
    await expect(outBubble.locator('[data-status="delivered"]')).toBeVisible();
    await expect(chat).not.toContainText(lead!.mobile);

    const box = qp.getByTestId('chat-composer');
    await expect(box.getByRole('radio', { name: 'WhatsApp' })).toHaveAttribute('aria-checked', 'true');
    await expect(box).toContainText('not set up');
    await box.getByRole('radio', { name: 'Email' }).click();
    await expect(box.getByLabel('Subject')).toBeVisible();
    await box.getByLabel('Message').fill('Hi {{first_name}}');
    await box.getByRole('button', { name: 'Send' }).click();
    await expect(box.getByRole('status')).toContainText('will go out once it is set up');
  } finally {
    if (ids.length) await db.from('message').delete().in('id', ids);
  }
});
