# Changelog

> Status: Draft
> Terakhir diperbarui: 2026-10-29
> Pemilik: _TBD_

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/). Versi mengikuti `package.json` (saat ini `0.1.0`); penetapan nomor versi rilis: _TBD_.

## [Unreleased]

### 2026-10-29 - Tampilan ringkas, data tetap di perangkat

#### Diubah
- Header besar di setiap halaman (pil tahap, judul besar, paragraf penjelasan) diganti tooltip ⓘ di samping nama halaman pada topbar. Judul tetap ada untuk pembaca layar; baris aksi hanya muncul bila halaman punya aksi.
- Tulisan teknis dihapus dari UI: "Terhubung · Cloudflare D1", nama model AI, tab Cloud di Pengaturan, "JSON mentah", label sumber data peta.
- Pencari prospek: hasil dan riwayat pencarian (maks. 8) disimpan di localStorage per pengguna; pencarian berjalan di belakang layar walau pindah halaman (`src/leads/job.js`); peta dan form dikunci selama mengambil data.
- Penasihat AI: percakapan disimpan di localStorage per pengguna (maks. 60 pesan per agen) dan jawaban tetap mengalir saat pindah halaman; riwayat chat tidak lagi ditulis ke D1.
- Media sosial: Threads ditambahkan, plus tab "Akun terhubung" untuk menyimpan akun media sosial.

### 2026-10-29 - Tindak lanjut audit kode

#### Diperbaiki
- Worker menolak jurnal dengan jumlah nol/negatif atau kategori tak dikenal, pendapatan ganda untuk satu pekerjaan selesai (409), dan penyelesaian ganda untuk satu penugasan (409). Mock memakai aturan yang sama.
- Pembukuan memberi pesan validasi bila pendapatan pekerjaan itu sudah diposting; biaya tetap boleh berkali-kali.
- Penyelesaian menampilkan peringatan bila status penugasan gagal diperbarui (sebelumnya hanya `console.warn`).
- Mock menolak `update`/`delete` tanpa filter, sama seperti Worker.

#### Dihapus
- `scripts/setup.js` dan skrip `npm run setup` (sisa WorkBuddy), serta helper mati `typewriterEffect` dan `createParticleBackground`.

#### Pengujian
- `tests/flow-rules.test.mjs`: 7 tes untuk aturan uang dan alur (total 152 unit test).

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

- Grup "Pertumbuhan" di sidebar: **Media sosial** (konten, jadwal, ide, iklan Meta, kolaborasi, pustaka) dan **Penasihat AI** (5 agen + routing otomatis, snapshot bisnis dari data asli, kalkulator target pertumbuhan, memori di D1). Diport selektif dari PR #3 (maszulfikarsuweleh/satu-alur); fitur dengan angka karangan tidak dibawa. Migrasi `0003_growth_tools.sql`.
- Form tahap menjadi wizard 2–3 langkah (`C.wizard`) sehingga muat dalam satu layar.
- Data demo 9 bisnis (3 Sole Trader, 3 UKM, 3 Enterprise) selama 12 bulan dengan target pertumbuhan dan musiman Indonesia: `scripts/seed-demo.mjs`, `seeds/`, [specs/2026-10-28-demo-growth-data-design.md](specs/2026-10-28-demo-growth-data-design.md); analisis kecukupan form: [specs/2026-10-28-form-data-sufficiency-review.md](specs/2026-10-28-form-data-sufficiency-review.md).

- Halaman login punya dua mode: **Live** (email + OTP) dan **Akun demo** (pilih skala dan bisnis dari dropdown yang bisa dicari, masuk tanpa OTP lewat `POST /api/auth/demo-login`, hanya untuk 9 email demo; nonaktifkan dengan `DEMO_LOGIN="false"`). Tautan langsung: `#/masuk?demo`.

- **Radar peluang**: peluang dihitung dari transaksi asli (layanan berulang jatuh tempo, risiko churn, upsell kontrak, cross-sell, penawaran tertunda, tawarkan ulang, musiman) dengan skor transparan dan bukti; migrasi `0005_opportunity_states.sql`.
- **Pencari prospek** (MVP B2B): titik + radius + kriteria di peta OpenStreetMap (Google Places opsional lewat secret), ranking AI, estimasi nilai dari rata-rata pekerjaan asli, draf penawaran ke alur; migrasi `0006_leads.sql`. Tidak ada pengiriman otomatis.
- Pagination (`C.pager`/`C.paginate`) di semua daftar panjang; Penasihat AI muat satu layar (pemilih penasihat di header chat, panel bertab Snapshot/Kalkulator/Statistik).
- Label "Laba bersih" menjadi "Laba sebelum pajak".
- Test suite: `npm test` (unit + e2e), master test case, `docs/ENVIRONMENTS.md`, `docs/DEMO_SCRIPT.md`; generator seed dengan lapisan makro (riil vs nominal, inflasi, upah, pajak).

### Fixed

- Pencari prospek: server Overpass publik timeout dari Cloudflare; kini mencoba mirror lalu otomatis memakai cadangan Nominatim (dibatasi kotak radius), dengan jeda 5 menit sebelum mencoba Overpass lagi.
- Ranking AI prospek diputus (502) karena JSON mode tidak streaming; Worker kini membuka SSE segera dan mengirim keep-alive selama model bekerja; batch ranking 25 prospek.

- Hemat kuota D1: paging data memakai keyset (`id > last`) sehingga D1 hanya membaca baris yang dikirim (sebelumnya OFFSET/sort membaca 3–6× lebih banyak); migrasi `0004_drop_unused_fk_indexes.sql` menghapus 4 indeks relasi yang tidak dipakai query sehingga setiap insert hanya 2 tulisan (sebelumnya 3).

- Error D1 "daily row write limit" (paket Free) kini dikembalikan sebagai 503 dengan pesan jelas, bukan 500 generik.

- Data hanya memuat 1.000 baris terbaru per tabel sehingga total dashboard dan "Perlu tindakan" salah untuk akun besar; kini dimuat per halaman.
- Penawaran berstatus `rejected` dihitung sebagai draf; kini tampil "Ditolak" dan tidak masuk antrean.
- "Pelanggan teratas" di laporan dikelompokkan per pelanggan (bukan per permintaan); `period_start/end` laporan memakai tanggal lokal.
- Aksi AI yang diklik sebelum daftar model termuat kini menunggu, bukan gagal.

- Penawaran AI sering gagal "bukan JSON yang valid": Worker kini memakai JSON mode Workers AI dengan skema (`scope`, `price`, `terms`, `notes`) lalu mengalirkan hasilnya sebagai SSE; klien memakai parser toleran yang memperbaiki key tanpa kutip penutup, code fence, dan koma berlebih, serta membuang key di luar skema.
- Pratinjau permintaan di tahap Penawaran menampilkan nomor telepon sebagai lokasi.

- Deploy pertama ke Cloudflare (https://satu-alur.apipedia.workers.dev, D1 `satu-alur-db` 085c9a7a-64c5-4ced-b0f3-3158870d64f4).
- Form Permintaan mengirim kolom `phone` yang tidak ada di skema: ditambahkan kolom `phone` (migrasi `0002_requests_phone.sql`) dan whitelist Worker.
- Penawaran yang disimpan kini berstatus `approved` agar muncul di tahap Penugasan (sebelumnya `draft`, alur terhenti).
