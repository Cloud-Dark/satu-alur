/**
 * Zero-waste engine.
 *
 * The product goal is blunt: drive five kinds of operational loss to zero, in
 * Rupiah, and show honestly how far along the business is. Every number is
 * computed from rows the user owns (waste_entries + ledger), never estimated
 * by a model.
 *
 * Model of a finding (table `waste_entries`):
 *   stream       one of WASTE_STREAMS[].key
 *   title        what is being lost
 *   detail       how it happens
 *   monthly_loss Rupiah lost per month when the finding was recorded
 *   saved        Rupiah per month already eliminated by the action taken
 *   action       what was done (or will be)
 *   owner        which team owns it
 *   status       open | progress | done
 *
 * Elimination is measured against the *recorded* loss, so a stream that was
 * 100% fixed still counts toward the total instead of vanishing from the
 * denominator — that is what makes "100% bebas limbah" meaningful.
 */

import { WASTE_STATUS_KEYS } from '../pendapatan/rules.js'

export const WASTE_STREAMS = [
  {
    key: 'waktu',
    label: 'Waktu teknisi menganggur',
    short: 'Waktu menganggur',
    icon: 'clock',
    benchmark: 8,
    why: 'Teknisi dibayar untuk menunggu jadwal, menunggu pelanggan, atau menunggu bahan.',
    fix: 'Gabungkan pekerjaan dalam satu zona, tetapkan slot 2 jam, dan isi celah dengan pekerjaan kecil.',
  },
  {
    key: 'perjalanan',
    label: 'Perjalanan & bahan bakar',
    short: 'Perjalanan',
    icon: 'mapPin',
    benchmark: 6,
    why: 'Rute yang tidak diurutkan membuat tim bolak-balik dan membakar bensin serta jam kerja.',
    fix: 'Urutkan kunjungan per zona, tugaskan petugas terdekat, dan hindari jadwal silang antar kota.',
  },
  {
    key: 'bahan',
    label: 'Bahan & consumables',
    short: 'Bahan',
    icon: 'layers',
    benchmark: 5,
    why: 'Dosis berlebih, kemasan terbuang, dan sisa bahan yang tidak terpakai.',
    fix: 'Takaran per pekerjaan, cat sisa per teknisi, dan beli ulang berdasarkan pemakaian nyata.',
  },
  {
    key: 'pengerjaan_ulang',
    label: 'Pekerjaan ulang & panggilan balik',
    short: 'Kerja ulang',
    icon: 'undo',
    benchmark: 4,
    why: 'Kualitas yang tidak konsisten memaksa kunjungan kedua yang tidak dibayar.',
    fix: 'Checklist sebelum meninggalkan lokasi, foto hasil, dan tanda tangan pelanggan.',
  },
  {
    key: 'air_kimia',
    label: 'Air & bahan kimia',
    short: 'Air & kimia',
    icon: 'sprout',
    benchmark: 3,
    why: 'Pencampuran tanpa takaran dan pembilasan berlebih memboroskan air serta kimia.',
    fix: 'Gunakan alat ukur, tablet dosis, dan daur ulang air bilas untuk pekerjaan berat.',
  },
]

export const streamMeta = (key) => WASTE_STREAMS.find((s) => s.key === key) || { key, label: key, short: key, icon: 'sprout', benchmark: 0, why: '', fix: '' }

const STATUS_LABELS = { open: 'Belum ditangani', progress: 'Sedang dikerjakan', done: 'Selesai' }

// Shared with the Worker's CHECK constraint: a status the form offers is
// always one the database accepts.
export const WASTE_STATUSES = WASTE_STATUS_KEYS.map((value) => ({ value, label: STATUS_LABELS[value] }))
export const statusLabel = (v) => WASTE_STATUSES.find((s) => s.value === v)?.label || 'Belum ditangani'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Per-stream and overall elimination.
 *
 * `pct` is eliminated / recorded loss. `freePct` is the same figure expressed
 * as progress toward the product's target of 100% waste-free.
 */
export function computeWaste(entries = [], revenue = 0) {
  const streams = WASTE_STREAMS.map((s) => {
    const rows = entries.filter((e) => e.stream === s.key)
    const loss = rows.reduce((sum, e) => sum + num(e.monthly_loss), 0)
    const saved = rows.reduce((sum, e) => sum + Math.min(num(e.saved), num(e.monthly_loss)), 0)
    const remaining = Math.max(0, loss - saved)
    const pct = loss > 0 ? (saved / loss) * 100 : 0
    return {
      ...s,
      rows,
      loss,
      saved,
      remaining,
      pct,
      shareOfRevenue: revenue > 0 ? (remaining / revenue) * 100 : 0,
      open: rows.filter((e) => e.status !== 'done').length,
      done: rows.filter((e) => e.status === 'done').length,
    }
  })

  const loss = streams.reduce((s, x) => s + x.loss, 0)
  const saved = streams.reduce((s, x) => s + x.saved, 0)
  const remaining = Math.max(0, loss - saved)
  const pct = loss > 0 ? (saved / loss) * 100 : 0

  return {
    streams,
    loss,
    saved,
    remaining,
    pct,
    // Remaining loss as a share of revenue — the number that matters to the P&L.
    lossShare: revenue > 0 ? (remaining / revenue) * 100 : 0,
    open: entries.filter((e) => e.status !== 'done').length,
    done: entries.filter((e) => e.status === 'done').length,
    // What is still winnable per month if every open finding is closed.
    winnable: entries.filter((e) => e.status !== 'done').reduce((s, e) => s + Math.max(0, num(e.monthly_loss) - num(e.saved)), 0),
  }
}

/** Benchmark comparison: is this stream worse or better than a healthy shop? */
export function benchmarkVerdict(stream, revenue) {
  if (!revenue) return { tone: 'neutral', label: 'Belum ada data pendapatan' }
  const share = revenue > 0 ? (stream.remaining / revenue) * 100 : 0
  if (share <= 0) return { tone: 'ok', label: 'Bebas limbah' }
  if (share <= stream.benchmark * 0.5) return { tone: 'ok', label: 'Di bawah patokan' }
  if (share <= stream.benchmark) return { tone: 'warn', label: 'Sesuai patokan' }
  return { tone: 'danger', label: 'Di atas patokan' }
}

/**
 * A 100% target is only credible with a plan attached. Returns the shortest
 * ordered list of actions that would close the largest remaining gaps.
 */
export function closurePlan(computed, limit = 5) {
  return [...computed.streams]
    .filter((s) => s.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, limit)
    .map((s) => ({
      stream: s.key,
      label: s.short,
      remaining: s.remaining,
      action: s.fix,
      pct: s.pct,
    }))
}
