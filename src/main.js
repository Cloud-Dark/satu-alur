import './styles.css'
import { mountApp } from './ui/app.js'
import { enableDevAudit, injectAntiSlopStyles } from './ui/antislop.js'

const appRoot = document.getElementById('app')

// Fallback visible jika JS crash sebelum mountApp selesai
if (appRoot) {
  appRoot.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif;"><h1>Satu Alur</h1><p>Memuat aplikasi…</p></div>'
}

try {
  // Inject AntiSlop base styles (skeleton keyframes, slop warnings)
  injectAntiSlopStyles()

  // Mount the application
  mountApp(appRoot)

  // Enable AntiSlop dev audit (hanya di localhost)
  enableDevAudit(5000)
} catch (err) {
  console.error('Mount error:', err)
  if (appRoot) {
    appRoot.innerHTML = `
      <div style="padding:40px;text-align:center;font-family:sans-serif;">
        <h1>Satu Alur</h1>
        <p style="color:#dc2626;">Gagal memuat aplikasi: ${err.message}</p>
        <p style="color:#6b7280;font-size:0.9rem;">Periksa console browser (F12 → Console) untuk detail.</p>
      </div>
    `
  }
}
