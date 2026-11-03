/**
 * Mock cloud — the same interface as src/http-cloud.js, kept in browser
 * memory + localStorage. Used for local development and e2e tests
 * (VITE_USE_MOCK=true); production talks to the Worker + D1.
 */
import { cleanProfileName } from '../auth/profile-rules.js'
import { isBlocked, isStaffEmail, SUSPENDED_MESSAGE, AUTH_NOTICE_KEY } from '../customers/rules.js'
import {
  validateVasItem, validateWasteEntry, withWasteCompletion, assertWasteInvariants, LIMITS,
} from '../pendapatan/rules.js'
import { demoAccount, isDemoEmail } from '../auth/demo-accounts.js'
import { normalizePlan } from '../business/plan-access.js'
import { simulateAnswer as mockAnswer } from '../ai/simulate.js'

const STORAGE_KEY = 'satualur_mock_v1'
const OTP_STORE = 'satualur_mock_otp'
const MOCK_PLAN_KEY = 'satualur_plan'

/**
 * Tier for a mock session. Demo accounts follow their seeded scale, any other
 * dev/e2e account is Enterprise so the whole product is reviewable without a
 * backend, and `localStorage.satualur_plan` overrides both — that is how the
 * e2e suite exercises the locked state.
 */
function mockPlanFor(user) {
  try {
    const forced = localStorage.getItem(MOCK_PLAN_KEY)
    if (forced) return normalizePlan(forced)
  } catch { /* storage unavailable */ }
  const account = demoAccount(user?.email)
  return account ? normalizePlan(account.scale) : 'enterprise'
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch { return {} }
}
function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

let _state = loadState()
function ensureTable(name) {
  if (!_state[name]) _state[name] = []
  return _state[name]
}
// Mirrors assertFlowRules in worker/index.js so tests catch the same mistakes.
const LEDGER_CATEGORIES = ['pendapatan', 'biaya_tenaga', 'biaya_bahan', 'biaya_transport', 'biaya_lain']
function flowRuleError(table, rows) {
  // Pendapatan tables: same validators the Worker runs (src/pendapatan/rules.js),
  // plus the per-owner ceiling. Returns the message instead of throwing.
  if (table === 'vas_items' || table === 'waste_entries') {
    try {
      const existing = ensureTable(table).length
      const cap = table === 'vas_items' ? LIMITS.items : LIMITS.findings
      if (existing + rows.length > cap) return `Batas ${cap} ${table === 'vas_items' ? 'item katalog' : 'temuan'} tercapai (${existing} tersimpan). Hapus yang tidak terpakai lebih dulu.`
      for (const r of rows) {
        const clean = table === 'vas_items' ? validateVasItem(r) : withWasteCompletion(validateWasteEntry(r))
        if (table === 'waste_entries') assertWasteInvariants(clean)
        Object.assign(r, clean)
      }
      return null
    } catch (err) { return err.message }
  }
  if (table === 'ledger_entries') {
    const revenueFor = new Set()
    for (const r of rows) {
      if ('amount' in r && !(Number(r.amount) > 0)) return 'Jumlah jurnal harus lebih dari nol.'
      if ('category' in r && !LEDGER_CATEGORIES.includes(r.category)) return 'Kategori jurnal tidak dikenal.'
      if (r.category === 'pendapatan' && r.completion_id != null) {
        const key = String(r.completion_id)
        const dup = revenueFor.has(key) || ensureTable('ledger_entries').some((l) => String(l.completion_id) === key && l.category === 'pendapatan')
        if (dup) return 'Pendapatan untuk pekerjaan ini sudah diposting.'
        revenueFor.add(key)
      }
    }
  }
  if (table === 'completions') {
    const seen = new Set()
    for (const r of rows) {
      if (r.assignment_id == null) continue
      const key = String(r.assignment_id)
      if (seen.has(key) || ensureTable('completions').some((c) => String(c.assignment_id) === key)) return 'Penugasan ini sudah ditandai selesai.'
      seen.add(key)
    }
  }
  return null
}

function persist() {
  saveState(_state)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('satualur:db-write'))
}

let _session = null
let _sessionCb = null

function notifyAuth(event) {
  if (_sessionCb) _sessionCb(event, _session)
}

// Same rules as the Worker: flags are written by src/customers/api.js (staff › Pengguna) under
// `satualur_customers_demo_v1`.flags[userId] = { suspended, reason, revoked_at, … }.
function userFlag(userId) {
  try { return (JSON.parse(localStorage.getItem('satualur_customers_demo_v1')) || {}).flags?.[userId] || null } catch { return null }
}
function refuseSuspended(user) {
  if (isBlocked(userFlag(user.id))) throw new Error(SUSPENDED_MESSAGE)
}
function startSession(user, extra) {
  _session = { user, access_token: 'mock_' + crypto.randomUUID(), created_at: new Date().toISOString(), ...extra }
  notifyAuth('SIGNED_IN')
}

// Bootstrap list plus admins added in Kantor › Sistem › Akses admin (src/admin/api.js demo store).
function mockAdminEmails() {
  const set = new Set(String(import.meta.env?.VITE_ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
  try { for (const a of (JSON.parse(localStorage.getItem('satualur_system_demo_v1')) || {}).admins || []) set.add(a.email) } catch { /* storage unavailable */ }
  return set
}

const mockAuth = {
  async sendOtp({ email }) {
    // Same rule as the Worker: staff addresses come only from staff login.
    if (!email || !email.includes('@') || isStaffEmail(email)) throw new Error('Email tidak valid.')
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const id = crypto.randomUUID()
    const otpData = JSON.parse(localStorage.getItem(OTP_STORE) || '{}')
    otpData[id] = { email, code, ts: Date.now() }
    localStorage.setItem(OTP_STORE, JSON.stringify(otpData))
    console.log(`[MOCK OTP] Kode untuk ${email}: ${code}`)
    window.dispatchEvent(new CustomEvent('mock-otp-sent', { detail: { email, code } }))
    const users = ensureTable('users')
    const isExistingUser = users.some(u => u.email === email)
    return { data: { verificationId: id, isExistingUser }, error: null }
  },

  async verifyOtp({ email, verificationId, isExistingUser, token }) {
    if (isStaffEmail(email)) throw new Error('Email tidak valid.')
    const otpData = JSON.parse(localStorage.getItem(OTP_STORE) || '{}')
    const rec = otpData[verificationId]
    if (!rec || rec.email !== email || rec.code !== token) {
      throw new Error('Kode OTP salah atau sudah kadaluarsa.')
    }
    delete otpData[verificationId]
    localStorage.setItem(OTP_STORE, JSON.stringify(otpData))

    let users = ensureTable('users')
    let user = users.find(u => u.email === email)
    if (!user) {
      user = { id: crypto.randomUUID(), email, name: email.split('@')[0], created_at: new Date().toISOString() }
      users.push(user)
      persist()
    }
    refuseSuspended(user)
    startSession(user)
    return { data: { user: { ...user, plan: mockPlanFor(user) } }, error: null }
  },

  // Google sign-in is a Worker flow; the mock has no Google. localStorage satualur_mock_google
  // turns on a Google Identity Services sign-in for dev/e2e.
  async providers() {
    // '1' = simulated GIS button; 'script' = load the real GIS script (e2e blocks it to test the fallback).
    let gis = null
    try { gis = localStorage.getItem('satualur_mock_google') } catch { /* storage off */ }
    return gis === '1' || gis === 'script'
      ? { google: true, google_client_id: 'mock-gis-client', gis_mock: gis === '1', otp_email: false, demo_login: true }
      : { google: false, otp_email: false, demo_login: true }
  },
  async googleExchange() { throw new Error('Masuk dengan Google tidak tersedia di mode demo lokal.') },
  async googleNonce() {
    const nonce = crypto.randomUUID().replace(/-/g, '')
    const store = JSON.parse(sessionStorage.getItem('satualur_mock_gis_nonces') || '[]')
    sessionStorage.setItem('satualur_mock_gis_nonces', JSON.stringify([...store, nonce].slice(-5)))
    return { data: { nonce }, error: null }
  },
  async googleCredential({ credential, nonce }) {
    const store = JSON.parse(sessionStorage.getItem('satualur_mock_gis_nonces') || '[]')
    if (!store.includes(nonce)) throw new Error('Sesi masuk Google sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.')
    sessionStorage.setItem('satualur_mock_gis_nonces', JSON.stringify(store.filter((n) => n !== nonce)))
    let claims = null
    try { claims = JSON.parse(decodeURIComponent(escape(atob(String(credential).replace(/^mockgis\./, ''))))) } catch { /* invalid */ }
    if (!claims?.email || claims.nonce !== nonce || claims.email_verified !== true) throw new Error('Token Google tidak valid.')
    const users = ensureTable('users')
    let user = users.find(u => u.email === claims.email)
    if (!user) {
      user = { id: crypto.randomUUID(), email: claims.email, name: claims.name || claims.email.split('@')[0], created_at: new Date().toISOString() }
      users.push(user)
      persist()
    }
    refuseSuspended(user)
    startSession(user)
    return { data: { user: { ...user, plan: mockPlanFor(user) } }, error: null }
  },

  async demoLogin({ email }) {
    const users = ensureTable('users')
    let user = users.find(u => u.email === email)
    if (!user) {
      user = { id: crypto.randomUUID(), email, name: email.split('@')[0], created_at: new Date().toISOString() }
      users.push(user)
      persist()
    }
    refuseSuspended(user)
    startSession(user)
    return { data: { user: { ...user, plan: mockPlanFor(user) } }, error: null }
  },

  /**
   * Staff login for dev/e2e. Accounts come from VITE_STAFF_USERS ("user:password,user2:password2");
   * the real Worker uses hashed passwords in staff_accounts (worker/staff.js). None by default.
   */
  async staffLogin({ username, password }) {
    const name = String(username || '').trim().toLowerCase()
    const accounts = String(import.meta.env?.VITE_STAFF_USERS || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!name || !accounts.some((a) => a === `${name}:${password}`)) throw new Error('Username atau password salah.')
    const email = `${name}@staff.satualur.internal`
    const users = ensureTable('users')
    let user = users.find(u => u.email === email)
    if (!user) {
      user = { id: crypto.randomUUID(), email, name, created_at: new Date().toISOString() }
      users.push(user)
      persist()
    }
    startSession(user, { is_staff: true })
    return { data: { user: { ...user, plan: mockPlanFor(user) } }, error: null }
  },

  async getSession() {
    if (_session) {
      const flag = userFlag(_session.user.id)
      if (isBlocked(flag) || (flag?.revoked_at && flag.revoked_at >= _session.created_at)) {
        _session = null
        notifyAuth('SIGNED_OUT')
        if (isBlocked(flag)) {
          try { sessionStorage.setItem(AUTH_NOTICE_KEY, SUSPENDED_MESSAGE) } catch { /* storage unavailable */ }
          return { data: null, error: { message: SUSPENDED_MESSAGE, status: 403 } }
        }
        return { data: null, error: { message: 'Sesi tidak valid atau sudah berakhir.', status: 401 } }
      }
    }
    // Same rule as the Worker: a staff-login session, or an email listed in VITE_ADMIN_EMAILS
    // (the mock's stand-in for ADMIN_EMAILS; dev/e2e only).
    if (_session) {
      const { is_staff, ...pub } = _session
      const user = { ...pub.user, plan: mockPlanFor(pub.user) }
      const emailAdmin = !is_staff && mockAdminEmails().has(String(pub.user.email).toLowerCase())
      return { data: { ...pub, user, is_admin: is_staff === true || emailAdmin, admin_via: is_staff ? 'staff' : emailAdmin ? 'email' : null }, error: null }
    }
    return { data: null, error: { message: 'Belum masuk.' } }
  },

  async refreshSession() {
    return mockAuth.getSession()
  },

  /** Display name only; same rules as PUT /api/me/profile. */
  async updateProfile({ name }) {
    if (!_session) throw new Error('Belum masuk.')
    const clean = cleanProfileName(name)
    if (isDemoEmail(_session.user.email)) throw new Error('Profil akun demo tidak bisa diubah.')
    _session.user = { ..._session.user, name: clean }
    const row = ensureTable('users').find((u) => u.id === _session.user.id)
    if (row) row.name = clean
    persist()
    return { user: _session.user }
  },

  async getUser() {
    return mockAuth.getSession()
  },

  onAuthStateChange(cb) {
    _sessionCb = cb
    return () => { _sessionCb = null }
  },

  async signOut() {
    _session = null
    notifyAuth('SIGNED_OUT')
    return { error: null }
  },

  // OAuth stubs (akan gagal gracefully di prototype mode)
  async signInWithOAuth() { throw new Error('OAuth tidak tersedia di prototype mode.') },
  async handleWechatWebCallback() { throw new Error('OAuth tidak tersedia di prototype mode.') },
  async handleWorkBuddyCallback() { throw new Error('OAuth tidak tersedia di prototype mode.') },
}

const mockDatabase = {
  from(table) {
    ensureTable(table)
    const filters = []
    const builder = {
      select(columns = '*', opts = {}) {
        builder._select = { columns, count: opts.count, head: opts.head }
        return builder
      },
      eq(col, val) { filters.push({ op: 'eq', col, val }); return builder },
      neq(col, val) { filters.push({ op: 'neq', col, val }); return builder },
      gt(col, val) { filters.push({ op: 'gt', col, val }); return builder },
      gte(col, val) { filters.push({ op: 'gte', col, val }); return builder },
      lt(col, val) { filters.push({ op: 'lt', col, val }); return builder },
      lte(col, val) { filters.push({ op: 'lte', col, val }); return builder },
      like(col, val) { filters.push({ op: 'like', col, val }); return builder },
      ilike(col, val) { filters.push({ op: 'ilike', col, val }); return builder },
      is(col, val) { filters.push({ op: 'is', col, val }); return builder },
      in(col, arr) { filters.push({ op: 'in', col, val: arr }); return builder },
      or(q) { filters.push({ op: 'or', val: q }); return builder },
      match(obj) { filters.push({ op: 'match', val: obj }); return builder },
      order(col, { ascending = true } = {}) { builder._order = { col, asc: ascending }; return builder },
      limit(n) { builder._limit = n; return builder },
      range(from, to) { builder._range = [from, to]; return builder },
      single() { builder._single = true; return builder },
      maybeSingle() { builder._maybeSingle = true; return builder },

      async then(resolve) {
        let rows = [...ensureTable(table)]
        if (!_session) {
          // prototype: tanpa auth tetap bisa CRUD dengan owner_id kosong
        }
        for (const f of filters) {
          rows = rows.filter(r => {
            if (f.op === 'eq') return r[f.col] == f.val
            if (f.op === 'neq') return r[f.col] != f.val
            if (f.op === 'gt') return r[f.col] > f.val
            if (f.op === 'gte') return r[f.col] >= f.val
            if (f.op === 'lt') return r[f.col] < f.val
            if (f.op === 'lte') return r[f.col] <= f.val
            if (f.op === 'like') return String(r[f.col] ?? '').includes(f.val.replace(/%/g, ''))
            if (f.op === 'ilike') return String(r[f.col] ?? '').toLowerCase().includes(f.val.replace(/%/g, '').toLowerCase())
            if (f.op === 'is') return r[f.col] === f.val
            if (f.op === 'in') return f.val.includes(r[f.col])
            if (f.op === 'match') return Object.entries(f.val).every(([k, v]) => r[k] == v)
            if (f.op === 'or') return true // simplified
            return true
          })
        }
        if (builder._order) {
          rows.sort((a, b) => {
            const av = a[builder._order.col], bv = b[builder._order.col]
            if (av < bv) return builder._order.asc ? -1 : 1
            if (av > bv) return builder._order.asc ? 1 : -1
            return 0
          })
        }
        let count = rows.length
        if (builder._range) rows = rows.slice(builder._range[0], builder._range[1] + 1)
        if (builder._limit) rows = rows.slice(0, builder._limit)
        if (builder._single) {
          if (rows.length !== 1) return resolve({ data: null, error: { message: 'Tidak ditemukan.' } })
          return resolve({ data: rows[0], error: null })
        }
        if (builder._maybeSingle) {
          return resolve({ data: rows[0] ?? null, error: null })
        }
        if (builder._select?.head) return resolve({ data: null, count, error: null })
        return resolve({ data: rows, count: builder._select?.count ? count : undefined, error: null })
      },

      insert(items) {
        builder._insert = Array.isArray(items) ? items : [items]
        return builder
      },
      update(changes) {
        builder._update = changes
        return builder
      },
      delete() {
        builder._delete = true
        return builder
      },
    }
    // Override then untuk write operations
    const originalThen = builder.then
    builder.then = async function (resolve) {
      if (builder._insert) {
        const ruleError = flowRuleError(table, builder._insert)
        if (ruleError) return resolve({ data: null, error: { message: ruleError } })
        const created = builder._insert.map(item => ({
          id: Date.now() + Math.floor(Math.random() * 100000),
          owner_id: _session?.user?.id ?? 'anon',
          created_at: new Date().toISOString(),
          // D1 fills this from the column default; the mock has to do it here.
          ...(table === 'vas_items' || table === 'waste_entries' ? { updated_at: new Date().toISOString() } : {}),
          ...item,
        }))
        ensureTable(table).push(...created)
        persist()
        return resolve({ data: created, error: null })
      }
      if ((builder._update || builder._delete) && filters.length === 0) {
        return resolve({ data: null, error: { message: 'Filter diperlukan untuk update/delete.' } })
      }
      if (builder._update) {
        const bad = ['id', 'owner_id'].find((c) => c in builder._update)
        if (bad) return resolve({ data: null, error: { message: `Kolom tidak boleh diubah: ${bad}` } })
        const matches = (row) => filters.every(f => (f.op === 'eq' ? row[f.col] == f.val : true))
        const targets = ensureTable(table).filter(matches)
        let patch = builder._update
        if (table === 'vas_items' || table === 'waste_entries') {
          try {
            patch = {
              ...patch,
              ...(table === 'vas_items' ? validateVasItem(patch, { partial: true }) : validateWasteEntry(patch, { partial: true })),
              updated_at: new Date().toISOString(),
            }
            if (table === 'waste_entries') {
              if (!filters.some((f) => f.op === 'eq' && f.col === 'id' && Number.isSafeInteger(Number(f.val)) && Number(f.val) > 0)) {
                throw new Error('Update temuan memerlukan filter id tunggal.')
              }
              for (const row of targets) {
                const merged = 'status' in patch || 'monthly_loss' in patch
                  ? withWasteCompletion({ ...row, ...patch }) : { ...row, ...patch }
                assertWasteInvariants(merged)
                if ('status' in patch || 'monthly_loss' in patch) patch.saved = merged.saved
              }
            }
          } catch (err) { return resolve({ data: null, error: { message: err.message } }) }
        }
        let affected = 0
        for (const row of targets) { Object.assign(row, patch); affected++ }
        persist()
        return resolve({ data: affected > 0 ? [patch] : [], error: null })
      }
      if (builder._delete) {
        const before = ensureTable(table).length
        _state[table] = ensureTable(table).filter(row => !filters.every(f => row[f.col] == f.val))
        persist()
        return resolve({ data: [], error: null })
      }
      return originalThen.call(builder, resolve)
    }
    return builder
  },

  rpc(name, params) {
    return { then: async (resolve) => resolve({ data: null, error: null }) }
  },
}

const mockStorage = {
  userPath(uid, path) { return `users/${uid}/${path}` },
  sharedPath(uid, path) { return `shared/${uid}/${path}` },
  async upload(path, body, opts = {}) {
    const files = ensureTable('_files')
    files.push({ path, name: path.split('/').pop(), size: body?.size ?? 0, created_at: new Date().toISOString() })
    persist()
    return { data: { path }, error: null }
  },
  async list(prefix, opts = {}) {
    const files = ensureTable('_files').filter(f => f.path.startsWith(prefix || ''))
    return { data: files.slice(opts.offset || 0, (opts.offset || 0) + (opts.limit || 100)), error: null }
  },
  async createSignedUrl(path, ttl = 600) {
    return { data: { signedUrl: `data:text/plain;base64,${btoa('mock-file-content')}` }, error: null }
  },
}

const mockLLM = {
  models: {
    async list() {
      return { data: [
        { id: 'mock-gpt-4o', name: 'GPT-4o (Mock)', disabled: false, temperature: 0.7, supportsToolCall: true, contextWindow: 128000 },
        { id: 'mock-claude-3', name: 'Claude 3 (Mock)', disabled: false, temperature: 0.7, supportsToolCall: true, contextWindow: 200000 },
        { id: 'mock-gpt-4o-mini', name: 'GPT-4o Mini (Mock)', disabled: false, temperature: 0.7, supportsToolCall: false, contextWindow: 128000 },
      ], error: null }
    }
  },
  chat: {
    completions: {
      // Metered like the Worker: the quota check runs before the first chunk (see src/quota/api.js mockMeter).
      create(opts) {
        return metered(opts.feature, () => mockAnswer(opts))
      }
    }
  }
}

async function* metered(feature, answer) {
  const { mockMeter, announceQuota, isQuotaError } = await import('../quota/api.js')
  try {
    await mockMeter(feature)
  } catch (err) {
    if (isQuotaError(err)) announceQuota(err)
    throw err
  }
  yield* answer()
}


const SEED_WORKERS = [
  { id: 6001, name: 'Budi Santoso', phone: '0812-3456-7890', skills: ['ac', 'cleaning'], zone: 'Jakarta Selatan', address: 'Jl. Fatmawati No.15, Jakarta Selatan', lat: -6.2673, lng: 106.7976, status: 'active', age: 60 },
  { id: 6002, name: 'Agus Wijaya', phone: '0821-9876-5432', skills: ['waterproofing', 'roof'], zone: 'Jakarta Pusat', address: 'Jl. Salemba Raya No.42, Jakarta Pusat', lat: -6.1965, lng: 106.8478, status: 'active', age: 55 },
  { id: 6003, name: 'Siti Rahayu', phone: '0838-1234-5678', skills: ['cleaning', 'carpet', 'sofa'], zone: 'Tangerang', address: 'Jl. MH Thamrin No.8, Tangerang', lat: -6.1777, lng: 106.6296, status: 'active', age: 90 },
  { id: 6004, name: 'Dedi Kurniawan', phone: '0856-7890-1234', skills: ['ac', 'electrical'], zone: 'Jakarta Selatan', address: 'Jl. Sisingamangaraja No.22, Jakarta Selatan', lat: -6.2436, lng: 106.8006, status: 'inactive', age: 45 },
  { id: 6005, name: 'Rina Puspita', phone: '0877-4567-8901', skills: ['pool', 'garden'], zone: 'Bogor', address: 'Jl. Pajajaran No.55, Bogor', lat: -6.5942, lng: 106.7892, status: 'active', age: 70 },
  { id: 6006, name: 'Eko Prasetyo', phone: '0813-5678-9012', skills: ['pest', 'cleaning'], zone: 'Surabaya', address: 'Jl. Darmo Permai Selatan No.12, Surabaya', lat: -7.2905, lng: 112.7271, status: 'active', age: 40 },
]
// [assignment_id, worker_id]; inactive 6004 only on an old completed job.
const SEED_LINKS = [[3001, 6001], [3001, 6003], [3002, 6002], [3003, 6005], [3004, 6004], [3005, 6006], [3006, 6005]]

/* --- Pendapatan: VAS catalog and zero-waste findings --- */

const SEED_VAS = [
  { name: 'Perawatan AC 3 bulan', category: 'perawatan', price: 450000, cost: 120000, attach_to: 'Pembersihan AC', attach_rate: 30, description: 'Kunjungan ringan setiap tiga bulan: cuci filter, cek freon, dan bersihkan evaporator.', status: 'active', age: 40 },
  { name: 'Cuci karpet express 6 jam', category: 'kecepatan', price: 250000, cost: 60000, attach_to: 'Cuci Sofa & Karpet', attach_rate: 20, description: 'Karpet selesai dan kering dalam enam jam, dikerjakan lebih dulu dari antrean.', status: 'active', age: 38 },
  { name: 'Perpanjangan garansi 6 bulan', category: 'perlindungan', price: 350000, cost: 40000, attach_to: null, attach_rate: 35, description: 'Garansi hasil kerja diperpanjang menjadi enam bulan, termasuk satu kunjungan pemeriksaan.', status: 'active', age: 35 },
  { name: 'Anti-bakteri coating sofa', category: 'peningkatan', price: 300000, cost: 90000, attach_to: 'Cuci Sofa & Karpet', attach_rate: 25, description: 'Lapisan pelindung setelah cuci, mengurangi noda dan bau sampai tiga bulan.', status: 'active', age: 30 },
  { name: 'Kontrak kolam bulanan plus', category: 'paket', price: 1200000, cost: 450000, attach_to: 'Pembersihan Kolam Renang', attach_rate: 40, description: 'Empat kunjungan sebulan, pengecekan pH, backwash, dan laporan foto mingguan.', status: 'active', age: 28 },
  { name: 'Inspeksi ducting tahunan', category: 'perawatan', price: 900000, cost: 250000, attach_to: 'Ducting & Exhaust Cleaning', attach_rate: 30, description: 'Pemeriksaan tahunan plus laporan kondisi untuk syarat kebersihan dapur.', status: 'active', age: 20 },
  { name: 'Poles marmer per meter', category: 'peningkatan', price: 85000, cost: 70000, attach_to: null, attach_rate: 15, description: 'Poles ringan untuk marmer dan granit setelah deep cleaning.', status: 'draft', age: 12 },
]

const SEED_WASTE = [
  { stream: 'pengerjaan_ulang', title: 'Kunjungan ulang karena noda tidak hilang', detail: 'Sekitar 3 dari 20 pekerjaan cuci sofa mendapat keluhan dan harus dikerjakan dua kali.', monthly_loss: 600000, saved: 240000, action: 'Checklist noda sebelum meninggalkan lokasi, plus foto hasil.', owner: 'Tim Operasional', status: 'progress', age: 45 },
  { stream: 'waktu', title: 'Teknisi menunggu bahan di gudang', detail: 'Rata-rata 45 menit per pekerjaan karena bahan baru disiapkan pagi hari.', monthly_loss: 480000, saved: 120000, action: 'Setiap tim membawa stok harian sendiri, disiapkan sehari sebelumnya.', owner: 'Tim Operasional', status: 'progress', age: 42 },
  { stream: 'perjalanan', title: 'Rute tidak diurutkan antar kecamatan', detail: 'Jadwal disusun per pesanan masuk, bukan per zona, sehingga tim bolak-balik.', monthly_loss: 360000, saved: 0, action: 'Urutkan kunjungan per zona dan tugaskan petugas terdekat.', owner: 'Tim Operasional', status: 'open', age: 40 },
  { stream: 'waktu', title: 'Jadwal menumpuk pagi, kosong sore', detail: 'Enam dari sepuluh pekerjaan dijadwalkan sebelum pukul 11, menyisakan sore tanpa pendapatan.', monthly_loss: 320000, saved: 80000, action: 'Slot dua jam dengan kuota pagi dan sore yang seimbang.', owner: 'Tim Operasional', status: 'progress', age: 36 },
  { stream: 'pengerjaan_ulang', title: 'Checklist tidak dipakai sebelum meninggalkan lokasi', detail: 'Tidak ada pemeriksaan akhir, sehingga masalah kecil baru ketahuan dari keluhan.', monthly_loss: 240000, saved: 240000, action: 'Checklist digital wajib dicentang dan difoto sebelum tutup pekerjaan.', owner: 'Tim Operasional', status: 'done', age: 34 },
  { stream: 'bahan', title: 'Dosis kimia berlebih pada kolam kecil', detail: 'Takaran disamakan untuk semua ukuran kolam, sehingga kolam kecil memakai dua kali lipat.', monthly_loss: 180000, saved: 60000, action: 'Tabel dosis per volume kolam ditempel di kotak alat.', owner: 'Tim Operasional', status: 'progress', age: 30 },
  { stream: 'perjalanan', title: 'Bensin dibeli eceran tanpa catatan', detail: 'Pembelian bensin harian tanpa nota, sehingga biaya tidak bisa dibandingkan dengan jarak tempuh.', monthly_loss: 140000, saved: 0, action: 'Satu kartu bahan bakar per tim dengan catatan kilometer.', owner: 'Tim Keuangan', status: 'open', age: 24 },
  { stream: 'air_kimia', title: 'Pembilasan berlebih pada cuci karpet', detail: 'Pembilasan dilakukan tiga kali, padahal dua kali sudah cukup untuk semua jenis karpet.', monthly_loss: 120000, saved: 0, action: 'Patokan dua kali bilas, kecuali karpet putih tebal.', owner: 'Tim Operasional', status: 'open', age: 18 },
]

function addSeedVas(state, daysAgo) {
  state.vas_items = SEED_VAS.map(({ age, ...v }, i) => ({
    id: 8001 + i, owner_id: 'anon', ...v, created_at: daysAgo(age), updated_at: daysAgo(age),
  }))
  // Two past jobs already carried a VAS line, so the baseline share is not zero:
  // 5004 cuci sofa + anti-bakteri coating, 5007 perawatan kolam + kontrak bulanan.
  const carried = { 5004: 8004, 5007: 8005 }
  for (const l of state.ledger_entries || []) {
    if (carried[l.id] && l.category === 'pendapatan') l.vas_item_id = carried[l.id]
  }
}

function addSeedWaste(state, daysAgo) {
  state.waste_entries = SEED_WASTE.map(({ age, ...w }, i) => ({
    id: 9001 + i, owner_id: 'anon', ...w, created_at: daysAgo(age), updated_at: daysAgo(age),
  }))
}

function addSeedWorkers(state, daysAgo) {
  state.workers = SEED_WORKERS.map(({ age, ...w }) => ({ owner_id: 'anon', ...w, created_at: daysAgo(age) }))
  const have = new Set((state.assignments || []).map((a) => a.id))
  state.assignment_workers = SEED_LINKS.filter(([a]) => have.has(a))
    .map(([assignment_id, worker_id], i) => ({ id: 7001 + i, owner_id: 'anon', assignment_id, worker_id, created_at: daysAgo(10) }))
  for (const a of state.assignments || []) {
    const names = state.assignment_workers.filter((l) => l.assignment_id === a.id)
      .map((l) => state.workers.find((w) => w.id === l.worker_id).name)
    if (names.length) a.worker_name = names.join(', ')
  }
}

/**
 * Seed realistic demo data for teammate demonstration
 */
export function seedDemoData() {
  const state = loadState()
  const now = new Date()
  const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString()
  if (state._seeded) {
    // Older seeded states have no workers, or legacy ones (string ids, old statuses).
    const legacy = !state.workers?.length || state.workers.some((w) => typeof w.id !== 'number' || !['active', 'inactive'].includes(w.status))
    let changed = false
    if (legacy) { addSeedWorkers(state, daysAgo); changed = true }
    if (!state.vas_items?.length) { addSeedVas(state, daysAgo); changed = true }
    if (!state.waste_entries?.length) { addSeedWaste(state, daysAgo); changed = true }
    if (changed) saveState(state)
    return
  }

  // --- Requests ---
  state.requests = [
    { id: 1001, phone: '0812-0000-1001', customer_name: 'PT Maju Jaya', service_type: 'Pembersihan AC', requested_at: daysAgo(14), location: 'Jakarta Selatan', description: 'Pembersihan 15 unit AC split untuk kantor 3 lantai. Termasuk servis ringan dan penggantian filter.', created_at: daysAgo(14) },
    { id: 1002, phone: '0812-0000-1002', customer_name: 'Rumah Bapak Surya', service_type: 'Cuci Sofa & Karpet', requested_at: daysAgo(12), location: 'Bandung', description: 'Cuci sofa 3 set dan karpet 2 pcs untuk rumah tinggal.', created_at: daysAgo(12) },
    { id: 1003, customer_name: 'Kost exclusive 99', service_type: 'Pembersihan Kolam Renang', location: 'Depok', description: 'Perawatan rutin kolam renang bulanan, termasuk pengecekan pH dan backwash.', created_at: daysAgo(10) },
    { id: 1004, customer_name: 'PT Sinar Abadi', service_type: 'Pest Control', location: 'Tangerang', description: 'Pengendalian hama rayap dan kecoa untuk gudang 500m2.', created_at: daysAgo(8) },
    { id: 1005, customer_name: 'Apartemen GreenView', service_type: 'Pembersihan Kaca Gedung', location: 'Jakarta Pusat', description: 'Pembersihan kaca eksterior 12 lantai menggunakan gondola.', created_at: daysAgo(6) },
    { id: 1006, customer_name: 'Resto Nusantara', service_type: 'Ducting & Exhaust Cleaning', location: 'Surabaya', description: 'Pembersihan ducting dan exhaust fan dapur restoran.', created_at: daysAgo(4) },
    { id: 1007, phone: '0812-0000-1007', customer_name: 'Hotel Grand Lestari', service_type: 'Deep Cleaning Kamar', location: 'Yogyakarta', description: 'Deep cleaning 50 kamar hotel setelah musim liburan.', created_at: daysAgo(2) },
    { id: 1008, phone: '0812-0000-1008', customer_name: 'Villa Bukit Asri', service_type: 'Pembersihan Taman & Kolam', location: 'Bogor', description: 'Perawatan taman landscape dan kolam ikan koi.', created_at: daysAgo(1) },
  ]

  // --- Offers ---
  state.offers = [
    { id: 2001, request_id: 1001, ai_proposal_json: { scope: 'Pembersihan AC split 15 unit di 3 lantai kantor.', price: 3500000, terms: 'Pembayaran 50% di muka.', notes: 'Harga termasuk sparepart filter.' }, validated_price: 3500000, validated_scope: 'Pembersihan AC split 15 unit di 3 lantai kantor.', status: 'approved', created_at: daysAgo(13) },
    { id: 2002, request_id: 1002, ai_proposal_json: { scope: 'Cuci sofa 3 set dan karpet 2 pcs.', price: 1200000, terms: 'Pembayaran penuh setelah selesai.', notes: 'Garansi 3 hari.' }, validated_price: 1200000, validated_scope: 'Cuci sofa 3 set dan karpet 2 pcs.', status: 'approved', created_at: daysAgo(11) },
    { id: 2003, request_id: 1003, ai_proposal_json: { scope: 'Perawatan rutin kolam renang bulanan.', price: 850000, terms: 'Langganan bulanan.', notes: 'Termasuk bahan kimia.' }, validated_price: 850000, validated_scope: 'Perawatan rutin kolam renang bulanan.', status: 'approved', created_at: daysAgo(9) },
    { id: 2004, request_id: 1004, ai_proposal_json: { scope: 'Pest control rayap dan kecoa gudang 500m2.', price: 4200000, terms: 'Kontrak 3 bulan.', notes: 'Garansi 6 bulan.' }, validated_price: 4200000, validated_scope: 'Pest control rayap dan kecoa gudang 500m2.', status: 'approved', created_at: daysAgo(7) },
    { id: 2005, request_id: 1005, ai_proposal_json: { scope: 'Pembersihan kaca eksterior 12 lantai.', price: 7800000, terms: 'Pembayaran 2 termin.', notes: 'Sertifikat safety disertakan.' }, validated_price: 7800000, validated_scope: 'Pembersihan kaca eksterior 12 lantai.', status: 'draft', created_at: daysAgo(5) },
    { id: 2006, request_id: 1006, ai_proposal_json: { scope: 'Ducting dan exhaust fan cleaning.', price: 2500000, terms: 'Pembayaran penuh.', notes: 'Dikerjakan malam hari.' }, validated_price: 2500000, validated_scope: 'Ducting dan exhaust fan cleaning.', status: 'draft', created_at: daysAgo(3) },
    { id: 2007, request_id: 1007, ai_proposal_json: { scope: 'Deep cleaning 50 kamar hotel.', price: 15000000, terms: 'Termin mingguan.', notes: 'Target 10 kamar/hari.' }, validated_price: 15000000, validated_scope: 'Deep cleaning 50 kamar hotel.', status: 'draft', created_at: daysAgo(1) },
  ]

  // --- Assignments ---
  state.assignments = [
    { id: 3001, offer_id: 2001, worker_name: 'Budi Santoso, Siti Rahayu', scheduled_at: daysAgo(11), status: 'done', created_at: daysAgo(12) },
    { id: 3002, offer_id: 2002, worker_name: 'Agus Wijaya', scheduled_at: daysAgo(9), status: 'done', created_at: daysAgo(10) },
    { id: 3003, offer_id: 2003, worker_name: 'Rina Puspita', scheduled_at: daysAgo(8), status: 'done', created_at: daysAgo(9) },
    { id: 3004, offer_id: 2004, worker_name: 'Dedi Kurniawan', scheduled_at: daysAgo(5), status: 'done', created_at: daysAgo(7) },
    { id: 3005, offer_id: 2001, worker_name: 'Eko Prasetyo', scheduled_at: daysAgo(3), status: 'assigned', created_at: daysAgo(4) },
    { id: 3006, offer_id: 2003, worker_name: 'Rina Puspita', scheduled_at: daysAgo(2), status: 'assigned', created_at: daysAgo(3) },
  ]

  // --- Completions ---
  state.completions = [
    { id: 4001, assignment_id: 3001, notes: 'Semua AC bersih dan dingin optimal. Filter sudah diganti.', status: 'done', completed_at: daysAgo(10), created_at: daysAgo(10) },
    { id: 4002, assignment_id: 3002, notes: 'Sofa dan karpet bersih, noda kopi hilang 95%.', status: 'done', completed_at: daysAgo(8), created_at: daysAgo(8) },
    { id: 4003, assignment_id: 3003, notes: 'pH kolam stabil 7.2, air jernih.', status: 'done', completed_at: daysAgo(6), created_at: daysAgo(6) },
    { id: 4004, assignment_id: 3004, notes: 'Pembasmi hama dikerjakan 2x. Rekomendasi follow up 1 bulan.', status: 'done', completed_at: daysAgo(3), created_at: daysAgo(3) },
  ]

  // --- Ledger Entries ---
  state.ledger_entries = [
    { id: 5001, completion_id: 4001, amount: 3500000, category: 'pendapatan', status: 'posted', posted_at: daysAgo(10), created_at: daysAgo(10) },
    { id: 5002, completion_id: 4001, amount: 800000, category: 'biaya_tenaga', status: 'posted', posted_at: daysAgo(10), created_at: daysAgo(10) },
    { id: 5003, completion_id: 4001, amount: 350000, category: 'biaya_bahan', status: 'posted', posted_at: daysAgo(10), created_at: daysAgo(10) },
    { id: 5004, completion_id: 4002, amount: 1200000, category: 'pendapatan', status: 'posted', posted_at: daysAgo(8), created_at: daysAgo(8) },
    { id: 5005, completion_id: 4002, amount: 300000, category: 'biaya_tenaga', status: 'posted', posted_at: daysAgo(8), created_at: daysAgo(8) },
    { id: 5006, completion_id: 4002, amount: 120000, category: 'biaya_bahan', status: 'posted', posted_at: daysAgo(8), created_at: daysAgo(8) },
    { id: 5007, completion_id: 4003, amount: 850000, category: 'pendapatan', status: 'posted', posted_at: daysAgo(6), created_at: daysAgo(6) },
    { id: 5008, completion_id: 4003, amount: 200000, category: 'biaya_tenaga', status: 'posted', posted_at: daysAgo(6), created_at: daysAgo(6) },
    { id: 5009, completion_id: 4003, amount: 180000, category: 'biaya_bahan', status: 'posted', posted_at: daysAgo(6), created_at: daysAgo(6) },
    { id: 5010, completion_id: 4004, amount: 4200000, category: 'pendapatan', status: 'posted', posted_at: daysAgo(3), created_at: daysAgo(3) },
    { id: 5011, completion_id: 4004, amount: 1200000, category: 'biaya_tenaga', status: 'posted', posted_at: daysAgo(3), created_at: daysAgo(3) },
    { id: 5012, completion_id: 4004, amount: 650000, category: 'biaya_bahan', status: 'posted', posted_at: daysAgo(3), created_at: daysAgo(3) },
  ]

  addSeedWorkers(state, daysAgo)
  addSeedVas(state, daysAgo)
  addSeedWaste(state, daysAgo)

  state.users = [{ id: 'demo-user', email: 'demo@satualur.id', name: 'Demo User', created_at: daysAgo(30) }]
  state._seeded = true
  saveState(state)
  console.log('[Mock Cloud] Demo data seeded: 8 requests, 7 offers, 6 assignments, 4 completions, 12 ledger entries, 6 workers, 7 VAS items, 8 waste findings')
}

export function createMockWorkBuddyCloud() {
  // Auto-seed on first creation, then re-read: the module-level copy was
  // loaded before seeding and would otherwise overwrite the demo data on the
  // next persist() (e.g. when the first login stores its user).
  seedDemoData()
  _state = loadState()

  return {
    auth: mockAuth,
    database: mockDatabase,
    storage: mockStorage,
    llm: mockLLM,
  }
}
