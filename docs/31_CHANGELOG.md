# Changelog

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/). Versi mengikuti `package.json` (saat ini `0.1.0`); penetapan nomor versi rilis: _TBD_.

## [Unreleased]

### Integrasi Tumbuh dan ruang kerja AI

- Menggabungkan `Cloud-Dark/satu-alur` main pada `e5beb83`, termasuk backend Cloudflare, landing/login, desain Tumbuh, dan combobox pencarian.
- Memindahkan Social Media dan AI Superpowers ke grup navigasi Ruang kerja tanpa mengubah enam tahap operasional.
- Menyesuaikan halaman konten, brainstorming, jadwal lokal, rekomendasi Meta Ads, partnership, dan percakapan AI ke panel, tipografi, ikon, tema terang/gelap, serta layout responsif yang sama.
- Hasil AI disanitasi dengan helper bersama. Pembatalan diteruskan ke stream HTTP; fallback tidak menggabungkan jawaban parsial; hasil tool lengkap disimpan dalam memori.
- Menjaga key konten/jadwal lokal yang sudah ada, menambahkan pesan kegagalan penyimpanan dan menyimpan hasil brainstorming ke pustaka ide.
- `npm test` menjalankan pemeriksaan integrasi AI berbasis Node/Vite: mock, tool, pembatalan, fallback, dan memori. Build serta smoke browser desktop (login mock, chat, generate/simpan konten) lulus.
- Belum diuji: layanan Cloudflare/Workers AI langsung dan layout perangkat seluler. Jadwal tetap berupa catatan lokal, bukan publikasi otomatis; percakapan memakai satu spesialis per sesi.

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
- Dependensi `@tencent-ai/workbuddy-cloud-sdk` dan konfigurasi `src/cloud.config.example.js` (sisa referensi lama seperti `scripts/setup.js` dan entri `.gitignore` untuk `src/cloud.config.js`: pembersihan _TBD_).

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

### Changed

- Desain ulang total ke Design System v2 "Tumbuh" (krem, hijau hutan, aksen kunyit; Instrument Serif + Plus Jakarta Sans). Spesifikasi: [specs/2026-10-28-design-system-v2-design.md](specs/2026-10-28-design-system-v2-design.md).
- Landing page baru (`#/`) dengan scene Three.js 6 pilar tumbuh (benih kunyit melompat antar tahap), pricing 3 paket (Sole Trader, UKM, Enterprise — harga draf), FAQ, dan demo agen AI.
- Halaman login baru (`#/masuk`) dengan OTP 6 kotak dan scene Three.js; dashboard dan semua tahap didesain ulang dengan metrik yang dihitung dari data (tanpa angka tren palsu).
- Logo baru: satu garis bertangga naik dengan titik kunyit (menggantikan bentuk S).
- Routing hash: `#/` landing, `#/masuk` login, `#/app` aplikasi.
- Semua dropdown kini memakai combobox dengan pencarian (`src/ui/combobox.js`): ketik untuk menyaring, sorotan teks cocok, navigasi keyboard, tetap memakai `<select>` asli sebagai sumber nilai.

### Fixed

- Penawaran AI sering gagal "bukan JSON yang valid": Worker kini memakai JSON mode Workers AI dengan skema (`scope`, `price`, `terms`, `notes`) lalu mengalirkan hasilnya sebagai SSE; klien memakai parser toleran yang memperbaiki key tanpa kutip penutup, code fence, dan koma berlebih, serta membuang key di luar skema.
- Pratinjau permintaan di tahap Penawaran menampilkan nomor telepon sebagai lokasi.

- Deploy pertama ke Cloudflare (https://satu-alur.apipedia.workers.dev, D1 `satu-alur-db` 085c9a7a-64c5-4ced-b0f3-3158870d64f4).
- Form Permintaan mengirim kolom `phone` yang tidak ada di skema: ditambahkan kolom `phone` (migrasi `0002_requests_phone.sql`) dan whitelist Worker.
- Penawaran yang disimpan kini berstatus `approved` agar muncul di tahap Penugasan (sebelumnya `draft`, alur terhenti).
