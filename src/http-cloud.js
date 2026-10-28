/**
 * HTTP Cloud — klien untuk API Cloudflare Worker + D1 (same-origin, /api/*).
 * Antarmuka sama dengan mock cloud: auth, database (builder ala supabase), llm.
 */

const TOKEN_KEY = 'satualur_token'

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage tidak tersedia */ }
}

function authHeaders(extra = {}) {
  const token = getToken()
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}

// Panggil endpoint JSON; tidak pernah throw — selalu {data, count, error}
async function request(path, { method = 'GET', body, signal } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
    let json = null
    try { json = await res.json() } catch { /* body kosong / bukan JSON */ }
    if (!res.ok) {
      const message = json?.error?.message || (typeof json?.error === 'string' ? json.error : null) || json?.message || `HTTP ${res.status}`
      return { data: null, error: { message, status: res.status } }
    }
    return { data: json?.data ?? null, count: json?.count, error: json?.error ?? null }
  } catch (e) {
    return { data: null, error: { message: e?.message || 'Jaringan bermasalah.' } }
  }
}

let _sessionCb = null
function notifyAuth(event, session) {
  if (_sessionCb) _sessionCb(event, session)
}

const httpAuth = {
  async sendOtp({ email }) {
    if (!email || !email.includes('@')) throw new Error('Email tidak valid.')
    const res = await request('/api/auth/send-otp', { method: 'POST', body: { email } })
    if (res.error) return { data: null, error: res.error }
    const { demoCode } = res.data || {}
    // Mode demo: server mengembalikan kode agar UI bisa menampilkannya
    if (demoCode) {
      window.dispatchEvent(new CustomEvent('mock-otp-sent', { detail: { email, code: demoCode } }))
    }
    return { data: { verificationId: res.data.verificationId, isExistingUser: res.data.isExistingUser }, error: null }
  },

  async verifyOtp({ email, verificationId, token }) {
    const res = await request('/api/auth/verify-otp', { method: 'POST', body: { email, verificationId, token } })
    if (res.error) throw new Error(res.error.message)
    const { user, access_token } = res.data
    setToken(access_token)
    notifyAuth('SIGNED_IN', { user, access_token })
    return { data: { user }, error: null }
  },

  async getSession() {
    const token = getToken()
    if (!token) return { data: null, error: { message: 'Belum masuk.' } }
    const res = await request('/api/auth/session')
    if (res.error || !res.data?.user) {
      if (res.error?.status === 401) setToken(null)
      return { data: null, error: res.error || { message: 'Belum masuk.' } }
    }
    return { data: { user: res.data.user, access_token: token }, error: null }
  },

  async refreshSession() {
    return httpAuth.getSession()
  },

  async getUser() {
    return httpAuth.getSession()
  },

  onAuthStateChange(cb) {
    _sessionCb = cb
    return () => { _sessionCb = null }
  },

  async signOut() {
    if (getToken()) await request('/api/auth/signout', { method: 'POST' })
    setToken(null)
    notifyAuth('SIGNED_OUT', null)
    return { error: null }
  },

  // OAuth stubs (tidak tersedia)
  async signInWithOAuth() { throw new Error('OAuth tidak tersedia.') },
  async handleWechatWebCallback() { throw new Error('OAuth tidak tersedia.') },
  async handleWorkBuddyCallback() { throw new Error('OAuth tidak tersedia.') },
}

const httpDatabase = {
  from(table) {
    const q = { table, action: 'select', columns: '*', filters: [] }
    const addFilter = (op, col, val) => { q.filters.push({ op, col, val }); return builder }
    const builder = {
      select(columns = '*', opts = {}) {
        // select() setelah insert/update/delete = minta baris hasil (returning)
        if (q.action === 'select') {
          q.count = opts.count
          q.head = opts.head
        }
        q.columns = columns
        return builder
      },
      eq: (col, val) => addFilter('eq', col, val),
      neq: (col, val) => addFilter('neq', col, val),
      gt: (col, val) => addFilter('gt', col, val),
      gte: (col, val) => addFilter('gte', col, val),
      lt: (col, val) => addFilter('lt', col, val),
      lte: (col, val) => addFilter('lte', col, val),
      like: (col, val) => addFilter('like', col, val),
      ilike: (col, val) => addFilter('ilike', col, val),
      is: (col, val) => addFilter('is', col, val),
      in: (col, arr) => addFilter('in', col, arr),
      match(obj) {
        // match(obj) = rangkaian eq per kolom
        for (const [col, val] of Object.entries(obj || {})) q.filters.push({ op: 'eq', col, val })
        return builder
      },
      // Tidak ada stage yang memakai .or() dan server tidak mendukungnya
      or() { throw new Error('.or() tidak didukung oleh API.') },
      order(col, { ascending = true } = {}) { q.order = { col, asc: ascending }; return builder },
      limit(n) { q.limit = n; return builder },
      range(from, to) { q.range = [from, to]; return builder },
      single() { q.single = true; return builder },
      maybeSingle() { q.maybeSingle = true; return builder },
      insert(items) {
        q.action = 'insert'
        q.values = Array.isArray(items) ? items : [items]
        return builder
      },
      update(changes) { q.action = 'update'; q.changes = changes; return builder },
      delete() { q.action = 'delete'; return builder },

      // Awaitable: satu panggilan POST /api/db
      then(resolve, reject) {
        return request('/api/db', { method: 'POST', body: q }).then(resolve, reject)
      },
    }
    return builder
  },

  rpc() {
    return { then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve) }
  },
}

// Parse stream SSE (`data: {...}` + `[DONE]`) menjadi chunk gaya OpenAI
export async function* parseSSE(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = done ? '' : lines.pop()
      if (done && lines.length && lines[lines.length - 1] === '') lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        if (payload === '[DONE]') return
        let chunk
        try { chunk = JSON.parse(payload) } catch { continue }
        if (chunk.error) throw new Error(chunk.error.message || String(chunk.error))
        yield chunk
      }
      if (done) return
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
}

const httpLLM = {
  models: {
    async list() {
      return request('/api/llm/models')
    },
  },
  chat: {
    completions: {
      async *create({ model, messages, temperature, max_tokens, response_format, signal }) {
        let res
        try {
          res = await fetch('/api/llm/chat', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ model, messages, temperature, max_tokens, response_format }),
            signal,
          })
        } catch (e) {
          if (e.name === 'AbortError') throw e
          throw new Error(e?.message || 'Jaringan bermasalah.')
        }
        if (!res.ok) {
          let message = `HTTP ${res.status}`
          try {
            const j = await res.json()
            message = j?.error?.message || (typeof j?.error === 'string' ? j.error : null) || j?.message || message
          } catch { /* bukan JSON */ }
          throw new Error(message)
        }
        if (!res.body) throw new Error('Respons AI kosong.')
        yield* parseSSE(res.body)
      },
    },
  },
}

export function createHttpCloud() {
  return {
    auth: httpAuth,
    database: httpDatabase,
    llm: httpLLM,
  }
}
