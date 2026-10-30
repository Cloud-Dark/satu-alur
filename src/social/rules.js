/**
 * Aturan murni untuk publikasi Media Sosial (Facebook, Instagram & Threads).
 * Tanpa DOM atau API Node: dipakai bersama oleh browser dan Cloudflare Worker.
 * Unit test: tests/social-rules.test.mjs
 */

export const PLATFORMS = ['facebook', 'instagram', 'threads']

const MIN_LEAD_MS = 60 * 1000
const MAX_LEAD_MS = 75 * 24 * 60 * 60 * 1000
const IG_MIN_RATIO = 0.8
const IG_MAX_RATIO = 1.91
const IG_MAX_CAPTION = 2200
const IG_MAX_HASHTAGS = 30
const TH_MAX_TEXT = 500
const TH_MAX_TAGS = 1
const hashtags = (text) => (text.match(/#\w+/g) || []).length

/** Mengembalikan pesan galat, atau null jika waktu tayang valid. */
export function validateScheduleAt(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'Tanggal dan waktu tidak valid.'
  if (t < now + MIN_LEAD_MS) return 'Waktu tayang minimal 1 menit dari sekarang.'
  if (t > now + MAX_LEAD_MS) return 'Waktu tayang maksimal 75 hari ke depan.'
  return null
}

/** Nilai `datetime-local` (waktu dinding lokal) menjadi ISO UTC. */
export function toUtcIso(localValue) {
  return new Date(localValue).toISOString()
}

/** Instagram hanya menerima gambar dengan rasio 4:5 sampai 1,91:1, caption ≤ 2.200 karakter dan ≤ 30 hashtag. */
export function igEligibility({ hasImage, width, height, caption }) {
  if (!hasImage) return { ok: false, reason: 'Instagram wajib memakai gambar.' }
  const ratio = width / height
  if (!(ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO)) {
    return { ok: false, reason: 'Rasio gambar harus antara 4:5 dan 1,91:1 untuk Instagram.' }
  }
  if (caption.length > IG_MAX_CAPTION) return { ok: false, reason: 'Caption Instagram maksimal 2.200 karakter.' }
  if (hashtags(caption) > IG_MAX_HASHTAGS) return { ok: false, reason: 'Instagram maksimal 30 hashtag.' }
  return { ok: true }
}

/** Threads: teks 1–500 karakter dengan paling banyak 1 tag topik; gambar opsional. */
export function threadsEligibility({ caption }) {
  if (!caption.trim()) return { ok: false, reason: 'Isi konten tidak boleh kosong.' }
  if (caption.length > TH_MAX_TEXT) return { ok: false, reason: 'Threads maksimal 500 karakter.' }
  if (hashtags(caption) > TH_MAX_TAGS) return { ok: false, reason: 'Threads maksimal 1 tag topik.' }
  return { ok: true }
}

export const SCHEDULE_STATUS_LABEL = {
  scheduled: 'Terjadwal',
  publishing: 'Memproses',
  posted: 'Tayang',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
}

export const REQUEST_STATUS_LABEL = {
  new: 'Baru',
  in_progress: 'Diproses',
  done: 'Selesai',
}
