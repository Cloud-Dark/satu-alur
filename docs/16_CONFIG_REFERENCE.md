# Referensi Konfigurasi

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Sumber: `wrangler.toml`, `package.json`, `vite.config.js`, `src/cloud.js`. Pemasangan: [18_INSTALLATION.md](18_INSTALLATION.md).

## wrangler.toml

| Kunci | Nilai saat ini | Keterangan |
|-------|----------------|------------|
| `name` | `satu-alur` | Nama Worker |
| `main` | `worker/index.js` | Entri Worker |
| `compatibility_date` | `2025-09-01` | Tanggal kompatibilitas runtime |
| `[assets] directory` | `./dist` | Hasil `vite build` |
| `[assets] binding` | `ASSETS` | Dipakai Worker untuk meneruskan rute non-API |
| `[assets] not_found_handling` | `single-page-application` | Fallback SPA |
| `[assets] run_worker_first` | `["/api/*"]` | Hanya `/api/*` yang menjalankan Worker lebih dulu |
| `[ai] binding` | `AI` | Workers AI |
| `[[d1_databases]] binding` | `DB` | D1 |
| `[[d1_databases]] database_name` | `satu-alur-db` | Nama database |
| `[[d1_databases]] database_id` | `REPLACE_WITH_D1_ID` | Wajib diganti dengan ID dari `wrangler d1 create` |
| `[[d1_databases]] migrations_dir` | `migrations` | Folder berkas migrasi |
| `[vars] DEMO_OTP` | `"true"` | Mode demo OTP |

## Variabel Worker

| Nama | Jenis | Nilai | Dampak |
|------|-------|-------|--------|
| `DEMO_OTP` | var | `"true"` atau lainnya | Hanya string persis `"true"` yang membuat `send-otp` mengembalikan `demoCode`. Ubah ke `"false"` atau hapus untuk produksi. Tidak aman untuk publik ([10_RISK_REGISTER.md](10_RISK_REGISTER.md) R-001). |
| `EMAIL_API_KEY` | secret (rencana) | - | Belum dipakai; disebut dalam TODO provider email di Worker. Provider: _TBD_. |

## Binding yang Dibaca Worker

| Binding | Dipakai untuk |
|---------|---------------|
| `env.DB` | Semua kueri D1 |
| `env.AI` | `env.AI.run(model, params)` pada `/api/llm/chat` |
| `env.ASSETS` | `env.ASSETS.fetch(request)` untuk rute non-API |

## Variabel Klien (Vite)

| Nama | Nilai | Dampak |
|------|-------|--------|
| `VITE_USE_MOCK` | `true` | Memakai mock `localStorage` alih-alih `/api/*`. Hanya untuk pengembangan lokal; jangan set pada build deploy. |
| `localStorage.satualur_use_mock` | `1` | Pada mode `vite dev` saja, mengaktifkan mock tanpa env var. Diabaikan pada build produksi. |
| `localStorage.satualur_token` | token | Token sesi bearer yang disimpan klien. |

Variabel `VITE_*` ditanam ke bundel saat build; jangan menaruh rahasia di sana.

## Pengaturan Klien (localStorage)

Halaman Pengaturan menyimpan di peramban: `satualur_settings_mcp`, `satualur_settings_agent`, `satualur_settings_cloud`. Tidak dikirim ke Worker. Lihat R-011.

## Skrip npm

| Skrip | Perintah | Fungsi |
|-------|----------|--------|
| `dev` | `vite` | Dev server (port 5173), memproksikan `/api` ke `http://localhost:8787` |
| `build` | `vite build` | Build ke `dist/` |
| `preview` | `vite preview` | Pratinjau build |
| `cf:dev` | `vite build && wrangler dev` | Build lalu jalankan Worker lokal (port bawaan wrangler 8787) |
| `deploy` | `vite build && wrangler deploy` | Build lalu deploy ke Cloudflare |
| `db:migrate:local` | `wrangler d1 migrations apply satu-alur-db --local` | Terapkan migrasi ke D1 lokal |
| `db:migrate:remote` | `wrangler d1 migrations apply satu-alur-db --remote` | Terapkan migrasi ke D1 Cloudflare |
| `setup` | `node scripts/setup.js` | Skrip lama untuk `cloud.config.js` (WorkBuddy); status relevansi _TBD_ |
| `lint`, `test` | placeholder | Belum dikonfigurasi |

## Konstanta di Kode Worker

Ubah lewat `worker/index.js` (bukan variabel lingkungan): masa berlaku OTP 10 menit, 5 percobaan, 5 kode per email per jendela, masa berlaku sesi 30 hari, batas body, batas baris/filter/limit, daftar model, `MAX_TOKENS_CAP` 4096. Rincian di [21_BACKEND.md](21_BACKEND.md).

## Pencari Prospek (Sumber Data Peta)

Halaman **Pertumbuhan → Pencari prospek** (`src/stages/leads.js`) memanggil rute Worker `POST /api/leads/search`, `GET /api/leads/geocode?q=…` dan `GET /api/leads/sources` (semua wajib masuk). Kode rute ada di `worker/leads.js`; pemetaan kata kunci → tag OSM ada di `src/leads/osm.js`.

| Sumber | Kapan dipakai | Kunci | Catatan |
|--------|---------------|-------|---------|
| OpenStreetMap Overpass (`https://overpass-api.de/api/interpreter`) | Bawaan | Tidak perlu | Kueri `nwr[...](around:radius,lat,lon)`, `timeout:25`, maks. 150 hasil terdekat. Hasil di-cache 24 jam (Cache API `caches.default` + cache memori per isolate) dengan kunci titik dibulatkan 3 desimal (~110 m), radius 0,5 km, dan kata kunci terurut. |
| Nominatim (`https://nominatim.openstreetmap.org/search`) | Kotak cari alamat | Tidak perlu | `countrycodes=id`, User-Agent Satu Alur, cache 7 hari, jeda ≥1 detik per isolate; UI menunda pencarian 1 detik (kebijakan Nominatim 1 permintaan/detik). |
| Google Places API (New) Text Search | Hanya bila secret `GOOGLE_PLACES_API_KEY` di-set dan pengguna memilih "Google Places" | `GOOGLE_PLACES_API_KEY` | Hasil Google tidak di-cache di server (ketentuan Places). Pemakaian ditagih oleh Google. |

Tidak ada scraping Google Maps (melanggar Ketentuan Layanan Google).

### Mengaktifkan Google Places (opsional)

1. Di Google Cloud Console, aktifkan **Places API (New)** dan buat API key. Batasi key ke API tersebut (API restrictions) dan pasang kuota harian.
2. Simpan sebagai secret Worker (bukan `[vars]`, bukan `VITE_*`):
   ```bash
   npx wrangler secret put GOOGLE_PLACES_API_KEY
   ```
   Untuk `wrangler dev` lokal, taruh di `.dev.vars`: `GOOGLE_PLACES_API_KEY=...` (jangan di-commit).
3. Deploy ulang. `GET /api/leads/sources` lalu mengembalikan `google: true` dan UI menampilkan pilihan sumber OpenStreetMap / Google Places.

Key tidak pernah dikirim ke klien; Worker memanggil `places:searchText` dengan header `X-Goog-Api-Key` dan field mask minimal.

### Variabel opsional

| Nama | Default | Fungsi |
|------|---------|--------|
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Ganti instans Overpass (mis. instans sendiri, atau server uji lokal). |
| `GOOGLE_PLACES_API_KEY` | (kosong) | Secret; mengaktifkan sumber Google Places. |

### Batas & penyimpanan

- 20 pencarian dan 60 pencarian alamat per pengguna per jam (penghitung di Cache API + memori, tanpa tulis D1). Pencarian yang terlayani dari cache tidak dihitung. Catatan: pada `*.workers.dev` Cache API bisa tidak berfungsi; saat itu cache dan penghitung hanya berlaku per isolate (lebih longgar). Domain kustom memberi cache penuh.
- Validasi: titik harus di kotak batas Indonesia, radius 0,5–40 km, 1–8 kata kunci (2–40 karakter).
- Tabel D1 `leads` (migrasi `0006_leads.sql`, satu indeks `owner_id`) hanya terisi saat pengguna menekan **Simpan prospek** atau **Simpan ke alur**; hasil pencarian tidak disimpan.
- Mode demo (mock cloud) tidak memanggil jaringan: hasil contoh deterministik di sekitar titik, berlabel "Data contoh (mode demo)".
