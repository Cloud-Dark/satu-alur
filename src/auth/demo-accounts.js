/**
 * Demo accounts seeded by scripts/seed-demo.mjs (12 months of generated data).
 * The Worker accepts demo logins only for these emails (DEMO_EMAILS in
 * worker/index.js — keep both lists in sync).
 */
export const DEMO_SCALES = [
  { value: 'sole', label: 'Sole Trader', target: 'Target tumbuh 1–2% per bulan' },
  { value: 'ukm', label: 'UKM', target: 'Target tumbuh 1–2% per bulan' },
  { value: 'enterprise', label: 'Enterprise', target: 'Target tumbuh 5–10% per bulan' },
]

export const DEMO_ACCOUNTS = [
  { scale: 'sole', email: 'demo-ac@satualur.id', name: 'Budi Santoso — Servis AC', industry: 'Servis AC rumah & ruko', city: 'Bekasi' },
  { scale: 'sole', email: 'demo-cleaning@satualur.id', name: 'Rapi Bersih Home Cleaning', industry: 'Cleaning service rumah & kos', city: 'Makassar' },
  { scale: 'sole', email: 'demo-listrik@satualur.id', name: 'Listrik Siaga Medan', industry: 'Instalasi & perbaikan listrik', city: 'Medan' },
  { scale: 'ukm', email: 'demo-pest@satualur.id', name: 'CV Basmi Hama Nusantara', industry: 'Pest control rumah, F&B, gudang', city: 'Surabaya' },
  { scale: 'ukm', email: 'demo-laundry@satualur.id', name: 'CV Wangi Bersih Laundry', industry: 'Laundry kiloan + B2B hotel & klinik', city: 'Bandung' },
  { scale: 'ukm', email: 'demo-dinding@satualur.id', name: 'CV Glasur Dinding Borneo', industry: 'Pengecatan, coating & waterproofing', city: 'Balikpapan' },
  { scale: 'enterprise', email: 'demo-mall@satualur.id', name: 'PT Arunika Layanan Ritel', industry: 'Kebersihan & maintenance mal', city: '8 wilayah' },
  { scale: 'enterprise', email: 'demo-fm@satualur.id', name: 'PT Prima Layanan Fasilitas', industry: 'Facility management BUMN & perbankan', city: '9 wilayah' },
  { scale: 'enterprise', email: 'demo-rs@satualur.id', name: 'PT Sehat Bersih Medika', industry: 'Housekeeping RS, klinik & lab', city: '8 wilayah' },
]

export const isDemoEmail = (email) => DEMO_ACCOUNTS.some((a) => a.email === String(email || '').toLowerCase())
export const demoAccount = (email) => DEMO_ACCOUNTS.find((a) => a.email === String(email || '').toLowerCase()) || null
