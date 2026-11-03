/**
 * Business integrations (Pengaturan › Integrasi) and outgoing email.
 *
 *   GET  /api/integrations                 email + AI settings (secrets never returned, only has_*)
 *   PUT  /api/integrations/email           { email_mode: platform|smtp, smtp_* , smtp_pass? }
 *   PUT  /api/integrations/ai              { ai_mode: builtin|openai|anthropic, ai_base_url, ai_model, ai_key? }
 *   POST /api/integrations/email/test      sends a test email to the signed-in user's own address
 *   POST /api/integrations/ai/test         one short completion through the chosen provider
 *   POST /api/email/send                   { kind: offer|report, to, subject, body } (offer: daily cap; report: own address only)
 *
 * Shared demo accounts can read but never change integrations or send real email (sends are simulated).
 */
import { encryptToken } from '../src/social/crypto.js';
import { validateEmailIntegration, validateAiIntegration } from '../src/admin/rules.js';
import { isEmail } from '../src/admin/constants.js';
import { testEmail, businessEmail } from '../src/email/templates.js';
import { sendEmail, loadSystemSettings, loadIntegration, resendConfigured, customSecretsEnabled, sentToday } from './email.js';
import { resolveAi, testProvider } from './ai-provider.js';

const DEMO_DENIED = 'Tidak tersedia di akun demo.';
const isDemo = (user, deps) => deps.DEMO_EMAILS.has(String(user.email || '').toLowerCase());

function validated(HttpError, fn) {
  try { return fn(); } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
}

function publicView(row, settings, env) {
  const r = row || {};
  return {
    email: {
      mode: r.email_mode || 'platform', smtp_host: r.smtp_host || '', smtp_port: r.smtp_port || 465, smtp_secure: r.smtp_secure || 'tls',
      smtp_user: r.smtp_user || '', smtp_from_email: r.smtp_from_email || '', smtp_from_name: r.smtp_from_name || '', has_password: Boolean(r.smtp_pass_enc),
    },
    ai: { mode: r.ai_mode || 'builtin', base_url: r.ai_base_url || '', model: r.ai_model || '', has_key: Boolean(r.ai_key_enc) },
    options: {
      custom_smtp_allowed: settings.email.allow_custom_smtp, custom_ai_allowed: settings.ai.allow_custom,
      secrets_enabled: customSecretsEnabled(env), platform_email_ready: resendConfigured(env),
    },
  };
}

async function upsert(env, ownerId, fields) {
  const cols = Object.keys(fields);
  await env.DB.prepare(
    `INSERT INTO business_integrations (owner_id, ${cols.join(', ')}, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT(owner_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = excluded.updated_at`,
  ).bind(ownerId, ...cols.map((c) => fields[c]), new Date().toISOString()).run();
}

export async function handleIntegrationsGet(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const [row, settings] = await Promise.all([loadIntegration(env, user.id), loadSystemSettings(env)]);
  return deps.ok(publicView(row, settings, env));
}

async function emailPut(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (isDemo(user, deps)) throw new deps.HttpError(403, DEMO_DENIED);
  const body = await deps.readJson(request);
  const clean = validated(deps.HttpError, () => validateEmailIntegration(body));
  const settings = await loadSystemSettings(env);
  if (clean.email_mode === 'platform') {
    await upsert(env, user.id, { email_mode: 'platform' });
  } else {
    if (!settings.email.allow_custom_smtp) throw new deps.HttpError(403, 'SMTP pribadi dimatikan oleh admin.');
    if (!customSecretsEnabled(env)) throw new deps.HttpError(503, 'SMTP pribadi belum tersedia: kunci enkripsi server belum diatur.');
    const existing = await loadIntegration(env, user.id);
    const { smtp_pass, ...rest } = clean;
    if (!smtp_pass && !existing?.smtp_pass_enc) throw new deps.HttpError(400, 'Password SMTP wajib diisi.');
    const fields = { ...rest };
    if (smtp_pass) fields.smtp_pass_enc = await encryptToken(smtp_pass, env.TOKEN_KEY);
    await upsert(env, user.id, fields);
  }
  return deps.ok(publicView(await loadIntegration(env, user.id), settings, env));
}

async function aiPut(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (isDemo(user, deps)) throw new deps.HttpError(403, DEMO_DENIED);
  const body = await deps.readJson(request);
  const clean = validated(deps.HttpError, () => validateAiIntegration(body));
  const settings = await loadSystemSettings(env);
  if (clean.ai_mode === 'builtin') {
    await upsert(env, user.id, { ai_mode: 'builtin' });
  } else {
    if (!settings.ai.allow_custom) throw new deps.HttpError(403, 'Penyedia AI sendiri dimatikan oleh admin.');
    if (!customSecretsEnabled(env)) throw new deps.HttpError(503, 'Penyedia AI sendiri belum tersedia: kunci enkripsi server belum diatur.');
    const existing = await loadIntegration(env, user.id);
    const { ai_key, ...rest } = clean;
    if (!ai_key && !existing?.ai_key_enc) throw new deps.HttpError(400, 'API key wajib diisi.');
    const fields = { ...rest };
    if (ai_key) fields.ai_key_enc = await encryptToken(ai_key, env.TOKEN_KEY);
    await upsert(env, user.id, fields);
  }
  return deps.ok(publicView(await loadIntegration(env, user.id), settings, env));
}

export { emailPut as handleIntegrationsEmailSave, aiPut as handleIntegrationsAiSave };

export async function handleIntegrationsEmailTest(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (isDemo(user, deps)) return deps.ok({ simulated: true, provider: 'demo', to: user.email });
  const row = await loadIntegration(env, user.id);
  const t = testEmail({ via: row?.email_mode === 'smtp' ? `SMTP pribadi (${row.smtp_host})` : 'layanan email Satu Alur' });
  const { provider } = await sendEmail(env, deps, { ownerId: user.id, kind: 'test', to: user.email, subject: t.subject, html: t.html, text: t.text });
  return deps.ok({ provider, to: user.email });
}

export async function handleIntegrationsAiTest(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const provider = await resolveAi(env, user, deps);
  if (provider.mode === 'builtin') return deps.ok({ mode: 'builtin', reply: 'Mesin AI bawaan siap dipakai.' });
  const reply = await testProvider(provider, deps);
  return deps.ok({ mode: provider.mode, model: provider.model, reply: reply || '(balasan kosong)' });
}

export async function handleEmailSend(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const body = await deps.readJson(request);
  const kind = body.kind === 'report' ? 'report' : 'offer';
  const to = kind === 'report' ? user.email : String(body.to || '').trim().toLowerCase();
  if (!isEmail(to)) throw new deps.HttpError(400, 'Alamat email penerima tidak valid.');
  const subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 150);
  const text = String(body.body || '').trim();
  if (!subject) throw new deps.HttpError(400, 'Subjek wajib diisi.');
  if (!text || text.length > 10000) throw new deps.HttpError(400, 'Isi email wajib diisi (maks. 10.000 karakter).');
  if (isDemo(user, deps)) return deps.ok({ simulated: true, provider: 'demo', to });
  const settings = await loadSystemSettings(env);
  const cap = kind === 'offer' ? settings.email.offer_daily_cap : 10;
  if ((await sentToday(env, user.id, kind)) >= cap) throw new deps.HttpError(429, `Batas ${cap} email ${kind === 'offer' ? 'penawaran' : 'laporan'} per hari tercapai.`);
  const mail = businessEmail({ subject, body: text, businessName: user.name });
  const { provider } = await sendEmail(env, deps, { ownerId: user.id, kind, to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: user.email });
  return deps.ok({ provider, to });
}
