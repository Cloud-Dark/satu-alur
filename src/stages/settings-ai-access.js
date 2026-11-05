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

const { el, icon } = C

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${what} disalin.`, 'success')
  } catch {
    showToast('Tidak bisa menyalin otomatis. Pilih teksnya lalu tekan Ctrl+C.', 'info', 4200)
  }
}

/** A read-only code block with its own copy button. */
function codeBlock({ text, label, kind, multiline = false }) {
  const code = el(multiline ? 'pre' : 'code', { className: 'aimcp-code-text', 'data-copy': kind, tabIndex: 0 }, text)
  const btn = C.button({ label: 'Salin', icon: 'copy', size: 'xs', variant: 'soft', 'aria-label': `Salin ${label}`, 'data-copy-btn': kind })
  btn.addEventListener('click', () => copy(text, label))
  return el('div', { className: `aimcp-code${multiline ? ' is-multiline' : ''}` }, code, btn)
}

function revealPanel(token, item, onDone) {
  const s = snippets(window.location.origin, token)
  const done = C.button({ label: 'Selesai, sudah disalin', icon: 'check', size: 'sm', variant: 'primary' })
  done.addEventListener('click', onDone)
  return el('section', { className: 'set-section aimcp-reveal', 'aria-label': 'Token baru' },
    el('div', { className: 'aimcp-reveal-head' },
      el('h3', { className: 'set-title' }, `Token baru: ${item.name}`),
      el('p', { className: 'aimcp-once' }, icon('alert', { size: 14 }), 'Salin sekarang. Token hanya ditampilkan sekali dan tidak bisa dilihat lagi.'),
    ),
    codeBlock({ text: token, label: 'token', kind: 'token' }),

    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'claude.ai (connector kustom)'),
      el('ol', { className: 'aimcp-steps' },
        el('li', {}, 'Buka claude.ai → Settings → Connectors.'),
        el('li', {}, 'Klik Add custom connector, beri nama "Satu Alur".'),
        el('li', {}, 'Tempel URL di bawah ini, lalu Add. URL ini sudah berisi token, jadi jangan dibagikan.'),
      ),
      codeBlock({ text: s.connector, label: 'URL connector', kind: 'connector' }),
    ),
    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'Claude Code'),
      el('p', {}, 'Jalankan di terminal:'),
      codeBlock({ text: s.claudeCode, label: 'perintah Claude Code', kind: 'claude-code' }),
    ),
    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'Claude Desktop'),
      el('p', {}, 'Tambahkan ke claude_desktop_config.json (Settings → Developer → Edit Config), lalu buka ulang Claude Desktop. Perlu Node.js.'),
      codeBlock({ text: s.desktop, label: 'konfigurasi Claude Desktop', kind: 'desktop', multiline: true }),
    ),
    el('p', { className: 'aimcp-try' }, 'Lalu tanyakan, misalnya: "Pekerjaan PT Maju sudah sampai mana?", "Berapa laba bulan ini?", atau "Invoice mana yang belum lunas?"'),
    el('div', { className: 'form-actions' }, done),
  )
}

function tokenRow(t, onRevoked) {
  const meta = el('p', { className: 'aimcp-row-meta' },
    `Dibuat ${C.formatDate(t.created_at)} · `,
    t.last_used_at ? `Terakhir dipakai ${C.relativeTime(t.last_used_at)}` : 'Belum pernah dipakai',
  )
  const actions = el('div', { className: 'aimcp-row-actions' })
  const row = el('li', { className: 'aimcp-row', 'data-id': String(t.id) },
    el('div', { className: 'aimcp-row-main' },
      el('strong', { className: 'aimcp-row-name' }, t.name),
      el('code', { className: 'aimcp-prefix' }, `${t.prefix}…`),
      meta,
    ),
    actions,
  )
  function idle() {
    const b = C.button({ label: 'Cabut', icon: 'trash', size: 'xs', variant: 'danger', 'aria-label': `Cabut token ${t.name}` })
    b.addEventListener('click', ask)
    actions.replaceChildren(b)
  }
  function ask() {
    const yes = C.button({ label: 'Ya, cabut', size: 'xs', variant: 'danger' })
    const no = C.button({ label: 'Batal', size: 'xs', variant: 'ghost' })
    no.addEventListener('click', () => { idle(); actions.querySelector('button')?.focus() })
    yes.addEventListener('click', async () => {
      const restore = C.setBusy(yes, 'Mencabut…')
      try {
        await revokeToken(t.id)
        showToast(`Token "${t.name}" dicabut.`, 'success')
        onRevoked()
      } catch (ex) {
        restore()
        showToast(ex.message, 'error', 4200)
      }
    })
    actions.replaceChildren(el('span', { className: 'aimcp-confirm' }, 'Claude yang memakai token ini langsung terputus.'), yes, no)
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
        `Terhubung sejak ${C.formatDate(g.created_at)} · `,
        g.last_used_at ? `Terakhir dipakai ${C.relativeTime(g.last_used_at)}` : 'Belum pernah dipakai',
      ),
    ),
    actions,
  )
  function idle() {
    const b = C.button({ label: 'Putuskan', icon: 'x', size: 'xs', variant: 'danger', 'aria-label': `Putuskan ${g.client_name}` })
    b.addEventListener('click', ask)
    actions.replaceChildren(b)
  }
  function ask() {
    const yes = C.button({ label: 'Ya, putuskan', size: 'xs', variant: 'danger' })
    const no = C.button({ label: 'Batal', size: 'xs', variant: 'ghost' })
    no.addEventListener('click', () => { idle(); actions.querySelector('button')?.focus() })
    yes.addEventListener('click', async () => {
      const restore = C.setBusy(yes, 'Memutuskan…')
      try {
        await revokeGrant(g.id)
        showToast(`${g.client_name} diputuskan.`, 'success')
        onRevoked()
      } catch (ex) {
        restore()
        showToast(ex.message, 'error', 4200)
      }
    })
    actions.replaceChildren(el('span', { className: 'aimcp-confirm' }, `${g.client_name} langsung kehilangan akses.`), yes, no)
    yes.focus()
  }
  idle()
  return row
}

/** 01: the login flow. Nothing to copy but the server URL. */
function loginSection(demo) {
  const host = window.location.origin
  return el('section', { className: 'set-section aimcp-login', 'aria-label': 'Hubungkan dengan login' },
    el('div', { className: 'set-head' }, el('div', {},
      el('span', { className: 'set-num' }, 'Akses AI · 01'),
      el('h3', { className: 'set-title' }, 'Hubungkan dengan login'),
      el('p', { className: 'set-desc' }, 'Tidak perlu menyalin token: cukup tempel alamat server, masuk ke Satu Alur, lalu klik Izinkan.'),
    )),
    demo ? demoNote() : null,
    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'claude.ai dan Claude Desktop'),
      el('ol', { className: 'aimcp-steps' },
        el('li', {}, 'Buka Settings → Connectors, lalu klik Add custom connector.'),
        el('li', {}, 'Beri nama "Satu Alur" dan tempel alamat di bawah ini, lalu Add.'),
        el('li', {}, 'Klik Connect. Claude membuka halaman masuk Satu Alur: masuk seperti biasa, lalu klik Izinkan.'),
      ),
      codeBlock({ text: serverUrl(host), label: 'alamat server', kind: 'server-url' }),
    ),
    el('div', { className: 'aimcp-way' },
      el('h4', {}, 'Claude Code'),
      el('p', {}, 'Jalankan di terminal, lalu ketik /mcp di Claude Code, pilih satu-alur, dan pilih Authenticate:'),
      codeBlock({ text: claudeCodeLoginCommand(host), label: 'perintah Claude Code', kind: 'claude-code-login' }),
    ),
    el('p', { className: 'aimcp-try' }, 'Lalu tanyakan, misalnya: "Pekerjaan PT Maju sudah sampai mana?", "Berapa laba bulan ini?", atau "Invoice mana yang belum lunas?"'),
  )
}

export async function renderAiAccessTab(container) {
  container.replaceChildren(C.skeletonRows(3))
  let data
  let grants
  try { [data, grants] = await Promise.all([listTokens(), listGrants()]) } catch (ex) {
    const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
    again.addEventListener('click', () => renderAiAccessTab(container))
    container.replaceChildren(C.errorState(ex.message), again)
    return
  }

  const lead = el('p', { className: 'set-lead' },
    'Hubungkan Claude (claude.ai, Claude Desktop, atau Claude Code) ke akun ini lewat MCP. Claude bisa menjawab pertanyaan tentang pekerjaan, progres pelanggan, keuangan, dan invoice. ',
    'Aksesnya hanya baca: Claude tidak bisa mengubah atau menghapus data.')
  const parts = [lead]
  if (isUsingMockCloud()) {
    const note = C.message()
    note.show('info', 'Mode demo lokal: koneksi dan token di sini hanya simulasi dan tidak bisa dipakai untuk menghubungkan Claude.')
    parts.push(note)
  }

  /* ---- 02 Aplikasi terhubung (OAuth grants) ---- */
  const grantHost = el('div', {})
  const grantSection = el('section', { className: 'set-section', 'aria-label': 'Aplikasi terhubung' },
    el('div', { className: 'set-head' }, el('div', {},
      el('span', { className: 'set-num' }, 'Akses AI · 02'),
      el('h3', { className: 'set-title' }, 'Aplikasi terhubung'),
      el('p', { className: 'set-desc' }, 'Claude yang sudah Anda izinkan lewat login. Putuskan yang tidak dipakai lagi.'),
    )),
    grantHost,
  )
  function drawGrants(items) {
    grantHost.replaceChildren(items.length
      ? el('ul', { className: 'aimcp-list aimcp-grants' }, ...items.map((g) => grantRow(g, refreshGrants)))
      : el('p', { className: 'set-desc aimcp-grants-empty' }, 'Belum ada aplikasi terhubung. Ikuti langkah di atas untuk menghubungkan Claude.'))
  }
  async function refreshGrants() {
    try { drawGrants((await listGrants()).items) } catch (ex) { grantHost.replaceChildren(C.errorState(ex.message)) }
  }
  drawGrants(grants.items)

  /* ---- Cara lain: token manual (lanjutan), collapsed ---- */
  const warn = C.message()
  warn.show('warn', 'Token memberi akses baca ke seluruh data usaha Anda. Simpan seperti kata sandi, dan cabut token yang bocor atau tidak dipakai lagi.')
  const reveal = el('div', { className: 'aimcp-reveal-host' })
  const label = C.field({ label: 'Nama token', id: 'mcp-token-label', placeholder: 'Contoh: Claude di laptop kantor', hint: 'Untuk mengenali token ini nanti.', attrs: { maxlength: '60', autocomplete: 'off' } })
  const create = C.button({ label: 'Buat token', icon: 'plus', size: 'sm', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'aimcp-create' }, label.wrap, el('div', { className: 'form-actions' }, create))
  const max = data.max || 10
  const fullNote = el('p', { className: 'set-desc aimcp-full', hidden: true }, `Sudah ${max} token aktif. Cabut salah satu untuk membuat yang baru.`)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (create.disabled) return
    const restore = C.setBusy(create, 'Membuat…')
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
      el('h3', { className: 'set-title' }, 'Buat token'),
      el('p', { className: 'set-desc' }, 'Untuk aplikasi yang belum mendukung login. Satu token untuk tiap perangkat atau aplikasi, supaya bisa dicabut sendiri-sendiri.'),
    )),
    data.demo ? demoNote() : null,
    fullNote,
    form,
  )

  const listHost = el('div', {})
  const listSection = el('section', { className: 'set-section' },
    el('div', { className: 'set-head' }, el('div', {}, el('h3', { className: 'set-title' }, 'Token aktif'))),
    listHost,
  )

  function drawItems(items) {
    const full = items.length >= max
    fullNote.hidden = data.demo || !full
    ;[label.input, create].forEach((x) => { x.disabled = data.demo || full })
    listHost.replaceChildren(items.length
      ? el('ul', { className: 'aimcp-list' }, ...items.map((t) => tokenRow(t, drawList)))
      : el('p', { className: 'set-desc aimcp-empty' }, 'Belum ada token manual.'))
  }
  async function drawList() {
    try { drawItems((await listTokens()).items) } catch (ex) { listHost.replaceChildren(C.errorState(ex.message)) }
  }
  drawItems(data.items)

  // Open when manual tokens are already in use, so they stay one click away.
  const advanced = el('details', { className: 'aimcp-advanced', open: data.items.length > 0 },
    el('summary', {}, 'Cara lain: token manual (lanjutan)'),
    el('div', { className: 'aimcp-advanced-body' }, warn, reveal, createSection, listSection),
  )

  container.replaceChildren(...parts, loginSection(data.demo || grants.demo), grantSection, advanced)
}

function demoNote() {
  const n = C.message()
  n.show('info', 'Akun demo tidak bisa dihubungkan ke Claude. Masuk dengan akun usaha Anda sendiri untuk menghubungkan Claude.')
  return n
}
