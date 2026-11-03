/**
 * Kantor Satu Alur › Sistem (admins only: staff sessions or ADMIN_EMAILS email logins).
 *
 *   GET  /api/office/admin/system                  { settings, status } (secrets only as configured true/false)
 *   PUT  /api/office/admin/system/:key             { value } for key email | ai | login
 *   POST /api/office/admin/system/email/test       { to? } test email via the platform provider
 *   POST /api/office/admin/system/ai/test          one short reply from the built-in model
 *   GET  /api/office/admin/summary                 dashboard counts
 *   GET  /api/office/admin/activity                recent emails + AI usage per feature (this month) + connector counts
 *   GET  /api/office/admin/users/:userId/detail    one user: tier, plan, usage, credit, integrations (no secrets), emails
 *   PUT  /api/office/admin/users/:userId/tier      { plan: sole | ukm | enterprise }
 *   GET  /api/office/admin/system/admins           { admins, bootstrap, audit }
 *   POST /api/office/admin/system/admins           { email } grant admin access
 *   DELETE /api/office/admin/system/admins/:email  revoke (never the last listed admin)
 * Every change is written to admin_audit.
 */
import { requireAdmin } from './office.js';
import { normalizeSetting, SETTING_KEYS, adminEmailSet, AI_MODE_LABELS } from '../src/admin/rules.js';
import { isEmail } from '../src/admin/constants.js';
import { testEmail } from '../src/email/templates.js';
import { isGoogleConfigured, googleRedirectUri } from '../src/auth/google.js';
import { PLANS } from '../src/business/plan-access.js';
import { STAFF_EMAIL_SUFFIX } from '../src/customers/rules.js';
import { loadSystemSettings, sendEmail, resendConfigured, customSecretsEnabled, DEFAULT_FROM } from './email.js';

export async function audit(env, actor, action, target, detail) {
  try {
    await env.DB.prepare('INSERT INTO admin_audit (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(String(actor || '?'), action, target ?? null, detail === undefined ? null : String(detail).slice(0, 500), new Date().toISOString()).run();
  } catch (err) {
    if (!/no such table/i.test(String(err?.message))) console.error('admin_audit insert failed', err);
  }
}

const missingTable = (err) => /no such (table|column)/i.test(String(err?.message));
const period = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);

async function safeFirst(stmt, fallback = null) {
  try { return await stmt.first(); } catch (err) { if (missingTable(err)) return fallback; throw err; }
}
async function safeAll(stmt) {
  try { return (await stmt.all()).results || []; } catch (err) { if (missingTable(err)) return []; throw err; }
}

export async function handleSystemGet(request, env, deps) {
  await requireAdmin(request, env, deps);
  const settings = await loadSystemSettings(env);
  const [byoAi, byoSmtp] = await Promise.all([
    safeFirst(env.DB.prepare("SELECT COUNT(*) AS n FROM business_integrations WHERE ai_mode != 'builtin' AND ai_key_enc IS NOT NULL"), { n: 0 }),
    safeFirst(env.DB.prepare("SELECT COUNT(*) AS n FROM business_integrations WHERE email_mode = 'smtp' AND smtp_pass_enc IS NOT NULL"), { n: 0 }),
  ]);
  return deps.ok({
    settings,
    status: {
      email: { resend: resendConfigured(env), from: env.EMAIL_FROM || DEFAULT_FROM, businesses_with_smtp: byoSmtp?.n || 0 },
      encryption: customSecretsEnabled(env),
      ai: { builtin_models: deps.LLM_MODELS.map((m) => ({ id: m.id, name: m.name })), businesses_with_custom: byoAi?.n || 0, modes: AI_MODE_LABELS },
      login: {
        otp_email: env.DEMO_OTP !== 'true', demo_otp: env.DEMO_OTP === 'true', demo_login: env.DEMO_LOGIN !== 'false',
        google: isGoogleConfigured(env), google_redirect_uri: googleRedirectUri(env, request.url),
        admin_emails: adminEmailSet(env.ADMIN_EMAILS).size,
      },
      whatsapp: await whatsappStatus(env),
    },
  });
}

// WhatsApp/social connectors live on their own branch and are per business; here only how many
// businesses connected each, when those tables exist, and whether the platform fallback is on.
async function whatsappStatus(env) {
  const count = async (sql) => (await safeFirst(env.DB.prepare(sql), null))?.n ?? null;
  return {
    platform_fallback: env.WA_PLATFORM_FALLBACK === 'true',
    wapilot: await count("SELECT COUNT(*) AS n FROM business_settings WHERE wa_provider = 'wapilot'"),
    waconsole: await count("SELECT COUNT(*) AS n FROM business_settings WHERE wa_provider = 'waconsole'"),
    repliz: await count('SELECT COUNT(DISTINCT owner_id) AS n FROM repliz_accounts'),
  };
}

export async function handleSystemPut(request, env, deps, params) {
  const admin = await requireAdmin(request, env, deps);
  if (!SETTING_KEYS.includes(params.key)) throw new deps.HttpError(404, 'Pengaturan tidak dikenal.');
  const body = await deps.readJson(request);
  let value;
  try { value = normalizeSetting(params.key, body.value); } catch (err) {
    if (err?.validation) throw new deps.HttpError(400, err.message);
    throw err;
  }
  await env.DB.prepare(
    `INSERT INTO system_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(params.key, JSON.stringify(value), new Date().toISOString(), admin.email).run();
  await audit(env, admin.email, 'setting.update', params.key, JSON.stringify(value));
  return deps.ok({ key: params.key, value });
}

export async function handleSystemEmailTest(request, env, deps) {
  const admin = await requireAdmin(request, env, deps);
  const body = await deps.readJson(request).catch(() => ({}));
  const to = String(body.to || (admin.email.endsWith(STAFF_EMAIL_SUFFIX) ? '' : admin.email)).trim().toLowerCase();
  if (!isEmail(to)) throw new deps.HttpError(400, 'Isi alamat email tujuan.');
  const t = testEmail({ via: 'layanan email Satu Alur (default)' });
  const { provider } = await sendEmail(env, deps, { ownerId: admin.id, kind: 'admin_test', to, subject: t.subject, html: t.html, text: t.text, useBusiness: false });
  return deps.ok({ provider, to });
}

export async function handleSystemAiTest(request, env, deps) {
  await requireAdmin(request, env, deps);
  const settings = await loadSystemSettings(env);
  const model = deps.LLM_MODELS.some((m) => m.id === settings.ai.default_model) ? settings.ai.default_model : deps.LLM_MODELS[0].id;
  const started = Date.now();
  try {
    const res = await env.AI.run(model, { messages: [{ role: 'user', content: 'Balas hanya dengan kata: OK' }], max_tokens: 8 });
    return deps.ok({ model, reply: String(res?.response ?? '').trim().slice(0, 100), ms: Date.now() - started });
  } catch (err) {
    console.error('AI test failed', err);
    throw new deps.HttpError(502, 'Mesin AI bawaan tidak merespons.');
  }
}

export async function handleAdminSummary(request, env, deps) {
  await requireAdmin(request, env, deps);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthStart = `${period()}-01`;
  const notStaff = `email NOT LIKE '%${STAFF_EMAIL_SUFFIX}'`;
  const [users, newWeek, activeWeek, ai, byo, emails, vouchers, suspended] = await Promise.all([
    safeFirst(env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${notStaff}`), { n: 0 }),
    safeFirst(env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${notStaff} AND created_at >= ?`).bind(weekAgo), { n: 0 }),
    safeFirst(env.DB.prepare('SELECT COUNT(DISTINCT s.user_id) AS n FROM sessions s WHERE s.created_at >= ? AND s.is_staff = 0').bind(weekAgo), { n: 0 }),
    safeFirst(env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM usage_counters WHERE period = ? AND feature NOT LIKE 'byo_%'").bind(period()), { n: 0 }),
    safeFirst(env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM usage_counters WHERE period = ? AND feature LIKE 'byo_%'").bind(period()), { n: 0 }),
    safeFirst(env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(status = 'failed'), 0) AS failed FROM email_log WHERE created_at >= ?").bind(monthStart), { n: 0, failed: 0 }),
    safeFirst(env.DB.prepare('SELECT COUNT(*) AS n FROM voucher_redemptions WHERE redeemed_at >= ?').bind(monthStart), { n: 0 }),
    safeFirst(env.DB.prepare('SELECT COUNT(*) AS n FROM user_flags WHERE suspended = 1'), { n: 0 }),
  ]);
  return deps.ok({
    users: users.n, new_this_week: newWeek.n, active_this_week: activeWeek.n, suspended: suspended.n,
    ai_calls_month: ai.n, ai_calls_own_provider_month: byo.n, emails_month: emails.n, emails_failed_month: emails.failed || 0,
    vouchers_redeemed_month: vouchers.n, period: period(),
  });
}

export async function handleAdminActivity(request, env, deps) {
  await requireAdmin(request, env, deps);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || '';
  const where = /^[a-z_]{2,20}$/.test(kind) ? 'WHERE kind = ?' : '';
  const emailStmt = env.DB.prepare(
    `SELECT e.id, e.kind, e.recipient, e.subject, e.provider, e.status, e.error, e.created_at, u.email AS owner_email
       FROM email_log e LEFT JOIN users u ON u.id = e.owner_id ${where} ORDER BY e.id DESC LIMIT 100`,
  );
  const [emails, usage, whatsapp] = await Promise.all([
    safeAll(where ? emailStmt.bind(kind) : emailStmt),
    safeAll(env.DB.prepare('SELECT feature, SUM(count) AS calls, COUNT(DISTINCT user_id) AS users FROM usage_counters WHERE period = ? GROUP BY feature ORDER BY calls DESC').bind(period())),
    whatsappStatus(env),
  ]);
  return deps.ok({ emails, usage, whatsapp, period: period() });
}

async function targetUser(env, deps, params) {
  const u = await env.DB.prepare('SELECT id, email, name, created_at, last_login_at FROM users WHERE id = ?').bind(params.userId).first()
    .catch(async (err) => {
      if (!missingTable(err)) throw err;
      return env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').bind(params.userId).first();
    });
  if (!u) throw new deps.HttpError(404, 'Pengguna tidak ditemukan.');
  return u;
}

export async function handleAdminUserDetail(request, env, deps, params) {
  await requireAdmin(request, env, deps);
  const u = await targetUser(env, deps, params);
  const [flag, account, usage, credit, integ, emails, sessions] = await Promise.all([
    safeFirst(env.DB.prepare('SELECT suspended, reason, plan FROM user_flags WHERE user_id = ?').bind(u.id)),
    safeFirst(env.DB.prepare(
      'SELECT c.plan_id, c.status, c.period_end, c.company, p.name AS plan_name FROM customer_accounts c LEFT JOIN subscription_plans p ON p.id = c.plan_id WHERE c.owner_id = ?',
    ).bind(u.id)),
    safeAll(env.DB.prepare('SELECT feature, count FROM usage_counters WHERE user_id = ? AND period = ? ORDER BY feature').bind(u.id, period())),
    safeFirst(env.DB.prepare('SELECT balance_idr FROM ai_credits WHERE user_id = ?').bind(u.id)),
    safeFirst(env.DB.prepare('SELECT email_mode, smtp_host, ai_mode, ai_base_url, ai_model FROM business_integrations WHERE owner_id = ?').bind(u.id)),
    safeAll(env.DB.prepare('SELECT kind, recipient, subject, provider, status, created_at FROM email_log WHERE owner_id = ? ORDER BY id DESC LIMIT 10').bind(u.id)),
    safeFirst(env.DB.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM sessions WHERE user_id = ?').bind(u.id), { n: 0 }),
  ]);
  return deps.ok({
    user: u,
    demo: deps.DEMO_EMAILS.has(String(u.email).toLowerCase()),
    tier: flag?.plan || 'sole',
    suspended: flag?.suspended === 1,
    reason: flag?.reason || '',
    subscription: account || null,
    usage,
    credit_idr: credit?.balance_idr || 0,
    integrations: integ || { email_mode: 'platform', ai_mode: 'builtin' },
    emails,
    sessions: { total: sessions?.n || 0, last: sessions?.last || null },
  });
}

export async function handleAdminUserTier(request, env, deps, params) {
  const admin = await requireAdmin(request, env, deps);
  const u = await targetUser(env, deps, params);
  if (String(u.email).endsWith(STAFF_EMAIL_SUFFIX)) throw new deps.HttpError(400, 'Akun staf dikelola lewat terminal.');
  // Demo accounts re-align their tier on every demo login, so a change there would not stick.
  if (deps.DEMO_EMAILS.has(String(u.email).toLowerCase())) throw new deps.HttpError(400, 'Skala akun demo mengikuti akunnya dan tidak bisa diubah.');
  const body = await deps.readJson(request);
  const plan = String(body.plan || '');
  if (!PLANS.includes(plan)) throw new deps.HttpError(400, 'Skala akun tidak dikenal.');
  await env.DB.prepare(
    `INSERT INTO user_flags (user_id, updated_at, updated_by, plan) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(u.id, new Date().toISOString(), admin.email, plan).run();
  await audit(env, admin.email, 'user.tier', u.email, plan);
  return deps.ok({ plan });
}

// ------------------------------------------------------------ admin access

export async function handleAdminsList(request, env, deps) {
  await requireAdmin(request, env, deps);
  const [admins, auditRows] = await Promise.all([
    safeAll(env.DB.prepare('SELECT email, role, added_by, added_at FROM admin_users ORDER BY added_at, email')),
    safeAll(env.DB.prepare('SELECT actor, action, target, detail, created_at FROM admin_audit ORDER BY id DESC LIMIT 50')),
  ]);
  return deps.ok({ admins, bootstrap: [...adminEmailSet(env.ADMIN_EMAILS)], audit: auditRows, email_admins_active: env.DEMO_OTP !== 'true' });
}

export async function handleAdminsAdd(request, env, deps) {
  const admin = await requireAdmin(request, env, deps);
  const body = await deps.readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (!isEmail(email)) throw new deps.HttpError(400, 'Email tidak valid.');
  if (email.endsWith(STAFF_EMAIL_SUFFIX)) throw new deps.HttpError(400, 'Akun staf dikelola lewat terminal.');
  if (deps.DEMO_EMAILS.has(email)) throw new deps.HttpError(400, 'Akun demo tidak bisa menjadi admin.');
  const res = await env.DB.prepare("INSERT OR IGNORE INTO admin_users (email, role, added_by, added_at) VALUES (?, 'admin', ?, ?)")
    .bind(email, admin.email, new Date().toISOString()).run();
  if (res.meta?.changes === 0) throw new deps.HttpError(409, 'Email ini sudah menjadi admin.');
  await audit(env, admin.email, 'admin.add', email);
  return deps.ok({ email });
}

export async function handleAdminsRemove(request, env, deps, params) {
  const admin = await requireAdmin(request, env, deps);
  const email = decodeURIComponent(String(params.email || '')).trim().toLowerCase();
  const row = await env.DB.prepare('SELECT email FROM admin_users WHERE email = ?').bind(email).first();
  if (!row) throw new deps.HttpError(404, 'Admin tidak ditemukan.');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first();
  if ((count?.n || 0) <= 1) throw new deps.HttpError(400, 'Admin terakhir tidak bisa dihapus. Tambahkan admin lain dulu.');
  await env.DB.prepare('DELETE FROM admin_users WHERE email = ?').bind(email).run();
  await audit(env, admin.email, 'admin.remove', email);
  return deps.ok({ email, still_bootstrap: adminEmailSet(env.ADMIN_EMAILS).has(email) });
}
