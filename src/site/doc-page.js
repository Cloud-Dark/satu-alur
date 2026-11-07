/**
 * Public document page (about, privacy, terms, cookies): renderDocPage(root, ctx, key) -> cleanup.
 * Stored text is rendered with text nodes only.
 */
import '../styles/landing.css'
import { logoLink } from '../ui/brand.js'
import { themeToggleButton } from '../ui/theme.js'
import { langToggleButton } from '../i18n/switcher.js'
import { t, getLang, locale } from '../i18n/index.js'
import { getSite } from './api.js'
import { parseDoc } from './content-rules.js'

// Indonesian titles: the staff editor's defaults (office/site-doc.js). The public page shows legal.titles.* instead.
export const DOC_TITLES = {
  about: 'Tentang Satu Alur',
  privacy: 'Kebijakan Privasi',
  terms: 'Syarat & Ketentuan',
  cookies: 'Kebijakan Cookie',
}

const LINKS = [['about', '#/tentang'], ['privacy', '#/privasi'], ['terms', '#/syarat'], ['cookies', '#/cookie']]

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
  const home = el('a', 'btn btn-ghost btn-sm', t('legal.home'))
  home.href = '#/'
  actions.append(langToggleButton(), themeToggleButton(), home)
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
  nav.setAttribute('aria-label', t('legal.navLabel'))
  nav.append(...LINKS.map(([key, href]) => { const a = el('a', '', t(`legal.links.${key}`)); a.href = href; return a }))
  fc.append(nav, el('p', 'doc-foot-copy', t('footer.copyright')))
  footer.append(fc)

  page.append(header, main, footer)
  root.append(page)
  return { title, body, close: () => { document.title = prevTitle } }
}

export function renderDocPage(root, ctx, key) {
  let disposed = false
  const heading = t(`legal.titles.${key}`)
  const { title, body, close } = docShell(root, heading, heading)

  getSite(key).then((row) => {
    if (disposed) return
    const v = row?.value
    if (!v || typeof v.title !== 'string') {
      body.append(el('p', 'doc-empty', t('legal.empty')))
      return
    }
    // Stored documents are written in Indonesian; in another language the translated title stays and a note says so.
    if (getLang() !== 'id') body.append(el('p', 'doc-updated', t('legal.onlyIndonesian')))
    else if (v.title.trim()) {
      title.textContent = v.title.trim()
      document.title = `${v.title.trim()} — Satu Alur`
    }
    body.append(...parseDoc(v.body).map(blockNode))
    if (row.updated_at) {
      const d = new Date(row.updated_at)
      if (!Number.isNaN(d.getTime())) {
        body.append(el('p', 'doc-updated', t('legal.updated', { date: d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) })))
      }
    }
  })

  return () => { disposed = true; close() }
}
