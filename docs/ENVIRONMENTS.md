# Lingkungan dan Akses Tim

> Status: Draft
> Terakhir diperbarui: 2026-10-29
> Pemilik: _TBD_

Lembar ringkas untuk tim (QA, analis bisnis, pengembang): lokasi aplikasi, cara masuk, dan batas yang perlu dijaga. **Dokumen ini sengaja tidak memuat rahasia** (token API, ID akun Cloudflare, kata sandi). Minta akses ke pemilik akun, jangan menyalin token ke dokumen atau chat. Sumber fakta: `wrangler.toml`, `worker/index.js`, `src/auth/demo-accounts.js`, [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md), [17_DEVELOPER_SETUP.md](17_DEVELOPER_SETUP.md), [18_INSTALLATION.md](18_INSTALLATION.md), [seeds/README.md](../seeds/README.md).

## Ringkasan

| Lingkungan | URL | Backend | Data | Untuk |
|------------|-----|---------|------|-------|
| **Produksi** | https://satu-alur.apipedia.workers.dev | Cloudflare Worker `satu-alur` + D1 `satu-alur-db` + Workers AI | D1 remote (akun Live + 9 akun demo) | UAT, demo ke klien, uji bisnis dengan akun demo |
| **Lokal mock** | http://localhost:5173 (`npm run dev`) | Tidak ada; `src/mock/mock-cloud.js` di peramban | localStorage `satualur_mock_v1` (8 permintaan contoh) | Uji UI cepat, e2e otomatis |
| **Lokal Worker** | http://localhost:8787 (`npm run cf:dev`) | `wrangler dev` + D1 lokal (`.wrangler/`) | D1 lokal, bisa diisi seed demo | Uji mendekati produksi tanpa menyentuh kuota produksi |
| Staging | _TBD_ | _TBD_ | _TBD_ | Belum ada. Semua uji Cloudflare saat ini langsung ke produksi |

## Produksi

| Item | Nilai |
|------|-------|
| URL | `https://satu-alur.apipedia.workers.dev` (subdomain workers.dev `apipedia`) |
| Akun Cloudflare | Akun tim Apipedia. ID akun dan token API: tanya pemilik akun (_TBD_); jangan ditulis di repo |
| Worker | `satu-alur` (`main = worker/index.js`, `compatibility_date = 2025-09-01`) |
| Aset | `./dist` lewat binding `ASSETS`, fallback SPA. Hanya `/api/*` yang dijalankan Worker lebih dulu |
| D1 | nama `satu-alur-db`, binding `DB`, `database_id = 085c9a7a-64c5-4ced-b0f3-3158870d64f4` (pengenal, bukan rahasia) |
| Migrasi | Remote (per 2026-10-28): `0001`–`0003` sudah diterapkan. `0004` (hapus indeks FK), `0005_opportunity_states.sql` (Radar peluang) dan `0006_leads.sql` (Pencari prospek) dijadwalkan diterapkan 2026-10-29 setelah kuota tulis harian pulih. Cek dengan `npx wrangler d1 migrations list satu-alur-db --remote` |
| Workers AI | binding `AI`. Model (daftar tetap di `worker/index.js`): `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (bawaan, urutan pertama) dan `@cf/meta/llama-3.1-8b-instruct-fast` |
| Batas Worker | Body auth/db 256 KB, chat 512 KB. OTP berlaku 10 menit, 5 percobaan, 5 kode per email per 10 menit. Sesi 30 hari. Maks 5.000 baris per kueri, 100 baris per insert. `max_tokens` ≤ 4096 |
| Seed yang termuat | Seed **penuh** `seeds/demo.sql` (diterapkan 2026-10-28; 39.182 baris di 9 akun demo, terverifikasi lewat hitungan baris). Kunci jawaban di [uat/2026-10-29_test-cases.md](uat/2026-10-29_test-cases.md#21-skenario-bisnis-dengan-9-akun-demo) memakai angka seed penuh. Seed lean hanya ada di D1 lokal pengembang |

### Variabel (`[vars]` di `wrangler.toml`)

| Nama | Nilai sekarang | Dampak |
|------|----------------|--------|
| `DEMO_OTP` | `"true"` | `POST /api/auth/send-otp` mengembalikan `demoCode`, jadi kode tampil di layar login. **Siapa pun bisa masuk sebagai email apa pun** (R-001). Belum ada provider email (R-002). Ubah ke `"false"` sebelum akses publik |
| `DEMO_LOGIN` | `"true"` | Mengaktifkan `POST /api/auth/demo-login` (masuk tanpa OTP) untuk 9 email demo saja. `"false"` membuat endpoint ini menjawab 403 "Mode demo tidak aktif." |

Secret dan variabel opsional (nilainya tidak pernah ditulis di repo):

| Nama | Jenis | Status | Fungsi |
|------|-------|--------|--------|
| `GOOGLE_PLACES_API_KEY` | secret | opsional, status di produksi _TBD_ | Menambah sumber Google Places di Pencari prospek. Tanpa secret ini hanya OpenStreetMap yang dipakai. Rincian di [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md#pencari-prospek-sumber-data-peta) |
| `OVERPASS_URL` | var | opsional | Mengganti instans OpenStreetMap Overpass |
| `EMAIL_API_KEY` | secret | rencana | Provider email OTP (_TBD_) |

Secret diisi dengan `npx wrangler secret put NAMA`, atau `.dev.vars` untuk lokal (jangan di-commit). Jangan taruh secret di `[vars]` atau `VITE_*`.

## Cara masuk

Halaman login `#/masuk` punya dua mode:

| Mode | Langkah | Kapan dipakai |
|------|---------|---------------|
| **Live** | Isi email → "Kirim kode" → kode 6 digit tampil di kotak "Mode demo" (karena `DEMO_OTP="true"`) → "Isi otomatis" atau ketik kode → masuk | Uji dengan akun sendiri (data kosong, terisolasi per email). Pakai alias, mis. `nama+uji1@domain` |
| **Akun demo** | Tab "Akun demo" → pilih Skala bisnis → pilih Akun demo (bisa dicari) → "Masuk ke mode demo" | Uji bisnis dengan data contoh 12 bulan. **Akun dipakai bersama**: perubahan Anda terlihat oleh orang lain, jadi jangan isi data pribadi |

Tautan `#/masuk?demo` seharusnya langsung membuka mode demo, tetapi saat ini masih terbuka di mode Live (BUG-01 di [daftar test case](uat/2026-10-29_test-cases.md#23-temuan)).

### Akun demo

Semua data **fiktif**. Dibuat oleh `scripts/seed-demo.mjs` untuk 12 bulan (Nov 2025–Okt 2026, as-of 28 Okt 2026). Daftar email harus sama dengan `DEMO_EMAILS` di `worker/index.js` (dicek otomatis oleh `tests/demo-accounts.test.mjs`).

| # | Email | Skala | Usaha | Kota | Target |
|---|-------|-------|-------|------|--------|
| 1 | `demo-ac@satualur.id` | Sole Trader | Budi Santoso, Servis AC rumah & ruko | Bekasi | 1–2%/bulan |
| 2 | `demo-cleaning@satualur.id` | Sole Trader | Rapi Bersih Home Cleaning, cleaning rumah & kos | Makassar | 1–2%/bulan |
| 3 | `demo-listrik@satualur.id` | Sole Trader | Listrik Siaga Medan, instalasi & perbaikan listrik | Medan | 1–2%/bulan |
| 4 | `demo-pest@satualur.id` | UKM | CV Basmi Hama Nusantara, pest control rumah/F&B/gudang | Surabaya | 1–2%/bulan |
| 5 | `demo-laundry@satualur.id` | UKM | CV Wangi Bersih Laundry, kiloan + B2B hotel & klinik | Bandung | 1–2%/bulan |
| 6 | `demo-dinding@satualur.id` | UKM | CV Glasur Dinding Borneo, pengecatan/coating/waterproofing | Balikpapan | 1–2%/bulan |
| 7 | `demo-mall@satualur.id` | Enterprise | PT Arunika Layanan Ritel, kebersihan & maintenance mal | 8 wilayah | 5–10%/bulan |
| 8 | `demo-fm@satualur.id` | Enterprise | PT Prima Layanan Fasilitas, FM BUMN & perbankan | 9 wilayah | 5–10%/bulan |
| 9 | `demo-rs@satualur.id` | Enterprise | PT Sehat Bersih Medika, housekeeping RS/klinik/lab | 8 wilayah | 5–10%/bulan |

Di **mode mock lokal**, akun demo hanya membuat pengguna baru di memori dan menampilkan data mock yang sama (8 permintaan), **bukan** data 12 bulan. Data 12 bulan hanya ada di produksi atau D1 lokal yang sudah di-seed.

## Pengembangan lokal

Prasyarat: Node.js 18+ (disarankan 22) dan `npm install`.

### Mode mock (tanpa backend)

```bash
VITE_USE_MOCK=true npm run dev      # http://localhost:5173
```

- Data di localStorage `satualur_mock_v1`, terisi otomatis saat pertama dibuka. Untuk mengulang dari awal, hapus key itu lalu muat ulang.
- AI disimulasikan dan tidak memanggil Workers AI.
- Login: email apa pun, lalu kode tampil di layar. Sesi hanya di memori, jadi muat ulang halaman = keluar.
- Tidak ada isolasi antar email. Uji isolasi data hanya bisa di Worker (lokal atau produksi).
- Alternatif tanpa env var (hanya `vite dev`): `localStorage.setItem('satualur_use_mock','1')`.

### Worker + D1 lokal (mendekati produksi)

```bash
npm run db:migrate:local                                                   # buat tabel di .wrangler/
npx wrangler d1 execute satu-alur-db --local --file seeds/demo.sql         # opsional: 9 akun demo, ±39 ribu baris
npm run cf:dev                                                             # vite build + wrangler dev → http://localhost:8787
```

- Untuk hot reload UI, jalankan juga `npm run dev` di terminal kedua (Vite :5173 memproksikan `/api` ke :8787).
- Seed lokal **tidak** memakai kuota produksi dan aman diulang.
- Binding Workers AI di `wrangler dev` memerlukan `npx wrangler login`. Pemakaian AI lokal mungkin tetap tercatat di akun Cloudflare (_TBD_, verifikasi).

### Menjalankan test

```bash
npm run test:unit        # node:test, modul murni + integrasi (Vite SSR, mock)
npm run test:e2e         # Playwright (sudah terpasang di mesin), Vite mock di port 5199, PASS/FAIL per cek
npm test                 # keduanya
node tests/e2e/run.cjs login flow                 # hanya spec yang namanya mengandung "login"/"flow"
E2E_SHOTS=/tmp/shots npm run test:e2e             # simpan tangkapan layar
```

E2E selalu memakai mode mock dan **tidak boleh** diarahkan ke produksi karena menulis data.

## Batas paket gratis

Akun Cloudflare saat ini memakai paket **Free**. Angka berikut sesuai dokumentasi Cloudflare per Oktober 2026 (cek ulang di dasbor bila paket berubah):

| Layanan | Batas | Reset |
|---------|-------|-------|
| D1 baris **ditulis** | **100.000/hari**, termasuk entri indeks. Satu baris domain = 2 writes, satu `users` = 3 writes (setelah migrasi 0004) | 00.00 UTC (07.00 WIB) |
| D1 baris **dibaca** | **5.000.000/hari** | 00.00 UTC |
| D1 penyimpanan | 500 MB per database, 5 GB per akun | - |
| Workers request | 100.000/hari | 00.00 UTC |
| Workers AI | 10.000 neurons/hari (model 70B jauh lebih mahal per token dibanding 8B) | 00.00 UTC |

Pemakaian yang menulis ke D1: login Live (OTP + user + sesi), login demo (1 sesi), setiap simpan di tahap 01–05, Media sosial (pustaka/jadwal), Penasihat AI (setiap pertanyaan dan jawaban), Radar (status kartu), Pencari prospek (prospek disimpan).

### Insiden 2026-10-28

- `seeds/demo.sql` penuh (39.182 baris, ±112.316 writes termasuk indeks) diterapkan ke D1 produksi dan melewati batas 100.000 writes/hari.
- Akibatnya **semua penyimpanan gagal sampai 00.00 UTC**, termasuk login (OTP dan sesi). Membaca tetap berjalan.
- Tindak lanjut yang sudah masuk:
  - Worker mengembalikan 503 "Batas penulisan harian database tercapai…" alih-alih 500 generik.
  - Migrasi `0004` menghapus indeks yang tidak dipakai (3 → 2 writes per baris).
  - Paging keyset menghemat baca.
  - Ada mode seed `--lean --split` (3 file, ±38 ribu writes per file, satu file per hari).

**Aturan tim:**

1. **Jangan menjalankan seed ulang ke produksi di paket Free.** Mengganti seed penuh dengan seed lain menulis lebih dari 100 ribu baris (hapus + isi).
2. Seed `--remote` hanya dijalankan oleh lead, satu file lean per hari UTC, di luar jam uji.
3. Uji beban, uji banyak data, dan uji kuota dikerjakan di **D1 lokal**.
4. Sebelum sesi UAT besar, cek sisa kuota hari itu di dasbor Cloudflare (D1 → Metrics).

## Log dan pemantauan

```bash
npx wrangler tail satu-alur                  # log Worker real time (console.error "Unhandled error", 5xx)
npx wrangler tail satu-alur --status error   # hanya error
npx wrangler d1 execute satu-alur-db --remote --command "SELECT COUNT(*) FROM requests"   # baca saja; memakai kuota baca
```

Perlu login wrangler dengan akses ke akun tim. Metrik D1 (baris dibaca/ditulis per hari) dan Workers AI (neurons) ada di dasbor Cloudflare. Log tidak memuat isi data pengguna. Error yang tidak tertangani hanya dicatat di log, tidak dikirim ke klien.

## Kontak

| Kebutuhan | Hubungi |
|-----------|---------|
| Akses akun Cloudflare / wrangler | _TBD_ |
| Deploy, migrasi, seed produksi | _TBD_ (lead) |
| Bug aplikasi dan test case | _TBD_ |
| QA / analis bisnis | Margareta Lola |
