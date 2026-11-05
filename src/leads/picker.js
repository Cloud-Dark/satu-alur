/**
 * "Cari dari peta" for the Permintaan wizard: search businesses on the open map
 * (OpenStreetMap via /api/leads/*, Google Places only when the server has a key;
 * demo accounts and mock mode get fictional data) and pick one to fill the
 * customer step. No Google Maps scraping.
 */
import * as C from '../ui/components.js'
import { geocode, searchLeads } from './api.js'
import { loadLeaflet, OSM_TILES, OSM_ATTRIBUTION } from './leaflet.js'
import { pickedFields, otherContacts } from './pick.js'

export { pickedFields }

const { el } = C
let seq = 0

export function openMapPicker({ opener, onPick, initialArea = '' }) {
  const n = ++seq
  const keyword = C.field({ label: 'Nama atau jenis usaha', id: `mp-kw-${n}`, placeholder: 'mis. hotel, laundry, PT Maju', attrs: { maxlength: '60', autocomplete: 'off' } })
  const area = C.field({ label: 'Kota atau area', id: `mp-area-${n}`, value: initialArea, placeholder: 'mis. Bekasi Barat', attrs: { maxlength: '80', autocomplete: 'address-level2' } })
  const go = C.button({ label: 'Cari', icon: 'search', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'mp-form', noValidate: true, role: 'search' }, keyword.wrap, area.wrap, el('div', { className: 'mp-go' }, go))
  const mapEl = el('div', { className: 'mp-map', role: 'region', 'aria-label': 'Peta hasil pencarian' })
  const note = el('p', { className: 'muted small mp-note' }, 'Data dari peta terbuka (OpenStreetMap) sering belum lengkap: banyak usaha tidak mencantumkan email, jam buka, atau kontak lain. Periksa lagi sebelum menghubungi.')
  const status = C.message()
  const list = el('ul', { className: 'mp-list', 'aria-live': 'polite' })
  const close = C.button({ label: 'Tutup', variant: 'ghost' })
  close.dataset.dismiss = ''
  // The only control left enabled while a search runs.
  const stop = C.button({ label: 'Batalkan pencarian', icon: 'x', variant: 'ghost', size: 'sm' })
  stop.classList.add('mp-stop')
  stop.hidden = true
  const m = C.modal({
    title: 'Cari pelanggan dari peta',
    description: 'Ketik nama atau jenis usaha dan areanya, lalu pilih salah satu hasil.',
    children: [form, status, mapEl, note, list], actions: [stop, close], opener, wide: true,
  })
  m.dialog.classList.add('mp-dialog')

  let L = null
  let map = null
  let layer = null
  let ctl = null
  const markers = new Map()
  let searching = false
  let searchSeq = 0
  m.dialog.addEventListener('close', () => { ctl?.abort(); map?.remove() })

  /**
   * While a search runs every button, input and the map are locked (no double
   * submits, no picking a stale result, no closing mid-request); only
   * "Batalkan pencarian" stays usable. Escape cancels the search instead of
   * closing the dialog.
   */
  function lock(on) {
    searching = on
    m.dialog.classList.toggle('is-searching', on)
    m.dialog.setAttribute('aria-busy', String(on))
    for (const c of m.dialog.querySelectorAll('button, input')) {
      if (c === stop) continue
      const prop = c.tagName === 'INPUT' ? 'readOnly' : 'disabled'
      if (on && !c[prop]) { c[prop] = true; c.dataset.mpLocked = '' } else if (!on && 'mpLocked' in c.dataset) { c[prop] = false; delete c.dataset.mpLocked }
    }
    mapEl.inert = on
    stop.hidden = !on
    if (on) stop.focus()
  }
  stop.addEventListener('click', () => ctl?.abort())
  m.dialog.addEventListener('cancel', (e) => { if (searching) { e.preventDefault(); ctl?.abort() } })

  async function ensureMap(center) {
    if (!L) {
      try { L = await loadLeaflet() } catch { mapEl.hidden = true; return }
    }
    if (!map) {
      map = L.map(mapEl, { zoomControl: true, attributionControl: true, zoomAnimation: false, markerZoomAnimation: false })
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map)
      map.attributionControl.setPrefix(false)
      layer = L.layerGroup().addTo(map)
    }
    map.setView([center.lat, center.lon], 14)
    setTimeout(() => map?.invalidateSize(), 50)
  }

  function choose(lead, areaLabel) {
    onPick(pickedFields(lead, areaLabel))
    m.close()
  }

  function render(results, areaLabel) {
    layer?.clearLayers()
    markers.clear()
    if (!results.length) {
      list.replaceChildren(el('li', {}, C.emptyState({ title: 'Tidak ada hasil', body: 'Coba kata lain atau area yang lebih luas.', iconName: 'mapPin' })))
      return
    }
    const bounds = []
    list.replaceChildren(...results.slice(0, 30).map((r, i) => {
      const pick = C.button({ label: 'Pilih', variant: 'soft', size: 'sm' })
      pick.setAttribute('aria-label', `Pilih ${r.name}`)
      pick.addEventListener('click', () => choose(r, areaLabel))
      const contacts = [r.phone, r.email, ...otherContacts(r)].filter(Boolean)
      const item = el('li', { className: 'mp-item', dataset: { i: String(i) } },
        el('span', { className: 'mp-item-main' },
          el('strong', {}, r.name),
          el('span', { className: 'muted small mp-item-desc' }, r.description || r.category || 'Usaha'),
          el('span', { className: 'muted small' }, r.address || 'Alamat belum tercatat'),
          el('span', { className: 'small mp-item-contacts' }, contacts.length ? contacts.join(' · ') : 'Kontak belum tercatat di peta')),
        el('span', { className: 'mp-item-side' }, Number.isFinite(r.distance_km) ? el('span', { className: 'muted small tnum' }, `${r.distance_km} km`) : null, r.demo ? C.tag('contoh', 'neutral') : null, pick))
      if (L && layer && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
        const mk = L.circleMarker([r.lat, r.lon], { radius: 7, weight: 2, color: '#16392E', fillColor: '#E7A13A', fillOpacity: 0.9 }).addTo(layer)
        mk.bindTooltip(r.name)
        mk.on('click', () => { item.scrollIntoView({ block: 'nearest' }); pick.focus() })
        markers.set(i, mk)
        bounds.push([r.lat, r.lon])
      }
      item.addEventListener('mouseenter', () => markers.get(i)?.setStyle({ radius: 10 }))
      item.addEventListener('mouseleave', () => markers.get(i)?.setStyle({ radius: 7 }))
      return item
    }))
    if (map && bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (searching) return
    status.hide?.()
    const kw = keyword.input.value.trim()
    const where = area.input.value.trim()
    if (kw.length < 2) { status.show('warn', 'Isi nama atau jenis usaha (minimal 2 huruf).'); keyword.input.focus(); return }
    if (where.length < 2) { status.show('warn', 'Isi kota atau area pencarian.'); area.input.focus(); return }
    ctl?.abort()
    ctl = new AbortController()
    const { signal } = ctl
    const mine = ++searchSeq
    const stale = () => signal.aborted || mine !== searchSeq
    lock(true)
    const restore = C.setBusy(go, 'Mencari…')
    list.replaceChildren(el('li', {}, C.skeletonRows(3)))
    try {
      const places = await geocode(where, { signal })
      if (stale()) return
      if (!places?.length) { list.replaceChildren(); status.show('warn', 'Area tidak ditemukan. Coba nama kota atau kecamatan.'); return }
      const center = places[0]
      await ensureMap(center)
      if (stale()) return
      const res = await searchLeads({ lat: center.lat, lon: center.lon, radiusKm: 5, keywords: [kw], signal })
      if (stale()) return
      render(res?.results || [], center.label)
      if (res?.results?.some((r) => r.demo)) status.show('info', 'Hasil di bawah adalah usaha contoh (akun demo).')
    } catch (ex) {
      if (mine !== searchSeq) return
      list.replaceChildren()
      if (ex.name === 'AbortError') status.show('info', 'Pencarian dibatalkan.')
      else status.show('danger', ex.status === 429 ? 'Batas pencarian tercapai. Coba lagi beberapa menit lagi.' : ex.message)
    } finally {
      if (mine === searchSeq) {
        if (list.querySelector('.skel-rows')) list.replaceChildren()
        const hadFocus = document.activeElement === stop
        restore()
        lock(false)
        if (hadFocus && m.dialog.open) (list.querySelector('.mp-item button') || keyword.input).focus()
      }
    }
  })
  requestAnimationFrame(() => keyword.input.focus())
  return m
}
