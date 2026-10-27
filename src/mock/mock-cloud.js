/**
 * Mock WorkBuddy Cloud SDK — runs entirely in browser memory + localStorage.
 * Mengisi gap saat cloud service WorkBuddy belum diaktifkan.
 * Dapat diganti dengan SDK nyata secara transparan saat publicConfig tersedia.
 */

const STORAGE_KEY = 'serviceops_mock_v1'
const OTP_STORE = 'serviceops_mock_otp'

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
function persist() {
  saveState(_state)
}

let _session = null
let _sessionCb = null

function notifyAuth(event) {
  if (_sessionCb) _sessionCb(event, _session)
}

const mockAuth = {
  async sendOtp({ email }) {
    if (!email || !email.includes('@')) throw new Error('Email tidak valid.')
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const id = crypto.randomUUID()
    const otpData = JSON.parse(localStorage.getItem(OTP_STORE) || '{}')
    otpData[id] = { email, code, ts: Date.now() }
    localStorage.setItem(OTP_STORE, JSON.stringify(otpData))
    console.log(`[MOCK OTP] Kode untuk ${email}: ${code}`)
    const users = ensureTable('users')
    const isExistingUser = users.some(u => u.email === email)
    return { data: { verificationId: id, isExistingUser }, error: null }
  },

  async verifyOtp({ email, verificationId, isExistingUser, token }) {
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
    _session = { user, access_token: 'mock_' + crypto.randomUUID() }
    notifyAuth('SIGNED_IN')
    return { data: { user }, error: null }
  },

  async getSession() {
    if (_session) return { data: _session, error: null }
    return { data: null, error: { message: 'Belum masuk.' } }
  },

  async refreshSession() {
    return mockAuth.getSession()
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
        const created = builder._insert.map(item => ({
          id: Date.now() + Math.floor(Math.random() * 100000),
          owner_id: _session?.user?.id ?? 'anon',
          created_at: new Date().toISOString(),
          ...item,
        }))
        ensureTable(table).push(...created)
        persist()
        return resolve({ data: created, error: null })
      }
      if (builder._update) {
        let affected = 0
        ensureTable(table).forEach((row, i) => {
          if (filters.every(f => {
            if (f.op === 'eq') return row[f.col] == f.val
            return true
          })) {
            Object.assign(row, builder._update)
            affected++
          }
        })
        persist()
        return resolve({ data: affected > 0 ? [builder._update] : [], error: null })
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

// Simulasi AI streaming dengan chunk
async function* mockStreamOffer(request) {
  const scope = request.service_type || 'Pembersihan umum'
  const price = Math.floor(Math.random() * 900000) + 100000
  const json = JSON.stringify({
    scope: `${scope} untuk area ${request.location || ' Jakarta'} — mencakup persiapan alat, pelaksanaan, dan pembersihan pasca kerja.`,
    price,
    terms: 'Pembayaran 50% di muka, sisa setelah pekerjaan selesai dan diterima. Garansi 7 hari.',
    notes: 'Harga estimasi berdasarkan deskripsi singkat. Survei lapangan mungkin diperlukan.',
  }, null, 2)
  // Stream token demi token
  for (let i = 0; i < json.length; i += 4) {
    await new Promise(r => setTimeout(r, 15))
    yield {
      choices: [{
        delta: { content: json.slice(i, i + 4) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 50, completion_tokens: json.length / 4, total_tokens: 50 + json.length / 4 },
  }
}

async function* mockStreamExplain(report) {
  const html = `<h3>Laporan Periode ${report.period || 'Oktober 2026'}</h3>
<p>Total pendapatan: <strong>Rp${(report.total_revenue || 0).toLocaleString('id-ID')}</strong>.</p>
<p>Biaya operasional: <strong>Rp${(report.total_cost || 0).toLocaleString('id-ID')}</strong>.</p>
<p>Laba bersih: <strong>Rp${((report.total_revenue || 0) - (report.total_cost || 0)).toLocaleString('id-ID')}</strong>.</p>
<ul>
  <li>Pendapatan naik 12% dibanding periode sebelumnya.</li>
  <li>Biaya tenaga kerja merupakan komponen terbesar.</li>
  <li>Rekomendasi: pertimbangkan paket langganan untuk meningkatkan recurring revenue.</li>
</ul>`
  for (let i = 0; i < html.length; i += 8) {
    await new Promise(r => setTimeout(r, 20))
    yield {
      choices: [{
        delta: { content: html.slice(i, i + 8) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 30, completion_tokens: html.length / 8, total_tokens: 30 + html.length / 8 },
  }
}

const mockLLM = {
  models: {
    async list() {
      return { data: [
        { id: 'mock-gpt-4o', name: 'GPT-4o (Mock)', disabled: false, temperature: 0.7, supportsToolCall: false },
        { id: 'mock-claude-3', name: 'Claude 3 (Mock)', disabled: false, temperature: 0.7 },
      ], error: null }
    }
  },
  chat: {
    completions: {
      create({ messages, stream, response_format }) {
        const userMsg = messages.find(m => m.role === 'user')?.content || ''
        const isOffer = userMsg.includes('Permintaan jasa')
        const generator = isOffer ? mockStreamOffer(JSON.parse(userMsg.replace('Permintaan jasa:\n', ''))) : mockStreamExplain({})
        return generator
      }
    }
  }
}

export function createMockWorkBuddyCloud() {
  return {
    auth: mockAuth,
    database: mockDatabase,
    storage: mockStorage,
    llm: mockLLM,
  }
}
