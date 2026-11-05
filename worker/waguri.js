/**
 * POST /api/waguri/public — "Tanya Waguri" for signed-out visitors (landing, login, …).
 *
 * Public knowledge only: the client sends a skill id, the question and a few recent turns;
 * the Worker builds the whole prompt itself from src/waguri/knowledge.js (public scope) and
 * the active plans, so no client text can become the system prompt and no account data is
 * ever read. Not metered (there is no account); limited instead per IP (hashed) and in total
 * per hour, counted per isolate plus the Cache API (best effort, like worker/leads.js).
 *
 * Model: the admin's platform provider ("Bawaan Satu Alur", Sistem › AI) when configured,
 * otherwise Workers AI with the default model from system settings.
 * Helpers are injected by worker/index.js (HttpError, readJson, sha256Hex, sseResponse,
 * translateStream, LLM_MODELS, platformProvider, customChatStream, loadSystemSettings).
 */
import { SKILLS, PUBLIC_SKILL_IDS, buildMessages } from '../src/waguri/skills.js';
import { knowledgeText } from '../src/waguri/knowledge.js';
import { ipBucket } from '../src/customers/rules.js';

export const PUBLIC_LIMITS = { perIp: 20, total: 600 };
const MAX_QUESTION = 800;
const MAX_TURNS = 6;
const MAX_TOKENS = 450;
const CACHE_HOST = 'https://waguri-rl.satualur.internal';

const mem = new Map(); // `${bucket}:${slot}` -> count (per isolate)
const hasCacheApi = () => typeof caches !== 'undefined' && caches?.default;

/** Adds one to an hourly counter; returns false when the limit was already reached. */
async function take(bucket, max, now = Date.now()) {
  const slot = Math.floor(now / 3_600_000);
  const key = `${bucket}:${slot}`;
  let n = mem.get(key) || 0;
  const url = `${CACHE_HOST}/rl?k=${encodeURIComponent(key)}`;
  if (hasCacheApi()) {
    try {
      const hit = await caches.default.match(url);
      if (hit) n = Math.max(n, Number(await hit.text()) || 0);
    } catch { /* best effort */ }
  }
  if (n >= max) return false;
  n += 1;
  if (mem.size > 5000) mem.clear();
  mem.set(key, n);
  if (hasCacheApi()) {
    try { await caches.default.put(url, new Response(String(n), { headers: { 'cache-control': 'public, max-age=3600' } })); } catch { /* best effort */ }
  }
  return true;
}
export const _resetLimits = () => mem.clear();

/** Validates the body: { skill, question, history: [{ role: 'user'|'assistant', content }] }. */
export function readPublicBody(body, HttpError) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Permintaan tidak valid.');
  const skillId = PUBLIC_SKILL_IDS.includes(body.skill) ? body.skill : PUBLIC_SKILL_IDS[0];
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) throw new HttpError(400, 'Pertanyaan kosong.');
  if (question.length > MAX_QUESTION) throw new HttpError(400, 'Pertanyaan terlalu panjang.');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_TURNS)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, text: m.content.slice(0, MAX_QUESTION) }));
  return { skill: SKILLS.find((s) => s.id === skillId), question, history };
}

export async function handleWaguriPublic(request, env, deps) {
  const { HttpError } = deps;
  const { skill, question, history } = readPublicBody(await deps.readJson(request, 16 * 1024), HttpError);

  const ip = ipBucket(request.headers.get('CF-Connecting-IP')) || 'unknown';
  const ipHash = await deps.sha256Hex(`waguri:${ip}:${env.TOKEN_KEY || 'satu-alur-waguri'}`);
  if (!(await take(`ip:${ipHash}`, PUBLIC_LIMITS.perIp))) throw new HttpError(429, 'Batas pertanyaan per jam tercapai. Coba lagi nanti, atau masuk untuk bertanya lebih banyak.');
  if (!(await take('all', PUBLIC_LIMITS.total))) throw new HttpError(429, 'Waguri sedang ramai. Coba lagi beberapa menit lagi.');

  let plans = null;
  try { plans = deps.activePlans ? await deps.activePlans(env) : null; } catch { plans = null; }
  const context = knowledgeText('public', { plans, only: skill.only });
  const messages = buildMessages({ skill, question, context, history });

  const provider = deps.platformProvider ? await deps.platformProvider(env) : null;
  if (provider) {
    try {
      const stream = await deps.customChatStream(provider, { messages, temperature: 0.4, max_tokens: MAX_TOKENS }, { HttpError });
      return deps.sseResponse(stream);
    } catch (err) {
      console.error('waguri platform provider failed', err?.message);
    }
  }
  const settings = await deps.loadSystemSettings(env);
  const model = deps.LLM_MODELS.some((m) => m.id === settings?.ai?.default_model) ? settings.ai.default_model : deps.LLM_MODELS[0].id;
  let out;
  try {
    out = await env.AI.run(model, { messages, stream: true, max_tokens: MAX_TOKENS, temperature: 0.4 });
  } catch (err) {
    console.error('waguri AI.run failed', err);
    throw new HttpError(502, 'Layanan AI tidak tersedia.');
  }
  if (out instanceof ReadableStream) return deps.sseResponse(deps.translateStream(out));
  const text = typeof out?.response === 'string' ? out.response : '';
  const enc = new TextEncoder();
  return deps.sseResponse(new ReadableStream({
    start(c) {
      if (text) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  }));
}
