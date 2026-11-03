/**
 * Per-business AI provider (business_integrations.ai_mode):
 *   builtin    Workers AI (default; metered by worker/quota.js)
 *   openai     OpenAI-compatible API with the business's own key
 *   anthropic  Anthropic-compatible API with the business's own key
 * Custom providers are paid by the business, so they never consume Satu Alur AI quota or
 * credit; each call is still counted in usage_counters under `byo_<feature>` for analytics.
 * Keys are AES-GCM encrypted with TOKEN_KEY; without TOKEN_KEY, or when an admin disallows
 * custom providers (system_settings.ai.allow_custom), everyone uses the built-in engine.
 */
import { decryptToken } from '../src/social/crypto.js';
import {
  openAiRequest, anthropicRequest, openAiToAppStream, anthropicToAppStream, providerErrorMessage, JSON_HINT,
} from '../src/ai-providers/providers.js';
import { loadSystemSettings, loadIntegration } from './email.js';

const PROVIDER_TIMEOUT_MS = 60000;

/** { mode: 'builtin' } or { mode, baseUrl, model, apiKey }. */
export async function resolveAi(env, user, { HttpError, DEMO_EMAILS }) {
  if (!env.TOKEN_KEY || DEMO_EMAILS?.has(String(user.email || '').toLowerCase())) return { mode: 'builtin' };
  const row = await loadIntegration(env, user.id);
  if (!row || row.ai_mode === 'builtin' || !row.ai_key_enc || !row.ai_base_url || !row.ai_model) return { mode: 'builtin' };
  const settings = await loadSystemSettings(env);
  if (!settings.ai.allow_custom) return { mode: 'builtin' };
  let apiKey;
  try { apiKey = await decryptToken(row.ai_key_enc, env.TOKEN_KEY); } catch { throw new HttpError(500, 'API key AI tersimpan tidak bisa dibuka. Simpan ulang di Pengaturan › Integrasi.'); }
  return { mode: row.ai_mode, baseUrl: row.ai_base_url, model: row.ai_model, apiKey };
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
