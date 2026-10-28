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
