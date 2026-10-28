# Changelog

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/). Versi mengikuti `package.json` (saat ini `0.1.0`); penetapan nomor versi rilis: _TBD_.

## [Unreleased]

### 2026-10-28 - Port ke Cloudflare

#### Ditambahkan
- Cloudflare Worker tunggal (`worker/index.js`) yang melayani aset `dist/` lewat binding `ASSETS` dan rute `/api/*`.
- Database D1 `satu-alur-db` dengan migrasi `migrations/0001_init.sql` (tabel `users`, `sessions`, `otp_codes`, `requests`, `offers`, `assignments`, `completions`, `ledger_entries`, `reports`).
- Autentikasi email OTP: `POST /api/auth/send-otp`, `POST /api/auth/verify-otp`, `GET /api/auth/session`, `POST /api/auth/signout`; token sesi bearer disimpan sebagai hash.
- Mode demo OTP (`DEMO_OTP`) yang mengembalikan kode di respons karena belum ada provider email.
- Endpoint generik `POST /api/db` dengan whitelist tabel/kolom dan pembatasan `owner_id` di Worker.
- LLM lewat Workers AI: `GET /api/llm/models` dan `POST /api/llm/chat` (SSE gaya OpenAI).
- Klien HTTP `src/http-cloud.js` dan pemilih backend di `src/cloud.js`.
- Skrip npm `deploy`, `cf:dev`, `db:migrate:local`, `db:migrate:remote`; devDependency `wrangler`.
- Proksi `/api` ke `localhost:8787` pada Vite dev server.
- Set dokumentasi `docs/` bernomor, standar, dan template UAT Cloudflare ([README.md](README.md)).

#### Diubah
- Backend berpindah dari WorkBuddy Cloud SDK/PostgreSQL ke Cloudflare Worker + D1 + Workers AI ([11_DECISIONS.md](11_DECISIONS.md)).
- Mode mock (`localStorage`) hanya untuk pengembangan lokal, dipilih dengan `VITE_USE_MOCK=true`.
- `docs/API.md` ditulis ulang untuk kontrak `/api`.
- `docs/DATABASE_SCHEMA.md` diberi catatan "Superseded by 20_DATABASE.md (D1)".
- Bagian Tech Stack, aktivasi cloud, struktur, dan skrip di `README.md` disesuaikan dengan Cloudflare.

#### Dihapus
- Dependensi `@tencent-ai/workbuddy-cloud-sdk` dan konfigurasi `src/cloud.config.example.js` (berkas `.gitignore` untuk `src/cloud.config.js` dan `scripts/setup.js` masih ada; pembersihan _TBD_).

#### Diketahui / Belum Selesai
- OTP belum dikirim lewat email; hanya mode demo (R-001, R-002).
- Formulir Permintaan mengirim `phone` yang tidak ada di skema D1 (R-015).
- Belum ada layar persetujuan penawaran (R-009).
- Belum ada rate limit per IP/LLM dan belum ada uji otomatis.

Lihat [10_RISK_REGISTER.md](10_RISK_REGISTER.md).

## [0.1.0]

Tanggal rilis: _TBD_ (riwayat git: `initial project`, `initiate main feature and fix ui design`).

### Ditambahkan
- Prototype enam tahap (Permintaan, Penawaran, Penugasan, Penyelesaian, Pembukuan, Laporan), dashboard, dan pengaturan.
- Penawaran dan penjelasan laporan berbasis AI dengan streaming dan validasi domain.
- Mode prototype dengan data di `localStorage`.
- Desain awal untuk WorkBuddy Cloud SDK/PostgreSQL (`docs/API.md`, `docs/DATABASE_SCHEMA.md`).
