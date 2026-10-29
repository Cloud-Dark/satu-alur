/**
 * Mock cloud — the same interface as src/http-cloud.js, kept in browser
 * memory + localStorage. Used for local development and e2e tests
 * (VITE_USE_MOCK=true); production talks to the Worker + D1.
 */
import { isBlocked, SUSPENDED_MESSAGE, AUTH_NOTICE_KEY } from '../customers/rules.js'

const STORAGE_KEY = 'satualur_mock_v1'
const OTP_STORE = 'satualur_mock_otp'

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

const mockAuth = {
  async sendOtp({ email }) {
    if (!email || !email.includes('@')) throw new Error('Email tidak valid.')
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
    return { data: { user }, error: null }
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
    return { data: { user }, error: null }
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
    return { data: { user }, error: null }
  },

  async getSession() {
    if (_session) {
      const flag = userFlag(_session.user.id)
      if (isBlocked(flag) || (flag?.revoked_at && flag.revoked_at >= _session.created_at)) {
        _session = null
        if (isBlocked(flag)) {
          try { sessionStorage.setItem(AUTH_NOTICE_KEY, SUSPENDED_MESSAGE) } catch { /* storage unavailable */ }
          return { data: null, error: { message: SUSPENDED_MESSAGE, status: 403 } }
        }
        return { data: null, error: { message: 'Sesi tidak valid atau sudah berakhir.', status: 401 } }
      }
    }
    // Same rule as the Worker: only a staff-login session is an admin.
    if (_session) {
      const { is_staff, ...pub } = _session
      return { data: { ...pub, is_admin: is_staff === true }, error: null }
    }
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
        const ruleError = flowRuleError(table, builder._insert)
        if (ruleError) return resolve({ data: null, error: { message: ruleError } })
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
      if ((builder._update || builder._delete) && filters.length === 0) {
        return resolve({ data: null, error: { message: 'Filter diperlukan untuk update/delete.' } })
      }
      if (builder._update) {
        const bad = ['id', 'owner_id'].find((c) => c in builder._update)
        if (bad) return resolve({ data: null, error: { message: `Kolom tidak boleh diubah: ${bad}` } })
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

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const rp = (n) => idr.format(Number(n) || 0)
const pctFmt = (n) => `${Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Compares cur with prev honestly: no percentage when prev is zero. */
function compareLine(label, cur, prev, prevLabel, { lowerIsBetter = false } = {}) {
  if (!(prev > 0)) return `${label} ${rp(cur)}; ${esc(prevLabel)} tidak punya ${label.toLowerCase()} sebagai pembanding.`
  const pct = ((cur - prev) / prev) * 100
  if (pct === 0) return `${label} sama dengan ${esc(prevLabel)} (${rp(prev)}).`
  const dir = pct > 0 ? 'naik' : 'turun'
  const good = lowerIsBetter ? pct < 0 : pct > 0
  return `${label} ${dir} ${pctFmt(pct)} dibanding ${esc(prevLabel)} (${rp(prev)} → ${rp(cur)})${good ? '' : ' — perlu diperhatikan'}.`
}

/** Builds the mock explanation strictly from the report payload. */
function explainHTML(report = {}) {
  const rev = Number(report.total_revenue) || 0
  const cost = Number(report.total_cost) || 0
  const profit = Number(report.net_profit ?? rev - cost) || 0
  const margin = report.margin_pct ?? (rev > 0 ? Math.round((profit / rev) * 1000) / 10 : null)
  const entries = Array.isArray(report.entries) ? report.entries.length : 0
  const cats = Array.isArray(report.by_category) ? report.by_category : []
  const costCats = cats.filter((c) => c.category !== 'pendapatan').sort((a, b) => (b.amount || 0) - (a.amount || 0))
  const custs = Array.isArray(report.top_customers) ? report.top_customers : []
  const prev = report.previous_period

  const out = []
  out.push(`<h3>Ringkasan ${esc(report.period || 'periode terpilih')}</h3>`)
  if (!entries && !rev && !cost) {
    out.push('<p>Belum ada jurnal di periode ini, jadi belum ada angka yang bisa dijelaskan.</p>')
    return out.join('\n')
  }
  out.push(`<p>Dari <strong>${entries} jurnal</strong>, pendapatan tercatat <strong>${rp(rev)}</strong> dan biaya <strong>${rp(cost)}</strong>, sehingga ${profit >= 0 ? 'laba' : 'rugi'} bersih <strong>${rp(Math.abs(profit))}</strong>${margin != null ? ` dengan margin <strong>${String(margin).replace('.', ',')}%</strong>` : ''}.</p>`)

  if (prev) {
    out.push('<h3>Dibanding periode sebelumnya</h3><ul>')
    out.push(`<li>${compareLine('Pendapatan', rev, prev.total_revenue, prev.label)}</li>`)
    out.push(`<li>${compareLine('Biaya', cost, prev.total_cost, prev.label, { lowerIsBetter: true })}</li>`)
    out.push(`<li>Laba sebelum pajak ${esc(prev.label)}: ${rp(prev.net_profit)}; periode ini: ${rp(profit)}.</li>`)
    out.push('</ul>')
  } else {
    out.push('<p>Periode ini tidak memiliki periode pembanding, jadi tidak ada tren yang disimpulkan.</p>')
  }

  if (costCats.length || custs.length) {
    out.push('<h3>Rincian</h3><ul>')
    if (costCats.length) {
      const top = costCats[0]
      const share = rev > 0 ? ` (${pctFmt(((top.amount || 0) / rev) * 100)} dari pendapatan)` : ''
      out.push(`<li>Komponen biaya terbesar: <strong>${esc(top.label || top.category)}</strong> ${rp(top.amount)}${share}.</li>`)
    }
    if (custs.length) {
      const c = custs[0]
      const share = rev > 0 ? ` — ${pctFmt(((c.revenue || 0) / rev) * 100)} dari pendapatan` : ''
      out.push(`<li>Pelanggan dengan pendapatan terbesar: <strong>${esc(c.name)}</strong>${c.service ? ` (${esc(c.service)})` : ''}, ${rp(c.revenue)}${share}.</li>`)
    }
    out.push('</ul>')
  }

  const recs = []
  if (rev === 0 && cost > 0) recs.push('Ada biaya tanpa pendapatan di periode ini. Pastikan pendapatan dari pekerjaan selesai sudah diposting.')
  if (margin != null && margin < 30) recs.push(`Margin ${String(margin).replace('.', ',')}% tergolong tipis. Tinjau harga penawaran atau tekan ${costCats[0] ? esc((costCats[0].label || '').toLowerCase()) : 'biaya'}.`)
  if (margin != null && margin >= 30) recs.push('Margin sehat. Pertahankan struktur harga dan pantau biaya per pekerjaan.')
  if (custs.length === 1 && rev > 0) recs.push('Seluruh pendapatan berasal dari satu pelanggan. Tambah pelanggan untuk mengurangi risiko konsentrasi.')
  if (recs.length) out.push(`<h3>Rekomendasi</h3><ul>${recs.map((r) => `<li>${r}</li>`).join('')}</ul>`)
  out.push('<p><small>Simulasi lokal: dihitung langsung dari data laporan di atas, bukan dari model AI.</small></p>')
  return out.join('\n')
}

async function* mockStreamExplain(report) {
  const html = explainHTML(report)
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

async function* mockStreamGeneral(userMsg) {
  const responses = [
    'Tentu! Satu Alur memiliki 6 tahap alur kerja yang terintegrasi: Permintaan → Penawaran AI → Penugasan → Penyelesaian → Pembukuan → Laporan. Setiap tahap terhubung secara otomatis.',
    'Anda bisa melihat dashboard eksekutif di halaman awal setelah login. Dashboard menampilkan ringkasan KPI, aktivitas terbaru, dan status setiap tahap.',
    'Fitur AI Penawaran akan secara otomatis menghasilkan proposal dengan estimasi harga berdasarkan deskripsi permintaan pelanggan. Harga dihitung realistis untuk pasar Indonesia.',
    'Data Anda tersimpan dengan aman. Dalam mode produksi, kami menggunakan enkripsi end-to-end dan backup otomatis.',
  ]
  const text = responses[Math.floor(Math.random() * responses.length)]
  for (let i = 0; i < text.length; i += 3) {
    await new Promise(r => setTimeout(r, 25))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 3) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: text.length / 3, total_tokens: 20 + text.length / 3 },
  }
}

async function* mockStreamAnalyst(userMsg) {
  const state = loadState()
  const counts = {
    requests: (state.requests || []).length,
    offers: (state.offers || []).length,
    assignments: (state.assignments || []).length,
    completions: (state.completions || []).length,
    ledger: (state.ledger_entries || []).length,
  }
  const text = `Berdasarkan data saat ini:\n\n• Total permintaan: ${counts.requests}\n• Total penawaran: ${counts.offers}\n• Total penugasan: ${counts.assignments}\n• Total penyelesaian: ${counts.completions}\n• Total jurnal: ${counts.ledger}\n\nTingkat konversi permintaan ke penawaran: ${counts.requests > 0 ? Math.round(counts.offers / counts.requests * 100) : 0}%.\nTingkat penyelesaian: ${counts.assignments > 0 ? Math.round(counts.completions / counts.assignments * 100) : 0}%.`
  for (let i = 0; i < text.length; i += 3) {
    await new Promise(r => setTimeout(r, 20))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 3) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 25, completion_tokens: text.length / 3, total_tokens: 25 + text.length / 3 },
  }
}

async function* mockStreamSocial(userMsg) {
  const isBrainstorm = userMsg.includes('brainstorm') || userMsg.includes('ide konten')
  const isCaption = userMsg.includes('caption') || userMsg.includes('naskah')
  const isImagePrompt = userMsg.includes('prompt gambar') || userMsg.includes('image generation')
  const isAds = userMsg.includes('iklan') || userMsg.includes('Meta Ads')

  let text = ''

  if (isBrainstorm) {
    text = `💡 **Brainstorm Ide Konten**

**1. "Before vs After" Transformation**
Format: Reels / TikTok
Hook: "Lihat perbedaan AC ini sebelum dan sesudah dibersihkan!"
Konsep: Video time-lapse proses pembersihan dengan musik upbeat.
Estimasi engagement: 🔥 Tinggi

**2. Tips & Educational Carousel**
Format: Carousel Instagram
Hook: "5 Tanda AC Anda Butuh Service Segera"
Konsep: Infografis swipeable dengan icon dan bullet points.
Estimasi engagement: 📈 Sedang-Tinggi

**3. Behind the Scenes**
Format: Story Series
Hook: "Hari ini kita service AC di gedung 20 lantai!"
Konsep: Dokumentasi tim bekerja dengan gondola/equipment.
Estimasi engagement: 📊 Sedang

**4. Customer Testimonial Video**
Format: Short Video
Hook: "Pak Surya bilang apa setelah sofa-nya bersih kembali?"
Konsep: Interview singkat pelanggan puas.
Estimasi engagement: 🔥 Tinggi

**5. Myth Buster Series**
Format: TikTok / Reels
Hook: "Fakta atau Mitos: AC sering mati-sendiri karena hantu?"
Konsep: Format Q&A dengan presenter enerjik.
Estimasi engagement: 🔥 Tinggi

Hashtag: #jasabersih #serviceac #cleaningservice #tipsrumah #jakarta`
  } else if (isImagePrompt) {
    text = `🎨 **AI Image Prompt**

Prompt 1 (Hero Image):
"Professional cleaning service team in orange uniform, modern minimalist living room, bright natural lighting, before-and-after split composition, photorealistic, 8K, commercial photography style"

Prompt 2 (Instagram Feed):
"Aerial view of sparkling clean swimming pool, tropical garden background, golden hour lighting, luxury villa setting, professional real estate photography, vivid colors"

Prompt 3 (TikTok Thumbnail):
"Split-screen dramatic transformation: dirty vs clean AC unit, bold text overlay space, high contrast, eye-catching colors, social media thumbnail style"

Prompt 4 (Ad Banner):
"Happy Indonesian family sitting on freshly cleaned sofa, bright modern home interior, warm lighting, lifestyle photography, copy space on right side, 16:9 aspect ratio"

Tip: Tambahkan "--ar 1:1" untuk Instagram, "--ar 9:16" untuk Stories/Reels, "--ar 16:9" untuk banner.`
  } else if (isAds) {
    text = `🎯 **Rekomendasi Meta Ads**

**Target Audience:**
• Usia: 28-50 tahun
• Gender: Semua
• Lokasi: Jakarta Selatan, Jakarta Pusat, Depok, Tangerang
• Minat: Home improvement, Property, Family & parenting, Cleaning services
• Perilaku: Engaged shoppers, Recent home buyers

**Placements:** Feed, Stories, Reels
**Budget harian:** Rp100.000
**Est. reach/hari:** ~200-350 orang
**Est. CPM:** Rp450-750

**Copy Iklan 1 (Promosi):**
"AC Bocor? AC Bau? 🤢
Tim kami siap datang HARI INI!
✅ Pembersihan AC dari Rp85rb/unit
✅ Garansi 7 hari
✅ Free survey
📍 Jakarta & sekitarnya
👇 Klik WA langsung!"

**Copy Iklan 2 (Testimonial):**
""Sofa kami seperti baru lagi!" — Ibu Dian, Jakarta Selatan
Cuci sofa mulai dari Rp350rb/set
✅ Noda hilang 99%
✅ Bahan aman & ramah anak
📲 Hubungi kami sekarang!"

**Waktu Posting Terbaik:**
🕐 09:00–11:00 | 🕐 13:00–15:00 | 🕐 19:00–21:00

Hashtag: #serviceacjakarta #jasabersih #homecare #cleaningserviceid #tipsrumah`
  } else {
    text = `📝 **Caption Instagram**

✨ AC BERSIH = UDARA SEGAR ✨

Siapa yang suka tidur dengan AC nyaman tanpa bau aneh? 🙋‍♀️

Tahukah kamu? AC yang jarang dibersihkan bisa jadi sarang bakteri dan debu yang menyebabkan alergi! 😷

Nggak usah khawatir, tim Satu Alur siap bantu:
✅ Pembersihan AC split & central
✅ Penggantian filter
✅ Pengecekan freon
✅ Garansi 7 hari

📍 Jakarta, Depok, Tangerang, Bekasi
💰 Mulai dari Rp85rb/unit

Yuk booking sekarang! Link di bio 👆

#serviceac #jasabersih #cleaningservice #tipsrumah #jakarta #depok #tangerang #homecare #acbersih #rumahsehat`
  }

  for (let i = 0; i < text.length; i += 4) {
    await new Promise(r => setTimeout(r, 18))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 4) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 30, completion_tokens: text.length / 4, total_tokens: 30 + text.length / 4 },
  }
}

async function* mockStreamPertumbuhan(userMsg) {
  const lower = userMsg.toLowerCase()
  let text = ''

  if (lower.includes('hotel horizon') || lower.includes('penawaran')) {
    text = `✅ **Tindakan: Kirim Penawaran ke Hotel Horizon**

Saya telah menyiapkan draft penawaran:

• **Layanan:** Daily cleaning kamar + lobby + common area
• **Frekuensi:** 6 hari/minggu
• **Tim:** 4 orang (2 cleaning, 1 supervisor, 1 backup)
• **Harga:** Rp 54.000.000/bulan (all-in)
• **Nilai tambah:** Free disinfection monthly + laporan foto harian

**Probabilitas deal: 78%** → **Expected close dalam 3-5 hari**

Langkah selanjutnya:
1. Kirim email proposal (sudah saya draft)
2. Follow-up WhatsApp dalam 24 jam
3. Offer site visit gratis untuk survey

Apakah Anda ingin saya kirim sekarang?`
  } else if (lower.includes('maju jaya') || lower.includes('paket tahunan')) {
    text = `💰 **Tindakan: Upsell Paket Tahunan PT Maju Jaya**

Berdasarkan analisis riwayat:
• Rata-rata order: Rp 350rb/bulan
• Total 12 bulan: Rp 4.200.000
• **Paket tahunan: Rp 3.360.000 (hemat 20%)**
• **Bonus:** 2× free deep cleaning (Rp 700rb value)

**Pitch rekomendasi:**
"Pak Budi, dengan paket tahunan Anda hemat Rp 840rb + dapat 2× deep cleaning gratis. Saya lock harga ini sampai akhir bulan."

**Prediksi keberhasilan: 82%**

Ingin saya generate draft WhatsApp/Email?`
  } else if (lower.includes('klinik') || lower.includes('retention')) {
    text = `⚠️ **Tindakan: Retention Klinik Sehat Sentosa**

Skenario churn terdeteksi:
• Gap order: 45 hari (normal: 30 hari)
• Last contact: 12 September
• Competitor probability: 55%

**Rekomendasi win-back sequence:**

**Hari 1 (hari ini):** Telepon langsung ke manager operasional
→ Tanyakan kebutuhan terbaru, offer audit kebersihan GRATIS

**Hari 2:** Kirim voucher Rp 50rb untuk order berikutnya

**Hari 5:** Follow-up email dengan portfolio hasil kerja terbaru

**Win-back probability: 62%** → Jika tidak merespons dalam 7 hari, flag sebagai "lost customer"

Mulai dengan telepon sekarang?`
  } else if (lower.includes('bsd') || lower.includes('partnership')) {
    text = `🤝 **Tindakan: Partnership BSD AC Service**

Analisis partnership:
• Overflow demand: 12 request/minggu (kapasitas penuh)
• Partner track record: 4.8⭐, 200+ job
• Margin bersih: 18%
• Estimasi: 5 job/minggu pertama

**Draft MOU:**
• Periode: 3 bulan trial
• Revenue share: 82% Anda, 18% partner
• SLA: Response < 2 jam, selesai < 24 jam
• Branding: Satu Alur tetap sebagai front-facing brand

**Expected value: Rp 12 juta/bulan**

Saya bisa generate draft MOU dan kontak BSD AC. Mulai?`
  } else {
    text = `🤖 **Asisten Pertumbuhan**

Saya membantu Anda menemukan dan mengeksekusi peluang bisnis. Berikut yang bisa saya lakukan:

• 📊 **Analisis peluang** — Scan data untuk hot lead, upsell, churn risk
• 🎯 **Rekomendasi tindakan** — Suggest next step dengan probabilitas keberhasilan
• 📞 **Generate draft komunikasi** — Email, WhatsApp, proposal untuk customer
• 📈 **Tracking prediksi** — Monitor progress dan update probability real-time

**6 peluang aktif terdeteksi dengan total potensi Rp 106.3 juta/bulan.**

Apa yang ingin Anda tindaklanjuti?`
  }

  for (let i = 0; i < text.length; i += 3) {
    await new Promise(r => setTimeout(r, 20))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 3) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 25, completion_tokens: text.length / 3, total_tokens: 25 + text.length / 3 },
  }
}

function parseRequest(text) {
  try { return JSON.parse(String(text).replace(/^Permintaan jasa:\s*/, '')) } catch { return { description: text } }
}

function parseReport(text) {
  try { return JSON.parse(String(text).replace(/^Data laporan:\s*/, '')) } catch { return {} }
}

/* ------------------------------------------------------------------------
 * Generic agent responder. Any request whose system prompt starts with the
 * marker `[agent:<key>]` gets a plausible Indonesian answer built from the
 * numbers in the context it was sent — clearly labelled as a local simulation.
 * ---------------------------------------------------------------------- */

async function* streamText(text, { step = 6, delay = 22 } = {}) {
  for (let i = 0; i < text.length; i += step) {
    await new Promise(r => setTimeout(r, delay))
    yield { choices: [{ delta: { content: text.slice(i, i + step) }, finish_reason: null }] }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: Math.ceil(text.length / 4), total_tokens: 120 + Math.ceil(text.length / 4) },
  }
}

const SIM_NOTE = '_Simulasi lokal: jawaban ini disusun otomatis dari angka konteks yang dikirim aplikasi, bukan dari model AI._'

/** Reads "Label: value" lines from the context the app sent. */
function contextReader(ctx) {
  const grab = (label) => {
    const m = ctx.match(new RegExp(`^${label}[^:\\n]*:\\s*(.+)$`, 'm'))
    return m ? m[1].trim() : null
  }
  const money = (label) => grab(label)?.match(/Rp\s?[\d.]+/)?.[0] || null
  const numericLines = ctx.split('\n').map(l => l.replace(/^[-\s]+/, '').trim())
    .filter(l => /Rp\s?[\d.]+|\d+(?:,\d+)?%/.test(l) && !l.startsWith('['))
  return { grab, money, numericLines }
}

function advisorMockAnswer(agent, question, ctx) {
  const { grab, money, numericLines } = contextReader(ctx)
  const noData = /Status data: belum ada data/.test(ctx)
  const rev30 = money('Pendapatan 30 hari terakhir')
  const profit30 = grab('Laba 30 hari terakhir')
  const avgJob = money('Rata-rata nilai pekerjaan')
  const mom = grab('Pertumbuhan bulan ke bulan')
  const topCost = grab('Biaya terbesar')
  const topService = grab('Layanan teratas')
  const topCustomer = grab('Pelanggan teratas')
  const pending = grab('Pekerjaan tertunda')
  const conversion = grab('Konversi')
  const target = grab('Target pertumbuhan')
  const nextMonth = grab('Bulan depan saja')
  const m12 = ctx.match(/^- Bulan ke-12: (.+)$/m)?.[1]
  const repeat = grab('Pelanggan berulang')
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 140)

  const out = []
  if (noData) {
    out.push(`Belum ada data permintaan maupun jurnal di akun ini, jadi saya menjawab "${q}" dengan saran umum dulu.`)
    out.push('### Mulai dari dasar')
    out.push('1. Catat setiap permintaan pelanggan di tahap **01 Permintaan**, sekecil apa pun.')
    out.push('2. Kirim penawaran tertulis untuk setiap permintaan dalam 24 jam.')
    out.push('3. Bukukan pendapatan dan biaya tiap pekerjaan agar margin terlihat.')
    out.push('Untuk usaha perorangan atau UKM, target pertumbuhan yang sehat adalah **1–2% per bulan**. Setelah satu bulan data terkumpul, saya bisa menghitung target yang spesifik untuk Anda.')
  } else {
    const facts = []
    if (rev30) facts.push(`pendapatan 30 hari terakhir **${rev30}**`)
    if (profit30) facts.push(`laba ${profit30.replace(/(Rp[\d.]+)/, '**$1**')}`)
    if (avgJob) facts.push(`rata-rata nilai pekerjaan **${avgJob}**`)
    out.push(`Untuk pertanyaan "${q}", saya berangkat dari angka Anda: ${facts.length ? facts.join(', ') : numericLines.slice(0, 2).join('; ')}.`)

    if (agent === 'keuangan') {
      out.push('### Yang terlihat di angka')
      if (topCost) out.push(`- Komponen biaya terbesar: **${topCost}**. Ini kandidat pertama untuk dihemat.`)
      if (mom) out.push(`- Pertumbuhan bulan ke bulan: ${mom}.`)
      out.push('- Periksa apakah harga per pekerjaan sudah menutup biaya tenaga, bahan, dan transport dengan margin minimal 30%.')
      out.push('### Rekomendasi')
      out.push('1. Negosiasikan harga bahan untuk pembelian bulanan, bukan per pekerjaan.')
      out.push('2. Gabungkan pekerjaan di area yang sama pada hari yang sama untuk menekan transport.')
      out.push('3. Naikkan harga 5–10% untuk layanan dengan permintaan tertinggi.')
    } else if (agent === 'pertumbuhan') {
      out.push('### Target dan kebutuhan')
      if (target) out.push(`- ${target}`)
      if (nextMonth) out.push(`- ${nextMonth}`)
      if (m12) out.push(`- Bulan ke-12: ${m12}`)
      if (mom) out.push(`- Pertumbuhan aktual Anda: ${mom}.`)
      out.push('- Patokan: UKM sehat tumbuh **1–2% per bulan**; enterprise menargetkan **5–10%**.')
      out.push('### Cara mencapainya')
      out.push(`1. Tawarkan ulang layanan ke pelanggan lama${repeat ? ` (saat ini ${repeat})` : ''}.`)
      out.push(`2. Dorong layanan teratas${topService ? `: ${topService.split(';')[0]}` : ''}.`)
      out.push('3. Pastikan kapasitas tim cukup sebelum menambah promosi.')
    } else if (agent === 'pemasaran') {
      out.push('### Peluang pemasaran')
      if (topService) out.push(`- Layanan dengan pendapatan terbesar: ${topService.split(';')[0]}. Jadikan pesan utama promosi.`)
      if (repeat) out.push(`- Pelanggan berulang: ${repeat}. Paket langganan bisa menaikkan angka ini.`)
      if (topCustomer) out.push(`- Pelanggan teratas: ${topCustomer.split(';')[0]}. Minta testimoni dan referral.`)
      out.push('### Rekomendasi')
      out.push('1. Kirim pesan WhatsApp pengingat perawatan ke pelanggan yang selesai 2–3 bulan lalu.')
      out.push('2. Minta ulasan Google Maps setiap pekerjaan selesai.')
      out.push('3. Buat promo musiman dengan kuota terbatas agar kapasitas tetap terjaga.')
    } else if (agent === 'operasional') {
      out.push('### Kondisi alur kerja')
      if (pending) out.push(`- ${pending}.`)
      if (conversion) out.push(`- ${conversion}.`)
      out.push('### Rekomendasi')
      out.push('1. Tetapkan batas waktu: penawaran dikirim maksimal 24 jam setelah permintaan masuk.')
      out.push('2. Jadwalkan pekerjaan per wilayah agar teknisi tidak bolak-balik.')
      out.push('3. Bukukan penyelesaian di hari yang sama supaya laporan selalu akurat.')
    } else {
      out.push('### Gambaran singkat')
      for (const line of numericLines.slice(0, 4)) out.push(`- ${line}`)
      out.push('### Prioritas')
      out.push(`1. Selesaikan pekerjaan tertunda${pending ? ` (${pending.split(',')[0]})` : ''}.`)
      out.push('2. Jaga margin dengan meninjau biaya terbesar setiap bulan.')
      out.push('3. Tetapkan target pertumbuhan 1–2% per bulan dan pantau di halaman ini.')
    }
  }
  out.push('### Langkah minggu ini')
  out.push('- Pilih satu rekomendasi di atas, tetapkan angkanya, dan cek hasilnya di Laporan minggu depan.')
  out.push(SIM_NOTE)
  return out.join('\n\n').replace(/\n\n(?=- |\d+\. )/g, '\n')
}

function socialMockAnswer(question, ctx) {
  const q = String(question || '').toLowerCase()
  const { grab, numericLines } = contextReader(ctx)
  const service = grab('Layanan') || grab('Layanan teratas')?.split(/\s+Rp/)[0] || 'servis AC'
  const out = []
  if (/ide|brainstorm|konten apa/.test(q)) {
    out.push(`### Ide konten untuk ${service}`)
    out.push('1. **Sebelum dan sesudah**: video 15 detik proses pengerjaan, tutup dengan hasil akhir.')
    out.push('2. **Tips perawatan**: carousel "5 tanda perangkat Anda perlu diservis".')
    out.push('3. **Di balik layar**: kenalkan teknisi dan standar kerja tim.')
    out.push('4. **Testimoni pelanggan**: kutipan singkat dan foto hasil kerja (dengan izin).')
    out.push('5. **Promo musiman**: kuota terbatas minggu ini, ajak pesan lewat WhatsApp.')
  } else if (/hashtag|tagar/.test(q)) {
    out.push('### Hashtag yang disarankan')
    out.push('#jasaprofesional #servisac #perawatanrumah #jasabersih #layananlokal #pesanviawa')
  } else if (/iklan|ads|meta/.test(q)) {
    out.push('### Rekomendasi iklan')
    out.push('- **Target**: pemilik rumah dan kantor kecil, usia 25–55, radius 10 km dari area layanan.')
    out.push('- **Anggaran awal**: Rp50.000 per hari selama 7 hari, lalu evaluasi biaya per chat WhatsApp.')
    out.push('- **Pesan utama**: jadwal cepat, harga transparan, garansi kerja.')
  } else {
    out.push(`### Caption untuk ${service}`)
    out.push(`Rumah nyaman dimulai dari perawatan yang tepat. Tim kami menangani ${service} dengan rapi, tepat waktu, dan bergaransi.`)
    out.push('Jadwal minggu ini masih tersedia. Kirim pesan WhatsApp untuk cek harga tanpa biaya survei.')
    out.push('#jasaprofesional #perawatanrumah #layananlokal')
  }
  if (numericLines.length) out.push(`Angka dari konteks Anda: ${numericLines.slice(0, 2).join('; ')}.`)
  out.push(SIM_NOTE)
  return out.join('\n\n').replace(/\n\n(?=- |\d+\. )/g, '\n')
}

/* json_schema requests: return valid JSON with the schema's keys filled in. */
function sampleString(key, i = 0) {
  const k = String(key).toLowerCase()
  const pick = (arr) => arr[i % arr.length]
  if (/hashtag|tag/.test(k)) return pick(['#jasaprofesional', '#servisac', '#perawatanrumah', '#jasabersih', '#layananlokal'])
  if (/platform/.test(k)) return pick(['instagram', 'tiktok', 'facebook'])
  if (/caption|body|isi|konten|content|text|copy|naskah/.test(k)) return pick(['Rumah nyaman dimulai dari perawatan yang tepat. Jadwal minggu ini masih tersedia, pesan lewat WhatsApp.', 'Tim kami datang tepat waktu, bekerja rapi, dan memberi garansi. Cek harga tanpa biaya survei.', 'Perawatan rutin membuat perangkat awet dan tagihan listrik lebih hemat. Tanyakan paket langganan kami.'])
  if (/title|judul|name|nama|hook|headline/.test(k)) return pick(['Sebelum dan sesudah perawatan', 'Lima tanda perlu servis', 'Kenalan dengan tim lapangan', 'Promo kuota terbatas'])
  if (/cta|ajakan/.test(k)) return 'Pesan lewat WhatsApp hari ini'
  if (/time|jam|waktu/.test(k)) return pick(['09:00', '12:30', '19:00'])
  if (/date|tanggal/.test(k)) return new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10)
  if (/agent|route|kategori|category|type|jenis|format/.test(k)) return pick(['umum', 'reels', 'carousel'])
  if (/reason|alasan|why|insight|catatan|notes|summary|ringkas/.test(k)) return 'Simulasi lokal: nilai contoh yang dibuat dari skema, bukan dari model AI.'
  if (/prompt/.test(k)) return 'Foto produk jasa di rumah modern, cahaya alami, gaya fotografi komersial, ruang kosong untuk teks'
  return `Contoh ${k.replace(/_/g, ' ')} (simulasi lokal)`
}

function sampleNumber(key, schema, i = 0) {
  const k = String(key).toLowerCase()
  let n = /price|harga|budget|anggaran|biaya|amount|nilai/.test(k) ? 150000 + i * 50000
    : /rate|persen|pct|percent|score|skor/.test(k) ? 4 + i
      : /count|jumlah|total|reach|jangkauan/.test(k) ? 120 + i * 40
        : 1 + i
  if (typeof schema.minimum === 'number') n = Math.max(n, schema.minimum)
  if (typeof schema.maximum === 'number') n = Math.min(n, schema.maximum)
  return schema.type === 'integer' ? Math.round(n) : n
}

function sampleFromSchema(schema = {}, key = 'nilai', depth = 0, i = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return null
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[i % schema.enum.length]
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type
    || (schema.properties ? 'object' : schema.items ? 'array' : 'string')
  if (type === 'object') {
    const props = schema.properties || {}
    const keys = [...new Set([...(schema.required || []), ...Object.keys(props)])]
    return Object.fromEntries(keys.map(k => [k, sampleFromSchema(props[k] || { type: 'string' }, k, depth + 1, i)]))
  }
  if (type === 'array') {
    const min = Number.isInteger(schema.minItems) ? schema.minItems : 3
    const max = Number.isInteger(schema.maxItems) ? schema.maxItems : Math.max(min, 5)
    const n = Math.max(1, Math.min(Math.max(min, 3), max))
    return Array.from({ length: n }, (_, j) => sampleFromSchema(schema.items || { type: 'string' }, key, depth + 1, j))
  }
  if (type === 'integer' || type === 'number') return sampleNumber(key, { ...schema, type }, i)
  if (type === 'boolean') return true
  return sampleString(key, i)
}

function schemaJson(responseFormat) {
  const rf = responseFormat || {}
  const schema = rf.json_schema?.schema || rf.json_schema || { type: 'object', properties: { hasil: { type: 'string' } } }
  return JSON.stringify(sampleFromSchema(schema, 'hasil'), null, 2)
}

const lastUserText = (messages) => [...messages].reverse().find(m => m.role === 'user')?.content || ''

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
        const isOffer = messages.some(m => m.role === 'system' && m.content.includes('agen penawaran')) || userMsg.includes('Permintaan jasa')
        if (isOffer) return mockStreamOffer(parseRequest(userMsg))
        if (response_format?.type === 'json_schema' || response_format?.type === 'json_object') {
          return streamText(schemaJson(response_format), { step: 10, delay: 14 })
        }
        const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
        const agent = system.match(/\[agent:([\w-]+)\]/)?.[1]
        if (agent === 'social') return streamText(socialMockAnswer(lastUserText(messages), system))
        if (agent) return streamText(advisorMockAnswer(agent, lastUserText(messages), system))
        const sysMsg = system
        if (sysMsg.includes('analis laporan') || userMsg.includes('Data laporan')) return mockStreamExplain(parseReport(userMsg))
        if (sysMsg.includes('social media') || sysMsg.includes('media sosial')) return mockStreamSocial(lastUserText(messages))
        if (sysMsg.includes('pertumbuhan') || sysMsg.includes('business development')) return mockStreamPertumbuhan(lastUserText(messages))
        if (sysMsg.includes('analis bisnis')) return mockStreamAnalyst(lastUserText(messages))
        if (sysMsg.includes('Asisten AI') || sysMsg.includes('asisten AI')) return mockStreamGeneral(lastUserText(messages))
        return mockStreamExplain(parseReport(userMsg))
      }
    }
  }
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
    if (legacy) { addSeedWorkers(state, daysAgo); saveState(state) }
    return
  }

  // --- Requests ---
  state.requests = [
    { id: 1001, customer_name: 'PT Maju Jaya', service_type: 'Pembersihan AC', requested_at: daysAgo(14), location: 'Jakarta Selatan', description: 'Pembersihan 15 unit AC split untuk kantor 3 lantai. Termasuk servis ringan dan penggantian filter.', created_at: daysAgo(14) },
    { id: 1002, customer_name: 'Rumah Bapak Surya', service_type: 'Cuci Sofa & Karpet', requested_at: daysAgo(12), location: 'Bandung', description: 'Cuci sofa 3 set dan karpet 2 pcs untuk rumah tinggal.', created_at: daysAgo(12) },
    { id: 1003, customer_name: 'Kost exclusive 99', service_type: 'Pembersihan Kolam Renang', location: 'Depok', description: 'Perawatan rutin kolam renang bulanan, termasuk pengecekan pH dan backwash.', created_at: daysAgo(10) },
    { id: 1004, customer_name: 'PT Sinar Abadi', service_type: 'Pest Control', location: 'Tangerang', description: 'Pengendalian hama rayap dan kecoa untuk gudang 500m2.', created_at: daysAgo(8) },
    { id: 1005, customer_name: 'Apartemen GreenView', service_type: 'Pembersihan Kaca Gedung', location: 'Jakarta Pusat', description: 'Pembersihan kaca eksterior 12 lantai menggunakan gondola.', created_at: daysAgo(6) },
    { id: 1006, customer_name: 'Resto Nusantara', service_type: 'Ducting & Exhaust Cleaning', location: 'Surabaya', description: 'Pembersihan ducting dan exhaust fan dapur restoran.', created_at: daysAgo(4) },
    { id: 1007, customer_name: 'Hotel Grand Lestari', service_type: 'Deep Cleaning Kamar', location: 'Yogyakarta', description: 'Deep cleaning 50 kamar hotel setelah musim liburan.', created_at: daysAgo(2) },
    { id: 1008, customer_name: 'Villa Bukit Asri', service_type: 'Pembersihan Taman & Kolam', location: 'Bogor', description: 'Perawatan taman landscape dan kolam ikan koi.', created_at: daysAgo(1) },
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

  state.users = [{ id: 'demo-user', email: 'demo@satualur.id', name: 'Demo User', created_at: daysAgo(30) }]
  state._seeded = true
  saveState(state)
  console.log('[Mock Cloud] Demo data seeded: 8 requests, 7 offers, 6 assignments, 4 completions, 12 ledger entries, 6 workers')
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
