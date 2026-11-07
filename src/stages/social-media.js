import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as C from '../ui/components.js'
import { t } from '../i18n/index.js'
import '../styles/social.css'
import { getAccount } from '../social/api.js'
import * as Repliz from '../repliz/api.js'
import { safeCallbackMessage } from '../repliz/rules.js'
import * as Account from './social-media/account.js'
import * as Content from './social-media/content.js'
import * as Schedule from './social-media/schedule.js'
import * as Ads from './social-media/ads.js'
import * as Collab from './social-media/collab.js'

// The URL is attacker-controllable: only echo the messages the OAuth callback itself sends.
const CALLBACK_ERRORS = ['Koneksi dibatalkan.', 'Integrasi Meta belum dikonfigurasi.', 'Integrasi Threads belum dikonfigurasi.', 'Sesi koneksi kedaluwarsa, coba lagi.']
const CALLBACK_ERROR_PREFIXES = ['Gagal terhubung ke Meta:', 'Gagal terhubung ke Threads:']
// Success outcomes the callbacks send (social=…), mapped to their message.
const CALLBACK_OK = { connected: 'Akun berhasil terhubung.', threads_connected: 'Akun Threads berhasil terhubung.' }
// Display text for the callback messages above (and the Repliz ones), keyed by the exact Indonesian text the worker sends.
const CALLBACK_KEYS = {
  'Koneksi dibatalkan.': 'cancelled', 'Integrasi Meta belum dikonfigurasi.': 'metaNotConfigured', 'Integrasi Threads belum dikonfigurasi.': 'threadsNotConfigured',
  'Sesi koneksi kedaluwarsa, coba lagi.': 'expired', 'Akun berhasil terhubung.': 'connected', 'Akun Threads berhasil terhubung.': 'threadsConnected',
  'Koneksi gagal, coba lagi.': 'failed', 'Hubungkan akun Repliz Anda terlebih dahulu di Media Sosial › Akun.': 'replizFirst', 'Tidak tersedia di akun demo.': 'demo',
  'Kunci Repliz ditolak. Periksa Access key dan Secret key di Media Sosial › Akun.': 'replizKeys', 'Fitur ini butuh paket Repliz yang lebih tinggi.': 'replizPlan',
  'Permintaan ditolak oleh platform media sosial. Periksa isinya lalu coba lagi.': 'rejected', 'Terlalu banyak permintaan. Coba lagi sebentar.': 'tooMany',
  'Layanan media sosial sedang bermasalah. Coba lagi nanti.': 'down', 'Layanan media sosial tidak menjawab. Coba lagi sebentar.': 'timeout',
  'Tidak dapat menghubungi layanan media sosial.': 'unreachable', 'Platform tidak mengembalikan akun.': 'noAccount', 'Platform tidak mengembalikan izin akses.': 'noToken',
}
function callbackText(msg) {
  if (CALLBACK_KEYS[msg]) return t(`social.callback.${CALLBACK_KEYS[msg]}`)
  if (msg.startsWith('Gagal terhubung ke Meta:')) return t('social.callback.metaFailed', { detail: msg.slice('Gagal terhubung ke Meta:'.length).trim() })
  if (msg.startsWith('Gagal terhubung ke Threads:')) return t('social.callback.threadsFailed', { detail: msg.slice('Gagal terhubung ke Threads:'.length).trim() })
  const none = msg.match(/^Tidak ada (.+) yang bisa dihubungkan\.$/)
  if (none) return t('social.callback.noEntity', { what: none[1] })
  return msg
}

const { el } = C
const TAB_KEYS = ['account', 'content', 'schedule', 'brainstorm', 'ads', 'collab']
let currentTab = 'account'

export async function render(container, ctx = {}) {
  let controller = null
  let modelId = null
  let acct = { configured: true, threads_configured: true, account: null }
  let pick = null
  let replizPick = null
  let repliz = { status: null, accounts: [] }
  // Return from the Meta OAuth callback (see ui/app.js): open Akun, show the outcome, drop the query.
  const query = ctx.query || new URLSearchParams(location.hash.split('?')[1] || '')
  const back = { connected: Object.hasOwn(CALLBACK_OK, query.get('social') || '') ? CALLBACK_OK[query.get('social')] : null,
    error: query.get('social_error'), pick: query.get('social_pick') }
  // Return from the Repliz connect page (worker/repliz.js): repliz=connected | repliz_error=… | repliz_pick=<id>.
  if (query.get('repliz') === 'connected') back.connected = 'Akun berhasil terhubung.'
  if (query.get('repliz_error')) back.replizError = safeCallbackMessage(query.get('repliz_error'))
  if (/^[0-9a-f]{32}$/.test(query.get('repliz_pick') || '')) replizPick = query.get('repliz_pick')
  if (back.connected || back.error || back.pick || back.replizError || replizPick) {
    currentTab = 'account'
    pick = back.pick
    if (ctx.setRoute) ctx.setRoute({})
    else history.replaceState(null, '', '#/app/media-sosial')
  }
  const status = C.message()
  const host = el('div')
  const tabs = C.segmented({ options: TAB_KEYS.map((value) => ({ value, label: t(`social.tabs.${value}`) })), value: currentTab, label: t('social.tabsLabel'), onChange: (value) => {
    controller?.abort()
    currentTab = value
    status.hide()
    draw()
  } })
  tabs.classList.add('workspace-tabs')
  container.replaceChildren(
    C.pageHeader({ title: t('social.title'), em: t('social.titleEm'), description: t('social.description') }),
    tabs, status, host)
  ctx.signal?.addEventListener('abort', () => controller?.abort(), { once: true })

  function tabCtx() {
    return { status, signal: controller.signal, getModelId: () => modelId, account: acct.account, configured: acct.configured, threadsConfigured: acct.threads_configured, loadError: acct.error, pick,
      repliz, replizPick, clearReplizPick: () => { replizPick = null },
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
    const [a, r] = await Promise.allSettled([getAccount(), loadRepliz()])
    acct = a.status === 'fulfilled' ? a.value : { configured: true, threads_configured: true, account: null, error: a.reason?.message }
    repliz = r.status === 'fulfilled' ? r.value : { status: null, accounts: [], error: r.reason?.message }
  }
  async function loadRepliz() {
    const status = await Repliz.status()
    return { status, accounts: status?.configured ? await Repliz.listAccounts() : [] }
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
  if (back.connected) status.show('ok', callbackText(back.connected))
  else if (back.replizError) status.show('danger', callbackText(back.replizError))
  else if (back.error) {
    const known = CALLBACK_ERRORS.includes(back.error) || CALLBACK_ERROR_PREFIXES.some((p) => back.error.startsWith(p))
    status.show('danger', known ? callbackText(back.error) : t('social.callback.failed'))
  }
  try {
    await loadModels()
    if (!ctx.signal?.aborted) modelId = pickDefaultModel()?.id
  } catch (err) { status.show('warn', t('social.aiUnavailable', { message: err.message })) }
}
