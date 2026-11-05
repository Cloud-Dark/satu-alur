/**
 * Pengaturan › Akses AI (MCP): tokens that let Claude (claude.ai, Claude Desktop, Claude Code) read this
 * business's data through the remote MCP server at /mcp (worker/mcp-server.js). A new token is shown
 * once, with ready-to-paste instructions; the list only shows its label and first characters.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { listTokens, createToken, revokeToken } from '../ai-access/api.js'
import { snippets } from '../ai-access/snippets.js'
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

export async function renderAiAccessTab(container) {
  container.replaceChildren(C.skeletonRows(3))
  let data
  try { data = await listTokens() } catch (ex) {
    const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
    again.addEventListener('click', () => renderAiAccessTab(container))
    container.replaceChildren(C.errorState(ex.message), again)
    return
  }

  const lead = el('p', { className: 'set-lead' },
    'Hubungkan Claude (claude.ai, Claude Desktop, atau Claude Code) ke akun ini lewat MCP. Claude bisa menjawab pertanyaan tentang pekerjaan, progres pelanggan, keuangan, dan invoice. ',
    'Aksesnya hanya baca: Claude tidak bisa mengubah atau menghapus data.')
  const warn = C.message()
  warn.show('warn', 'Token memberi akses baca ke seluruh data usaha Anda. Simpan seperti kata sandi, dan cabut token yang bocor atau tidak dipakai lagi.')
  const parts = [lead, warn]
  if (isUsingMockCloud()) {
    const note = C.message()
    note.show('info', 'Mode demo lokal: token di sini hanya simulasi dan tidak bisa dipakai untuk menghubungkan Claude.')
    parts.push(note)
  }

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
      el('span', { className: 'set-num' }, 'Akses AI · 01'),
      el('h3', { className: 'set-title' }, 'Buat token'),
      el('p', { className: 'set-desc' }, 'Satu token untuk tiap perangkat atau aplikasi, supaya bisa dicabut sendiri-sendiri.'),
    )),
    data.demo ? demoNote() : null,
    fullNote,
    form,
  )

  const listHost = el('div', {})
  const listSection = el('section', { className: 'set-section' },
    el('div', { className: 'set-head' }, el('div', {},
      el('span', { className: 'set-num' }, 'Akses AI · 02'),
      el('h3', { className: 'set-title' }, 'Token aktif'),
    )),
    listHost,
  )

  function drawItems(items) {
    const full = items.length >= max
    fullNote.hidden = data.demo || !full
    ;[label.input, create].forEach((x) => { x.disabled = data.demo || full })
    listHost.replaceChildren(items.length
      ? el('ul', { className: 'aimcp-list' }, ...items.map((t) => tokenRow(t, drawList)))
      : el('p', { className: 'set-desc aimcp-empty' }, 'Belum ada token. Buat token di atas untuk menghubungkan Claude.'))
  }
  async function drawList() {
    try { drawItems((await listTokens()).items) } catch (ex) { listHost.replaceChildren(C.errorState(ex.message)) }
  }
  drawItems(data.items)

  container.replaceChildren(...parts, reveal, createSection, listSection)
}

function demoNote() {
  const n = C.message()
  n.show('info', 'Akun demo tidak bisa membuat token Akses AI. Masuk dengan akun usaha Anda sendiri untuk menghubungkan Claude.')
  return n
}
