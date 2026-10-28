/**
 * Pencari prospek (B2B lead finder) — Worker routes.
 *
 *   POST /api/leads/search   { lat, lon, radius_km, keywords[], source? }
 *   GET  /api/leads/geocode?q=…
 *   GET  /api/leads/sources
 *
 * Data sources (legal only, no scraping):
 *   - OpenStreetMap Overpass API (default, no key). Results cached 24h per
 *     rounded point/radius/keywords in the Cache API plus a per-isolate map.
 *   - Nominatim for address search (cached 7 days, ≤1 request/s per isolate).
 *   - Google Places API (New) Text Search, only when the secret
 *     GOOGLE_PLACES_API_KEY is set and the client asks for source "google".
 *     Google results are not cached (Places terms restrict caching).
 *
 * Rate limit: 20 searches and 60 address lookups per user per hour, counted
 * in the Cache API (no D1 writes) with an in-memory fallback.
 */
import {
  validateKeywords, roundSearch, cacheKeyOf, buildOverpassQuery, leadsFromOverpass, inIndonesia,
  haversineKm, cleanPhone, cleanWebsite, dedupeLeads, MIN_RADIUS_KM, MAX_RADIUS_KM, MAX_RESULTS, OVERPASS_TIMEOUT_S,
} from '../src/leads/osm.js';

const USER_AGENT = 'SatuAlur/0.1 (lead finder for Indonesian service businesses; https://github.com/Cloud-Dark/satu-alur)';
const OVERPASS_DEFAULT = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GOOGLE_TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText';

const SEARCH_TTL_S = 24 * 60 * 60;
const GEOCODE_TTL_S = 7 * 24 * 60 * 60;
const SEARCHES_PER_HOUR = 20;
const GEOCODES_PER_HOUR = 60;
const CACHE_HOST = 'https://leads-cache.satu-alur.internal';

// Per-isolate fallbacks (the Cache API is a no-op on some hosts, e.g. *.workers.dev).
const memCache = new Map(); // key -> { exp, value }
const memCounters = new Map(); // key -> count
let lastNominatimAt = 0;

function memGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { memCache.delete(key); return null; }
  return hit.value;
}
function memSet(key, value, ttlS) {
  if (memCache.size > 200) memCache.delete(memCache.keys().next().value);
  memCache.set(key, { exp: Date.now() + ttlS * 1000, value });
}

const cacheUrl = (kind, key) => `${CACHE_HOST}/${kind}?k=${encodeURIComponent(key)}`;
const hasCacheApi = () => typeof caches !== 'undefined' && caches?.default;

async function cacheGet(kind, key) {
  const mem = memGet(`${kind}:${key}`);
  if (mem) return mem;
  if (!hasCacheApi()) return null;
  try {
    const res = await caches.default.match(cacheUrl(kind, key));
    if (!res) return null;
    const value = await res.json();
    memSet(`${kind}:${key}`, value, 300);
    return value;
  } catch {
    return null;
  }
}
async function cachePut(kind, key, value, ttlS) {
  memSet(`${kind}:${key}`, value, ttlS);
  if (!hasCacheApi()) return;
  try {
    await caches.default.put(cacheUrl(kind, key), new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlS}` },
    }));
  } catch { /* best effort */ }
}

/** Light per-user hourly counter. Throws 429 when the limit is reached. */
async function rateLimit(userId, bucket, max, HttpError) {
  const slot = Math.floor(Date.now() / 3_600_000);
  const key = `${bucket}:${userId}:${slot}`;
  let n = memCounters.get(key) || 0;
  if (hasCacheApi()) {
    try {
      const hit = await caches.default.match(cacheUrl('rl', key));
      if (hit) n = Math.max(n, Number(await hit.text()) || 0);
    } catch { /* ignore */ }
  }
  if (n >= max) throw new HttpError(429, `Batas ${max} ${bucket === 'search' ? 'pencarian' : 'pencarian alamat'} per jam tercapai. Coba lagi nanti.`);
  n += 1;
  if (memCounters.size > 2000) memCounters.clear();
  memCounters.set(key, n);
  if (hasCacheApi()) {
    try {
      await caches.default.put(cacheUrl('rl', key), new Response(String(n), { headers: { 'cache-control': 'public, max-age=3600' } }));
    } catch { /* ignore */ }
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN;
}

/** Strict request validation. Returns the cleaned search. */
export function parseSearchBody(body, HttpError) {
  const lat = num(body.lat);
  const lon = num(body.lon);
  const radiusKm = num(body.radius_km);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new HttpError(400, 'Koordinat tidak valid.');
  }
  if (!inIndonesia(lat, lon)) throw new HttpError(400, 'Pencarian prospek saat ini hanya untuk wilayah Indonesia.');
  if (!Number.isFinite(radiusKm) || radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) {
    throw new HttpError(400, `Radius harus ${MIN_RADIUS_KM}–${MAX_RADIUS_KM} km.`);
  }
  const { keywords, error } = validateKeywords(body.keywords);
  if (error) throw new HttpError(400, error);
  const source = body.source === undefined || body.source === null ? 'osm' : body.source;
  if (source !== 'osm' && source !== 'google') throw new HttpError(400, 'Sumber data tidak dikenal.');
  return { lat, lon, radiusKm, keywords, source };
}

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function searchOverpass(env, search, HttpError) {
  const r = roundSearch(search);
  const query = buildOverpassQuery({ lat: r.lat, lon: r.lon, radiusKm: r.radiusKm, keywords: r.keywords, limit: 250 });
  const endpoints = [env.OVERPASS_URL || OVERPASS_DEFAULT];
  let lastErr = null;
  for (const url of endpoints) {
    let res;
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      }, (OVERPASS_TIMEOUT_S + 5) * 1000);
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      throw new HttpError(503, 'Server OpenStreetMap (Overpass) sedang sibuk. Coba lagi beberapa menit lagi atau perkecil radius.');
    }
    if (!res.ok) {
      lastErr = new Error(`Overpass HTTP ${res.status}`);
      continue;
    }
    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new HttpError(502, 'Jawaban OpenStreetMap tidak dapat dibaca. Coba perkecil radius.');
    }
    if (payload?.remark && /runtime error|timed out|out of memory/i.test(payload.remark) && !(payload.elements || []).length) {
      throw new HttpError(503, 'Pencarian terlalu berat untuk OpenStreetMap. Perkecil radius atau kurangi kriteria.');
    }
    const results = leadsFromOverpass(payload, { origin: { lat: r.lat, lon: r.lon }, radiusKm: r.radiusKm, keywords: r.keywords });
    return { results, truncated: (payload.elements || []).length >= 250 };
  }
  console.error('Overpass unreachable', lastErr);
  throw new HttpError(502, 'OpenStreetMap (Overpass) tidak dapat dihubungi saat ini. Coba lagi nanti.');
}

const GOOGLE_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types',
  'places.primaryTypeDisplayName', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri', 'places.businessStatus',
].join(',');

async function searchGoogle(env, search, HttpError) {
  const origin = { lat: search.lat, lon: search.lon };
  const rows = [];
  for (const keyword of search.keywords) {
    let res;
    try {
      res = await fetchWithTimeout(GOOGLE_TEXT_SEARCH, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GOOGLE_PLACES_API_KEY,
          'x-goog-fieldmask': GOOGLE_FIELDS,
        },
        body: JSON.stringify({
          textQuery: keyword,
          languageCode: 'id',
          regionCode: 'ID',
          pageSize: 20,
          locationBias: { circle: { center: { latitude: search.lat, longitude: search.lon }, radius: Math.min(50000, search.radiusKm * 1000) } },
        }),
      }, 15000);
    } catch (e) {
      console.error('Google Places unreachable', e);
      throw new HttpError(502, 'Google Places tidak dapat dihubungi saat ini.');
    }
    if (!res.ok) {
      console.error('Google Places HTTP', res.status, await res.text().catch(() => ''));
      throw new HttpError(502, 'Google Places menolak permintaan. Periksa kunci API dan kuotanya.');
    }
    const data = await res.json().catch(() => ({}));
    for (const p of data.places || []) {
      const lat = p.location?.latitude;
      const lon = p.location?.longitude;
      const name = String(p.displayName?.text || '').trim();
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || p.businessStatus === 'CLOSED_PERMANENTLY') continue;
      const d = haversineKm(origin, { lat, lon });
      if (d > search.radiusKm + 0.05) continue;
      rows.push({
        id: `google:${p.id}`,
        source: 'google',
        source_id: String(p.id),
        name: name.slice(0, 120),
        category: String(p.primaryTypeDisplayName?.text || keyword),
        tags: { types: (p.types || []).slice(0, 6).join(';') },
        lat, lon,
        address: String(p.formattedAddress || '').slice(0, 200),
        phone: cleanPhone(p.internationalPhoneNumber || p.nationalPhoneNumber),
        website: cleanWebsite(p.websiteUri),
        distance_km: Math.round(d * 100) / 100,
        matched: [keyword],
      });
    }
  }
  return { results: dedupeLeads(rows.sort((a, b) => a.distance_km - b.distance_km)).slice(0, MAX_RESULTS), truncated: false };
}

export async function handleLeadSearch(request, env, { authenticate, readJson, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  const search = parseSearchBody(await readJson(request, 8 * 1024), HttpError);
  const googleOn = Boolean(env.GOOGLE_PLACES_API_KEY);
  if (search.source === 'google' && !googleOn) throw new HttpError(400, 'Google Places belum diaktifkan di server ini.');

  const key = cacheKeyOf(search, search.source);
  if (search.source === 'osm') {
    const hit = await cacheGet('search', key);
    if (hit) return ok({ ...hit, cached: true });
  }
  await rateLimit(user.id, 'search', SEARCHES_PER_HOUR, HttpError);

  const r = roundSearch(search);
  const { results, truncated } = search.source === 'google' ? await searchGoogle(env, search, HttpError) : await searchOverpass(env, search, HttpError);
  const data = {
    source: search.source,
    attribution: search.source === 'google' ? 'Data © Google' : '© OpenStreetMap contributors (ODbL)',
    center: { lat: r.lat, lon: r.lon },
    radius_km: r.radiusKm,
    keywords: r.keywords,
    truncated,
    fetched_at: new Date().toISOString(),
    results,
  };
  if (search.source === 'osm') await cachePut('search', key, data, SEARCH_TTL_S);
  return ok({ ...data, cached: false });
}

export async function handleLeadGeocode(request, env, { authenticate, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  const q = String(new URL(request.url).searchParams.get('q') || '').replace(/\s+/g, ' ').trim();
  if (q.length < 3 || q.length > 120 || /[<>{}\\]/.test(q)) throw new HttpError(400, 'Alamat minimal 3 huruf dan maksimal 120 karakter.');
  const key = q.toLowerCase();
  const hit = await cacheGet('geo', key);
  if (hit) return ok(hit);
  await rateLimit(user.id, 'geocode', GEOCODES_PER_HOUR, HttpError);

  // Nominatim usage policy: at most 1 request per second.
  const wait = lastNominatimAt + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 1000)));
  lastNominatimAt = Date.now();

  const url = `${NOMINATIM_URL}?${new URLSearchParams({ format: 'json', countrycodes: 'id', limit: '6', 'accept-language': 'id', q })}`;
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json', referer: 'https://satu-alur.apipedia.workers.dev/' } }, 10000);
  } catch (e) {
    console.error('Nominatim unreachable', e);
    throw new HttpError(502, 'Layanan pencarian alamat (Nominatim) tidak dapat dihubungi.');
  }
  if (res.status === 429) throw new HttpError(503, 'Layanan pencarian alamat sedang membatasi permintaan. Coba lagi sebentar lagi.');
  if (!res.ok) throw new HttpError(502, 'Layanan pencarian alamat sedang bermasalah.');
  const rows = await res.json().catch(() => []);
  const data = (Array.isArray(rows) ? rows : []).map((x) => ({
    label: String(x.display_name || '').slice(0, 200),
    lat: Math.round(Number(x.lat) * 1e6) / 1e6,
    lon: Math.round(Number(x.lon) * 1e6) / 1e6,
    type: String(x.addresstype || x.type || ''),
  })).filter((x) => x.label && Number.isFinite(x.lat) && Number.isFinite(x.lon));
  await cachePut('geo', key, data, GEOCODE_TTL_S);
  return ok(data);
}

export async function handleLeadSources(request, env, { authenticate, ok }) {
  await authenticate(request, env);
  return ok({ osm: true, google: Boolean(env.GOOGLE_PLACES_API_KEY), max_radius_km: MAX_RADIUS_KM, searches_per_hour: SEARCHES_PER_HOUR });
}
