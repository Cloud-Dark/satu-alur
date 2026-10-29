/**
 * Satu Alur staff login (Kantor Satu Alur): POST /api/auth/staff-login { username, password }.
 * Accounts live in staff_accounts and are managed only with `npm run staff` (scripts/staff.mjs).
 * A successful login creates a short session with sessions.is_staff = 1; that flag is the only
 * thing that grants admin rights (isAdminUser in worker/social.js).
 */
import { hashPassword, verifyPassword, validateUsername, MAX_PASSWORD } from '../src/staff/password.js';

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const STAFF_SESSION_MS = 12 * 60 * 60 * 1000;
const DENIED = 'Username atau password salah.';
const LOCKED = 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.';

// Unknown usernames still pay for one PBKDF2 run, so timing doesn't reveal which usernames exist.
let dummyHash = null;
async function burn(password) {
  dummyHash ??= await hashPassword('satu-alur-dummy-password');
  await verifyPassword(password, dummyHash);
}

export async function handleStaffLogin(request, env, { readJson, ok, HttpError, sha256Hex, randomHex }) {
  const body = await readJson(request);
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (validateUsername(username) || !password || password.length > MAX_PASSWORD) {
    await burn(password.slice(0, MAX_PASSWORD));
    throw new HttpError(401, DENIED);
  }

  const now = new Date();
  const acct = await env.DB.prepare(
    'SELECT id, username, password_hash, active, locked_until FROM staff_accounts WHERE username = ?',
  ).bind(username).first();
  if (!acct) { await burn(password); throw new HttpError(401, DENIED); }
  if (acct.locked_until && acct.locked_until > now.toISOString()) throw new HttpError(429, LOCKED);

  if (!(await verifyPassword(password, acct.password_hash)) || acct.active !== 1) {
    // One statement, so parallel guesses can't slip past the lock: the 5th failure locks and resets the count.
    await env.DB.prepare(
      `UPDATE staff_accounts
          SET locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END,
              failed_attempts = CASE WHEN failed_attempts + 1 >= ? THEN 0 ELSE failed_attempts + 1 END
        WHERE id = ?`,
    ).bind(LOCK_AFTER, new Date(now.getTime() + LOCK_MS).toISOString(), LOCK_AFTER, acct.id).run();
    throw new HttpError(401, DENIED);
  }

  await env.DB.prepare('UPDATE staff_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
    .bind(now.toISOString(), acct.id).run();
  // Each staff account has its own app user, so office actions stay attributable.
  const email = `${username}@staff.satualur.internal`;
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), email, username, now.toISOString()).run();
  const user = await env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE email = ?').bind(email).first();

  const accessToken = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at, is_staff) VALUES (?, ?, ?, ?, 1)')
    .bind(await sha256Hex(accessToken), user.id, new Date(now.getTime() + STAFF_SESSION_MS).toISOString(), now.toISOString())
    .run();
  return ok({ user, access_token: accessToken });
}
