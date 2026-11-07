import './styles/tokens.css'
import './styles.css'
import { mountApp } from './ui/app.js'
import { applyDocumentLang, t } from './i18n/index.js'
import { enableDevAudit, injectAntiSlopStyles } from './ui/antislop.js'

const appRoot = document.getElementById('app')

try {
  applyDocumentLang()
  injectAntiSlopStyles()
  mountApp(appRoot)
  enableDevAudit(5000)
} catch (err) {
  console.error('Mount error:', err)
  if (appRoot) {
    appRoot.innerHTML = `
      <div style="padding:40px;text-align:center;">
        <h1>Satu Alur</h1>
        <p style="color:var(--danger);">${t('ui.mount.failed', { error: err.message })}</p>
        <p style="color:var(--muted);font-size:0.9rem;">${t('ui.mount.console')}</p>
      </div>
    `
  }
}
