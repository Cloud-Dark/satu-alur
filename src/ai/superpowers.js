import { getCloud } from '../cloud.js'
import { loadModels, pickDefaultModel, getModels } from './models.js'

/**
 * =========================================================
 * AI Superpowers Engine for Satu Alur
 * Multi-Agent | Memory | Tool Calling | Smart Retry | Analytics
 * =========================================================
 */

// ---- Conversation Memory ----
const MEMORY_KEY = 'satualur_ai_memory'
const MAX_HISTORY = 20

function loadMemory() {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}')
  } catch { return {} }
}

function saveMemory(memory) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory))
}

function getSessionId() {
  let sid = sessionStorage.getItem('satualur_session_id')
  if (!sid) {
    sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    sessionStorage.setItem('satualur_session_id', sid)
  }
  return sid
}

export function getConversationHistory(agent = 'default') {
  const memory = loadMemory()
  const sid = getSessionId()
  return (memory[sid]?.[agent] || []).slice(-MAX_HISTORY)
}

export function appendToHistory(agent, role, content) {
  const memory = loadMemory()
  const sid = getSessionId()
  if (!memory[sid]) memory[sid] = {}
  if (!memory[sid][agent]) memory[sid][agent] = []
  memory[sid][agent].push({ role, content, timestamp: Date.now() })
  // Trim old messages
  if (memory[sid][agent].length > MAX_HISTORY) {
    memory[sid][agent] = memory[sid][agent].slice(-MAX_HISTORY)
  }
  saveMemory(memory)
}

export function clearHistory(agent = 'default') {
  const memory = loadMemory()
  const sid = getSessionId()
  if (memory[sid]) delete memory[sid][agent]
  saveMemory(memory)
}

// ---- Tool Registry ----
export const TOOLS = {}

export function registerTool(name, spec, handler) {
  TOOLS[name] = { spec, handler }
}

// Built-in tools
registerTool('calculator', {
  description: 'Kalkulator untuk operasi matematika dasar',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Ekspresi matematika, contoh: 1500000 * 3 + 500000' }
    },
    required: ['expression']
  }
}, async ({ expression }) => {
  try {
    // Safe evaluation
    const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '')
    const result = Function('"use strict"; return (' + sanitized + ')')()
    return { result, expression: sanitized }
  } catch (e) {
    return { error: 'Ekspresi tidak valid: ' + e.message }
  }
})

registerTool('get_date', {
  description: 'Mendapatkan tanggal dan waktu saat ini dalam format Indonesia',
  parameters: { type: 'object', properties: {} }
}, async () => {
  const now = new Date()
  return {
    date: now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: now.toLocaleTimeString('id-ID'),
    iso: now.toISOString()
  }
})

registerTool('count_database', {
  description: 'Menghitung jumlah record di tabel database',
  parameters: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Nama tabel: requests, offers, assignments, completions, ledger_entries' }
    },
    required: ['table']
  }
}, async ({ table }) => {
  try {
    const cloud = getCloud()
    const { data, error } = await cloud.database.from(table).select('*')
    if (error) return { error: error.message }
    return { table, count: (data || []).length }
  } catch (e) {
    return { error: e.message }
  }
})

registerTool('format_rupiah', {
  description: 'Memformat angka ke format Rupiah Indonesia',
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Jumlah dalam angka' }
    },
    required: ['amount']
  }
}, async ({ amount }) => {
  return { formatted: 'Rp' + Number(amount).toLocaleString('id-ID') }
})

registerTool('generate_hashtags', {
  description: 'Menghasilkan hashtag yang relevan untuk konten media sosial',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topik konten, contoh: pembersihan AC Jakarta' },
      platform: { type: 'string', description: 'Platform: instagram, tiktok, facebook, linkedin' },
      count: { type: 'number', description: 'Jumlah hashtag yang diinginkan (default 10)' }
    },
    required: ['topic']
  }
}, async ({ topic, platform = 'instagram', count = 10 }) => {
  const baseTags = {
    jasa: ['#jasa', '#jasabersih', '#jasaprofesional', '#homecare', '#cleaningservice', '#jasaterpercaya', '#solusibersih'],
    ac: ['#ac', '#serviceac', '#pembersihanac', '#acsehat', '#acbersih', '#perawatanac', '#actips'],
    property: ['#property', '#rumahbersih', '#apartemen', '#officespace', '#properti', '#hunian', '#rumahidaman'],
  }
  const all = [...baseTags.jasa, ...baseTags.ac, ...baseTags.property]
  const shuffled = all.sort(() => 0.5 - Math.random())
  return {
    topic,
    platform,
    hashtags: shuffled.slice(0, Math.min(count, shuffled.length)),
    suggested: ['#' + topic.replace(/\s+/g, '').toLowerCase(), '#indonesia', '#tips']
  }
})

registerTool('suggest_demographics', {
  description: 'Memberikan rekomendasi targeting demografi untuk Meta Ads',
  parameters: {
    type: 'object',
    properties: {
      service_type: { type: 'string', description: 'Jenis layanan, contoh: pembersihan AC, cuci sofa' },
      location: { type: 'string', description: 'Lokasi target, contoh: Jakarta, Bandung' },
      budget: { type: 'number', description: 'Budget harian dalam Rupiah' }
    },
    required: ['service_type']
  }
}, async ({ service_type, location = 'Indonesia', budget = 50000 }) => {
  return {
    service_type,
    location,
    budget,
    demographics: {
      age_min: 25,
      age_max: 55,
      gender: 'all',
      interests: ['Home improvement', 'Cleaning services', 'Property management', 'Family & parenting'],
      behaviors: ['Engaged shoppers', 'Frequent travelers'],
    },
    placements: ['Feed', 'Stories', 'Reels'],
    estimated_reach_per_day: Math.floor(budget / 500),
    estimated_cpm: 'Rp450–750',
    best_posting_times: ['09:00–11:00', '13:00–15:00', '19:00–21:00'],
  }
})

// ---- Prompt Template Engine ----
export function renderTemplate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

// ---- Agent Definitions ----
const AGENTS = {
  offer: {
    name: 'Agen Penawaran',
    description: 'Membuat proposal penawaran profesional',
    systemPrompt: `Anda adalah agen penawaran untuk perusahaan jasa layanan di Indonesia.
Tugas Anda:
1. Analisis permintaan pelanggan (jenis layanan, lokasi, deskripsi)
2. Buat penawaran profesional dengan: scope, price, terms, notes
Aturan:
- Harga wajib realistis untuk pasar Indonesia
- Gunakan bahasa Indonesia profesional
- Sertakan garansi jika relevan
- Berikan estimasi waktu pengerjaan`,
    responseFormat: { type: 'json_object' },
    temperature: 0.4,
    tools: ['calculator', 'format_rupiah'],
  },
  report: {
    name: 'Analis Laporan',
    description: 'Menganalisis dan menjelaskan laporan keuangan',
    systemPrompt: `Anda adalah analis laporan keuangan untuk perusahaan jasa.
Tugas Anda:
1. Analisis data keuangan periode terkini
2. Buat penjelasan komprehensif dalam format HTML
Aturan:
- Gunakan bahasa Indonesia profesional
- Format dengan tag HTML
- Berikan insight actionable`,
    temperature: 0.7,
    tools: ['calculator', 'format_rupiah', 'count_database'],
  },
  general: {
    name: 'Asisten Umum',
    description: 'Asisten AI untuk pertanyaan umum tentang Satu Alur',
    systemPrompt: `Anda adalah asisten AI untuk platform Satu Alur — sistem operasional jasa terpadu.
Anda membantu pengguna dengan:
- Cara menggunakan fitur platform
- Penjelasan alur kerja (permintaan → penawaran → penugasan → penyelesaian → pembukuan → laporan)
- Tips mengoptimalkan bisnis jasa
- Troubleshooting teknis dasar
Selalu ramah, profesional, dan gunakan bahasa Indonesia.`,
    temperature: 0.7,
    tools: ['get_date', 'count_database', 'format_rupiah'],
  },
  analyst: {
    name: 'Analis Bisnis',
    description: 'Analis data bisnis dengan query database',
    systemPrompt: `Anda adalah analis bisnis AI. Anda memiliki akses ke database Satu Alur.
Gunakan tool count_database untuk mendapatkan data aktual.
Berikan analisis berbasis data: tren, pola, dan rekomendasi konkret.
Gunakan format Rupiah untuk semua angka keuangan.`,
    temperature: 0.5,
    tools: ['count_database', 'calculator', 'format_rupiah'],
  },
  social: {
    name: 'Social Media Expert',
    description: 'Ahli konten media sosial dan digital marketing',
    systemPrompt: `Anda adalah ahli social media marketing untuk bisnis jasa di Indonesia.
Tugas Anda:
1. Membuat copywriting engaging untuk Instagram, Facebook, TikTok, LinkedIn
2. Menyusun strategi konten yang sesuai target audience
3. Memberikan rekomendasi hashtag, waktu posting, dan demografi iklan
4. Membantu brainstorming ide konten kreatif
5. Membuat prompt untuk AI image generation
Aturan:
- Gunakan bahasa Indonesia yang natural dan engaging
- Sesuaikan tone dengan platform (casual untuk TikTok/IG, profesional untuk LinkedIn)
- Sertakan call-to-action yang kuat
- Berikan estimasi engagement rate yang realistis`,
    temperature: 0.8,
    tools: ['get_date', 'format_rupiah', 'count_database'],
  },
}

export function getAgents() {
  return Object.entries(AGENTS).map(([key, agent]) => ({ key, ...agent }))
}

// ---- Smart Retry with Fallback ----
async function* smartStream({ modelId, messages, options = {} }) {
  const cloud = getCloud()
  const models = getModels()
  const primaryModel = modelId || pickDefaultModel()?.id
  const fallbackModels = models
    .filter(m => m.id !== primaryModel && !m.disabled)
    .map(m => m.id)

  const candidates = [primaryModel, ...fallbackModels].filter(Boolean)
  let lastError = null

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const model = candidates[attempt]
    try {
      const stream = cloud.llm.chat.completions.create({
        model,
        messages,
        stream: true,
        ...options,
      })

      for await (const chunk of stream) {
        yield { type: 'chunk', chunk, model }
      }
      return
    } catch (err) {
      lastError = err
      if (err.name === 'AbortError') throw err
      // Exponential backoff before retry
      if (attempt < candidates.length - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw new Error(`Semua model gagal: ${lastError?.message}`)
}

// ---- Analytics Tracker ----
const ANALYTICS_KEY = 'satualur_ai_analytics'

export function trackAnalytics(event) {
  const data = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]')
  data.push({ ...event, timestamp: Date.now() })
  // Keep last 100 events
  if (data.length > 100) data.shift()
  localStorage.setItem(ANALYTICS_KEY, JSON.stringify(data))
}

export function getAnalytics() {
  return JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]')
}

export function getAnalyticsSummary() {
  const events = getAnalytics()
  const total = events.length
  const errors = events.filter(e => e.error).length
  const avgLatency = total > 0
    ? events.reduce((s, e) => s + (e.latency || 0), 0) / total
    : 0
  const byAgent = {}
  events.forEach(e => {
    byAgent[e.agent] = (byAgent[e.agent] || 0) + 1
  })
  return { total, errors, successRate: total ? ((total - errors) / total * 100).toFixed(1) : 0, avgLatency: Math.round(avgLatency), byAgent }
}

// ---- Main Chat with Superpowers ----
export async function* chatWithAgent({ agentKey, message, modelId, signal, useMemory = true, useTools = true }) {
  const agent = AGENTS[agentKey] || AGENTS.general
  const startTime = performance.now()
  let error = null

  try {
    // Build messages with history
    const messages = [{ role: 'system', content: agent.systemPrompt }]

    if (useMemory) {
      const history = getConversationHistory(agentKey)
      history.forEach(h => messages.push({ role: h.role, content: h.content }))
    }

    messages.push({ role: 'user', content: message })

    // If tools enabled, inject tool descriptions into system prompt
    const options = {
      temperature: agent.temperature ?? 0.7,
      max_tokens: 4000,
    }
    if (agent.responseFormat) {
      options.response_format = agent.responseFormat
    }

    let fullText = ''
    const streamedChunks = []

    for await (const { type, chunk } of smartStream({ modelId, messages, options })) {
      if (type === 'chunk') {
        if (signal?.aborted) throw new Error('AbortError')
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          streamedChunks.push(delta)
          yield { type: 'text', delta, full: fullText }
        }
      }
    }

    // Save to memory
    if (useMemory) {
      appendToHistory(agentKey, 'user', message)
      appendToHistory(agentKey, 'assistant', fullText)
    }

    // Try tool calling if enabled and text contains tool call markers
    if (useTools && agent.tools?.length > 0) {
      const toolResult = await tryToolCalls(fullText, agent.tools)
      if (toolResult) {
        yield { type: 'tool', result: toolResult }
        // Continue with tool-augmented response
        const toolMessages = [
          ...messages,
          { role: 'assistant', content: fullText },
          { role: 'system', content: `Hasil tool: ${JSON.stringify(toolResult)}\nBerikan respons akhir berdasarkan hasil tool.` }
        ]
        for await (const { type: t, chunk } of smartStream({ modelId, messages: toolMessages, options })) {
          if (t === 'chunk') {
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) yield { type: 'text', delta, full: fullText + delta }
          }
        }
      }
    }

    const latency = Math.round(performance.now() - startTime)
    trackAnalytics({ agent: agentKey, model: modelId, latency, error: null })

    yield { type: 'done', full: fullText, latency }

  } catch (err) {
    error = err.message
    trackAnalytics({ agent: agentKey, model: modelId, latency: Math.round(performance.now() - startTime), error })
    if (err.message === 'AbortError' || err.name === 'AbortError') throw err
    yield { type: 'error', message: error }
  }
}

// ---- Tool Call Parser ----
async function tryToolCalls(text, allowedTools) {
  // Simple heuristic: look for JSON code block with tool call
  const match = text.match(/```tool\n([\s\S]*?)\n```/)
  if (!match) return null

  try {
    const call = JSON.parse(match[1])
    const toolName = call.tool
    if (!allowedTools.includes(toolName)) return null
    const tool = TOOLS[toolName]
    if (!tool) return null
    const result = await tool.handler(call.parameters || {})
    return { tool: toolName, result }
  } catch {
    return null
  }
}

// ---- Convenience wrappers ----
export async function generateOfferSuper({ request, modelId, signal, onChunk }) {
  const generator = chatWithAgent({
    agentKey: 'offer',
    message: `Permintaan jasa:\n${JSON.stringify(request, null, 2)}`,
    modelId,
    signal,
    useMemory: false,
    useTools: true,
  })

  let fullText = ''
  for await (const event of generator) {
    if (event.type === 'text') {
      fullText = event.full
      onChunk?.(event.delta, event.full)
    }
    if (event.type === 'error') throw new Error(event.message)
  }

  try {
    return JSON.parse(fullText)
  } catch {
    throw new Error('Respons AI bukan JSON yang valid. Coba lagi.')
  }
}

export async function explainReportSuper({ report, modelId, signal, onChunk }) {
  const generator = chatWithAgent({
    agentKey: 'report',
    message: `Data laporan:\n${JSON.stringify(report, null, 2)}`,
    modelId,
    signal,
    useMemory: false,
    useTools: true,
  })

  let fullText = ''
  for await (const event of generator) {
    if (event.type === 'text') {
      fullText = event.full
      onChunk?.(event.delta, event.full)
    }
    if (event.type === 'error') throw new Error(event.message)
  }

  return fullText
}

export async function* generalChat({ message, modelId, signal }) {
  yield* chatWithAgent({ agentKey: 'general', message, modelId, signal, useMemory: true, useTools: true })
}

export async function* analystChat({ message, modelId, signal }) {
  yield* chatWithAgent({ agentKey: 'analyst', message, modelId, signal, useMemory: true, useTools: true })
}
