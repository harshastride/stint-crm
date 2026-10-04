import { expect, test } from '@playwright/test';
import { login, service } from './helpers';
import { makeCoachToken, verifyCoachToken } from '../lib/server/coachSso';

test('coach sign-in pass: valid, tampered, expired, wrong secret', () => {
  const t = makeCoachToken({ cid: 'c1', email: 'a@example.com', name: 'A' }, 'test-secret');
  expect(verifyCoachToken(t, 'test-secret')?.cid).toBe('c1');
  expect(verifyCoachToken(t, 'other-secret')).toBeNull();
  const [p, s] = t.split('.');
  expect(verifyCoachToken(Buffer.from(JSON.stringify({ cid: 'c2', exp: 9e9 })).toString('base64url') + '.' + s, 'test-secret')).toBeNull();
  expect(verifyCoachToken(p, 'test-secret')).toBeNull();
  expect(verifyCoachToken(makeCoachToken({ cid: 'c1', email: '', name: '' }, 'test-secret', -5), 'test-secret')).toBeNull();
});

test('practice scores: API key, range checks, shown to Trainer not Telecaller', async ({ page }) => {
  const db = service();
  const key = (await db.from('integration_config').select('value').eq('key', 'incoming_api_key').single()).data!.value as string;
  const c = (await db.from('candidate').insert({ code: 'STA-PR-' + String(Date.now()).slice(-6), full_name: 'Practice Test', stage: 'Training' }).select('id').single()).data!;
  const ref = 'e2e-' + Date.now();
  const body = { candidate_id: c.id, attempt_ref: ref, topic: 'SQL joins', question: 'Explain a left join', overall: 78, accuracy: 80, fluency: 70, completeness: 85, wpm: 130, filler_count: 3, created_at: new Date().toISOString() };
  const post = (data: unknown, k = key) => page.request.post('/api/integrations/practice', { data, headers: { 'x-api-key': k } });
  try {
    expect((await post(body, 'wrong')).status()).toBe(401);
    const out = await post({ ...body, overall: 140 });
    expect(out.status()).toBe(400);
    expect((await out.json()).error).toContain('overall');
    expect((await post({ ...body, attempt_ref: '' })).status()).toBe(400);
    const ok = await post(body);
    expect(ok.status()).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    expect((await post({ ...body, overall: 82 })).status()).toBe(200); // same attempt_ref → update
    expect((await db.from('interview_practice').select('overall').eq('attempt_ref', ref)).data).toEqual([{ overall: 82 }]);

    await login(page, 'kiran');
    await page.goto('/candidate/' + c.id);
    const card = page.getByRole('region', { name: 'Interview practice' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('82');
    await expect(card).toContainText('SQL joins');

    await login(page, 'teja');
    await page.goto('/candidate/' + c.id);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('region', { name: 'Interview practice' })).toHaveCount(0);
  } finally {
    await db.from('interview_practice').delete().eq('candidate_id', c.id);
    await db.from('candidate').delete().eq('id', c.id);
  }
});
