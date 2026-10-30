import '../../styles/landing.css'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListPlans, adminCreatePlan, adminUpdatePlan, adminReorderPlans } from '../../business/api.js'
import { validatePlan, formatPrice } from '../../business/plan-rules.js'
import { renderPlanCard } from '../../business/plan-card.js'
import { PRICING_TIERS } from '../../landing/pricing.js'
import { stampLine } from './site-landing.js'
import { LEAVE_MSG } from './site-doc.js'
import { FEATURES, limitFor } from '../../quota/rules.js'

const { el } = C
const PERIOD_OPTIONS = [{ value: 'month', label: 'Per bulan' }, { value: 'year', label: 'Per tahun' }, { value: 'once', label: 'Sekali bayar' }, { value: 'custom', label: 'Kustom (tanpa akhiran)' }]
const CTA_OPTIONS = [{ value: 'signup', label: 'Daftar / masuk' }, { value: 'contact', label: 'Hubungi kami' }]
let seq = 0

// 'Rp0' -> 0, 'Rp349rb' -> 349000, 'Kustom' -> null.
function priceFromText(s) {
  const m = /(\d+)\s*(rb)?/i.exec(s)
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null
}

const fromTier = (t, i) => {
  const price_idr = priceFromText(t.price)
  return {
    slug: t.id, name: t.name, tagline: t.tagline, price_idr, period: price_idr === null ? 'custom' : 'month', period_label: t.period,
    recommended: t.recommended ? 1 : 0, badge: t.badge || '', limits: t.limits, features: t.features,
    cta_label: t.cta.label, cta_kind: t.cta.href ? 'signup' : 'contact', sort: i + 1, active: 1,
  }
}

function planDialog(ctx, plan, nextSort, opener, onSaved, setDirty) {
  const id = ++seq
  const v = plan || { slug: '', name: '', tagline: '', price_idr: 0, period: 'month', period_label: '', recommended: 0, badge: '', limits: [], features: [], quota: {}, cta_label: 'Pilih paket', cta_kind: 'signup', active: 1 }
  const f = (label, key, extra = {}) => C.field({ label, id: `of-pl-${key}-${id}`, value: v[key] ?? '', ...extra })
  const name = f('Nama paket', 'name', { required: true, attrs: { maxlength: '60' } })
  const slug = f('Slug', 'slug', { required: true, hint: 'Huruf kecil, angka, tanda hubung (2-40 karakter).', attrs: { maxlength: '40' } })
  const tagline = f('Tagline', 'tagline', { attrs: { maxlength: '160' } })
  const price = f('Harga (Rp)', 'price_idr', { type: 'number', hint: 'Kosongkan untuk "Kustom".', attrs: { min: '0', step: '1' } })
  const period = C.select({ label: 'Periode', id: `of-pl-period-${id}`, options: PERIOD_OPTIONS, value: v.period })
  const periodLabel = f('Label periode', 'period_label', { hint: 'Opsional; menggantikan akhiran periode, mis. "Gratis 3 bulan".', attrs: { maxlength: '40' } })
  const rec = C.choiceGroup({ legend: 'Rekomendasi', name: `of-pl-rec-${id}`, options: [{ value: 'on', label: 'Tandai sebagai paket rekomendasi', checked: Boolean(v.recommended), hint: 'Paket lain kehilangan tanda ini.' }] })
  const badge = f('Badge', 'badge', { hint: 'Kosong berarti "Rekomendasi".', attrs: { maxlength: '30' } })
  const ctaLabel = f('Teks tombol', 'cta_label', { required: true, attrs: { maxlength: '30' } })
  const ctaKind = C.select({ label: 'Tujuan tombol', id: `of-pl-cta-${id}`, options: CTA_OPTIONS, value: v.cta_kind })
  const act = C.choiceGroup({ legend: 'Status', name: `of-pl-act-${id}`, options: [{ value: 'on', label: 'Aktif (tampil di landing page)', checked: v.active !== 0 }] })

  // Monthly AI quota per feature: what the app enforces (the "Batas" rows below are only card text).
  const quotaInputs = FEATURES.map((ft) => {
    const cur = limitFor(v.quota || {}, ft.key)
    return { key: ft.key, f: C.field({ label: `${ft.label} (${ft.unit}/bulan)`, id: `of-pl-q-${ft.key}-${id}`, type: 'number', value: cur === null ? '' : String(cur), hint: 'Kosong = tanpa batas.', attrs: { min: '0', step: '1', 'data-quota': ft.key } }) }
  })
  const quotaGrid = el('div', { className: 'of-quota-grid' }, ...quotaInputs.map((q) => q.f.wrap))
  const limitRows = el('div', { className: 'of-list' })
  const featureRows = el('div', { className: 'of-list' })
  const preview = el('div', { className: 'lp of-preview', 'aria-live': 'polite' })
  const err = el('p', { className: 'field-error', role: 'alert' })

  const gather = () => ({
    slug: slug.input.value, name: name.input.value, tagline: tagline.input.value,
    price_idr: price.input.value.trim() === '' ? null : Number(price.input.value),
    period: period.input.value, period_label: periodLabel.input.value,
    recommended: rec.inputs.on.checked ? 1 : 0, badge: badge.input.value,
    limits: [...limitRows.children].map((r) => ({ label: r.querySelector('[data-k=label]').value, value: r.querySelector('[data-k=value]').value })),
    features: [...featureRows.children].map((r) => r.querySelector('input').value),
    quota: Object.fromEntries(quotaInputs.map((q) => [q.key, q.f.input.value.trim() === '' ? null : Number(q.f.input.value)])),
    cta_label: ctaLabel.input.value, cta_kind: ctaKind.input.value, active: act.inputs.on.checked ? 1 : 0,
  })
  let base = null // snapshot of the untouched form; null while it is still being filled
  const touch = () => { redraw(); if (base !== null) setDirty(JSON.stringify(gather()) !== base) }
  const redraw = () => { const g = gather(); preview.replaceChildren(renderPlanCard({ ...g, price_idr: Number.isNaN(g.price_idr) ? null : g.price_idr })) }

  function addRow(box, kind, vals = {}) {
    const n = box.children.length + 1
    const rid = `of-pl-${kind}-${id}-${++seq}`
    const rm = C.button({ label: 'Hapus', variant: 'ghost', size: 'sm', 'aria-label': `Hapus ${kind === 'limit' ? 'batas' : 'fitur'} ${n}` })
    let row
    if (kind === 'limit') {
      const a = C.field({ label: `Label batas ${n}`, id: `${rid}-l`, value: vals.label || '', attrs: { maxlength: '30', 'data-k': 'label' } })
      const b = C.field({ label: `Nilai batas ${n}`, id: `${rid}-v`, value: vals.value || '', attrs: { maxlength: '60', 'data-k': 'value' } })
      row = el('div', { className: 'of-row of-row-wrap' }, a.wrap, b.wrap, rm)
    } else {
      const a = C.field({ label: `Fitur ${n}`, id: rid, value: vals.text || '', attrs: { maxlength: '100' } })
      row = el('div', { className: 'of-row' }, a.wrap, rm)
    }
    rm.addEventListener('click', () => { row.remove(); renumber(); touch(); syncAdd() })
    box.append(row)
  }
  // Labels are numbered; keep them in step after a removal.
  function renumber() {
    [...limitRows.children].forEach((r, i) => {
      const ls = r.querySelectorAll('label')
      ls[0].textContent = `Label batas ${i + 1}`; ls[1].textContent = `Nilai batas ${i + 1}`
      r.querySelector('button').setAttribute('aria-label', `Hapus batas ${i + 1}`)
    });
    [...featureRows.children].forEach((r, i) => {
      r.querySelector('label').textContent = `Fitur ${i + 1}`
      r.querySelector('button').setAttribute('aria-label', `Hapus fitur ${i + 1}`)
    })
  }
  const addLimit = C.button({ label: 'Tambah batas', icon: 'plus', variant: 'soft', size: 'sm' })
  const addFeature = C.button({ label: 'Tambah fitur', icon: 'plus', variant: 'soft', size: 'sm' })
  const syncAdd = () => { addLimit.disabled = limitRows.children.length >= 6; addFeature.disabled = featureRows.children.length >= 12 }
  addLimit.addEventListener('click', () => { addRow(limitRows, 'limit'); syncAdd(); touch(); limitRows.lastChild.querySelector('input').focus() })
  addFeature.addEventListener('click', () => { addRow(featureRows, 'feature'); syncAdd(); touch(); featureRows.lastChild.querySelector('input').focus() })
  v.limits.forEach((l) => addRow(limitRows, 'limit', l))
  v.features.forEach((t) => addRow(featureRows, 'feature', { text: t }))
  syncAdd()

  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: plan ? `Ubah ${plan.name}` : 'Tambah paket', wide: true, opener, actions: [cancel, save],
    children: [name.wrap, el('div', { className: 'form-row' }, slug.wrap, tagline.wrap), el('div', { className: 'form-row' }, price.wrap, period.wrap), periodLabel.wrap,
      el('div', { className: 'form-row' }, rec.wrap, badge.wrap), el('div', { className: 'form-row' }, ctaLabel.wrap, ctaKind.wrap),
      el('h3', { className: 'field-label' }, 'Batas'), limitRows, addLimit,
      el('h3', { className: 'field-label' }, 'Fitur'), featureRows, addFeature,
      el('h3', { className: 'field-label' }, 'Kuota AI per bulan'),
      el('p', { className: 'muted small' }, 'Batas pemakaian AI yang benar-benar berlaku. Setelah kuota habis, pelanggan memakai saldo AI. Paket tidak termasuk saldo AI.'),
      quotaGrid,
      act.wrap, el('h3', { className: 'field-label' }, 'Pratinjau kartu'), preview, err],
  })
  redraw()
  base = JSON.stringify(gather())
  form.addEventListener('input', touch)
  form.addEventListener('change', touch)
  // Unsaved edits ask first, like leaving the section does (Escape fires `cancel`, Batal calls it too).
  const dirty = () => base !== null && JSON.stringify(gather()) !== base
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validatePlan({ ...gather(), sort: plan ? plan.sort : nextSort }) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      if (plan) await adminUpdatePlan(plan.id, clean)
      else await adminCreatePlan(clean)
      base = null
      close()
      showToast('Paket tersimpan.', 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  let run = 0
  async function load() {
    const mine = ++run
    host.replaceChildren(C.skeletonRows(4))
    let rows
    try { rows = await adminListPlans() } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
      again.addEventListener('click', load)
      host.replaceChildren(C.errorState(e.message), again)
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    const nextSort = rows.reduce((m, p) => Math.max(m, p.sort), 0) + 1
    const add = C.button({ label: 'Tambah paket', icon: 'plus', variant: 'primary', size: 'sm' })
    add.addEventListener('click', () => planDialog(ctx, null, nextSort, add, load, setDirty))

    // Reorder = one request that rewrites `sort` as 1..n.
    const move = async (i, j) => {
      try {
        const ids = rows.map((r) => r.id);
        [ids[i], ids[j]] = [ids[j], ids[i]]
        await adminReorderPlans(ids)
      } catch (ex) { showToast(ex.message, 'error') }
      if (!ctx.signal.aborted) load()
    }
    const items = rows.map((p, i) => {
      const { price, period } = formatPrice(p)
      const btn = (label, disabled, fn) => {
        const b = C.button({ label, variant: label === 'Ubah' ? 'soft' : 'ghost', size: 'sm', disabled, 'aria-label': `${label} ${p.name}` })
        b.addEventListener('click', fn)
        return b
      }
      const edit = btn('Ubah', false, () => planDialog(ctx, p, nextSort, edit, load, setDirty))
      return el('article', { className: 'workspace-entry of-plan' },
        el('div', { className: 'workspace-entry-head' }, el('strong', {}, p.name),
          p.recommended ? C.tag('Rekomendasi', 'ok') : null, p.active ? null : C.tag('Nonaktif', 'neutral')),
        el('p', { className: 'small' }, `${price}${period ? ` · ${period}` : ''}`),
        el('p', { className: 'muted small' }, stampLine(p)),
        el('div', { className: 'of-row-actions' }, btn('Naik', i === 0, () => move(i, i - 1)), btn('Turun', i === rows.length - 1, () => move(i, i + 1)), edit))
    })

    let body
    if (items.length) body = items
    else {
      const imp = C.button({ label: 'Impor paket dari landing saat ini', variant: 'soft' })
      const impErr = el('p', { className: 'field-error', role: 'alert' })
      imp.addEventListener('click', async () => {
        impErr.textContent = ''
        const restore = C.setBusy(imp, 'Mengimpor…')
        let failed = false
        try {
          // Only slugs that are not there yet, so a retry after a partial failure never duplicates.
          const have = new Set((await adminListPlans()).map((p) => p.slug))
          for (const [i, t] of PRICING_TIERS.entries()) if (!have.has(t.id)) await adminCreatePlan(validatePlan(fromTier(t, i)))
          showToast('Paket diimpor.', 'success')
        } catch (ex) {
          failed = true
          impErr.textContent = `Impor belum selesai: ${ex.message}`
        } finally { restore() }
        if (failed) imp.querySelector('.btn-label').textContent = 'Impor ulang'
        else if (!ctx.signal.aborted) load()
      })
      body = [C.emptyState({ title: 'Belum ada paket', body: 'Landing page memakai paket bawaan sampai ada paket aktif di sini.', iconName: 'sprout', action: el('div', { className: 'of-list' }, imp, impErr) })]
    }
    host.replaceChildren(C.panel({ title: 'Paket langganan', meta: `${rows.length} paket`, actions: add }, ...body))
  }
  load()
}
