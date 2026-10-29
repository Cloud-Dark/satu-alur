/**
 * Customers admin: business accounts (users rows) with their plan and status. Staff only.
 * Helpers (authenticate, readJson, ok, HttpError, DEMO_EMAILS) are injected by worker/index.js.
 */

import { validateCustomer, escapeLike, STAFF_EMAIL_SUFFIX } from '../src/customers/rules.js';
import { requireAdmin } from './office.js';

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

export async function handleAdminCustomers(request, env, deps) {
  await requireAdmin(request, env, deps);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  let where = NOT_STAFF;
  const args = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += ` AND (u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR c.company LIKE ? ESCAPE '\\')`;
    args.push(like, like, like);
  }
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
