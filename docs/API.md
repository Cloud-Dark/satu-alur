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
