import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Agency from '../../agency/api.js'
import * as Social from '../../social/api.js'
import {
  CAMPAIGN_STATUS_LABEL, CAMPAIGN_TONE, DELIVERABLE_STATUS_LABEL, DELIVERABLE_KIND_LABEL, campaignMoney, validateCampaign, validateDeliverable,
} from '../../agency/rules.js'
import { LEAVE_MSG } from './site-doc.js'
import { t } from '../../i18n/index.js'

const { el } = C
// Labels come from agency/rules.js (shared with the Worker); translate them here by their stable key.
const opts = (o, group) => Object.keys(o).map((value) => ({ value, label: t(`office.campaigns.${group}.${value}`) }))
const campaignStatus = (s) => (CAMPAIGN_STATUS_LABEL[s] ? t(`office.campaigns.status.${s}`) : s)
const day = (d) => (d ? C.formatDate(`${d}T00:00:00`) : '')
export const dateRange = (a, b) => (a || b ? `${day(a) || '…'} – ${day(b) || '…'}` : '')
let filter = ''
let seq = 0

function errLine() { return el('p', { className: 'field-error', role: 'alert' }) }

/**
 * Wide editor for one campaign. The header saves with "Simpan kampanye"; each influencer or deliverable row saves on its own
 * and only that row (and the summary) is redrawn, so unsaved edits elsewhere stay. Adding or removing an influencer redraws
 * the lists and asks first when another row has unsaved edits. Closing with unsaved edits asks first. onClosed runs after it closes.
 */
export function openCampaignEditor(ctx, id, opener, setDirty, onClosed = () => {}) {
  const uid = ++seq
  const f = (label, key, extra = {}) => C.field({ label, id: `ag-${key}-${uid}`, ...extra })
  const title = f(t('office.campaigns.titleLabel'), 'title', { required: true, attrs: { maxlength: '120' } })
  const brief = C.textarea({ label: t('office.campaigns.brief'), id: `ag-brief-${uid}`, rows: 4, attrs: { maxlength: '3000' } })
  const status = C.select({ label: t('office.common.status'), id: `ag-status-${uid}`, options: opts(CAMPAIGN_STATUS_LABEL, 'status'), value: 'draft' })
  const start = f(t('office.campaigns.start'), 'start', { type: 'date' })
  const end = f(t('office.campaigns.end'), 'end', { type: 'date' })
  const fee = f(t('office.campaigns.fee'), 'fee', { type: 'number', hint: t('office.common.teamOnly'), attrs: { min: '0', step: '1' } })
  const headErr = errLine()
  const summary = el('p', { className: 'ag-summary', 'aria-live': 'polite' })
  const lists = el('div', { className: 'of-list' }, C.skeletonRows(3))
  const save = C.button({ label: t('office.campaigns.save'), icon: 'save', variant: 'primary', type: 'submit', disabled: true })
  const cancel = C.button({ label: t('office.common.close'), variant: 'ghost', type: 'button' })
  const head = el('div', { className: 'of-list' }, title.wrap, brief.wrap, el('div', { className: 'form-row' }, status.wrap, fee.wrap),
    el('div', { className: 'form-row' }, start.wrap, end.wrap), headErr)
  head.hidden = true
  const { dialog, form, close } = C.modal({
    title: t('office.campaigns.title'), wide: true, opener, actions: [cancel, save],
    children: [head, summary, lists],
  })
  const titleEl = dialog.querySelector('.modal-title')

  const gatherHead = () => ({ title: title.input.value, brief: brief.input.value, status: status.input.value,
    start_date: start.input.value, end_date: end.input.value, client_fee_idr: fee.input.value.trim() })
  // Each row keeps a snapshot of its saved values; a row is dirty when its inputs differ (a new deliverable row always is).
  const snap = (row) => JSON.stringify([...row.querySelectorAll('input, select, textarea')].map((n) => n.value))
  const snaps = new WeakMap()
  const mark = (row, saved = snap(row)) => { snaps.set(row, saved); return row }
  const rowDirty = (row) => row.classList.contains('is-new') || snaps.get(row) !== snap(row)
  const listsDirty = (except) => [...lists.querySelectorAll('.ag-inf, .ag-del, .ag-add')].some((r) => r !== except && rowDirty(r))
  let headBase = null
  const dirty = () => headBase !== null && (JSON.stringify(gatherHead()) !== headBase || listsDirty())
  const touch = () => setDirty(dirty())
  form.addEventListener('input', touch)
  form.addEventListener('change', touch)
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => { setDirty(false); if (!ctx.signal.aborted) onClosed() })
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  // Enter inside a row saves that row (its [data-save] button), never the campaign header.
  lists.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return
    const btn = e.target.closest('.ag-inf, .ag-del, .ag-add')?.querySelector('[data-save]')
    if (!btn) return
    e.preventDefault()
    if (!btn.disabled) btn.click()
  })

  let catalogue = []
  let run = 0
  let pendingRedraw = false // a structural redraw a later no-redraw load must not cancel
  // Re-reads the campaign: title and summary always, the lists only when `redraw`; the header form is filled only the first time.
  async function load({ redraw = true } = {}) {
    redraw = redraw || pendingRedraw
    pendingRedraw = redraw
    const mine = ++run
    let c
    try {
      [c, catalogue] = await Promise.all([Agency.adminGetCampaign(id), headBase === null ? Social.adminListInfluencers() : catalogue])
    } catch (e) {
      if (mine !== run || !dialog.open) return
      // A refresh after a row/header save failed: keep the lists (and their unsaved edits), just say so.
      if (!redraw) { showToast(e.message, 'error'); return }
      const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => { lists.replaceChildren(C.skeletonRows(3)); load() })
      lists.replaceChildren(C.errorState(e.message), again)
      return
    }
    if (mine !== run || !dialog.open) return
    if (headBase === null) {
      title.input.value = c.title
      brief.input.value = c.brief || ''
      status.input.value = c.status
      start.input.value = c.start_date || ''
      end.input.value = c.end_date || ''
      fee.input.value = c.client_fee_idr ?? ''
      headBase = JSON.stringify(gatherHead())
      head.hidden = false
      save.disabled = false
    }
    titleEl.textContent = c.title
    const m = campaignMoney(c, c.influencers)
    summary.textContent = t('office.campaigns.summary', { fee: m.fee === null ? '—' : C.rupiah(m.fee), payout: C.rupiah(m.payout), margin: m.margin === null ? '—' : C.rupiah(m.margin) })
    if (redraw) {
      pendingRedraw = false
      drawLists(c)
      lists.querySelectorAll('.ag-inf, .ag-del, .ag-add').forEach((r) => mark(r))
    }
    touch()
  }

  function drawLists(c) {
    const assigned = new Set(c.influencers.map((i) => i.influencer_id))
    const free = catalogue.filter((i) => i.visible === 1 && !assigned.has(i.id))
    let add = null
    if (free.length) {
      const sel = C.select({ label: t('office.campaigns.addInfluencer'), id: `ag-add-inf-${uid}-${++seq}`, options: free.map((i) => ({ value: i.id, label: i.name })) })
      const pay = C.field({ label: t('office.campaigns.payout'), id: `ag-add-pay-${uid}-${seq}`, type: 'number', attrs: { min: '0', step: '1' } })
      const btn = C.button({ label: t('office.campaigns.addBtn'), icon: 'plus', variant: 'soft', size: 'sm', 'data-save': '' })
      const err = errLine()
      add = el('div', { className: 'ag-add' }, el('div', { className: 'of-row of-row-wrap' }, sel.wrap, pay.wrap, btn), err)
      btn.addEventListener('click', () => structural(add, btn, err, () => Agency.adminAssignInfluencer(id, { influencer_id: Number(sel.input.value), payout_idr: pay.input.value.trim() }), t('office.campaigns.influencerAdded')))
    } else add = el('p', { className: 'muted small' }, t('office.campaigns.allAssigned'))

    lists.replaceChildren(
      el('h3', { className: 'field-label' }, t('office.campaigns.influencer')),
      ...(c.influencers.length ? c.influencers.map(infRow) : [el('p', { className: 'muted small' }, t('office.campaigns.noInfluencers'))]), add,
      el('h3', { className: 'field-label' }, t('office.campaigns.content')),
      ...(c.influencers.length ? c.influencers.map((i) => group(i, c.deliverables.filter((d) => d.influencer_id === i.influencer_id)))
        : [el('p', { className: 'muted small' }, t('office.campaigns.addInfluencerFirst'))]))
  }

  // Runs one row action; success → toast + after(result), failure → the row's error line.
  async function act(btn, err, fn, done, after) {
    err.textContent = ''
    const restore = C.setBusy(btn)
    try {
      const res = await fn()
      showToast(done, 'success')
      after(res)
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  }
  // Adding/removing an influencer changes the groups, so the lists are redrawn: ask first if another row has unsaved edits.
  function structural(row, btn, err, fn, done) {
    if (listsDirty(row) && !confirm(LEAVE_MSG)) return
    act(btn, err, fn, done, () => load())
  }

  function infRow(i) {
    const pay = C.field({ label: t('office.campaigns.payout'), id: `ag-pay-${uid}-${i.influencer_id}-${++seq}`, type: 'number', value: i.payout_idr ?? '', attrs: { min: '0', step: '1' } })
    const keep = C.button({ label: t('office.campaigns.savePayout'), variant: 'soft', size: 'sm', 'data-save': '' })
    const rm = C.button({ label: t('office.common.delete'), variant: 'ghost', size: 'sm', 'aria-label': t('office.campaigns.removeFrom', { name: i.name }) })
    const err = errLine()
    const row = el('div', { className: 'ag-inf' },
      el('div', { className: 'workspace-entry-head' }, el('strong', {}, i.name), i.visible === 0 ? C.tag(t('office.common.hidden'), 'neutral') : null,
        el('span', { className: 'muted small' }, [i.niche, i.city].filter(Boolean).join(' · '))),
      el('div', { className: 'of-row of-row-wrap' }, pay.wrap, keep, rm), err)
    keep.addEventListener('click', () => {
      const sent = snap(row) // what is saved; edits typed during the request keep the row dirty
      act(keep, err, () => Agency.adminAssignInfluencer(id, { influencer_id: i.influencer_id, payout_idr: pay.input.value.trim() }),
        t('office.campaigns.payoutSaved'), () => { mark(row, sent); touch(); load({ redraw: false }) })
    })
    rm.addEventListener('click', () => structural(row, rm, err, () => Agency.adminRemoveInfluencer(id, i.influencer_id), t('office.campaigns.influencerRemoved')))
    return row
  }

  function group(i, dels) {
    const rows = el('div', { className: 'of-list' }, ...dels.map((d) => delRow(i, d)))
    const more = C.button({ label: t('office.campaigns.addContent'), icon: 'plus', variant: 'soft', size: 'sm', 'aria-label': t('office.campaigns.addContentFor', { name: i.name }) })
    more.addEventListener('click', () => { rows.append(delRow(i, null)); rows.lastChild.querySelector('select, input').focus(); touch() })
    return el('section', { className: 'ag-group' }, el('h4', {}, i.name), rows, more)
  }

  function delRow(i, d) {
    const rid = `ag-del-${uid}-${++seq}`
    const kind = C.select({ label: t('office.campaigns.kindLabel'), id: `${rid}-k`, options: opts(DELIVERABLE_KIND_LABEL, 'kind'), value: d?.kind ?? 'feed', attrs: { 'data-k': 'kind' } })
    const due = C.field({ label: t('office.campaigns.due'), id: `${rid}-d`, type: 'date', value: d?.due_date ?? '' })
    const st = C.select({ label: t('office.common.status'), id: `${rid}-s`, options: opts(DELIVERABLE_STATUS_LABEL, 'deliverable'), value: d?.status ?? 'planned', attrs: { 'data-k': 'status' } })
    const link = C.field({ label: t('office.campaigns.link'), id: `${rid}-l`, type: 'url', value: d?.link ?? '', placeholder: 'https://', hint: t('office.campaigns.linkHint'), attrs: { maxlength: '300' } })
    const note = C.textarea({ label: t('office.campaigns.note'), id: `${rid}-n`, rows: 2, value: d?.note ?? '', hint: t('office.common.teamOnly'), attrs: { maxlength: '500' } })
    const err = errLine()
    const keep = C.button({ label: t('office.common.save'), variant: 'soft', size: 'sm', 'data-save': '' })
    const drop = C.button({ label: d ? t('office.common.delete') : t('office.common.cancel'), variant: 'ghost', size: 'sm' })
    const row = el('div', { className: `ag-del${d ? '' : ' is-new'}` },
      el('div', { className: 'of-row of-row-wrap' }, kind.wrap, due.wrap, st.wrap), link.wrap, note.wrap, err, el('div', { className: 'of-row-actions' }, keep, drop))
    keep.addEventListener('click', () => {
      const body = { influencer_id: i.influencer_id, kind: kind.input.value, due_date: due.input.value, status: st.input.value, link: link.input.value, note: note.input.value }
      let clean
      try { clean = validateDeliverable(body) } catch (ex) { err.textContent = ex.message; return }
      const sent = snap(row)
      act(keep, err, () => (d ? Agency.adminUpdateDeliverable(d.id, body) : Agency.adminAddDeliverable(id, body)), t('office.campaigns.contentSaved'), (res) => {
        const saved = { ...d, ...clean, id: d ? d.id : res.id }
        // Untouched since sending: redraw just this row from the saved values. Edited meanwhile: keep the
        // typed values, record the id and the sent snapshot, so the row stays dirty.
        if (snap(row) === sent) row.replaceWith(mark(delRow(i, saved)))
        else {
          d = saved
          row.classList.remove('is-new')
          drop.querySelector('.btn-label').textContent = t('office.common.delete')
          mark(row, sent)
        }
        touch()
      })
    })
    drop.addEventListener('click', () => {
      if (!d) { row.remove(); touch(); return }
      if (confirm(t('office.campaigns.confirmDeleteContent'))) act(drop, err, () => Agency.adminDeleteDeliverable(d.id), t('office.campaigns.contentDeleted'), () => { row.remove(); touch() })
    })
    return row
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    headErr.textContent = ''
    let clean
    try { clean = validateCampaign(gatherHead()) } catch (ex) { headErr.textContent = ex.message; return }
    const sent = JSON.stringify(gatherHead())
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      await Agency.adminUpdateCampaign(id, clean)
      headBase = sent
      touch()
      showToast(t('office.campaigns.saved'), 'success')
      load({ redraw: false }) // title + summary only; unsaved row edits stay
    } catch (ex) { headErr.textContent = ex.message } finally { restore() }
  })
  load()
}

/** Kantor › Kampanye: campaigns by status, newest change first; a row opens the editor. */
export function draw(host, ctx, setDirty) {
  let run = 0
  const pg = C.pager({ label: t('office.campaigns.pagerLabel'), pageSize: Agency.PAGE_SIZE, sizes: [Agency.PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const body = el('div', { 'aria-live': 'polite' })
  const seg = C.segmented({ options: [{ value: '', label: t('office.common.all') }, ...opts(CAMPAIGN_STATUS_LABEL, 'status')], value: filter, label: t('office.common.filterStatus'), onChange: (v) => { filter = v; pg.reset(); load(1) } })
  seg.classList.add('of-seg-wrap')
  host.replaceChildren(C.panel({ title: t('office.campaigns.title') }, seg, body, pg.root))

  function row(c) {
    const b = el('button', { type: 'button', className: 'of-cust ag-campaign' },
      el('span', { className: 'of-cust-main' }, el('strong', {}, c.title),
        el('span', { className: 'muted small' }, [c.business_name, c.business_email].filter(Boolean).join(' · '))),
      el('span', { className: 'of-cust-meta' }, C.tag(campaignStatus(c.status), CAMPAIGN_TONE[c.status] || 'neutral'),
        el('span', { className: 'muted small' }, dateRange(c.start_date, c.end_date) || t('office.campaigns.noDates')),
        c.client_fee_idr === null ? null : el('span', { className: 'small' }, C.rupiah(c.client_fee_idr))))
    b.addEventListener('click', () => openCampaignEditor(ctx, c.id, b, setDirty, () => load(pg.page)))
    return b
  }

  async function load(page) {
    const mine = ++run
    body.replaceChildren(C.skeletonRows(3))
    let data
    try { data = await Agency.adminListCampaigns({ status: filter, page }) } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => load(page))
      body.replaceChildren(C.errorState(e.message), again)
      pg.root.hidden = true
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    pg.slice(new Array(data.total))
    if (!data.items.length && data.total && pg.page !== page) return load(pg.page)
    body.replaceChildren(data.items.length
      ? el('div', { className: 'of-cust-list' }, ...data.items.map(row))
      : C.emptyState({ title: t('office.campaigns.empty'), body: t('office.campaigns.emptyBody'), iconName: 'inbox' }))
  }
  load(1)
}
