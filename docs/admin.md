# Admin Kantor Satu Alur

> Status: Draft
> Terakhir diperbarui: 2026-11-03

## Siapa admin

| Cara | Keterangan |
|------|------------|
| Akun staf | Username + password di `/super-admin-login` (`npm run staff`). Hanya melihat menu Kantor. |
| Admin lewat email | Email di var `ADMIN_EMAILS` (produksi: `apipedia22@gmail.com`) yang masuk dengan kode email atau Google. Berlaku hanya saat `DEMO_OTP` bukan `"true"`. Admin ini tetap punya aplikasi bisnisnya sendiri dan berpindah lewat tombol "Kantor Satu Alur" / "Kembali ke usaha saya" di sidebar. |

Semua rute `/api/office/admin/*` memakai `requireAdmin` (worker/office.js) yang mengakui keduanya.

## Yang bisa diatur

- **Konten situs, Bisnis, Pelanggan, Agensi Influencer**: halaman yang sudah ada (landing, legal, paket, payment gateway, voucher, pelanggan, pengguna, Contact Us, tiket CS, influencer, permintaan, kampanye).
- **Pengguna**: daftar dengan pencarian dan halaman, skala akun, paket, pemakaian AI bulan ini, saldo AI; tombol Detail (skala akun bisa diubah, kecuali akun demo), Tangguhkan/Pulihkan, Akhiri sesi.
- **Sistem › Dasbor sistem**: jumlah pengguna, aktif 7 hari, panggilan AI, email, voucher, dan status kesehatan (Resend, kunci enkripsi, OTP email, Google, admin email).
- **Sistem › Email**: nama pengirim, izinkan SMTP milik bisnis, batas email penawaran per hari, kirim email uji.
- **Sistem › Mesin AI**: model bawaan default, izinkan penyedia AI milik bisnis, uji mesin AI.
- **Sistem › Login**: status OTP email/demo/Google, redirect URI Google, sakelar "masuk dengan kode email".
- **Sistem › WhatsApp & sosial**: jumlah bisnis yang menghubungkan WAPilot/WAConsole/Repliz (bila tabelnya ada) dan status cadangan pengirim platform (`WA_PLATFORM_FALLBACK`, mati secara bawaan). Kredensial tiap bisnis tidak ditampilkan.
- **Sistem › Log aktivitas**: 100 email terbaru (filter per jenis) dan pemakaian AI per fitur bulan ini.

Pengaturan non-rahasia disimpan di tabel `system_settings` (kunci `email`, `ai`, `login`). Rahasia (Resend, Google, `TOKEN_KEY`) hanya di secret Worker dan tampil sebagai "Terkonfigurasi / Belum".

## Google Cloud Console

Jenis klien: Web application.

- Authorized JavaScript origins: `https://satu-alur.apipedia.workers.dev`
- Authorized redirect URIs: `https://satu-alur.apipedia.workers.dev/api/auth/google/callback`
- Scope: `openid email profile`
