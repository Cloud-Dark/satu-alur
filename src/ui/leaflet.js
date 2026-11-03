/** Lazy Leaflet (only downloaded when a map opens) and the shared OSM base layer. */
let leafletPromise = null

export function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => mod.default || mod)
      .catch((err) => { leafletPromise = null; throw err })
  }
  return leafletPromise
}

export function addBaseLayer(L, map) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map)
  map.attributionControl.setPrefix(false)
}

/** Stops animations before removing, so pending transitions don't touch removed panes. */
export function disposeMap(map) {
  if (!map) return
  try { map.stop(); map.off(); map.remove() } catch { /* already torn down */ }
}
