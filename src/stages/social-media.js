import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as C from '../ui/components.js'
import { getAccount } from '../social/api.js'
import * as Account from './social-media/account.js'
import * as Content from './social-media/content.js'
import * as Schedule from './social-media/schedule.js'
import * as Ads from './social-media/ads.js'
import * as Collab from './social-media/collab.js'

// The URL is attacker-controllable: only echo the messages the OAuth callback itself sends.
const CALLBACK_ERRORS = ['Koneksi dibatalkan.', 'Integrasi Meta belum dikonfigurasi.', 'Sesi koneksi kedaluwarsa, coba lagi.']

const { el } = C
const TABS = [
  { value: 'account', label: 'Akun' }, { value: 'content', label: 'Konten' }, { value: 'schedule', label: 'Jadwal' },
  { value: 'brainstorm', label: 'Brainstorm' }, { value: 'ads', label: 'Iklan' }, { value: 'collab', label: 'Kolaborasi' },
]
let currentTab = 'account'

export async function render(container, ctx = {}) {
  let controller = null
  let modelId = null
  let acct = { configured: true, account: null }
  let pick = null
  // Return from the Meta OAuth callback (see ui/app.js): open Akun, show the outcome, drop the query.
  const query = new URLSearchParams(location.hash.split('?')[1] || '')
  const back = { connected: query.get('social') === 'connected', error: query.get('social_error'), pick: query.get('social_pick') }
  if (back.connected || back.error || back.pick) {
    currentTab = 'account'
    pick = back.pick
    history.replaceState(null, '', '#/app')
  }
  const status = C.message()
  const host = el('div')
  const tabs = C.segmented({ options: TABS, value: currentTab, label: 'Social media', onChange: (value) => {
    controller?.abort()
    currentTab = value
    status.hide()
    draw()
  } })
  tabs.classList.add('workspace-tabs')
  container.replaceChildren(
    C.pageHeader({ title: 'Ruang untuk bertumbuh', em: 'bertumbuh', description: 'Siapkan konten, susun jadwal, dan temukan ide pemasaran untuk bisnis jasa Anda.' }),
    tabs, status, host)
  ctx.signal?.addEventListener('abort', () => controller?.abort(), { once: true })

  function tabCtx() {
    return { status, signal: controller.signal, getModelId: () => modelId, account: acct.account, configured: acct.configured, loadError: acct.error, pick,
      refresh, clearPick: () => { pick = null }, goto: (value) => tabs.querySelector(`[data-value="${value}"]`).click() }
  }
  function draw() {
    controller?.abort() // stop AI streams and fetches of the tab being replaced
    controller = new AbortController()
    if (currentTab === 'account') Account.render(host, tabCtx())
    else if (currentTab === 'content' || currentTab === 'brainstorm') Content.render(host, tabCtx(), currentTab === 'brainstorm')
    else if (currentTab === 'schedule') Schedule.render(host, tabCtx())
    else if (currentTab === 'ads') Ads.render(host, tabCtx())
    else Collab.render(host, tabCtx())
  }
  async function loadAccount() {
    try { acct = await getAccount() } catch (err) { acct = { configured: true, account: null, error: err.message } }
  }
  async function refresh() {
    await loadAccount()
    if (ctx.signal?.aborted) return
    draw()
    host.setAttribute('tabindex', '-1')
    host.focus({ preventScroll: true })
  }
  host.replaceChildren(C.skeletonRows(3))
  await loadAccount()
  if (ctx.signal?.aborted) return
  draw()
  if (back.connected) status.show('ok', 'Akun berhasil terhubung.')
  else if (back.error) status.show('danger', CALLBACK_ERRORS.includes(back.error) || back.error.startsWith('Gagal terhubung ke Meta:') ? back.error : 'Koneksi gagal, coba lagi.')
  try {
    await loadModels()
    if (!ctx.signal?.aborted) modelId = pickDefaultModel()?.id
  } catch (err) { status.show('warn', `Fitur AI belum tersedia: ${err.message}. Jadwal dan rekomendasi lokal tetap dapat digunakan.`) }
}
