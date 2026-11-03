/**
 * "Cari dari peta" for the Permintaan wizard: search businesses on the open map
 * (OpenStreetMap via /api/leads/*, Google Places only when the server has a key;
 * demo accounts and mock mode get fictional data) and pick one to fill the
 * customer step. No Google Maps scraping.
 */
import * as C from '../ui/components.js'
import { geocode, searchLeads } from './api.js'
import { loadLeaflet, OSM_TILES, OSM_ATTRIBUTION } from './leaflet.js'
import { pickedFields } from './pick.js'

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
  const note = el('p', { className: 'muted small mp-note' }, 'Data dari peta terbuka (OpenStreetMap). Periksa lagi sebelum menghubungi.')
  const status = C.message()
  const list = el('ul', { className: 'mp-list', 'aria-live': 'polite' })
  const close = C.button({ label: 'Tutup', variant: 'ghost' })
  close.dataset.dismiss = ''
  const m = C.modal({
    title: 'Cari pelanggan dari peta',
    description: 'Ketik nama atau jenis usaha dan areanya, lalu pilih salah satu hasil.',
    children: [form, status, mapEl, note, list], actions: [close], opener, wide: true,
  })
  m.dialog.classList.add('mp-dialog')

  let L = null
  let map = null
  let layer = null
  let ctl = null
  const markers = new Map()
  m.dialog.addEventListener('close', () => { ctl?.abort(); map?.remove() })

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
      const item = el('li', { className: 'mp-item', dataset: { i: String(i) } },
        el('span', { className: 'mp-item-main' },
          el('strong', {}, r.name),
          el('span', { className: 'muted small' }, [r.category, r.address].filter(Boolean).join(' · ') || 'Alamat belum tercatat'),
          r.phone ? el('span', { className: 'small' }, r.phone) : null),
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
    status.hide?.()
    const kw = keyword.input.value.trim()
    const where = area.input.value.trim()
    if (kw.length < 2) { status.show('warn', 'Isi nama atau jenis usaha (minimal 2 huruf).'); keyword.input.focus(); return }
    if (where.length < 2) { status.show('warn', 'Isi kota atau area pencarian.'); area.input.focus(); return }
    ctl?.abort()
    ctl = new AbortController()
    const { signal } = ctl
    const restore = C.setBusy(go, 'Mencari…')
    list.replaceChildren(el('li', {}, C.skeletonRows(3)))
    try {
      const places = await geocode(where, { signal })
      if (!places?.length) { list.replaceChildren(); status.show('warn', 'Area tidak ditemukan. Coba nama kota atau kecamatan.'); return }
      const center = places[0]
      await ensureMap(center)
      const res = await searchLeads({ lat: center.lat, lon: center.lon, radiusKm: 5, keywords: [kw], signal })
      if (signal.aborted) return
      render(res?.results || [], center.label)
      if (res?.results?.some((r) => r.demo)) status.show('info', 'Hasil di bawah adalah usaha contoh (akun demo).')
    } catch (ex) {
      if (ex.name === 'AbortError') return
      list.replaceChildren()
      status.show('danger', ex.status === 429 ? 'Batas pencarian tercapai. Coba lagi beberapa menit lagi.' : ex.message)
    } finally { restore() }
  })
  requestAnimationFrame(() => keyword.input.focus())
  return m
}
