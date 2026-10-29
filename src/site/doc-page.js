/**
 * Public document page (about, privacy, terms, cookies): renderDocPage(root, ctx, key) -> cleanup.
 * Stored text is rendered with text nodes only.
 */
import '../styles/landing.css'
import { logoLink } from '../ui/brand.js'
import { themeToggleButton } from '../ui/theme.js'
import { getSite } from './api.js'
import { parseDoc } from './content-rules.js'

export const DOC_TITLES = {
  about: 'Tentang Satu Alur',
  privacy: 'Kebijakan Privasi',
  terms: 'Syarat & Ketentuan',
  cookies: 'Kebijakan Cookie',
}

const LINKS = [['Tentang kami', '#/tentang'], ['Kebijakan privasi', '#/privasi'], ['Syarat & ketentuan', '#/syarat'], ['Kebijakan cookie', '#/cookie']]

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

export function blockNode(b) {
  if (b.type === 'h') return el('h2', '', b.text)
  if (b.type === 'ul') {
    const ul = el('ul')
    ul.append(...b.items.map((i) => el('li', '', i)))
    return ul
  }
  return el('p', '', b.text)
}

/** The public page frame (logo header, reading column, footer) → { title, body, close }; close() restores document.title. */
export function docShell(root, headingText, docTitle) {
  const prevTitle = document.title
  document.title = `${docTitle} — Satu Alur`
  const page = el('div', 'lp doc-page')

  const header = el('header', 'lp-header is-scrolled')
  const bar = el('div', 'lp-header-bar')
  const actions = el('div', 'lp-header-actions')
  const home = el('a', 'btn btn-ghost btn-sm', 'Beranda')
  home.href = '#/'
  actions.append(themeToggleButton(), home)
  bar.append(logoLink({ size: 30 }), actions)
  header.append(bar)

  const title = el('h1', 'display doc-title', headingText)
  const body = el('div', 'doc-body')
  const article = el('article', 'doc-col')
  article.append(title, body)
  const main = el('main', 'lp-container doc-main')
  main.id = 'lp-main'
  main.append(article)

  const footer = el('footer', 'lp-footer doc-foot')
  const fc = el('div', 'lp-container')
  const nav = el('nav', 'doc-foot-links')
  nav.setAttribute('aria-label', 'Halaman Satu Alur')
  nav.append(...LINKS.map(([label, href]) => { const a = el('a', '', label); a.href = href; return a }))
  fc.append(nav, el('p', 'doc-foot-copy', '© 2026 Satu Alur. Hak cipta dilindungi.'))
  footer.append(fc)

  page.append(header, main, footer)
  root.append(page)
  return { title, body, close: () => { document.title = prevTitle } }
}

export function renderDocPage(root, ctx, key) {
  let disposed = false
  const { title, body, close } = docShell(root, DOC_TITLES[key], DOC_TITLES[key])

  getSite(key).then((row) => {
    if (disposed) return
    const v = row?.value
    if (!v || typeof v.title !== 'string') {
      body.append(el('p', 'doc-empty', 'Dokumen ini sedang disiapkan.'))
      return
    }
    if (v.title.trim()) {
      title.textContent = v.title.trim()
      document.title = `${v.title.trim()} — Satu Alur`
    }
    body.append(...parseDoc(v.body).map(blockNode))
    if (row.updated_at) {
      const d = new Date(row.updated_at)
      if (!Number.isNaN(d.getTime())) {
        body.append(el('p', 'doc-updated', `Terakhir diperbarui ${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`))
      }
    }
  })

  return () => { disposed = true; close() }
}
