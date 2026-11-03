# Testing Lokal (QA)

> Status: Draft
> Terakhir diperbarui: 2026-11-03

Panduan singkat untuk menguji semua fitur Satu Alur di laptop sendiri, tanpa akun Cloudflare. Semua data di mode ini **fiktif** dan tersimpan di browser.

## 1. Siapkan

Butuh Node.js 18+ (disarankan 22) dan Git.

```bash
git clone https://github.com/maszulfikarsuweleh/satu-alur.git
cd satu-alur
npm install
```

## 2. Jalankan

```bash
VITE_STAFF_USERS=staff:rahasia-demo-123 npm run dev
```

Di Windows (PowerShell):

```powershell
$env:VITE_STAFF_USERS="staff:rahasia-demo-123"; npm run dev
```

Buka `http://localhost:5173`. Mode dev otomatis memakai **mock**: data contoh dibuat saat pertama kali dibuka, dan jawaban AI **disimulasikan** (bukan model sungguhan).

## 3. Masuk

| Peran | Cara masuk |
|-------|-----------|
| Pemilik usaha | Halaman **Masuk** → isi email apa saja → **Kirim kode**. Kode OTP tampil di layar, klik untuk mengisi. |
| Akun demo (9 usaha) | Halaman **Masuk** → tab **Akun demo** → pilih skala dan akun. |
| Staf Kantor Satu Alur | Buka `http://localhost:5173/super-admin-login` → username `staff`, password `rahasia-demo-123` (dari `VITE_STAFF_USERS` di atas). |

## 4. Yang bisa diuji di mode ini

Semua menu bisa dibuka dan diisi: alur 6 tahap (Permintaan → Laporan), Layanan tambahan dan Tanpa limbah (VAS & Zero Waste), Radar peluang, Pencari prospek, Media Sosial, Penasihat AI, AI Superpowers, Pertumbuhan, Bantuan, tab **ERP & Integrasi** di Pengaturan, dan seluruh halaman Kantor Satu Alur.

Yang **berbeda dari production**:

- Jawaban AI adalah simulasi. Untuk menguji AI sungguhan, pakai situs live: <https://satu-alur.apipedia.workers.dev>.
- Posting ke Meta/Threads dan pembayaran tidak benar-benar terkirim.
- Data hanya ada di browser itu. Untuk mulai dari nol: buka DevTools → Application → Local Storage → hapus semua kunci `satualur_*`, lalu muat ulang.

## 5. Tes otomatis (opsional)

```bash
npm run test:unit   # unit test
npm i --no-save playwright && npx playwright install chromium   # sekali saja, untuk e2e
npm run test:e2e    # e2e Playwright
```

Untuk menjalankan satu bagian saja: `node tests/e2e/run.cjs office` (nama berkas di `tests/e2e/`).

## 6. Melaporkan bug

Catat: menu, langkah, hasil yang diharapkan, hasil yang terjadi, dan screenshot. Daftar kasus uji ada di [uat/](uat/).

Mode lain (Worker + D1 lokal, mendekati production) ada di [17_DEVELOPER_SETUP.md](17_DEVELOPER_SETUP.md).
