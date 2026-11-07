/**
 * Pengaturan › Akses AI (MCP): connect Claude (claude.ai, Claude Desktop, Claude Code) to this
 * business's data through the remote MCP server at /mcp (worker/mcp-server.js).
 *
 *   01 Hubungkan dengan login (primary): paste <origin>/mcp into Claude, sign in, click Izinkan
 *      (OAuth 2.1, worker/oauth.js, consent page #/izin-ai). No token to copy.
 *   02 Aplikasi terhubung: the OAuth grants, each with "Putuskan" (all its tokens stop at once).
 *   Cara lain: token manual (lanjutan), collapsed: per-device "sa_mcp_" tokens, shown once with
 *      ready-to-paste instructions; the list only shows the label and first characters.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { listTokens, createToken, revokeToken, listGrants, revokeGrant } from '../ai-access/api.js'
import { snippets, serverUrl, claudeCodeLoginCommand } from '../ai-access/snippets.js'
import { isUsingMockCloud } from '../cloud.js'
import '../styles/ai-access.css'
import { t } from '../i18n/index.js'

const { el, icon } = C

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(t('settings.aiAccess.copied', { what }), 'success')
  } catch {
    showToast(t('settings.aiAccess.copyFailed'), 'info', 4200)
  }
}

/** A read-only code block with its own copy button. */
function codeBlock({ text, label, kind, multiline = false }) {
  const code = el(multiline ? 'pre' : 'code', { className: 'aimcp-code-text', 'data-copy': kind, tabIndex: 0 }, text)
  const btn = C.button({ label: t('settings.aiAccess.copy'), icon: 'copy', size: 'xs', variant: 'soft', 'aria-label': t('settings.aiAccess.copyWhat', { what: label }), 'data-copy-btn': kind })
  btn.addEventListener('click', () => copy(text, label))
  return el('div', { className: `aimcp-code${multiline ? ' is-multiline' : ''}` }, code, btn)
}

function revealPanel(token, item, onDone) {
  const s = snippets(window.location.origin, token)
  const done = C.button({ label: t('settings.aiAccess.doneCopied'), icon: 'check', size: 'sm', variant: 'primary' })
  done.addEventListener('click', onDone)
  return el('section', { className: 'set-section aimcp-reveal', 'aria-label': t('settings.aiAccess.newToken') },
    el('div', { className: 'aimcp-reveal-head' },
      el('h3', { className: 'set-title' }, t('settings.aiAccess.newTokenTitle', { name: item.name })),
      el('p', { className: 'aimcp-once' }, icon('alert', { size: 14 }), t('settings.aiAccess.once')),
    ),
    codeBlock({ text: token, label: 'token', kind: 'token' }),

    el('div', { className: 'aimcp-way' },
      el('h4', {}, t('settings.aiAccess.customConnector')),
      el('ol', { className: 'aimcp-steps' },
        el('li', {}, t('settings.aiAccess.step1')),
        el('li', {}, t('settings.aiAccess.step2')),
        el('li', {}, t('settings.aiAccess.step3')),
      ),
      codeBlock({ text: s.connector, label: t('settings.aiAccess.connectorUrl'), kind: 'connector' }),
    ),
    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'Claude Code'),
      el('p', {}, t('settings.aiAccess.runTerminal')),
      codeBlock({ text: s.claudeCode, label: t('settings.aiAccess.ccCommand'), kind: 'claude-code' }),
    ),
    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'Claude Desktop'),
      el('p', {}, t('settings.aiAccess.desktopHelp')),
      codeBlock({ text: s.desktop, label: t('settings.aiAccess.desktopConfig'), kind: 'desktop', multiline: true }),
    ),
    el('p', { className: 'aimcp-try' }, t('settings.aiAccess.try')),
    el('div', { className: 'form-actions' }, done),
  )
}

function tokenRow(tok, onRevoked) {
  const meta = el('p', { className: 'aimcp-row-meta' },
    t('settings.aiAccess.created', { date: C.formatDate(tok.created_at) }),
    tok.last_used_at ? t('settings.aiAccess.lastUsed', { when: C.relativeTime(tok.last_used_at) }) : t('settings.aiAccess.neverUsed'),
  )
  const actions = el('div', { className: 'aimcp-row-actions' })
  const row = el('li', { className: 'aimcp-row', 'data-id': String(tok.id) },
    el('div', { className: 'aimcp-row-main' },
      el('strong', { className: 'aimcp-row-name' }, tok.name),
      el('code', { className: 'aimcp-prefix' }, `${tok.prefix}…`),
      meta,
    ),
    actions,
  )
  function idle() {
    const b = C.button({ label: t('settings.aiAccess.revoke'), icon: 'trash', size: 'xs', variant: 'danger', 'aria-label': t('settings.aiAccess.revokeToken', { name: tok.name }) })
    b.addEventListener('click', ask)
    actions.replaceChildren(b)
  }
  function ask() {
    const yes = C.button({ label: t('settings.aiAccess.yesRevoke'), size: 'xs', variant: 'danger' })
    const no = C.button({ label: t('settings.common.cancel'), size: 'xs', variant: 'ghost' })
    no.addEventListener('click', () => { idle(); actions.querySelector('button')?.focus() })
    yes.addEventListener('click', async () => {
      const restore = C.setBusy(yes, t('settings.aiAccess.revoking'))
      try {
        await revokeToken(tok.id)
        showToast(t('settings.aiAccess.revoked', { name: tok.name }), 'success')
        onRevoked()
      } catch (ex) {
        restore()
        showToast(ex.message, 'error', 4200)
      }
    })
    actions.replaceChildren(el('span', { className: 'aimcp-confirm' }, t('settings.aiAccess.revokeConfirm')), yes, no)
    yes.focus()
  }
  idle()
  return row
}

/** One connected app (OAuth grant) with an inline "Putuskan" confirm. */
function grantRow(g, onRevoked) {
  const actions = el('div', { className: 'aimcp-row-actions' })
  const row = el('li', { className: 'aimcp-row aimcp-grant', 'data-grant': String(g.id) },
    el('div', { className: 'aimcp-row-main' },
      el('strong', { className: 'aimcp-row-name' }, g.client_name),
      g.redirect_host ? el('span', { className: 'aimcp-host' }, g.redirect_host) : null,
      el('p', { className: 'aimcp-row-meta' },
        t('settings.aiAccess.connectedSince', { date: C.formatDate(g.created_at) }),
        g.last_used_at ? t('settings.aiAccess.lastUsed', { when: C.relativeTime(g.last_used_at) }) : t('settings.aiAccess.neverUsed'),
      ),
    ),
    actions,
  )
  function idle() {
    const b = C.button({ label: t('settings.aiAccess.disconnect'), icon: 'x', size: 'xs', variant: 'danger', 'aria-label': t('settings.aiAccess.disconnectName', { name: g.client_name }) })
    b.addEventListener('click', ask)
    actions.replaceChildren(b)
  }
  function ask() {
    const yes = C.button({ label: t('settings.aiAccess.yesDisconnect'), size: 'xs', variant: 'danger' })
    const no = C.button({ label: t('settings.common.cancel'), size: 'xs', variant: 'ghost' })
    no.addEventListener('click', () => { idle(); actions.querySelector('button')?.focus() })
    yes.addEventListener('click', async () => {
      const restore = C.setBusy(yes, t('settings.aiAccess.disconnecting'))
      try {
        await revokeGrant(g.id)
        showToast(t('settings.aiAccess.disconnected', { name: g.client_name }), 'success')
        onRevoked()
      } catch (ex) {
        restore()
        showToast(ex.message, 'error', 4200)
      }
    })
    actions.replaceChildren(el('span', { className: 'aimcp-confirm' }, t('settings.aiAccess.loseAccess', { name: g.client_name })), yes, no)
    yes.focus()
  }
  idle()
  return row
}

/** 01: the login flow. Nothing to copy but the server URL. */
function loginSection(demo) {
  const host = window.location.origin
  return el('section', { className: 'set-section aimcp-login', 'aria-label': t('settings.aiAccess.loginTitle') },
    el('div', { className: 'set-head' }, el('div', {},
      el('span', { className: 'set-num' }, t('settings.aiAccess.num1')),
      el('h3', { className: 'set-title' }, t('settings.aiAccess.loginTitle')),
      el('p', { className: 'set-desc' }, t('settings.aiAccess.loginDesc')),
    )),
    demo ? demoNote() : null,
    el('div', { className: 'aimcp-way' },
      el('h4', {}, t('settings.aiAccess.claudeAiDesktop')),
      el('ol', { className: 'aimcp-steps' },
        el('li', {}, t('settings.aiAccess.loginStep1')),
        el('li', {}, t('settings.aiAccess.loginStep2')),
        el('li', {}, t('settings.aiAccess.loginStep3')),
      ),
      codeBlock({ text: serverUrl(host), label: t('settings.aiAccess.serverAddress'), kind: 'server-url' }),
    ),
    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'Claude Code'),
      el('p', {}, t('settings.aiAccess.ccLogin')),
      codeBlock({ text: claudeCodeLoginCommand(host), label: t('settings.aiAccess.ccCommand'), kind: 'claude-code-login' }),
    ),
    el('p', { className: 'aimcp-try' }, t('settings.aiAccess.try')),
  )
}

export async function renderAiAccessTab(container) {
  container.replaceChildren(C.skeletonRows(3))
  let data
  let grants
  try { [data, grants] = await Promise.all([listTokens(), listGrants()]) } catch (ex) {
    const again = C.button({ label: t('settings.common.retry'), variant: 'soft', size: 'sm' })
    again.addEventListener('click', () => renderAiAccessTab(container))
    container.replaceChildren(C.errorState(ex.message), again)
    return
  }

  const lead = el('p', { className: 'set-lead' },
    t('settings.aiAccess.lead'),
    t('settings.aiAccess.readOnly'))
  const parts = [lead]
  if (isUsingMockCloud()) {
    const note = C.message()
    note.show('info', t('settings.aiAccess.mockNote'))
    parts.push(note)
  }

  /* ---- 02 Aplikasi terhubung (OAuth grants) ---- */
  const grantHost = el('div', {})
  const grantSection = el('section', { className: 'set-section', 'aria-label': t('settings.aiAccess.apps') },
    el('div', { className: 'set-head' }, el('div', {},
      el('span', { className: 'set-num' }, t('settings.aiAccess.num2')),
      el('h3', { className: 'set-title' }, t('settings.aiAccess.apps')),
      el('p', { className: 'set-desc' }, t('settings.aiAccess.appsDesc')),
    )),
    grantHost,
  )
  function drawGrants(items) {
    grantHost.replaceChildren(items.length
      ? el('ul', { className: 'aimcp-list aimcp-grants' }, ...items.map((g) => grantRow(g, refreshGrants)))
      : el('p', { className: 'set-desc aimcp-grants-empty' }, t('settings.aiAccess.appsEmpty')))
  }
  async function refreshGrants() {
    try { drawGrants((await listGrants()).items) } catch (ex) { grantHost.replaceChildren(C.errorState(ex.message)) }
  }
  drawGrants(grants.items)

  /* ---- Cara lain: token manual (lanjutan), collapsed ---- */
  const warn = C.message()
  warn.show('warn', t('settings.aiAccess.warn'))
  const reveal = el('div', { className: 'aimcp-reveal-host' })
  const label = C.field({ label: t('settings.aiAccess.tokenName'), id: 'mcp-token-label', placeholder: t('settings.aiAccess.tokenNamePh'), hint: t('settings.aiAccess.tokenNameHint'), attrs: { maxlength: '60', autocomplete: 'off' } })
  const create = C.button({ label: t('settings.aiAccess.createToken'), icon: 'plus', size: 'sm', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'aimcp-create' }, label.wrap, el('div', { className: 'form-actions' }, create))
  const max = data.max || 10
  const fullNote = el('p', { className: 'set-desc aimcp-full', hidden: true }, t('settings.aiAccess.full', { max }))
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (create.disabled) return
    const restore = C.setBusy(create, t('settings.aiAccess.creating'))
    try {
      const { token, item } = await createToken(label.input.value)
      label.input.value = ''
      const panel = revealPanel(token, item, () => { panel.remove(); label.input.focus() })
      reveal.replaceChildren(panel)
      restore()
      await drawList()
      panel.querySelector('.aimcp-code-text')?.focus()
    } catch (ex) {
      restore()
      showToast(ex.message, 'error', 4200)
    }
  })

  const createSection = el('section', { className: 'set-section' },
    el('div', { className: 'set-head' }, el('div', {},
      el('h3', { className: 'set-title' }, t('settings.aiAccess.createToken')),
      el('p', { className: 'set-desc' }, t('settings.aiAccess.createDesc')),
    )),
    data.demo ? demoNote() : null,
    fullNote,
    form,
  )

  const listHost = el('div', {})
  const listSection = el('section', { className: 'set-section' },
    el('div', { className: 'set-head' }, el('div', {}, el('h3', { className: 'set-title' }, t('settings.aiAccess.activeTokens')))),
    listHost,
  )

  function drawItems(items) {
    const full = items.length >= max
    fullNote.hidden = data.demo || !full
    ;[label.input, create].forEach((x) => { x.disabled = data.demo || full })
    listHost.replaceChildren(items.length
      ? el('ul', { className: 'aimcp-list' }, ...items.map((tok) => tokenRow(tok, drawList)))
      : el('p', { className: 'set-desc aimcp-empty' }, t('settings.aiAccess.noTokens')))
  }
  async function drawList() {
    try { drawItems((await listTokens()).items) } catch (ex) { listHost.replaceChildren(C.errorState(ex.message)) }
  }
  drawItems(data.items)

  // Open when manual tokens are already in use, so they stay one click away.
  const advanced = el('details', { className: 'aimcp-advanced', open: data.items.length > 0 },
    el('summary', {}, t('settings.aiAccess.advanced')),
    el('div', { className: 'aimcp-advanced-body' }, warn, reveal, createSection, listSection),
  )

  container.replaceChildren(...parts, loginSection(data.demo || grants.demo), grantSection, advanced)
}

function demoNote() {
  const n = C.message()
  n.show('info', t('settings.aiAccess.demoNote'))
  return n
}
