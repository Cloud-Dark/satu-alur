/**
 * Pendapatan (VAS + zero waste) — one set of rules, three callers.
 *
 * The Worker (`worker/index.js`), the mock cloud and both stages import this
 * module, so a row that the form accepts can never be one the database
 * rejects. Everything here is pure: no DOM, no fetch, no globals.
 *
 * Errors carry `validation: true` (the convention from business/plan-rules.js)
 * so the Worker can turn them into 400s and let real bugs surface as 500s.
 * All messages are Indonesian because they are shown to the user verbatim.
 */

/* ------------------------------------------------------------------ Enums */

export const VAS_CATEGORY_KEYS = ['perawatan', 'perlindungan', 'peningkatan', 'kecepatan', 'paket', 'lain']
export const VAS_STATUS_KEYS = ['active', 'draft', 'retired']
export const WASTE_STREAM_KEYS = ['waktu', 'perjalanan', 'bahan', 'pengerjaan_ulang', 'air_kimia']
export const WASTE_STATUS_KEYS = ['open', 'progress', 'done']

/* ----------------------------------------------------------------- Limits */

/** Rp1 miliar: far above any real add-on or monthly leak, low enough to catch typos. */
const MAX_MONEY = 1_000_000_000

export const LIMITS = {
  name: 80,
  description: 400,
  attachTo: 80,
  title: 120,
  detail: 1000,
  action: 500,
  owner: 80,
  maxMoney: MAX_MONEY,
  /** Rows accepted in one bulk paste. Matches the Worker's MAX_INSERT_ROWS. */
  importRows: 100,
  /** Per-owner ceilings: a catalog of 500 add-ons is already unusual. */
  items: 500,
  findings: 2000,
}

/* ---------------------------------------------------------------- Helpers */

function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}

/** Trim + collapse internal whitespace (a pasted spreadsheet has both). */
function text(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

/**
 * Money from a number or a pasted string ("Rp 450.000" → 450000).
 * Digits only on purpose: Indonesian uses "." for thousands, never decimals.
 */
export function moneyInt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : NaN
  const raw = String(value ?? '').trim().replace(/^Rp\s*/i, '')
  if (!raw) return 0
  if (!/^-?\d+(?:[.\s]\d+)*$/.test(raw)) return NaN
  return Number(raw.replace(/[.\s]/g, ''))
}

/** Whole percent 0..100 from "25", "25%", 25 or 0.25. */
export function percentInt(value) {
  if (value === '' || value === null || value === undefined) return NaN
  let n
  if (typeof value === 'number') n = value
  else {
    const cleaned = String(value).trim().replace(/%$/, '').trim().replace(',', '.')
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return NaN
    n = Number(cleaned)
  }
  if (!Number.isFinite(n)) return NaN
  // 0.25 means a fraction (25%), 1 means one percent: the field is labelled "%".
  const pct = n > 0 && n < 1 ? n * 100 : n
  return Math.round(Math.min(100, Math.max(0, pct)))
}

const present = (input, key) => input != null && Object.hasOwn(input, key) && input[key] !== undefined

function boundedText(out, input, key, label, max, { required = false } = {}) {
  const value = text(input[key])
  if (required && !value) fail(`${label} wajib diisi.`)
  if (required && value.length < 2) fail(`${label} minimal 2 karakter.`)
  if (value.length > max) fail(`${label} maksimal ${max} karakter.`)
  out[key] = value || null
}

/* --------------------------------------------------------------- VAS rows */

/**
 * Validates and normalises one `vas_items` row.
 * `partial: true` validates only the keys present (updates).
 * Returns a plain object with integers for money and attach_rate.
 */
export function validateVasItem(input, { partial = false } = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const out = {}

  if (!partial || present(src, 'name')) boundedText(out, src, 'name', 'Nama item', LIMITS.name, { required: true })

  if (!partial || present(src, 'category')) {
    const category = text(src.category) || 'lain'
    if (!VAS_CATEGORY_KEYS.includes(category)) fail('Kategori item tidak dikenal.')
    out.category = category
  }

  if (!partial || present(src, 'price')) {
    const price = moneyInt(src.price)
    if (!Number.isFinite(price) || price <= 0) fail('Harga jual harus lebih dari nol.')
    if (price > MAX_MONEY) fail(`Harga jual maksimal Rp${MAX_MONEY.toLocaleString('id-ID')}.`)
    out.price = price
  }

  if (!partial || present(src, 'cost')) {
    const cost = src.cost === '' || src.cost === null || src.cost === undefined ? 0 : moneyInt(src.cost)
    if (!Number.isFinite(cost) || cost < 0) fail('Biaya langsung tidak boleh negatif.')
    if (cost > MAX_MONEY) fail(`Biaya langsung maksimal Rp${MAX_MONEY.toLocaleString('id-ID')}.`)
    out.cost = cost
  }

  if (!partial || present(src, 'attach_to')) {
    const attachTo = text(src.attach_to)
    if (attachTo.length > LIMITS.attachTo) fail(`Nama layanan induk maksimal ${LIMITS.attachTo} karakter.`)
    out.attach_to = attachTo || null
  }

  if (!partial || present(src, 'attach_rate')) {
    const raw = src.attach_rate === '' || src.attach_rate === null || src.attach_rate === undefined ? 25 : percentInt(src.attach_rate)
    if (!Number.isFinite(raw)) fail('Tingkat pasang harus angka 0 sampai 100.')
    out.attach_rate = raw
  }

  if (!partial || present(src, 'description')) {
    const description = text(src.description)
    if (description.length > LIMITS.description) fail(`Penjelasan maksimal ${LIMITS.description} karakter.`)
    out.description = description || null
  }

  if (!partial || present(src, 'status')) {
    const status = text(src.status) || 'active'
    if (!VAS_STATUS_KEYS.includes(status)) fail('Status item tidak dikenal.')
    out.status = status
  }

  return out
}

/* ------------------------------------------------------------- Waste rows */

/**
 * Validates and normalises one `waste_entries` row.
 * Invariants enforced here (and by CHECK constraints in D1):
 *   monthly_loss > 0, 0 <= saved <= monthly_loss, status in the enum.
 * A `done` finding is fully saved by definition, so saved is set to the loss.
 */
export function validateWasteEntry(input, { partial = false } = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const out = {}

  if (!partial || present(src, 'stream')) {
    const stream = text(src.stream) || 'waktu'
    if (!WASTE_STREAM_KEYS.includes(stream)) fail('Sumber pemborosan tidak dikenal.')
    out.stream = stream
  }

  if (!partial || present(src, 'title')) {
    const title = text(src.title)
    if (!title) fail('Judul temuan wajib diisi.')
    if (title.length < 3) fail('Judul temuan minimal 3 karakter.')
    if (title.length > LIMITS.title) fail(`Judul temuan maksimal ${LIMITS.title} karakter.`)
    out.title = title
  }

  if (!partial || present(src, 'detail')) {
    const detail = text(src.detail)
    if (detail.length > LIMITS.detail) fail(`Keterangan maksimal ${LIMITS.detail} karakter.`)
    out.detail = detail || null
  }

  if (!partial || present(src, 'monthly_loss')) {
    const loss = moneyInt(src.monthly_loss)
    if (!Number.isFinite(loss) || loss <= 0) fail('Kerugian per bulan harus lebih dari nol.')
    if (loss > MAX_MONEY) fail(`Kerugian per bulan maksimal Rp${MAX_MONEY.toLocaleString('id-ID')}.`)
    out.monthly_loss = loss
  }

  if (!partial || present(src, 'saved')) {
    const saved = src.saved === '' || src.saved === null || src.saved === undefined ? 0 : moneyInt(src.saved)
    if (!Number.isFinite(saved) || saved < 0) fail('Nilai yang sudah dihentikan tidak boleh negatif.')
    if (saved > MAX_MONEY) fail(`Nilai yang sudah dihentikan maksimal Rp${MAX_MONEY.toLocaleString('id-ID')}.`)
    out.saved = saved
  }

  if (!partial || present(src, 'action')) {
    const action = text(src.action)
    if (action.length > LIMITS.action) fail(`Tindakan maksimal ${LIMITS.action} karakter.`)
    out.action = action || null
  }

  if (!partial || present(src, 'owner')) {
    const owner = text(src.owner)
    if (owner.length > LIMITS.owner) fail(`Pemilik tindakan maksimal ${LIMITS.owner} karakter.`)
    out.owner = owner || null
  }

  if (!partial || present(src, 'status')) {
    const status = text(src.status) || 'open'
    if (!WASTE_STATUS_KEYS.includes(status)) fail('Status temuan tidak dikenal.')
    out.status = status
  }

  return out
}

/**
 * Cross-field checks that need the *effective* row (insert, or update merged
 * with the stored row). Kept separate so a partial update can be validated
 * against the row it will produce rather than in isolation.
 */
export function assertWasteInvariants(row) {
  const loss = Number(row.monthly_loss)
  const saved = Number(row.saved) || 0
  if (saved > loss) fail('Yang sudah dihentikan tidak boleh melebihi kerugian tercatat.')
  if (row.status === 'done' && saved !== loss) fail('Temuan yang selesai harus dihitung terhenti penuh.')
  return row
}

/** A `done` finding saves the whole loss; used before validating an update. */
export function withWasteCompletion(row) {
  const next = { ...row }
  if (next.status === 'done') next.saved = Number(next.monthly_loss) || 0
  return next
}

/* --------------------------------------------------------------- Imports */

export const vasKey = (name) => text(name).toLowerCase()
export const wasteKey = (title) => text(title).toLowerCase()

/**
 * Splits parsed import rows into new and duplicate ones (by normalised name /
 * title against what is already stored). Importing the same spreadsheet twice
 * must not double the catalog.
 */
export function splitDuplicates(rows, existing, keyOf) {
  const seen = new Set((existing || []).map((r) => keyOf(r)))
  const fresh = []
  const duplicates = []
  for (const row of rows || []) {
    const key = keyOf(row)
    if (seen.has(key)) duplicates.push(row)
    else { seen.add(key); fresh.push(row) }
  }
  return { fresh, duplicates }
}

/** Guard the batch size before it reaches the Worker's MAX_INSERT_ROWS. */
export function assertImportSize(count) {
  if (!Number.isFinite(count) || count <= 0) fail('Tidak ada data untuk diimpor.')
  if (count > LIMITS.importRows) fail(`Maksimal ${LIMITS.importRows} baris per impor. Bagi berkas menjadi beberapa bagian.`)
  return count
}
