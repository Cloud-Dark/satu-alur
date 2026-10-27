import './styles.css'
import { mountApp } from './ui/app.js'

const appRoot = document.getElementById('app')

// Fallback visible jika JS crash sebelum mountApp selesai
if (appRoot) {
  appRoot.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif;"><h1>ServiceOps AI</h1><p>Memuat aplikasi…</p></div>'
}

try {
  mountApp(appRoot)
} catch (err) {
  console.error('Mount error:', err)
  if (appRoot) {
    appRoot.innerHTML = `
      <div style="padding:40px;text-align:center;font-family:sans-serif;">
        <h1>ServiceOps AI</h1>
        <p style="color:#dc2626;">Gagal memuat aplikasi: ${err.message}</p>
        <p style="color:#6b7280;font-size:0.9rem;">Periksa console browser (F12 → Console) untuk detail.</p>
      </div>
    `
  }
}
