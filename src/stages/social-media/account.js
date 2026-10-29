import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'

const { el } = C
const OLD_CONTENT = 'satualur_saved_content'
const OLD_SCHEDULES = 'satualur_schedules'
const MIGRATED = 'satualur_social_migrated'

function readOld(key) {
  try {
    const items = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(items) ? items : []
  } catch { return [] }
}

// Old localStorage items that still need moving to the account, or null when there is nothing (or it was done).
function legacyRows() {
  try { if (localStorage.getItem(MIGRATED)) return null } catch { return null }
  const rows = [
    ...readOld(OLD_CONTENT).map((i) => ({ kind: i?.type === 'brainstorm' ? 'brainstorm' : 'content', body: i?.content })),
    ...readOld(OLD_SCHEDULES).map((i) => ({ kind: 'content', body: i?.content })),
  ].filter((r) => typeof r.body === 'string' && r.body.trim())
  return rows.length ? rows : null
}

function connectPanel(ctx) {
  const { account, configured, status } = ctx
  const button = (label, extra = {}) => C.button({ label, icon: 'plug', variant: 'primary', ...extra })
  const run = async (btn, busy, fn) => {
    const restore = C.setBusy(btn, busy)
    status.hide()
    try { await fn() } catch (err) { status.show('danger', err.message) } finally { restore() }
  }
  const connect = (label) => {
    const btn = button(label)
    btn.addEventListener('click', () => run(btn, 'Menghubungkan…', async () => {
      await Social.startConnect()
      await ctx.refresh() // demo mode connects in place; the real flow navigates away
    }))
    return btn
  }
  if (!configured) {
    return C.panel({ title: 'Akun Meta', raised: true },
      el('p', {}, 'Integrasi Meta belum dikonfigurasi oleh admin.'),
      el('div', { className: 'form-actions' }, button('Hubungkan Facebook & Instagram', { disabled: true })))
  }
  if (!account) {
    return C.panel({ title: 'Akun Meta', meta: 'Belum terhubung', raised: true },
      el('p', {}, 'Hubungkan Page Facebook Anda (dan akun Instagram Bisnis yang tertaut) untuk membagikan konten langsung dari sini.'),
      el('div', { className: 'form-actions' }, connect('Hubungkan Facebook & Instagram')))
  }
  const off = C.button({ label: 'Putuskan', icon: 'x', variant: 'ghost' })
  off.addEventListener('click', () => {
    if (!confirm(`Putuskan ${account.page_name}? Jadwal yang belum tayang tidak akan terkirim.`)) return
    run(off, 'Memutuskan…', async () => {
      await Social.disconnect()
      await ctx.refresh()
      showToast('Akun diputuskan.', 'success')
    })
  })
  return C.panel({ title: 'Akun Meta', meta: 'Terhubung', raised: true },
    C.defList([
      ['Page Facebook', account.page_name],
      ['Instagram', account.ig_username ? `@${account.ig_username}` : 'Hubungkan akun Instagram Bisnis ke Page ini'],
    ]),
    account.needs_reconnect ? el('div', { className: 'note note-warn', role: 'status' }, C.icon('alert'),
      el('div', { className: 'note-body' }, el('p', {}, 'Koneksi ke Meta perlu diperbarui sebelum Anda bisa membagikan konten.'))) : null,
    el('div', { className: 'form-actions' }, account.needs_reconnect ? connect('Hubungkan ulang') : null, off))
}

function pickPanel(ctx) {
  const list = el('div', {}, C.skeletonRows(2))
  Social.listPagesToPick(ctx.pick).then((pages) => {
    if (ctx.signal.aborted) return
    list.replaceChildren(...(pages.length ? pages : []).map((pg) => {
      const btn = C.button({ label: 'Pilih', variant: 'soft', size: 'sm', 'aria-label': `Pilih ${pg.name}` })
      btn.addEventListener('click', async () => {
        const restore = C.setBusy(btn, 'Memilih…')
        try {
          await Social.pickPage(ctx.pick, pg.id)
          ctx.clearPick()
          await ctx.refresh()
        } catch (err) { ctx.status.show('danger', err.message); restore() }
      })
      return el('article', { className: 'workspace-entry' }, el('strong', {}, pg.name),
        el('p', { className: 'muted small' }, pg.ig_username ? `Instagram @${pg.ig_username}` : 'Tanpa akun Instagram Bisnis'), btn)
    }))
    if (!pages.length) list.replaceChildren(C.emptyState({ title: 'Tidak ada Page', body: 'Akun Meta ini belum mengelola Page Facebook.' }))
  }).catch((err) => { if (!ctx.signal.aborted) list.replaceChildren(C.errorState(err.message)) })
  return C.panel({ title: 'Pilih Page', meta: 'Beberapa Page ditemukan' }, list)
}

function importPanel(ctx, rows) {
  const btn = C.button({ label: 'Pindahkan ke akun', icon: 'save', variant: 'soft' })
  btn.addEventListener('click', async () => {
    const restore = C.setBusy(btn, 'Memindahkan…')
    ctx.status.hide()
    try {
      for (const r of rows) await Social.saveContent(r)
      try { localStorage.setItem(MIGRATED, '1') } catch { /* storage unavailable */ }
      showToast(`${rows.length} konten dipindahkan ke akun.`, 'success')
      await ctx.refresh()
    } catch (err) {
      ctx.status.show('danger', err.message)
      restore()
    }
  })
  return C.panel({ title: 'Konten lama di browser ini', meta: `${rows.length} item` },
    el('p', {}, 'Konten dan jadwal lama masih tersimpan di browser ini. Pindahkan ke akun agar bisa dipakai di perangkat lain. Data lama tidak dihapus.'),
    el('div', { className: 'form-actions' }, btn))
}

export function render(host, ctx) {
  const legacy = legacyRows()
  host.replaceChildren(el('div', { className: 'workspace-stack' },
    ctx.pick ? pickPanel(ctx) : null,
    connectPanel(ctx),
    legacy ? importPanel(ctx, legacy) : null))
}
