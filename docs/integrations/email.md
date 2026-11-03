# Integrasi Email

> Status: Draft
> Terakhir diperbarui: 2026-11-03

## Ringkasan

| Pengirim | Kapan dipakai | Konfigurasi |
|----------|---------------|-------------|
| Resend (bawaan) | Kode masuk (OTP), uji admin, dan email bisnis yang tidak memakai SMTP sendiri | Secret `RESEND_API_KEY`, var `EMAIL_FROM` (domain terverifikasi di Resend, saat ini `apipedia.id`) |
| SMTP milik bisnis | Email penawaran/laporan/uji dari bisnis yang memilih "Server email saya sendiri" | Pengaturan › Email & AI. Butuh `TOKEN_KEY`; admin bisa mematikannya di Kantor › Sistem › Email |

Kode OTP **selalu** lewat Resend, tidak pernah lewat SMTP bisnis.

## Alur

- `POST /api/auth/send-otp` (saat `DEMO_OTP` bukan `"true"`): membuat kode, mengirim email OTP (HTML + teks), lalu menjawab tanpa kode. Bila email gagal, baris OTP dihapus dan pengguna melihat "Kode belum bisa dikirim…". Batas: 5 kode per email per 10 menit (yang sudah ada).
- `POST /api/email/send` `{ kind: offer|report, to, subject, body }`: penawaran ke alamat yang diketik pemilik (tabel `requests` tidak punya kolom email), maks. `offer_daily_cap` per hari (default 20, diatur admin); laporan hanya ke email pemilik sendiri, maks. 10 per hari. Akun demo: disimulasikan, tidak ada email terkirim.
- `POST /api/integrations/email/test`: email uji ke alamat pengguna sendiri.
- Semua pengiriman dicatat di `email_log` (penerima, subjek, pengirim, status, galat) dan tampil di Kantor › Sistem › Log aktivitas.

## SMTP sendiri

Klien SMTP minimal di Worker (`src/email/smtp.js`, `cloudflare:sockets`):

| Port | Mode |
|------|------|
| 465, 2465 | TLS langsung (`secureTransport: 'on'`) |
| 587, 2587 | STARTTLS (`secureTransport: 'starttls'` lalu `startTls()`) |

Urutan: sapaan 220 → `EHLO` → (STARTTLS → `EHLO`) → `AUTH PLAIN` (atau `AUTH LOGIN`) → `MAIL FROM` → `RCPT TO` → `DATA` (pesan RFC 5322 multipart teks + HTML, base64, subjek RFC 2047, dot-stuffing) → `QUIT`. Batas waktu 20 detik per balasan. Host harus domain publik; port 25 tidak didukung (Cloudflare memblokirnya).

Password disimpan di `business_integrations.smtp_pass_enc` (AES-GCM, `TOKEN_KEY`) dan tidak pernah dikirim balik ke browser.
