# Instalasi dan Deploy ke Cloudflare

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Langkah deploy Satu Alur sebagai satu Worker + D1 + Workers AI. Konfigurasi: [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md). Pengujian penerimaan setelah deploy: [uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md).

## Prasyarat

- Akun Cloudflare dengan Workers, D1, dan Workers AI tersedia (batas paket _TBD_).
- Node.js 18+ dan repositori sudah di-clone.
- `npm install` sudah dijalankan.
- Login wrangler: `npx wrangler login` (atau variabel `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` untuk CI).

## Langkah

### 1. Buat database D1

```bash
npx wrangler d1 create satu-alur-db
```

Salin `database_id` dari keluaran perintah.

### 2. Isi `database_id`

Edit `wrangler.toml`, ganti `REPLACE_WITH_D1_ID`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "satu-alur-db"
database_id = "<ID dari langkah 1>"
migrations_dir = "migrations"
```

### 3. Terapkan migrasi ke D1 remote

```bash
npm run db:migrate:remote
```

Pastikan 9 tabel terbentuk:

```bash
npx wrangler d1 execute satu-alur-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

### 4. Tetapkan mode OTP

`DEMO_OTP` di `wrangler.toml` bernilai `"true"` secara bawaan. Untuk uji internal biarkan `"true"`. Untuk akses publik jangan dipakai tanpa provider email (R-001, R-002). Catat nilai yang dipakai di checklist.

### 5. Deploy

```bash
npm run deploy
```

Perintah membangun `dist/` lalu mendeploy Worker. Catat URL `https://satu-alur.<subdomain>.workers.dev` dari keluaran.

### 6. Verifikasi dengan curl

Ganti `$URL` dengan URL Worker.

```bash
URL=https://satu-alur.<subdomain>.workers.dev

# 1) Halaman statis
curl -sI $URL/ | head -1                       # HTTP/2 200

# 2) Endpoint tanpa token harus 401
curl -s -X POST $URL/api/db -H 'content-type: application/json' \
  -d '{"table":"requests","action":"select"}'  # {"data":null,"error":{"message":"Belum masuk."}}

# 3) Minta OTP (mode demo mengembalikan demoCode)
curl -s -X POST $URL/api/auth/send-otp -H 'content-type: application/json' \
  -d '{"email":"uji@example.com"}'
# -> {"data":{"verificationId":"...","isExistingUser":false,"demoCode":"123456"},"error":null}

# 4) Verifikasi OTP, ambil access_token
curl -s -X POST $URL/api/auth/verify-otp -H 'content-type: application/json' \
  -d '{"email":"uji@example.com","verificationId":"<id>","token":"<demoCode>"}'

# 5) Sesi dan database dengan token
TOKEN=<access_token>
curl -s $URL/api/auth/session -H "authorization: Bearer $TOKEN"
curl -s -X POST $URL/api/db -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"table":"requests","action":"insert","values":[{"customer_name":"Uji","service_type":"Uji"}]}'
curl -s -X POST $URL/api/db -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"table":"requests","action":"select"}'

# 6) Model dan chat (SSE)
curl -s $URL/api/llm/models -H "authorization: Bearer $TOKEN"
curl -sN -X POST $URL/api/llm/chat -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"model":"@cf/meta/llama-3.1-8b-instruct-fast","messages":[{"role":"user","content":"Halo"}],"max_tokens":50}'
# -> baris "data: {...}" dan diakhiri "data: [DONE]"

# 7) Sign out lalu token harus 401
curl -s -X POST $URL/api/auth/signout -H "authorization: Bearer $TOKEN"
curl -s $URL/api/auth/session -H "authorization: Bearer $TOKEN"
```

Respons dokumentasi lengkap: [API.md](API.md).

### 7. Jalankan UAT

Isi [uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md) dan centang item di [07_MASTER_CHECKLIST.md](07_MASTER_CHECKLIST.md).

## Pembaruan

Deploy ulang: `npm run deploy`. Migrasi baru: tambahkan berkas bernomor di `migrations/` lalu `npm run db:migrate:remote` sebelum deploy kode yang memerlukannya.

## Rollback

- Kode: deploy ulang commit sebelumnya, atau gunakan fitur rollback versi Worker di dasbor Cloudflare (langkah persis _TBD_).
- Skema: migrasi D1 tidak otomatis dapat dibalik; buat migrasi korektif. Cadangan data: _TBD_ (kebijakan backup/Time Travel D1 belum dikaji).

## Pemecahan Masalah

| Gejala | Penyebab/solusi |
|--------|-----------------|
| `database_id` error saat deploy/migrasi | `REPLACE_WITH_D1_ID` belum diganti |
| `no such table` di remote | `npm run db:migrate:remote` belum dijalankan |
| `/api/llm/chat` 502 "Layanan AI tidak tersedia" | Binding `AI` belum aktif, kuota habis, atau model tidak tersedia; lihat log `wrangler tail` |
| Login tidak menampilkan kode | `DEMO_OTP` bukan `"true"`; provider email belum ada |
| Halaman kosong/404 | `dist/` belum terbangun; jalankan `npm run build` |
