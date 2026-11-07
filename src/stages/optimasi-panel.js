/**
 * Ruang Optimasi — the shared multi-team panel used by both Layanan Tambahan
 * (VAS) and Tanpa Limbah.
 *
 * One brief goes in, five teams answer in parallel, and a lead agent merges
 * them into a ranked plan. A run lives at module level, so leaving the page
 * does not throw away work in progress: coming back re-attaches to it.
 */
import '../styles/pendapatan.css'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { resolveModel } from './offer.js'
import { TEAMS, TEAM_KEYS, LEAD, SCOPE_LABEL, runOptimization } from '../ai/teams.js'
import { t, getLang } from '../i18n/index.js'

const { el, icon } = C
const STORE = 'satualur_opt_run_v1:'

/** scope -> job. Jobs outlive the mounted page on purpose. */
const jobs = new Map()

const PHASES = ['idle', 'working', 'done', 'error', 'stopped']
const phaseLabel = (state) => (PHASES.includes(state) ? t(`optimize.phase.${state}`) : state)

/* ------------------------------------------------------------ Markdown */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')

/** Small, deliberately narrow markdown → HTML for model output. */
function mdToHtml(src) {
  const out = []
  let list = null
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const raw of String(src || '').split('\n')) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    const h = line.match(/^#{1,4}\s+(.*)$/)
    if (h) { closeList(); out.push(`<h4>${inline(h[1])}</h4>`); continue }
    const ol = line.match(/^\d+[.)]\s+(.*)$/)
    if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    const ul = line.match(/^[-*•]\s+(.*)$/)
    if (ul) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('')
}

function writeMarkdown(node, text) {
  node.innerHTML = C.sanitizeHTML(mdToHtml(text))
}

/* --------------------------------------------------------------- Storage */

function loadRun(scope) {
  try {
    const raw = JSON.parse(localStorage.getItem(`${STORE}${scope}`) || 'null')
    if (!raw || !raw.brief) return null
    return {
      brief: raw.brief,
      teams: raw.teams || {},
      status: Object.fromEntries(TEAM_KEYS.map((k) => [k, raw.teams?.[k] ? 'done' : 'idle'])),
      lead: raw.lead || '',
      phase: raw.lead ? 'done' : 'idle',
      error: null,
      at: raw.at || null,
      listeners: new Set(),
      ac: null,
    }
  } catch { return null }
}

function saveRun(scope, job) {
  try {
    localStorage.setItem(`${STORE}${scope}`, JSON.stringify({
      brief: job.brief, teams: job.teams, lead: job.lead, at: new Date().toISOString(),
    }))
  } catch { /* storage full or disabled: the run still shows until reload */ }
}

/* ---------------------------------------------------------------- Panel */

/**
 * renderOptimasi(host, ctx, opts)
 *   scope    'vas' | 'waste'
 *   context  plain-text business numbers handed to every team
 *   facts    [{ label, value }] shown to the user as "what the teams read"
 *   presets  [{ label, problem, target }] one-tap briefs
 */
export function renderOptimasi(host, ctx = {}, { scope, context = '', facts = [], presets = [] }) {
  const scopeLabel = SCOPE_LABEL[scope] ? t(`optimize.scope.${scope}`) : scope
  const runKey = `${ctx.user?.id || 'anon'}:${scope}`
  let job = jobs.get(runKey) || loadRun(runKey)
  if (job) jobs.set(runKey, job)

  const status = C.message()

  /* ---- Brief form ---- */
  const problem = C.textarea({
    label: t('optimize.form.problem'),
    id: `opt-problem-${scope}`,
    required: true,
    rows: 3,
    placeholder: scope === 'vas'
      ? t('optimize.form.problemPlaceholderVas')
      : t('optimize.form.problemPlaceholderWaste'),
  })
  const target = C.field({
    label: t('optimize.form.target'),
    id: `opt-target-${scope}`,
    type: 'number',
    hint: t('optimize.form.targetHint'),
    attrs: { min: '0', step: '50000', inputmode: 'numeric' },
  })
  const note = C.field({
    label: t('optimize.form.note'),
    id: `opt-note-${scope}`,
    placeholder: t('optimize.form.notePlaceholder'),
  })

  if (job?.brief) {
    problem.input.value = job.brief.problem || ''
    target.input.value = job.brief.target || ''
    note.input.value = job.brief.note || ''
  }

  const presetRow = presets.length
    ? el('div', { className: 'opt-presets', role: 'group', 'aria-label': t('optimize.form.presets') },
        presets.map((p) => C.button({
          label: p.label, size: 'sm', variant: 'ghost', className: 'opt-preset',
          onClick: () => {
            problem.input.value = p.problem
            if (p.target) target.input.value = String(p.target)
            problem.input.focus()
          },
        })))
    : null

  const runBtn = C.button({ label: t('optimize.form.run'), icon: 'zap', variant: 'primary', type: 'submit' })
  const stopBtn = C.button({ label: t('optimize.form.stop'), icon: 'stop', variant: 'ghost', hidden: true })

  const briefForm = el('form', { className: 'opt-brief panel', noValidate: true },
    el('div', { className: 'panel-head' },
      el('div', { className: 'panel-head-text' },
        el('h2', { className: 'panel-title' }, t('optimize.form.title', { scope: getLang() === 'en' ? scopeLabel : scopeLabel.toLowerCase() })),
        el('span', { className: 'panel-meta' }, t('optimize.form.meta')),
      ),
    ),
    el('div', { className: 'panel-body' },
      el('div', { className: 'opt-form-grid' }, problem.wrap, target.wrap, note.wrap),
      presetRow,
      el('div', { className: 'opt-actions' }, runBtn, stopBtn),
    ),
  )

  /* ---- What the teams read ---- */
  const factList = facts.length
    ? el('ul', { className: 'opt-facts' },
        facts.map((f) => el('li', {},
          el('span', { className: 'opt-fact-label' }, f.label),
          el('span', { className: 'opt-fact-value tnum' }, f.value))))
    : null
  const factsPanel = el('section', { className: 'opt-context' },
    el('p', { className: 'opt-context-title' }, icon('info', { size: 16 }), t('optimize.facts.title')),
    factList || el('p', { className: 'opt-context-empty' }, t('optimize.facts.empty')),
  )

  /* ---- Team cards ---- */
  const cards = {}
  const teamGrid = el('div', { className: 'opt-teams' })
  for (const key of TEAM_KEYS) {
    const team = TEAMS[key]
    const body = el('div', { className: 'opt-team-body' })
    const badge = el('span', { className: 'opt-team-state' }, phaseLabel('idle'))
    const card = el('article', { className: 'opt-team', 'data-state': 'idle', 'aria-live': 'polite' },
      el('header', { className: 'opt-team-head' },
        el('span', { className: 'opt-team-ico', 'aria-hidden': 'true' }, icon(team.icon, { size: 18 })),
        el('div', { className: 'opt-team-id' },
          el('h3', { className: 'opt-team-name' }, t(`optimize.teams.${key}.name`)),
          el('p', { className: 'opt-team-role' }, t(`optimize.teams.${key}.role`)),
        ),
        badge,
      ),
      body,
    )
    cards[key] = { card, body, badge }
    teamGrid.append(card)
  }

  /* ---- Lead ---- */
  const leadBody = el('div', { className: 'opt-md' })
  const leadMeta = el('span', { className: 'panel-meta' }, t('optimize.lead.waiting'))
  const leadPanel = el('section', { className: 'panel opt-lead' },
    el('div', { className: 'panel-head' },
      el('div', { className: 'panel-head-text' },
        el('h2', { className: 'panel-title' }, t('optimize.lead.name')),
        leadMeta,
      ),
      el('div', { className: 'panel-actions' }, el('span', { className: 'opt-lead-ico', 'aria-hidden': 'true' }, icon(LEAD.icon, { size: 18 }))),
    ),
    el('div', { className: 'panel-body' }, leadBody),
  )

  host.replaceChildren(
    briefForm,
    status,
    factsPanel,
    el('div', { className: 'opt-teams-head' },
      el('h2', { className: 'opt-section-title' }, t('optimize.teamsHead.title')),
      el('span', { className: 'opt-section-note' }, t('optimize.teamsHead.note')),
    ),
    teamGrid,
    leadPanel,
  )

  /* ---- Painting ---- */

  function paint() {
    if (!host.isConnected) return
    for (const key of TEAM_KEYS) {
      const c = cards[key]
      const text = job?.teams?.[key] || ''
      const state = job?.status?.[key] || 'idle'
      c.card.dataset.state = state
      c.badge.textContent = phaseLabel(state)
      if (text) writeMarkdown(c.body, text)
      else {
        c.body.replaceChildren(el('p', { className: 'opt-team-hint' },
          state === 'working' ? t('optimize.team.working')
            : state === 'error' ? t('optimize.team.error')
              : t('optimize.team.waiting', { ask: t(`optimize.teams.${key}.ask`) })))
      }
    }
    const phase = job?.phase || 'idle'
    if (job?.lead) writeMarkdown(leadBody, job.lead)
    else {
      leadBody.replaceChildren(el('p', { className: 'opt-lead-hint' },
        phase === 'lead' ? t('optimize.lead.merging')
          : phase === 'done' ? t('optimize.lead.noConclusion')
            : t('optimize.lead.hint')))
    }
    leadMeta.textContent = phase === 'done'
      ? t('optimize.lead.done', { when: job.at ? ` · ${C.formatDateTime(job.at)}` : '' })
      : phase === 'lead' ? t('optimize.lead.mergingShort')
        : phase === 'stopped' ? t('optimize.lead.stopped')
          : t('optimize.lead.waiting')
    const running = phase === 'teams' || phase === 'lead'
    runBtn.hidden = running
    stopBtn.hidden = !running
    runBtn.disabled = running
    briefForm.querySelectorAll('input, textarea').forEach((n) => { n.disabled = running })
  }

  function emit() { paint() }

  /* ---- Run ---- */

  async function run(event) {
    event?.preventDefault()
    const text = problem.input.value.trim()
    if (!text) {
      status.show('warn', t('optimize.run.needProblem'))
      problem.input.focus()
      return
    }
    status.hide()
    const brief = {
      scope,
      problem: text,
      target: Number(String(target.input.value).replace(/[^\d]/g, '')) || 0,
      note: note.input.value.trim(),
    }
    const ac = new AbortController()
    job = {
      brief,
      teams: {},
      status: Object.fromEntries(TEAM_KEYS.map((k) => [k, 'idle'])),
      lead: '',
      phase: 'teams',
      error: null,
      at: null,
      listeners: new Set(),
      ac,
    }
    jobs.set(runKey, job)
    paint()

    let model = null
    try { model = (await resolveModel())?.id || null }
    catch (err) {
      status.show('warn', t('optimize.run.modelNotReady', { error: err.message }))
    }

    try {
      for await (const ev of runOptimization({ brief, context, model, signal: ac.signal })) {
        if (ev.type === 'team-start') job.status[ev.key] = 'working'
        else if (ev.type === 'team-delta') { job.teams[ev.key] = ev.full; job.status[ev.key] = 'working' }
        else if (ev.type === 'team-done') { job.teams[ev.key] = ev.text; job.status[ev.key] = ev.text ? 'done' : 'error' }
        else if (ev.type === 'team-error') { job.status[ev.key] = 'error' }
        else if (ev.type === 'teams-complete') job.phase = 'lead'
        else if (ev.type === 'lead-start') job.phase = 'lead'
        else if (ev.type === 'lead-delta') job.lead = ev.full
        else if (ev.type === 'done') {
          job.lead = ev.text
          job.phase = 'done'
          job.at = new Date().toISOString()
          saveRun(runKey, job)
        } else if (ev.type === 'lead-error') {
          job.phase = 'done'
          job.error = ev.message
        }
        emit()
      }
      if (job.phase !== 'done') job.phase = job.lead ? 'done' : 'stopped'
    } catch (err) {
      if (err?.name === 'AbortError') job.phase = 'stopped'
      else {
        job.phase = 'done'
        job.error = err?.message || t('optimize.run.genericError')
      }
    } finally {
      job.ac = null
      emit()
      if (job.error) status.show('danger', job.error)
      else if (job.phase === 'done') showToast(t('optimize.run.ready'), 'success')
      else if (job.phase === 'stopped') status.show('info', t('optimize.run.stopped'))
    }
  }

  briefForm.addEventListener('submit', run)
  stopBtn.addEventListener('click', () => {
    job?.ac?.abort()
    status.show('info', t('optimize.run.stopping'))
  })

  paint()
  if (job?.phase === 'teams' || job?.phase === 'lead') {
    // A run survived a page change: keep listening so the panel fills itself in.
    const tick = setInterval(() => {
      if (!host.isConnected || !job) { clearInterval(tick); return }
      paint()
      if (job.phase === 'done' || job.phase === 'stopped') clearInterval(tick)
    }, 400)
  }
  return () => { /* the run is intentionally left alive */ }
}
