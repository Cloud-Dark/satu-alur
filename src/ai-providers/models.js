/**
 * Model lists for OpenAI-compatible and Anthropic-compatible providers (no I/O here):
 *   OpenAI-compatible     GET {base}/models            Bearer key       { data: [{ id }] }
 *   Anthropic-compatible  GET {base}/v1/models?limit=  x-api-key + anthropic-version
 *                         { data: [{ id, display_name }], has_more, last_id } (paged with after_id)
 * Providers that don't implement the list answer 404/405/501: the UI then allows typing a model.
 */
export const ANTHROPIC_VERSION = '2023-06-01'
export const MAX_MODEL_PAGES = 5

const anthropicBase = (baseUrl) => String(baseUrl).replace(/\/v1$/, '')

export function modelsRequest({ mode, baseUrl, apiKey, afterId }) {
  if (mode === 'anthropic') {
    const q = new URLSearchParams({ limit: '100' })
    if (afterId) q.set('after_id', afterId)
    return { url: `${anthropicBase(baseUrl)}/v1/models?${q}`, init: { method: 'GET', headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION } } }
  }
  return { url: `${baseUrl}/models`, init: { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } } }
}

const clean = (id) => (typeof id === 'string' && /^[\w.:@/-]{1,120}$/.test(id) ? id : null)

/** OpenAI-compatible list → [{ id, name }], sorted, de-duplicated. */
export function parseOpenAiModels(json) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : []
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const id = clean(typeof r === 'string' ? r : r?.id || r?.name)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: id })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** One Anthropic page → { models: [{ id, name }], hasMore, lastId }. */
export function parseAnthropicModels(json) {
  const models = (Array.isArray(json?.data) ? json.data : []).map((r) => {
    const id = clean(r?.id)
    return id ? { id, name: typeof r.display_name === 'string' && r.display_name ? `${r.display_name} (${id})` : id } : null
  }).filter(Boolean)
  return { models, hasMore: json?.has_more === true, lastId: typeof json?.last_id === 'string' ? json.last_id : null }
}

/** True when a provider answer means "this server has no model list". */
export const listUnsupported = (status) => [404, 405, 501].includes(Number(status))
