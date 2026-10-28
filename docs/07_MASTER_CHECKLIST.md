# Master Checklist

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Centang `[x]` bila selesai. Butir deploy dicentang oleh pelaksana deployment setelah diverifikasi.

## Fase 1 - Prototype UI dan Mode Mock

- [x] Dashboard
- [x] Tahap 1 Permintaan
- [x] Tahap 2 Penawaran (AI, validasi domain)
- [x] Tahap 3 Penugasan
- [x] Tahap 4 Penyelesaian
- [x] Tahap 5 Pembukuan (jurnal, laba/rugi)
- [x] Tahap 6 Laporan (penjelasan AI)
- [x] Pengaturan (MCP, agent skill, model)
- [x] Mode mock berbasis localStorage dengan data contoh
- [x] Aturan domain `validateOffer` dan `OfferTransitions`
- [x] AntiSlop UI engine

## Fase 2 - Port ke Cloudflare (kode)

Status implementasi dikerjakan oleh tim lain; verifikasi tiap butir terhadap kode sebelum mencentang.

- [ ] Worker `worker/index.js` melayani `dist/` (ASSETS) dan `/api/*`
- [ ] Migrasi D1 untuk 9 tabel (`migrations/`)
- [ ] Auth: send-otp, verify-otp, session, signout
- [ ] Mode demo OTP (`DEMO_OTP`)
- [ ] Token sesi disimpan sebagai hash
- [ ] Endpoint `POST /api/db` dengan whitelist tabel/kolom dan scoping `owner_id`
- [ ] `GET /api/llm/models` dan `POST /api/llm/chat` (SSE) lewat Workers AI
- [ ] Klien `/api/*` dan pemilih mock/cloud (`VITE_USE_MOCK`)
- [ ] Hapus dependensi `@tencent-ai/workbuddy-cloud-sdk` dan `cloud.config*`
- [ ] Skrip npm: `deploy`, `cf:dev`, `db:migrate:local`, `db:migrate:remote`
- [ ] `wrangler.toml` dengan binding D1, AI, ASSETS

## Fase 3 - Verifikasi Lokal

- [ ] `npm install` bersih
- [ ] `npm run db:migrate:local` berhasil
- [ ] `npm run cf:dev` berjalan; login OTP demo berhasil
- [ ] Enam tahap berjalan end-to-end di `cf:dev`
- [ ] Mode mock (`VITE_USE_MOCK=true`) tetap berjalan
- [ ] Uji isolasi dua pengguna secara lokal

## Fase 4 - Deploy Cloudflare

Panduan: [18_INSTALLATION.md](18_INSTALLATION.md).

- [ ] D1 `satu-alur-db` dibuat
- [ ] `database_id` diisi di `wrangler.toml`
- [ ] `npm run db:migrate:remote` berhasil
- [ ] `npm run deploy` berhasil
- [ ] Verifikasi curl (auth, db, llm) lulus
- [ ] UAT Cloudflare dijalankan: [uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md)
- [ ] Model Workers AI bawaan ditetapkan dan diuji
- [ ] `DEMO_OTP` dikonfirmasi sesuai lingkungan (true hanya untuk uji)

## Fase 5 - Dokumentasi

- [x] Set dokumen `docs/` dibuat (2026-10-28)
- [ ] Dokumen direview dan status dinaikkan ke Review/Final
- [ ] `_TBD_` pada dokumen diselesaikan setelah kode digabung

## Fase 6 - Pasca Rilis (lihat [08_ROADMAP.md](08_ROADMAP.md))

- [ ] Provider email untuk OTP, `DEMO_OTP=false`
- [ ] Layar persetujuan penawaran
- [ ] Simpan laporan ke tabel `reports`
- [ ] Uji otomatis (Worker dan domain)
- [ ] Rate limit endpoint auth dan LLM
