/**
 * Customers admin: business accounts (users rows) with their plan and status, and their
 * login state (Pengguna: suspend, restore, end sessions). Staff only.
 * Helpers (authenticate, readJson, ok, HttpError, DEMO_EMAILS) are injected by worker/index.js.
 */

import {
  validateCustomer, validateSuspendReason, escapeLike, STAFF_EMAIL_SUFFIX,
  validateContact, validateContactUpdate, isHoneypot, contactRateLimited, CONTACT_STATUS_LABEL, CONTACT_OK_MESSAGE, CONTACT_LIMIT_MESSAGE,
} from '../src/customers/rules.js';
import {
  validateTicket, validateReply, validateTicketStatus, nextStatusOnReply, customerAuthorName, staffAuthorName, ticketLimitReached,
  TICKET_STATUS_LABEL, TICKET_LIMIT_MESSAGE, TICKET_NOT_FOUND,
} from '../src/support/rules.js';
import { requireAdmin } from './office.js';
import { realUser } from './social.js';

const PAGE_SIZE = 50;
const SELECT = `SELECT u.id, u.email, u.name, u.created_at, c.plan_id, p.name AS plan_name, c.status, c.period_end,
  c.company, c.phone, c.notes, c.updated_at, c.updated_by
  FROM users u
  LEFT JOIN customer_accounts c ON c.owner_id = u.id
  LEFT JOIN subscription_plans p ON p.id = c.plan_id`;
const NOT_STAFF = `u.email NOT LIKE '%${STAFF_EMAIL_SUFFIX}'`;

function toCustomer(row, DEMO_EMAILS) {
  return { ...row, status: row.status ?? null, demo: DEMO_EMAILS.has(String(row.email).toLowerCase()) };
}

const findUser = (env, id) => env.DB.prepare(`${SELECT} WHERE u.id = ?`).bind(id).first();

// Shared by both lists: ?q= searches `cols` (LIKE, escaped), ?page= is 1-based; staff never listed.
function listQuery(request, cols) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  let where = NOT_STAFF;
  const args = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += ` AND (${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
    args.push(...cols.map(() => like));
  }
  return { where, args, page };
}

export async function handleAdminCustomers(request, env, deps) {
  await requireAdmin(request, env, deps);
  const { where, args, page } = listQuery(request, ['u.email', 'u.name', 'c.company']);
  const from = 'FROM users u LEFT JOIN customer_accounts c ON c.owner_id = u.id';
  const [count, { results }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).bind(...args).first(),
    env.DB.prepare(`${SELECT} WHERE ${where} ORDER BY u.created_at DESC, u.id LIMIT ? OFFSET ?`).bind(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
  ]);
  return deps.ok({ items: results.map((r) => toCustomer(r, deps.DEMO_EMAILS)), total: count.n, page });
}

export async function handleAdminCustomerGet(request, env, deps, params) {
  await requireAdmin(request, env, deps);
  const row = await findUser(env, params.userId);
  if (!row || String(row.email).endsWith(STAFF_EMAIL_SUFFIX)) throw new deps.HttpError(404, 'Pelanggan tidak ditemukan.');
  return deps.ok(toCustomer(row, deps.DEMO_EMAILS));
}

export async function handleAdminCustomerPut(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const cur = await findUser(env, params.userId);
  if (!cur) throw new HttpError(404, 'Pelanggan tidak ditemukan.');
  if (String(cur.email).endsWith(STAFF_EMAIL_SUFFIX)) throw new HttpError(400, 'Akun staf bukan pelanggan.');
  const body = await readJson(request);
  let v;
  try {
    v = validateCustomer(body);
  } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
  if (v.plan_id !== null && !(await env.DB.prepare('SELECT id FROM subscription_plans WHERE id = ?').bind(v.plan_id).first())) {
    throw new HttpError(400, 'Paket tidak ditemukan.');
  }
  await env.DB.prepare(
    `INSERT INTO customer_accounts (owner_id, plan_id, status, period_end, company, phone, notes, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status, period_end = excluded.period_end,
       company = excluded.company, phone = excluded.phone, notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(cur.id, v.plan_id, v.status, v.period_end, v.company, v.phone, v.notes, new Date().toISOString(), user.name).run();
  return ok(toCustomer(await findUser(env, cur.id), deps.DEMO_EMAILS));
}

// ------------------------------------------------------------------ Contact Us

const CONTACT_COLS = 'id, name, email, phone, subject, message, status, staff_note, created_at, updated_at, updated_by'; // never ip_hash
const HOUR_MS = 3600 * 1000;

// Public, no auth. Honeypot hits look like successes; the per-IP limit counts the last hour.
export async function handleContactPost(request, env, deps) {
  const body = await deps.readJson(request);
  if (isHoneypot(body)) return deps.ok({ message: CONTACT_OK_MESSAGE });
  let v;
  try {
    v = validateContact(body);
  } catch (err) {
    if (err?.validation) throw new deps.HttpError(400, err.message);
    throw err;
  }
  const ipHash = await deps.sha256Hex(`${request.headers.get('CF-Connecting-IP') || 'unknown'}:${env.TOKEN_KEY || 'satu-alur-contact'}`);
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM contact_messages WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, new Date(now - HOUR_MS).toISOString()).first();
  if (contactRateLimited(recent.n)) throw new deps.HttpError(429, CONTACT_LIMIT_MESSAGE);
  await env.DB.prepare(
    'INSERT INTO contact_messages (name, email, phone, subject, message, status, staff_note, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(v.name, v.email, v.phone, v.subject, v.message, 'new', '', ipHash, new Date(now).toISOString()).run();
  return deps.ok({ message: CONTACT_OK_MESSAGE });
}

export async function handleAdminContact(request, env, deps) {
  await requireAdmin(request, env, deps);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'new';
  if (status !== 'all' && !Object.hasOwn(CONTACT_STATUS_LABEL, status)) throw new deps.HttpError(400, 'Status tidak dikenal.');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const where = status === 'all' ? '' : 'WHERE status = ?';
  const args = status === 'all' ? [] : [status];
  const [count, { results }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM contact_messages ${where}`).bind(...args).first(),
    env.DB.prepare(`SELECT ${CONTACT_COLS} FROM contact_messages ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
  ]);
  return deps.ok({ items: results, total: count.n, page });
}

export async function handleAdminContactCounts(request, env, deps) {
  await requireAdmin(request, env, deps);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'").first();
  return deps.ok({ new: row.n });
}

export async function handleAdminContactUpdate(request, env, deps, params) {
  const admin = await requireAdmin(request, env, deps);
  if (!/^\d+$/.test(params.id || '')) throw new deps.HttpError(404, 'Pesan tidak ditemukan.');
  let v;
  try {
    v = validateContactUpdate(await deps.readJson(request));
  } catch (err) {
    if (err?.validation) throw new deps.HttpError(400, err.message);
    throw err;
  }
  const sets = Object.keys(v).map((k) => `${k} = ?`);
  const res = await env.DB.prepare(`UPDATE contact_messages SET ${sets.join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(...Object.values(v), new Date().toISOString(), admin.name, Number(params.id)).run();
  if (!res.meta?.changes) throw new deps.HttpError(404, 'Pesan tidak ditemukan.');
  return deps.ok(await env.DB.prepare(`SELECT ${CONTACT_COLS} FROM contact_messages WHERE id = ?`).bind(Number(params.id)).first());
}

// ------------------------------------------------------------------ Pengguna

export async function handleAdminUsers(request, env, deps) {
  await requireAdmin(request, env, deps);
  const { where, args, page } = listQuery(request, ['u.email', 'u.name']);
  const [count, { results }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`).bind(...args).first(),
    env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.created_at,
         (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_sessions,
         (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_session_at,
         COALESCE(f.suspended, 0) AS suspended, COALESCE(f.reason, '') AS reason
       FROM users u LEFT JOIN user_flags f ON f.user_id = u.id
       WHERE ${where} ORDER BY u.created_at DESC, u.id LIMIT ? OFFSET ?`,
    ).bind(new Date().toISOString(), ...args, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
  ]);
  const items = results.map((r) => ({ ...r, suspended: r.suspended === 1, demo: deps.DEMO_EMAILS.has(String(r.email).toLowerCase()) }));
  return deps.ok({ items, total: count.n, page });
}

// The admin making the change, plus the target user (never a staff account).
async function adminAndTarget(request, env, deps, params) {
  const admin = await requireAdmin(request, env, deps);
  const target = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(params.userId).first();
  if (!target) throw new deps.HttpError(404, 'Pengguna tidak ditemukan.');
  if (String(target.email).endsWith(STAFF_EMAIL_SUFFIX)) throw new deps.HttpError(400, 'Akun staf dikelola lewat terminal.');
  return { admin, target };
}

export async function handleAdminUserSuspend(request, env, deps, params) {
  const { admin, target } = await adminAndTarget(request, env, deps, params);
  let reason;
  try {
    reason = validateSuspendReason(await deps.readJson(request));
  } catch (err) {
    if (err?.validation) throw new deps.HttpError(400, err.message);
    throw err;
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_flags (user_id, suspended, reason, updated_at, updated_by) VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET suspended = 1, reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(target.id, reason, new Date().toISOString(), admin.name),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
    // Shown as Dibatalkan in the user's Laporan tayang; restore does not bring them back.
    env.DB.prepare("UPDATE social_posts SET status = 'cancelled', error = 'Akun ditangguhkan.' WHERE owner_id = ? AND status = 'scheduled'").bind(target.id),
  ]);
  return deps.ok({ id: target.id, suspended: true, reason });
}

export async function handleAdminUserRestore(request, env, deps, params) {
  const { admin, target } = await adminAndTarget(request, env, deps, params);
  // Also drops any session created in a race with the suspend.
  await env.DB.batch([
    env.DB.prepare('UPDATE user_flags SET suspended = 0, updated_at = ?, updated_by = ? WHERE user_id = ?')
      .bind(new Date().toISOString(), admin.name, target.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
  ]);
  return deps.ok({ id: target.id, suspended: false });
}

export async function handleAdminUserRevokeSessions(request, env, deps, params) {
  const { target } = await adminAndTarget(request, env, deps, params);
  const res = await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  return deps.ok({ id: target.id, ended: res.meta?.changes ?? 0 });
}

// ------------------------------------------------------------------ Support tickets (Bantuan / Pengaduan CS)

const TICKET_COLS = 't.id, t.owner_id, t.category, t.subject, t.status, t.created_at, t.updated_at, t.last_reply_by';
const STAFF_TICKETS = `SELECT ${TICKET_COLS}, u.email, u.name AS user_name, c.company
  FROM support_tickets t JOIN users u ON u.id = t.owner_id LEFT JOIN customer_accounts c ON c.owner_id = t.owner_id`;

// Validator errors → 400; anything else bubbles up.
function checked(fn, HttpError) {
  try {
    return fn();
  } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
}
function ticketParam(params, HttpError) {
  if (!/^\d+$/.test(params.id || '')) throw new HttpError(404, TICKET_NOT_FOUND);
  return Number(params.id);
}
const messagesOf = async (env, id) => (await env.DB.prepare(
  'SELECT id, ticket_id, author, author_name, body, created_at FROM support_messages WHERE ticket_id = ? ORDER BY created_at, id',
).bind(id).all()).results;

// The caller's own ticket only: another owner's id gets the same 404 as a missing one, so ids can't be probed.
async function ownThread(env, deps, id, ownerId) {
  const ticket = await env.DB.prepare(`SELECT ${TICKET_COLS} FROM support_tickets t WHERE t.id = ? AND t.owner_id = ?`).bind(id, ownerId).first();
  if (!ticket) throw new deps.HttpError(404, TICKET_NOT_FOUND);
  return { ticket, messages: await messagesOf(env, id) };
}
async function staffThread(env, deps, id) {
  const ticket = await env.DB.prepare(`${STAFF_TICKETS} WHERE t.id = ?`).bind(id).first();
  if (!ticket) throw new deps.HttpError(404, TICKET_NOT_FOUND);
  return { ticket, messages: await messagesOf(env, id) };
}

// Inserts the message and moves the ticket (status, updated_at, last_reply_by). ownerId scopes customer writes.
function saveReply(env, { id, author, name, body, status, ownerId }) {
  const now = new Date().toISOString();
  const update = ownerId === undefined
    ? env.DB.prepare('UPDATE support_tickets SET status = ?, updated_at = ?, last_reply_by = ? WHERE id = ?').bind(status, now, author, id)
    : env.DB.prepare('UPDATE support_tickets SET status = ?, updated_at = ?, last_reply_by = ? WHERE id = ? AND owner_id = ?').bind(status, now, author, id, ownerId);
  return env.DB.batch([
    env.DB.prepare('INSERT INTO support_messages (ticket_id, author, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, author, name, body, now),
    update,
  ]);
}

async function customerName(env, user) {
  const acct = await env.DB.prepare('SELECT company FROM customer_accounts WHERE owner_id = ?').bind(user.id).first();
  return customerAuthorName({ company: acct?.company, name: user.name, email: user.email });
}

export async function handleSupportList(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  // ponytail: no paging; the newest 200 is plenty while open tickets are capped at 20 per business.
  const { results } = await env.DB.prepare(
    `SELECT ${TICKET_COLS} FROM support_tickets t WHERE t.owner_id = ? ORDER BY t.updated_at DESC, t.id DESC LIMIT 200`,
  ).bind(user.id).all();
  return deps.ok({ items: results });
}

export async function handleSupportGet(request, env, deps, params) {
  const { user } = await deps.authenticate(request, env);
  return deps.ok(await ownThread(env, deps, ticketParam(params, deps.HttpError), user.id));
}

export async function handleSupportCreate(request, env, deps) {
  const user = await realUser(request, env, deps);
  const body = await deps.readJson(request);
  const v = checked(() => validateTicket(body), deps.HttpError);
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE owner_id = ? AND status != 'closed'").bind(user.id).first();
  if (ticketLimitReached(open.n)) throw new deps.HttpError(400, TICKET_LIMIT_MESSAGE);
  const name = await customerName(env, user);
  const now = new Date().toISOString();
  const [ins] = await env.DB.batch([
    env.DB.prepare("INSERT INTO support_tickets (owner_id, category, subject, status, created_at, updated_at, last_reply_by) VALUES (?, ?, ?, 'open', ?, ?, 'customer')")
      .bind(user.id, v.category, v.subject, now, now),
    env.DB.prepare("INSERT INTO support_messages (ticket_id, author, author_name, body, created_at) VALUES (last_insert_rowid(), 'customer', ?, ?, ?)")
      .bind(name, v.body, now),
  ]);
  return deps.ok(await ownThread(env, deps, ins.meta.last_row_id, user.id));
}

export async function handleSupportReply(request, env, deps, params) {
  const user = await realUser(request, env, deps);
  const id = ticketParam(params, deps.HttpError);
  const { ticket } = await ownThread(env, deps, id, user.id);
  const reqBody = await deps.readJson(request);
  const body = checked(() => validateReply(reqBody), deps.HttpError);
  const status = checked(() => nextStatusOnReply(ticket.status, 'customer'), deps.HttpError);
  await saveReply(env, { id, author: 'customer', name: await customerName(env, user), body, status, ownerId: user.id });
  return deps.ok(await ownThread(env, deps, id, user.id));
}

export async function handleAdminSupport(request, env, deps) {
  await requireAdmin(request, env, deps);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'all';
  if (status !== 'all' && !Object.hasOwn(TICKET_STATUS_LABEL, status)) throw new deps.HttpError(400, 'Status tidak dikenal.');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const where = status === 'all' ? '' : 'WHERE t.status = ?';
  const args = status === 'all' ? [] : [status];
  const [count, { results }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM support_tickets t ${where}`).bind(...args).first(),
    env.DB.prepare(`${STAFF_TICKETS} ${where} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`).bind(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
  ]);
  return deps.ok({ items: results, total: count.n, page });
}

export async function handleAdminSupportCounts(request, env, deps) {
  await requireAdmin(request, env, deps);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM support_tickets WHERE status IN ('open', 'in_progress') AND last_reply_by = 'customer'",
  ).first();
  return deps.ok({ open: row.n });
}

export async function handleAdminSupportGet(request, env, deps, params) {
  await requireAdmin(request, env, deps);
  return deps.ok(await staffThread(env, deps, ticketParam(params, deps.HttpError)));
}

export async function handleAdminSupportReply(request, env, deps, params) {
  const admin = await requireAdmin(request, env, deps);
  const id = ticketParam(params, deps.HttpError);
  const { ticket } = await staffThread(env, deps, id);
  const reqBody = await deps.readJson(request);
  const body = checked(() => validateReply(reqBody), deps.HttpError);
  await saveReply(env, { id, author: 'staff', name: staffAuthorName(admin.name), body, status: nextStatusOnReply(ticket.status, 'staff') });
  return deps.ok(await staffThread(env, deps, id));
}

export async function handleAdminSupportUpdate(request, env, deps, params) {
  await requireAdmin(request, env, deps);
  const id = ticketParam(params, deps.HttpError);
  const reqBody = await deps.readJson(request);
  const status = checked(() => validateTicketStatus(reqBody), deps.HttpError);
  const res = await env.DB.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').bind(status, new Date().toISOString(), id).run();
  if (!res.meta?.changes) throw new deps.HttpError(404, TICKET_NOT_FOUND);
  return deps.ok(await staffThread(env, deps, id));
}
