/**
 * Email delivery for the whole app (OTP, offers, tests, reports).
 *
 * Default provider: Resend REST API (env RESEND_API_KEY, From env EMAIL_FROM).
 * A business may instead use its own SMTP server (business_integrations.email_mode = 'smtp');
 * its password is AES-GCM encrypted with TOKEN_KEY and the option is off when TOKEN_KEY is
 * missing or an admin disallows it (system_settings.email.allow_custom_smtp).
 * Admins may switch the PLATFORM transport (system emails such as OTP, and the default for
 * businesses without their own SMTP) to a custom SMTP server (system_settings 'email_transport',
 * password AES-GCM encrypted with TOKEN_KEY). If that SMTP fails, the email falls back to
 * Resend so sign-in never breaks; the failure is still logged.
 * Every send is logged in email_log (recipient, subject, provider, status).
 */
import { sendResend, EmailError } from '../src/email/resend.js';
import { sendSmtp, SmtpError } from '../src/email/smtp.js';
import { parseAddress } from '../src/email/mime.js';
import { withDefaults } from '../src/admin/rules.js';
import { decryptToken } from '../src/social/crypto.js';

export const TRANSPORT_KEY = 'email_transport';

export const DEFAULT_FROM = 'Satu Alur <noreply@apipedia.id>';
const missingSchema = (err) => /no such (table|column)/i.test(String(err?.message));

export async function loadSystemSettings(env) {
  try {
    const { results } = await env.DB.prepare('SELECT key, value_json FROM system_settings').all();
    const raw = {};
    for (const r of results || []) {
      try { raw[r.key] = JSON.parse(r.value_json); } catch { /* ignore a corrupt row */ }
    }
    return withDefaults(raw);
  } catch (err) {
    if (missingSchema(err)) return withDefaults({});
    throw err;
  }
}

export async function loadIntegration(env, ownerId) {
  if (!ownerId) return null;
  try {
    return await env.DB.prepare('SELECT * FROM business_integrations WHERE owner_id = ?').bind(ownerId).first();
  } catch (err) {
    if (missingSchema(err)) return null;
    throw err;
  }
}

/** The stored platform transport row (raw, includes pass_enc) or { mode: 'resend' }. */
export async function loadPlatformTransport(env) {
  try {
    const row = await env.DB.prepare('SELECT value_json FROM system_settings WHERE key = ?').bind(TRANSPORT_KEY).first();
    const v = row ? JSON.parse(row.value_json) : null;
    return v && v.mode === 'smtp' ? v : { mode: 'resend' };
  } catch (err) {
    if (missingSchema(err) || err instanceof SyntaxError) return { mode: 'resend' };
    throw err;
  }
}

export const resendConfigured = (env) => Boolean(env.RESEND_API_KEY);
export const customSecretsEnabled = (env) => Boolean(env.TOKEN_KEY);

async function log(env, row) {
  try {
    await env.DB.prepare(
      'INSERT INTO email_log (owner_id, kind, recipient, subject, provider, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(row.ownerId || null, row.kind, row.to, String(row.subject).slice(0, 200), row.provider, row.status, row.error ? String(row.error).slice(0, 300) : null, new Date().toISOString()).run();
  } catch (err) {
    if (!missingSchema(err)) console.error('email_log insert failed', err);
  }
}

/**
 * Sends one email. opts: { ownerId?, kind, to, subject, html, text, useBusiness = true, smtpOverride? }.
 * Returns { provider }. Throws HttpError with a friendly message on failure (also logged).
 */
export async function sendEmail(env, { HttpError }, opts) {
  const settings = await loadSystemSettings(env);
  let smtp = opts.smtpOverride || null;
  let provider = 'smtp';
  if (!smtp && opts.useBusiness !== false && opts.ownerId && settings.email.allow_custom_smtp && customSecretsEnabled(env)) {
    const row = await loadIntegration(env, opts.ownerId);
    if (row?.email_mode === 'smtp' && row.smtp_host && row.smtp_pass_enc) {
      let pass;
      try { pass = await decryptToken(row.smtp_pass_enc, env.TOKEN_KEY); } catch { throw new HttpError(500, 'Password SMTP tersimpan tidak bisa dibuka. Simpan ulang di Pengaturan › Integrasi.'); }
      smtp = { host: row.smtp_host, port: row.smtp_port, secure: row.smtp_secure, user: row.smtp_user, pass, from: row.smtp_from_email, fromName: row.smtp_from_name };
    }
  }
  // No business SMTP: the platform transport chosen by admins (custom SMTP or Resend).
  if (!smtp && !opts.forceResend && customSecretsEnabled(env)) {
    const t = await loadPlatformTransport(env);
    if (t.mode === 'smtp' && t.host && t.pass_enc) {
      try {
        const pass = await decryptToken(t.pass_enc, env.TOKEN_KEY);
        smtp = { host: t.host, port: t.port, secure: t.secure, user: t.user, pass, from: t.from_email, fromName: t.from_name || settings.email.from_name, replyTo: t.reply_to || undefined };
        provider = 'platform_smtp';
      } catch (err) {
        await log(env, { ownerId: opts.ownerId, kind: opts.kind, to: opts.to, subject: opts.subject, provider: 'platform_smtp', status: 'failed', error: 'Password SMTP platform tidak bisa dibuka.' });
      }
    }
  }
  const base = { ownerId: opts.ownerId, kind: opts.kind, to: opts.to, subject: opts.subject };
  if (smtp) {
    try {
      const { connect } = await import('cloudflare:sockets');
      await sendSmtp({ ...smtp, replyTo: opts.replyTo || smtp.replyTo, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html }, { connect, hostname: 'satualur.apipedia.id' });
      await log(env, { ...base, provider, status: 'sent' });
      return { provider };
    } catch (err) {
      const message = err instanceof SmtpError ? err.message : 'Email gagal dikirim lewat SMTP.';
      await log(env, { ...base, provider, status: 'failed', error: message });
      // Platform SMTP down: fall back to Resend so OTP codes and system mail still arrive.
      if (provider !== 'platform_smtp' || !resendConfigured(env)) throw new HttpError(502, message);
    }
  }
  const from = parseAddress(env.EMAIL_FROM || DEFAULT_FROM);
  const fromHeader = `${settings.email.from_name || from.name || 'Satu Alur'} <${from.email}>`;
  try {
    await sendResend({ apiKey: env.RESEND_API_KEY, from: fromHeader, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, replyTo: opts.replyTo });
    await log(env, { ...base, provider: 'resend', status: 'sent' });
    return { provider: 'resend' };
  } catch (err) {
    const status = err instanceof EmailError ? err.status : 502;
    const message = err instanceof EmailError ? err.message : 'Email gagal dikirim.';
    await log(env, { ...base, provider: 'resend', status: 'failed', error: message });
    throw new HttpError(status, message);
  }
}

/** Emails of `kind` sent by an owner today (WIB day), for daily caps. */
export async function sentToday(env, ownerId, kind) {
  const start = new Date(Date.now() + 7 * 3600 * 1000);
  start.setUTCHours(0, 0, 0, 0);
  const since = new Date(start.getTime() - 7 * 3600 * 1000).toISOString();
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_log WHERE owner_id = ? AND kind = ? AND status = 'sent' AND created_at >= ?")
      .bind(ownerId, kind, since).first();
    return r?.n || 0;
  } catch (err) {
    if (missingSchema(err)) return 0;
    throw err;
  }
}
