/**
 * Repliz Public API client (https://api.repliz.com/public), HTTP Basic auth with the business's own keys.
 * Errors come out as ReplizError with a friendly Indonesian message and the HTTP status the route should answer.
 */
const DEFAULT_BASE = 'https://api.repliz.com/public';
const TIMEOUT_MS = 20000;

export class ReplizError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function replizProblem(status, message = '') {
  if (status === 401 || status === 403) return 'Kunci Repliz ditolak. Periksa Access key dan Secret key di Media Sosial › Akun.';
  if (status === 402) return /storage/i.test(message) ? 'Penyimpanan media Repliz Anda penuh. Hapus berkas lama atau naikkan paket Repliz.' : 'Fitur ini butuh paket Repliz yang lebih tinggi.';
  if (status === 404) return 'Data media sosial tidak ditemukan.';
  if (status === 400) return 'Permintaan ditolak oleh platform media sosial. Periksa isinya lalu coba lagi.';
  if (status === 429) return 'Terlalu banyak permintaan. Coba lagi sebentar.';
  return 'Layanan media sosial sedang bermasalah. Coba lagi nanti.';
}

// cfg = { access_key, secret_key, base_url? } — the business's own Repliz workspace.
export function createRepliz(cfg, fetchImpl = fetch) {
  const base = String(cfg.base_url || DEFAULT_BASE).replace(/\/+$/, '');
  const auth = `Basic ${btoa(`${cfg.access_key}:${cfg.secret_key}`)}`;
  async function request(method, path, { query, body } = {}) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(url.toString(), {
        method,
        headers: { authorization: auth, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
    } catch (e) {
      throw new ReplizError(504, e?.name === 'AbortError' ? 'Layanan media sosial tidak menjawab. Coba lagi sebentar.' : 'Tidak dapat menghubungi layanan media sosial.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return null;
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw new ReplizError(res.status >= 500 ? 502 : res.status, replizProblem(res.status, json?.message));
    return json;
  }
  return {
    request,
    authorize: (platform, redirect) => request('GET', `/account/${platform}/authorize`, { query: { redirect } }),
    exchange: (platform, code) => request('POST', `/account/${platform}/exchange`, { body: { code } }),
    entities: (platform, entity, token) => request('GET', `/account/${platform}/${entity}`, { query: { token } }),
    connect: (platform, body, reconnectId) => request('POST', `/account/${platform}/connect${reconnectId ? `/${encodeURIComponent(reconnectId)}` : ''}`, { body }),
    accounts: () => request('GET', '/account', { query: { limit: 100 } }),
    account: (id) => request('GET', `/account/${encodeURIComponent(id)}`),
    removeAccount: (id) => request('DELETE', `/account/${encodeURIComponent(id)}`),
    count: () => request('GET', '/account/count'),
    boards: (accountId) => request('GET', '/addon/pinterest/board', { query: { accountId } }),
    createSchedule: (body) => request('POST', '/schedule', { body }),
    schedule: (id) => request('GET', `/schedule/${encodeURIComponent(id)}`),
    removeSchedule: (id) => request('DELETE', `/schedule/${encodeURIComponent(id)}`),
    initFile: (body) => request('POST', '/storage/file/init', { body }),
    completeFile: (id) => request('POST', `/storage/file/${encodeURIComponent(id)}/complete`),
  };
}

