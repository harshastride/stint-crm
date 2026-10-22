import { NextResponse } from 'next/server';
import { crossSite, fail, limited } from '@/lib/server/guard';
import { getApp, graph, MetaError, appToken, setupWebhook } from '@/lib/server/meta';
import { requireMetaAdmin } from '@/lib/server/meta-sync';
import { service } from '@/lib/server/recordings';
import { siteUrl } from '@/lib/server/teams';

// "Save" on the Meta lead forms page: stores the Meta app (App ID, secret, optional Login for Business configuration),
// checks Meta accepts them, and points the app's webhook at this CRM. The secret is never returned or logged.
export const dynamic = 'force-dynamic';

const DIGITS = /^\d{5,25}$/;
const SECRET = /^[A-Za-z0-9]{16,64}$/;

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  try {
    const who = await requireMetaAdmin();
    if (who instanceof NextResponse) return who;
    if (limited('meta-app:' + who.user.id, 10, 3600_000))
      return NextResponse.json({ error: 'Saved many times in the last hour. Please try again later.' }, { status: 429 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const appId = typeof body?.app_id === 'string' ? body.app_id.trim() : '';
    const secret = typeof body?.app_secret === 'string' ? body.app_secret.trim() : '';
    const configId = typeof body?.login_config_id === 'string' ? body.login_config_id.trim() : '';
    if (!DIGITS.test(appId)) return NextResponse.json({ error: 'The App ID is a number from the Meta app (App settings → Basic).' }, { status: 400 });
    if (secret && !SECRET.test(secret)) return NextResponse.json({ error: 'The App secret does not look right. Copy it again from App settings → Basic (press Show).' }, { status: 400 });
    if (configId && !DIGITS.test(configId)) return NextResponse.json({ error: 'The configuration ID is a number (Facebook Login for Business → Configurations). Leave it empty if you do not use one.' }, { status: 400 });

    const db = service();
    const saved = await getApp(db);
    if (!secret && !saved?.app_secret) return NextResponse.json({ error: 'Enter the App secret (App settings → Basic, press Show).' }, { status: 400 });

    // 1. Does Meta accept this App ID and secret? Checked BEFORE saving, so a mistyped secret never replaces a working one.
    const app = { ...saved, app_id: appId, login_config_id: configId || null, app_secret: secret || saved.app_secret };
    let appName = '';
    try {
      const r = await graph<{ id?: string; name?: string }>(app, appId, { token: appToken(app), params: { fields: 'id,name' } });
      appName = String(r?.name || '');
    } catch (e) {
      if (!(e instanceof MetaError)) throw e;
      return NextResponse.json({ error: 'Meta did not accept this App ID and secret. Check them in the Meta app → App settings → Basic. Nothing was changed.' }, { status: 400 });
    }
    const { error: saveErr } = await db.from('meta_app')
      .update({ app_id: appId, login_config_id: configId || null, ...(secret ? { app_secret: secret } : {}), updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (saveErr) return fail('meta app save', saveErr, 'Could not save the Meta app.');
    const note = (webhook_ok: boolean, webhook_error: string | null) =>
      db.from('meta_app').update({ webhook_ok, webhook_error, updated_at: new Date().toISOString() }).eq('id', 1);

    // 2. Point the app's webhook at this CRM (Meta checks it straight away by calling our webhook).
    const site = await siteUrl().catch(() => '');
    let webhookOk = false;
    let webhookError: string | null = null;
    if (!site.startsWith('https://')) {
      webhookError = 'Meta only sends leads to a secure web address. Save this again from the live CRM address (for example crm.skillxen.com).';
    } else {
      try {
        await setupWebhook(app, site + '/api/meta/webhook');
        webhookOk = true;
      } catch (e) {
        if (!(e instanceof MetaError)) throw e;
        webhookError = e.message;
      }
    }
    await note(webhookOk, webhookError);
    return NextResponse.json({ ok: true, app_name: appName, webhook_ok: webhookOk, webhook_error: webhookError });
  } catch (e) {
    return fail('meta app', e, 'Could not save the Meta app. Please try again.');
  }
}
