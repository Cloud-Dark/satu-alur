# Dokumentasi API

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Kontrak HTTP API Satu Alur (Cloudflare Worker). Menggantikan dokumentasi lama berbasis WorkBuddy Cloud SDK. Implementasi dan semantik rinci: [21_BACKEND.md](21_BACKEND.md); skema data: [20_DATABASE.md](20_DATABASE.md).

## Ringkasan

- Base URL: origin yang sama dengan aplikasi (mis. `https://satu-alur.<subdomain>.workers.dev`); semua rute di bawah `/api`.
- Format: JSON (`content-type: application/json`), kecuali `/api/llm/chat` yang berupa SSE.
- Autentikasi: header `Authorization: Bearer <access_token>` (kecuali `send-otp` dan `verify-otp`).
- Batas body: 256 KB (auth, db), 512 KB (chat).

### Envelope Respons

```json
{ "data": <hasil atau null>, "error": null }
{ "data": null, "error": { "message": "Pesan kesalahan" } }
```

`/api/db` select dengan `count` menambahkan `"count": <angka>`.

### Kode Status

| Kode | Arti |
|------|------|
| 200 | Berhasil (kecuali `single` tanpa hasil: 200 dengan `error`) |
| 400 | Input tidak valid, tabel/kolom/operator tak dikenal, OTP salah/kedaluwarsa |
| 401 | Token tidak ada, tidak valid, atau sesi berakhir |
| 404 | Endpoint tidak ditemukan |
| 405 | Method tidak diizinkan untuk path |
| 413 | Body terlalu besar |
| 429 | Terlalu banyak permintaan kode OTP |
| 500 | Kesalahan server |
| 502 | Layanan AI tidak tersedia |

## Autentikasi

### POST /api/auth/send-otp

Request:

```json
{ "email": "pengguna@example.com" }
```

Respons 200:

```json
{ "data": { "verificationId": "uuid", "isExistingUser": false }, "error": null }
```

Pada mode demo (`DEMO_OTP="true"`) ditambah `"demoCode": "123456"`. Tanpa mode demo kode tidak dikembalikan dan, selama belum ada provider email, tidak terkirim ke mana pun. Masa berlaku 10 menit. Maks 5 permintaan per email per 10 menit (429).

### POST /api/auth/verify-otp

Request:

```json
{ "email": "pengguna@example.com", "verificationId": "uuid", "token": "123456" }
```

Respons 200:

```json
{
  "data": {
    "user": { "id": "uuid", "email": "pengguna@example.com", "name": "pengguna", "created_at": "2026-10-28T00:00:00.000Z" },
    "access_token": "<64 karakter hex>"
  },
  "error": null
}
```

Kesalahan: 400 "Kode OTP salah atau sudah kadaluarsa." (kode salah, kedaluwarsa, email tidak cocok, atau melebihi 5 percobaan). `access_token` berlaku 30 hari.

### POST /api/auth/staff-login

Login staf Satu Alur dari halaman `/super-admin-login` (kode: `worker/staff.js`). Akun dibuat dengan `npm run staff` (lihat [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md)).

```json
{ "username": "budi", "password": "minimal-12-karakter" }
```

Respons 200 sama seperti `verify-otp` (`user` dengan email `<username>@staff.satualur.internal`, `access_token`). Sesi ditandai `sessions.is_staff = 1` dan berlaku 12 jam. Hanya sesi ini yang mendapat `is_admin: true`.

Kesalahan: 401 "Username atau password salah." (username tidak ada, password salah, atau akun nonaktif; pesan sama agar username tidak bisa ditebak), 429 "Terlalu banyak percobaan. Coba lagi dalam 15 menit." (5 kali salah berturut-turut).

### GET /api/auth/session

Respons 200: `{ "data": { "user": { ... } }, "error": null }`. 401 bila tidak valid.

### POST /api/auth/signout

Respons 200: `{ "data": null, "error": null }`. Token tidak berlaku lagi.

## Database: POST /api/db

Satu endpoint untuk semua tabel domain: `requests`, `offers`, `assignments`, `completions`, `ledger_entries`, `reports`. Baris selalu dibatasi ke pengguna login (`owner_id`); jangan mengirim `owner_id`.

Field request:

| Field | Tipe | Aksi | Keterangan |
|-------|------|------|------------|
| `table` | string | semua | Nama tabel (whitelist) |
| `action` | string | semua | `select`, `insert`, `update`, `delete` |
| `columns` | string | select | `"*"` (bawaan) atau `"a,b,c"` |
| `filters` | array | select, update, delete | `[{ "op": "eq", "col": "status", "val": "approved" }]` |
| `order` | object | select | `{ "col": "created_at", "asc": false }` |
| `limit` | integer | select | Maks 1000 (bawaan 1000) |
| `range` | [int,int] | select | Inklusif, berbasis 0 |
| `single` | boolean | select | Tepat satu baris, objek tunggal |
| `maybeSingle` | boolean | select | Satu baris atau `null` |
| `count` | boolean | select | Sertakan `count` |
| `head` | boolean | select | Hanya `count` |
| `values` | object atau array | insert | Maks 100 baris |
| `changes` | object | update | Kolom yang diubah |

Operator filter: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is` (`null`/`true`/`false`), `in` (array, maks 100), `match` (`val` berupa objek, setara beberapa `eq`). Maks 20 filter. `update` dan `delete` wajib memiliki minimal satu filter.

### Contoh: select

```bash
curl -s -X POST $URL/api/db -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"table":"requests","action":"select","order":{"col":"created_at","asc":false},"limit":20}'
```

```json
{ "data": [ { "id": 1, "owner_id": "uuid", "customer_name": "PT Maju Jaya", "service_type": "Pembersihan AC", "location": "Jakarta Selatan", "description": "AC 5 unit", "status": "draft", "created_at": "2026-10-28T00:00:00.000Z" } ], "error": null }
```

### Contoh: insert

```json
{ "table": "offers", "action": "insert",
  "values": { "request_id": 1,
    "ai_proposal_json": { "scope": "Pembersihan AC 5 unit", "price": 500000, "terms": "Pembayaran 50% di muka", "notes": "" },
    "validated_price": 500000, "validated_scope": "Pembersihan AC 5 unit", "status": "draft" } }
```

Respons: `data` berisi array baris yang dibuat. Kolom JSON dikembalikan sebagai objek.

### Contoh: update dan delete

```json
{ "table": "assignments", "action": "update",
  "filters": [{ "op": "eq", "col": "id", "val": 3 }],
  "changes": { "status": "done" } }
```

```json
{ "table": "requests", "action": "delete", "filters": [{ "op": "eq", "col": "id", "val": 9 }] }
```

Respons: array baris yang terdampak.

### Contoh: count

```json
{ "table": "ledger_entries", "action": "select", "count": true, "head": true,
  "filters": [{ "op": "eq", "col": "category", "val": "pendapatan" }] }
```

Respons: `{ "data": null, "error": null, "count": 12 }`.

### Kesalahan Umum

| Pesan | Penyebab |
|-------|----------|
| `Tabel tidak dikenal.` | Tabel di luar whitelist (termasuk `users`, `sessions`, `otp_codes`) |
| `Kolom tidak dikenal: x` | Kolom di luar whitelist (mis. `phone` pada `requests`, lihat R-015) |
| `Operator tidak didukung: x` | Operator filter tidak dikenal |
| `Filter diperlukan untuk update/delete.` | Tidak ada filter |
| `Kolom tidak boleh diubah: owner_id` | Mencoba mengubah `id`/`owner_id` |
| `Referensi request_id tidak ditemukan.` | FK menunjuk baris yang bukan milik pengguna atau tidak ada |
| `Data tidak valid atau melanggar batasan.` | Constraint database (mis. kolom NOT NULL kosong) |

## LLM

### GET /api/llm/models

Respons 200:

```json
{ "data": [
  { "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "name": "Llama 3.3 70B Instruct (fast)", "disabled": false },
  { "id": "@cf/meta/llama-3.1-8b-instruct-fast", "name": "Llama 3.1 8B Instruct (fast)", "disabled": false }
], "error": null }
```

### POST /api/llm/chat

Request:

```json
{
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "messages": [ { "role": "system", "content": "..." }, { "role": "user", "content": "..." } ],
  "temperature": 0.4,
  "max_tokens": 2000,
  "response_format": { "type": "json_object" }
}
```

`temperature` 0-2; `max_tokens` dibatasi 4096; maks 50 pesan dan 100.000 karakter; role `system|user|assistant`. Dengan `response_format.type = "json_object"` Worker menambahkan instruksi sistem agar keluaran hanya JSON (hasil tetap harus divalidasi klien).

Respons 200 `text/event-stream`:

```
data: {"choices":[{"delta":{"content":"Halo"},"finish_reason":null}]}

data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

Kesalahan sebelum stream dimulai berupa JSON biasa (400/401/502). Pembatalan: tutup koneksi (`AbortController` di klien).

## Social Media: Publikasi Meta

Semua rute wajib masuk, kecuali `oauth/callback` (dipanggil Meta; dicek lewat `state` + cookie) dan `GET /api/media/:key` (publik, agar Meta bisa mengambil gambar). Kode: `worker/social.js`; konfigurasi: [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md). `social_posts` hanya bisa dibaca lewat `/api/db` (tulis lewat rute di bawah); `social_accounts` tidak bisa diakses lewat `/api/db`.

Akun demo bersama (`DEMO_EMAILS`, dipakai `demo-login`) mendapat 403 "Tidak tersedia di akun demo." pada `oauth/start`, `threads/start`, `oauth/pick`, `publish`, `schedule` dan `media`, dan `GET /api/social/account` untuk mereka selalu `configured: false`. Selama `DEMO_OTP` = `"true"` integrasi dianggap belum dikonfigurasi dan tidak ada admin (lihat [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md)).

| Rute | Fungsi | Kesalahan |
|------|--------|-----------|
| `GET /api/social/account` | `{ configured, threads_configured, account: { fb_connected, page_name, ig_username, ig_connected, needs_reconnect, threads_connected, threads_username, threads_needs_reconnect } }`; `account` null bila Facebook maupun Threads belum terhubung. Tidak pernah berisi token | - |
| `DELETE /api/social/account` | Putuskan Facebook (dan Instagram); Threads tetap terhubung | - |
| `POST /api/social/threads/start` | `{ url }` ke `threads.net/oauth/authorize` (scope `threads_basic,threads_content_publish`), memasang cookie `__Host-social_nonce` yang sama. `state` bertujuan `threads`, jadi tidak berlaku di callback Facebook dan sebaliknya | 503 bila Threads belum dikonfigurasi |
| `GET /api/social/threads/callback` | Mengalihkan (302) ke aplikasi: `?social=threads_connected` atau `?social_error=` | - |
| `DELETE /api/social/threads` | Putuskan Threads; Facebook tetap terhubung | - |
| `POST /api/social/oauth/start` | `{ url }` ke dialog Meta. Sekaligus memasang cookie sekali pakai `__Host-social_nonce` (HttpOnly, 10 menit) yang dicocokkan callback | 400 bila belum dikonfigurasi |
| `GET /api/social/oauth/callback` | Mengalihkan (302) ke aplikasi: `?social=connected`, `?social_pick=<id>` bila ada lebih dari satu Halaman, atau pesan galat. Menolak `state` kedaluwarsa atau cookie tidak cocok | - |
| `GET /api/social/oauth/pages?pick=<id>` | Daftar Halaman `[{ id, name, ig_username }]` (pilihan disimpan terenkripsi di D1 `social_oauth_picks`, sekali pakai) | 404 bila pilihan kedaluwarsa (10 menit) |
| `POST /api/social/oauth/pick` | Body `{ pick, page_id }`; menyimpan Halaman terpilih | 400 Halaman tak dikenal, 404 |
| `POST /api/social/media` | Unggah JPEG mentah (`content-type: image/jpeg`, maks. 8 MB); `{ key }`. Hanya bila integrasi Meta atau Threads terkonfigurasi dan pemanggil punya akun terhubung atau admin | 403 "Hubungkan akun media sosial terlebih dahulu.", 400 bukan JPEG, 413, 415, 503 bila R2 belum ada |
| `GET /api/media/:key` | Gambar publik (kunci 32 hex) | 404 |
| `POST /api/social/publish` | Body `{ content_id, platforms: ["facebook","instagram","threads"] }` (hanya platform yang terhubung; Threads: teks 1–500 karakter, maks. 1 tag topik); terbit sekarang, mengembalikan baris `social_posts` hasilnya. Tidak pernah dicoba ulang: galat sementara langsung `failed` | 400, 404 konten tak ditemukan |
| `POST /api/social/schedule` | Body sama + `scheduled_at` (ISO; 1 menit sampai 75 hari ke depan); mengembalikan baris berstatus `scheduled` | 400 |
| `DELETE /api/social/schedule/:id` | Batalkan baris yang masih `scheduled` | 409 bila sudah diproses |

Satu baris `social_posts` per platform. Instagram wajib bergambar dan butuh akun IG tertaut. Status baris: `scheduled`, `publishing`, `posted`, `failed`, `cancelled`.

**Cron** (`*/5 * * * *`): menerbitkan maks. 15 baris jatuh tempo per putaran (batas 50 subrequest Workers Free; satu baris IG bisa memakai hingga 8 panggilan Meta). Wadah IG ditunggu sampai `FINISHED` (5 kali, jeda 1,5 detik); `ERROR`/`EXPIRED` gagal dengan "Instagram menolak gambar ini.". Galat batas laju atau wadah IG yang belum siap dicoba ulang sampai 3 percobaan. Cron tidak berjalan selama `DEMO_OTP` = `"true"`. Galat tak pasti pada panggilan publikasi terakhir tidak pernah diulang (risiko posting ganda) dan tampil "Status tidak pasti, periksa halaman Anda"; baris `publishing` lebih dari 15 menit diberi pesan yang sama. Halaman berganti atau terputus: "Akun Facebook berubah atau terputus, jadwalkan ulang". Token ditolak Meta menandai akun perlu hubungkan ulang.

## Kantor Satu Alur

Kode: `worker/office.js`. Rute `admin/*` hanya untuk sesi dari `POST /api/auth/staff-login` (username + password di `/super-admin-login`); selain itu 403 "Khusus tim Satu Alur.". Login OTP biasa (`#/masuk`) tidak pernah menjadi admin. `GET /api/auth/session` mengembalikan `is_admin`. Login akun demo bukan admin di Worker asli; di mode mock/demo akun staf diatur lewat `VITE_STAFF_USERS` (kosong secara bawaan).

| Rute | Fungsi |
|------|--------|
| `GET /api/office/influencers` | Katalog influencer yang `visible` |
| `POST /api/office/requests` | Bisnis mengajukan `{ kind: "collab" \| "ads", influencer_id?, payload }`; `{ id }`. 400 bila validasi gagal atau influencer tidak tersedia |
| `GET /api/office/requests` | Permintaan milik sendiri (dengan `payload`, `status`, `admin_note`) |
| `GET /api/office/admin/influencers` | Semua influencer termasuk tersembunyi |
| `POST /api/office/admin/influencers` | Tambah; `{ id }` |
| `PATCH /api/office/admin/influencers/:id` | Ubah sebagian kolom |
| `GET /api/office/admin/requests[?status=]` | Kotak masuk semua bisnis (`new`, `in_progress`, `done`), dengan nama dan email bisnis |
| `PATCH /api/office/admin/requests/:id` | Ubah `status` dan/atau `admin_note` (maks. 2000 karakter); 404 bila tidak ada |

## Pemakaian dari Klien

Stage tidak memanggil `fetch` langsung; mereka memakai `getCloud()` (`src/cloud.js`) dengan antarmuka builder:

```javascript
import { getCloud } from './cloud.js'
const cloud = getCloud()

const { data, error } = await cloud.database.from('requests')
  .select('*').order('created_at', { ascending: false })

await cloud.database.from('assignments').update({ status: 'done' }).eq('id', 3)
```

`src/http-cloud.js` menerjemahkan builder tersebut menjadi `POST /api/db`; `src/mock/mock-cloud.js` menyediakan antarmuka sama untuk mode mock. Fungsi AI: `generateOffer` dan `explainReport` di `src/ai/agent.js` (lihat [03_FRD.md](03_FRD.md) FR-011 dan FR-016).

## Batas dan Kuota

- Rate limit API: belum ada selain pembatasan OTP per email.
- Kuota Workers AI dan batas D1: mengikuti paket Cloudflare, _TBD_ ([10_RISK_REGISTER.md](10_RISK_REGISTER.md)).
