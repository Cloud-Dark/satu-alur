/**
 * Invoice data access. Rows go through the generic data API (owner-scoped in the
 * Worker); the number comes from POST /api/invoices/next-number, which increments
 * a per-business, per-year counter atomically. Mock mode derives it locally.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { signOutIfSuspended } from '../http-cloud.js'
import { computeTotals, formatNumber, nextSeqFrom, revenuePlan, lineAmount } from './rules.js'

const db = () => getCloud().database
const TOKEN_KEY = 'satualur_token'
const token = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

export async function loadInvoices() {
  return check(await db().from('invoices').select('*')) || []
}

export async function loadItems(invoiceId) {
  const rows = check(await db().from('invoice_items').select('*').eq('invoice_id', invoiceId)) || []
  return rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
}

export async function loadSettings() {
  const rows = check(await db().from('invoice_settings').select('*')) || []
  return rows[0] || null
}

export async function saveSettings(current, { payment_info, due_days }) {
  const row = { payment_info: payment_info || null, due_days: Number(due_days) || 14, updated_at: new Date().toISOString() }
  const t = db().from('invoice_settings')
  check(await (current?.id ? t.update(row).eq('id', current.id) : t.insert(row)))
}

export async function nextNumber(year = new Date().getFullYear()) {
  if (isUsingMockCloud()) {
    const existing = await loadInvoices()
    return formatNumber(year, nextSeqFrom(existing.map((i) => i.number), year))
  }
  let res
  try {
    res = await fetch('/api/invoices/next-number', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
      body: JSON.stringify({ year }),
    })
  } catch {
    throw new Error('Jaringan bermasalah. Periksa koneksi lalu coba lagi.')
  }
  let json = null
  try { json = await res.json() } catch { /* not JSON */ }
  if (!res.ok || json?.error) {
    const message = json?.error?.message || `HTTP ${res.status}`
    signOutIfSuspended(res.status, message)
    throw new Error(message)
  }
  return json.data.number
}

/** Saves the invoice and replaces its lines. Returns the saved invoice row. */
export async function saveInvoice(inv, items) {
  const t = computeTotals(items, inv)
  const row = {
    completion_id: Number(inv.completion_id),
    request_id: inv.request_id != null ? Number(inv.request_id) : null,
    number: inv.number,
    customer_name: String(inv.customer_name || '').trim(),
    customer_phone: inv.customer_phone || null,
    customer_email: inv.customer_email || null,
    customer_address: inv.customer_address || null,
    issue_date: inv.issue_date,
    due_date: inv.due_date || null,
    discount: t.discount,
    tax_rate: t.tax_rate,
    subtotal: t.subtotal,
    tax_amount: t.tax_amount,
    total: t.total,
    payment_info: inv.payment_info || null,
    notes: inv.notes || null,
    status: inv.status || 'draft',
  }
  let saved
  if (inv.id) {
    const rows = check(await db().from('invoices').update(row).eq('id', inv.id))
    saved = { ...inv, ...row, ...(Array.isArray(rows) ? rows[0] : {}) , id: inv.id }
    check(await db().from('invoice_items').delete().eq('invoice_id', inv.id))
  } else {
    const rows = check(await db().from('invoices').insert(row)) || []
    saved = rows[0]
    if (!saved) throw new Error('Invoice gagal disimpan.')
  }
  const lines = items.map((it, i) => ({
    invoice_id: Number(saved.id), description: String(it.description).trim(), qty: Number(String(it.qty).replace(',', '.')),
    unit_price: Math.round(Number(it.unit_price) || 0), amount: lineAmount(it), position: i,
  }))
  if (lines.length) check(await db().from('invoice_items').insert(lines))
  return saved
}

export async function setStatus(inv, status, extra = {}) {
  check(await db().from('invoices').update({ status, ...extra }).eq('id', inv.id))
}

/**
 * "Tandai lunas": link the penyelesaian's existing revenue entry or post one
 * (excluding PPN), then mark the invoice paid. Returns { action, amount? }.
 */
export async function markPaid(inv, ledger) {
  const plan = revenuePlan(inv, ledger)
  let ledgerId = plan.ledgerId ?? null
  if (plan.action === 'post') {
    const { data, error } = await db().from('ledger_entries').insert({
      completion_id: Number(inv.completion_id), amount: plan.amount, category: 'pendapatan', status: 'posted', posted_at: new Date().toISOString(),
    })
    if (error) {
      // Another device posted the revenue in the meantime: the Worker refuses a second one.
      if (!/sudah diposting/i.test(error.message)) throw new Error(error.message)
    } else {
      ledgerId = (Array.isArray(data) ? data[0] : data)?.id ?? null
    }
  }
  await setStatus(inv, 'lunas', { paid_at: new Date().toISOString(), ...(ledgerId ? { ledger_entry_id: Number(ledgerId) } : {}) })
  return plan
}
