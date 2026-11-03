/**
 * Per-business AI provider (business_integrations.ai_mode):
 *   builtin    Workers AI (default; metered by worker/quota.js)
 *   openai     OpenAI-compatible API with the business's own key
 *   anthropic  Anthropic-compatible API with the business's own key
 * Custom providers are paid by the business, so they never consume Satu Alur AI quota or
 * credit; each call is still counted in usage_counters under `byo_<feature>` for analytics.
 * Keys are AES-GCM encrypted with TOKEN_KEY; without TOKEN_KEY, or when an admin disallows
 * custom providers (system_settings.ai.allow_custom), everyone uses the built-in engine.
 *
 * The built-in engine itself is chosen by admins (system_settings 'ai_provider'): Workers AI by
 * default, or a platform OpenAI-/Anthropic-compatible provider. Platform calls are still metered
 * like Workers AI; if the platform provider fails before streaming, the call falls back to
 * Workers AI and the fallback is written to admin_audit (shown in Log aktivitas).
 */
import { decryptToken } from '../src/social/crypto.js';
import { isDemoUser } from './demo.js';
import {
  openAiRequest, anthropicRequest, openAiToAppStream, anthropicToAppStream, providerErrorMessage, JSON_HINT,
} from '../src/ai-providers/providers.js';
import { loadSystemSettings, loadIntegration } from './email.js';
import { modelsRequest, parseOpenAiModels, parseAnthropicModels, listUnsupported, MAX_MODEL_PAGES } from '../src/ai-providers/models.js';

export const PLATFORM_AI_KEY = 'ai_provider';

/** Stored platform provider (raw, includes key_enc) or { mode: 'workers' }. */
export async function loadPlatformAi(env) {
  try {
    const row = await env.DB.prepare('SELECT value_json FROM system_settings WHERE key = ?').bind(PLATFORM_AI_KEY).first();
    const v = row ? JSON.parse(row.value_json) : null;
    return v && (v.mode === 'openai' || v.mode === 'anthropic') ? v : { mode: 'workers' };
  } catch (err) {
    if (/no such table/i.test(String(err?.message)) || err instanceof SyntaxError) return { mode: 'workers' };
    throw err;
  }
}

async function platformProvider(env) {
  const p = await loadPlatformAi(env);
  if (p.mode === 'workers' || !p.key_enc || !p.base_url || !p.model) return null;
  let apiKey;
  try { apiKey = await decryptToken(p.key_enc, env.TOKEN_KEY); } catch { return null; }
  return { mode: p.mode, baseUrl: p.base_url, model: p.model, apiKey, platform: true, defaults: { max_tokens: p.max_tokens, temperature: p.temperature } };
}

const PROVIDER_TIMEOUT_MS = 60000;

/**
 * { mode: 'builtin' } (Workers AI), a business's own provider { mode, baseUrl, model, apiKey },
 * or the platform provider { ..., platform: true, defaults }.
 */
export async function resolveAi(env, user, { HttpError }) {
  if (!env.TOKEN_KEY || isDemoUser(user)) return { mode: 'builtin' };
  const row = await loadIntegration(env, user.id);
  if (row && row.ai_mode !== 'builtin' && row.ai_key_enc && row.ai_base_url && row.ai_model) {
    const settings = await loadSystemSettings(env);
    if (settings.ai.allow_custom) {
      let apiKey;
      try { apiKey = await decryptToken(row.ai_key_enc, env.TOKEN_KEY); } catch { throw new HttpError(500, 'API key AI tersimpan tidak bisa dibuka. Simpan ulang di Pengaturan › Integrasi.'); }
      return { mode: row.ai_mode, baseUrl: row.ai_base_url, model: row.ai_model, apiKey };
    }
  }
  return (await platformProvider(env)) || { mode: 'builtin' };
}

let lastFallbackLog = 0;
/** Records that the platform provider failed and Workers AI answered instead (at most once a minute per isolate). */
export async function logAiFallback(env, provider, reason) {
  const now = Date.now();
  if (now - lastFallbackLog < 60000) return;
  lastFallbackLog = now;
  try {
    await env.DB.prepare('INSERT INTO admin_audit (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('sistem', 'ai.fallback', `${provider.mode}:${provider.model}`, String(reason || '').slice(0, 300), new Date().toISOString()).run();
  } catch (err) {
    console.error('ai fallback log failed', err);
  }
}

/**
 * Lists a provider's models server-side. Returns { supported, models }; supported=false when the
 * server has no list endpoint (the UI then lets the admin type a model). Throws HttpError(502) otherwise.
 */
export async function listProviderModels(provider, { HttpError, fetchImpl = fetch }) {
  const models = [];
  let afterId = null;
  for (let page = 0; page < (provider.mode === 'anthropic' ? MAX_MODEL_PAGES : 1); page++) {
    const req = modelsRequest({ mode: provider.mode, baseUrl: provider.baseUrl, apiKey: provider.apiKey, afterId });
    let res;
    try {
      res = await fetchImpl(req.url, { ...req.init, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new HttpError(502, 'Penyedia AI tidak bisa dihubungi. Periksa alamat API.');
    }
    if (listUnsupported(res.status)) return { supported: false, models: [] };
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    if (!res.ok) throw new HttpError(502, providerErrorMessage(res.status, body));
    let json;
    try { json = JSON.parse(body); } catch { return { supported: false, models: [] }; }
    if (provider.mode !== 'anthropic') return { supported: true, models: parseOpenAiModels(json) };
    const p = parseAnthropicModels(json);
    models.push(...p.models);
    if (!p.hasMore || !p.lastId) break;
    afterId = p.lastId;
  }
  return { supported: true, models };
}

export async function countByo(env, userId, feature) {
  const period = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
  try {
    await env.DB.prepare(
      `INSERT INTO usage_counters (user_id, feature, period, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, feature, period) DO UPDATE SET count = count + 1`,
    ).bind(userId, `byo_${feature}`, period).run();
  } catch (err) {
    console.error('byo usage count failed', err);
  }
}

/**
 * Streams a chat through the custom provider, as the app's SSE contract.
 * params: { messages, temperature?, max_tokens?, schema?, json? }. Returns a Response-ready ReadableStream
 * or throws HttpError(502) when the provider refuses before streaming.
 */
export async function customChatStream(provider, params, { HttpError, fetchImpl = fetch }) {
  const json = Boolean(params.schema || params.json);
  let messages = params.messages;
  let req;
  if (provider.mode === 'anthropic') {
    req = anthropicRequest({ ...provider, messages, temperature: params.temperature, max_tokens: params.max_tokens, json, schema: params.schema });
  } else {
    // JSON mode as an instruction: many OpenAI-compatible servers reject json_schema/json_object.
    if (json) {
      const hint = params.schema ? `${JSON_HINT} The JSON must match this JSON schema: ${JSON.stringify(params.schema).slice(0, 6000)}` : JSON_HINT;
      messages = [{ role: 'system', content: hint }, ...messages];
    }
    req = openAiRequest({ ...provider, messages, temperature: params.temperature, max_tokens: params.max_tokens });
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROVIDER_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(req.url, { ...req.init, signal: ac.signal });
  } catch {
    clearTimeout(timer);
    throw new HttpError(502, 'Penyedia AI Anda tidak bisa dihubungi. Periksa alamat API di Pengaturan › Integrasi.');
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    let text = '';
    try { text = await res.text(); } catch { /* ignore */ }
    throw new HttpError(502, providerErrorMessage(res.status, text));
  }
  const transform = provider.mode === 'anthropic' ? anthropicToAppStream() : openAiToAppStream();
  const out = res.body.pipeThrough(transform);
  // Clear the connect timeout once the stream ends.
  return out.pipeThrough(new TransformStream({ flush() { clearTimeout(timer); } }));
}

/** One short round-trip to prove the key, URL and model work. Returns the reply text. */
export async function testProvider(provider, { HttpError, fetchImpl = fetch }) {
  const stream = await customChatStream(provider, {
    messages: [{ role: 'user', content: 'Balas hanya dengan kata: OK' }], max_tokens: 16, temperature: 0,
  }, { HttpError, fetchImpl });
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = '';
  let error = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split('\n')) {
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try {
        const obj = JSON.parse(line.slice(5));
        if (obj.error) error = obj.error.message;
        text += obj.choices?.[0]?.delta?.content || '';
      } catch { /* partial line */ }
    }
  }
  if (error) throw new HttpError(502, error);
  return text.trim().slice(0, 200);
}
