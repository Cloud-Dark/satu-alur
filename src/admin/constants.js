// Tiny shared constants with no imports (safe for the Worker, the browser and node tests).
export const SMTP_PORTS_LIST = [465, 587, 2465, 2587]
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim())
