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

Respons 200: `{ "data": { "user": { ... }, "is_admin": false }, "error": null }`. 401 bila tidak valid.

`user.plan` berisi tier langganan: `sole`, `ukm`, atau `enterprise`. Nilainya dibaca dari `user_flags.plan` dan dipakai untuk menutup fitur ([06_SCALABLE_ARCHITECTURE.md](06_SCALABLE_ARCHITECTURE.md) §4). Akun baru mendapat `sole`; akun demo mengikuti skala seed-nya dan diselaraskan setiap `demo-login`.

### POST /api/auth/signout

Respons 200: `{ "data": null, "error": null }`. Token tidak berlaku lagi.

## Database: POST /api/db

Satu endpoint untuk semua tabel domain: `requests`, `offers`, `assignments`, `workers`, `assignment_workers`, `completions`, `ledger_entries`, `vas_items`, `waste_entries`, `reports`, `social_contents`, `social_schedules`, `ai_messages`, `opportunity_states`, `leads`. Baris selalu dibatasi ke pengguna login (`owner_id`); jangan mengirim `owner_id`. `social_posts` hanya boleh dibaca; `social_accounts` dan `social_oauth_picks` tidak ada di whitelist.

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

### Aturan Tabel Pendapatan (`vas_items`, `waste_entries`)

Kedua tabel divalidasi oleh `src/pendapatan/rules.js` — modul yang sama yang dipakai formulir dan mock cloud, sehingga UI tidak bisa menerima baris yang akan ditolak server, dan sebaliknya. Pelanggaran mengembalikan **400** dengan pesan berbahasa Indonesia yang siap ditampilkan.

| Aturan | Berlaku pada | Pesan (400) |
|--------|--------------|-------------|
| `name` wajib, 2–80 karakter | `vas_items` insert/update | `Nama item wajib diisi.` · `Nama item minimal 2 karakter.` · `Nama item maksimal 80 karakter.` |
| `category` dari enum | `vas_items` | `Kategori item tidak dikenal.` |
| `price` > 0 dan ≤ Rp1.000.000.000 | `vas_items` | `Harga jual harus lebih dari nol.` · `Harga jual maksimal Rp1.000.000.000.` |
| `cost` ≥ 0 dan ≤ Rp1.000.000.000 | `vas_items` | `Biaya langsung tidak boleh negatif.` |
| `attach_rate` angka 0–100 | `vas_items` | `Tingkat pasang harus angka 0 sampai 100.` |
| `status` dari enum | `vas_items` | `Status item tidak dikenal.` |
| `title` wajib, 3–120 karakter | `waste_entries` | `Judul temuan wajib diisi.` · `Judul temuan minimal 3 karakter.` |
| `stream` dari enum | `waste_entries` | `Sumber pemborosan tidak dikenal.` |
| `monthly_loss` > 0 dan ≤ Rp1.000.000.000 | `waste_entries` | `Kerugian per bulan harus lebih dari nol.` |
| `saved` ≥ 0 dan ≤ `monthly_loss` | `waste_entries` | `Nilai yang sudah dihentikan tidak boleh negatif.` · `Yang sudah dihentikan tidak boleh melebihi kerugian tercatat.` |
| `status: 'done'` berarti `saved === monthly_loss` | `waste_entries` | `Temuan yang selesai harus dihitung terhenti penuh.` |
| `status` dari enum | `waste_entries` | `Status temuan tidak dikenal.` |
| Maks 500 item katalog per pemilik | `vas_items` insert | `Batas 500 item katalog tercapai (N tersimpan). Hapus yang tidak terpakai lebih dulu.` |
| Maks 2000 temuan per pemilik | `waste_entries` insert | `Batas 2000 temuan tercapai (N tersimpan). Hapus yang tidak terpakai lebih dulu.` |

Dua perilaku yang mudah disalahpahami:

- **`attach_rate` di luar rentang dijepit, bukan ditolak** (`150` → `100`, `-5` → `0`). Nilai 0–1 dibaca sebagai pecahan (`0,25` = 25%), sesuai label kolom yang memakai persen. Hanya nilai yang bukan angka sama sekali yang gagal.
- **Uang menerima format tempelan.** `moneyInt("Rp 450.000")` → `450000`; titik dibaca sebagai pemisah ribuan, bukan desimal.

Catatan penting:

- **Update divalidasi terhadap baris hasil gabungan.** `changes` hanya berisi kolom yang berubah, jadi invarian `saved <= monthly_loss` diperiksa pada baris tersimpan yang digabung dengan perubahan — bukan pada `changes` saja. Mengubah `monthly_loss` ke bawah `saved` ditolak; menandai `status: 'done'` otomatis menaikkan `saved` ke `monthly_loss`.
- **Update `waste_entries` memerlukan filter `eq` pada satu `id`.** Setiap temuan memiliki kerugian berbeda; perubahan status harus memakai angka temuan itu sendiri. Update massal dengan filter aliran/status ditolak (400).
- **`updated_at` diisi server.** Nilai dari klien diabaikan.
- **`ledger_entries.vas_item_id`** opsional dan harus menunjuk `vas_items` milik pengguna yang sama (`Referensi vas_item_id tidak ditemukan.` bila bukan). `NULL` berarti pendapatan jasa biasa. Kolom ini yang membuat "Porsi VAS" di dasbor terukur, bukan perkiraan.
- Batas 100 baris per `insert` tetap berlaku; UI menolak tempelan lebih dari 100 baris. Bagi berkas besar menjadi beberapa impor. Baris duplikat dapat dilewati (nama item untuk VAS, judul untuk temuan).

### Kesalahan Umum

| Pesan | Penyebab |
|-------|----------|
| `Tabel tidak dikenal.` | Tabel di luar whitelist (termasuk `users`, `sessions`, `otp_codes`) |
| `Kolom tidak dikenal: x` | Kolom di luar whitelist (mis. `phone` pada `requests`, lihat R-015) |
| `Operator tidak didukung: x` | Operator filter tidak dikenal |
| `Filter diperlukan untuk update/delete.` | Tidak ada filter |
| `Kolom tidak boleh diubah: owner_id` | Mencoba mengubah `id`/`owner_id` |
| `Referensi request_id tidak ditemukan.` | FK menunjuk baris yang bukan milik pengguna atau tidak ada |
| `Batas 500 item katalog tercapai (…)` | Insert `vas_items` melebihi kuota per pemilik |
| `Batas 2000 temuan tercapai (…)` | Insert `waste_entries` melebihi kuota per pemilik |
| `Yang sudah dihentikan tidak boleh melebihi kerugian tercatat.` | `saved > monthly_loss` (insert maupun update) |
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

## MCP: Konektor ERP dan Migrasi

MCP adalah nama modul konektor internal, bukan implementasi standar Model Context Protocol. Implementasi: `worker/mcp.js`; aturan bersama: `src/mcp/rules.js`. [Panduan implementasi](mcp/MCP_SPEC.md) dan [skema D1](20_DATABASE.md).

Authenticated routes memerlukan sesi Bearer, kepemilikan, dan paket Enterprise. Plan `sole`, `ukm`, atau tidak ada mendapat `403`. Webhook memakai HMAC serta memeriksa plan/suspensi pemilik saat event diterima. Tabel `mcp_*` tidak tersedia lewat `/api/db`.

Respons memakai `{ data, error }`; create konektor/migrasi mengembalikan `201`, operasi lain `200`. Galat memakai `{ data: null, error: { message } }`.

### Batas dan cakupan

| Batas | Nilai |
|-------|-------|
| Body request | 256 KiB; `413` jika terlampaui |
| Nama konektor | 2–80 karakter |
| URL REST | Maks. 500 karakter, HTTPS hostname publik, tanpa userinfo atau fragmen; redirect ditolak |
| Konektor per pemilik | 20 |
| Pemetaan per pemilik | 60; pemetaan yang sudah ada tetap dapat diperbarui pada batas ini |
| Bidang per pemetaan | 120 |
| Baris per request | 500; input atau respons REST berlebih ditolak seluruhnya |
| Dead letter per sync | Maks. 200 baris gagal disimpan, maks. 20.000 karakter per baris mentah |

Entitas yang dapat ditulis adalah `requests`, `workers`, `vas_items`, dan `waste_entries`. Penawaran/jurnal dan entitas dengan referensi internal belum dapat diimpor. Hanya arah `inbound` didukung. Mode `upsert` memakai `externalIdField` atau natural key; `insert` selalu membuat baris baru. Tidak ada penjadwal ERP, pagination vendor, atau retensi log otomatis.

### Konektor dan pemetaan

| Rute | Kontrak |
|------|---------|
| `GET /api/mcp/schema` | `{ entities: [{ key, label, importable, columns: [{ name, type, required, values }] }], phases }` |
| `GET /api/mcp/connectors` | Array konektor milik pemanggil, tanpa rahasia |
| `POST /api/mcp/connectors` | `{ type, name, enabled?, config?, apiKey?, password?, token?, secret? }`; tipe `rest`, `database`, `file`, `webhook` → `201`. Bidang konfigurasi juga boleh flat; rahasia nested dalam `auth`/`connection` dipisahkan sebelum disimpan |
| `GET /api/mcp/connectors/:id` | Satu konektor; `404` bila tidak dimiliki pemanggil |
| `PATCH /api/mcp/connectors/:id` | Perubahan sebagian. `enabled`/rahasia yang tidak dikirim dipertahankan. Tipe tidak dapat diganti; buat konektor baru |
| `DELETE /api/mcp/connectors/:id` | Hapus konektor, pemetaan, log, dead letter, dan referensi eksternal. Catatan migrasi dan jurnal tetap disimpan |
| `POST /api/mcp/connectors/:id/test` | `{ ok, code, message, status, latencyMs }`. REST: HEAD, fallback GET untuk 405/501, timeout maks. 20 detik. Database: `code: "BRIDGE_REQUIRED"`. File/webhook: validasi konfigurasi |
| `GET /api/mcp/connectors/:id/mappings` | Array pemetaan masuk |
| `PUT /api/mcp/connectors/:id/mappings` | `{ entity, direction?, fields, externalIdField?, mode?, filters? }`. `fields`: `[{ source?, target, transform?, mapping?, constant? }]`. Kolom wajib harus dipetakan. Hanya `inbound` dan entitas importable diterima |
| `DELETE /api/mcp/connectors/:id/mappings/:entity` | Hapus pemetaan milik pemanggil |

REST memakai `config.endpoint.baseUrl`, `config.auth.type` (`apikey`, `basic`, `oauth2`), dan `config.auth.headerName` untuk API key. Basic membutuhkan `username` dan `password`; OAuth membutuhkan bearer `token` yang sudah diperoleh. Tidak ada token refresh otomatis. File hanya mendukung CSV/JSON; ekspor Excel sebagai CSV.

### Sinkronisasi

| Rute | Kontrak |
|------|---------|
| `POST /api/mcp/connectors/:id/sync` | `{ dryRun?, trigger?, entity?, rows? }`. Konektor harus aktif dan mempunyai pemetaan. `rows` untuk file; tanpa rows, REST menarik array JSON dari sumber. `dryRun` tidak menulis data atau log |
| `GET /api/mcp/connectors/:id/sync` | 100 log terakhir milik konektor |
| `GET /api/mcp/sync/:id` | Satu log sync milik pemanggil |
| `GET /api/mcp/sync` | 100 log terakhir milik pemanggil |
| `GET /api/mcp/errors?status=open` | Dead letter milik pemanggil; status `open`, `resolved`, `ignored` |
| `PATCH /api/mcp/errors/:id` | `{ status }`; mengubah penandaan, bukan menjalankan replay otomatis |

REST menerima array langsung, `{ data: [] }`, `{ records: [] }`, atau `{ rows: [] }`. Path tambahan dari `filters.path` atau `config.endpoint.entityPath`; query dari `filters.query`.

Hasil sync: `{ syncId, dryRun, status, stats, errors, errorCount }`, dengan `stats: { processed, inserted, updated, skipped, failed, entities }`. Error per baris tidak membatalkan baris lain; INSERT domain dan referensi/jurnalnya tetap atomik. `errors` membatasi contoh 50 item.

### Migrasi

| Rute | Kontrak |
|------|---------|
| `GET /api/mcp/migrations` | 50 migrasi terakhir milik pemanggil |
| `POST /api/mcp/migrations` | `{ connectorId?, name, strategy?, phases? }` → `201`. Fase tersedia `master` (`workers`, `vas_items`) dan `open_transactions` (`requests`). Strategi `parallel`, `phased`, `bigbang` adalah label operator; tidak menjalankan cutover otomatis |
| `GET /api/mcp/migrations/:id` | Satu migrasi dan fase |
| `POST /api/mcp/migrations/:id/run` | `{ phaseIndex?, dryRun?, rowsByEntity?: { entity: rows[] } }`. Memerlukan konektor aktif dan pemetaan masuk. File memerlukan baris sumber. Fase dijalankan sekali dan berurutan; duplikat/permintaan serentak `409`. Dry run mengembalikan pratinjau tanpa mengubah progres/data/log/lock tersimpan |
| `POST /api/mcp/migrations/:id/rollback` | Hapus hanya baris baru milik run ini yang belum berubah dan belum dipakai. `{ rolledBack, removedRows, retainedRows }`. Update pada baris lama tidak dipulihkan; fase/statistik dipertahankan sebagai audit |

Galat: `400` payload/sumber tidak valid atau konektor nonaktif, `404` tidak dimiliki, `409` migrasi sedang diproses atau fase sudah dijalankan. `mcp_migration_rows` dari migrasi `0011` adalah sumber jurnal rollback; baris run lama tanpa jurnal tidak dihapus.

### Webhook masuk

`POST /api/mcp/webhook/:id` menerima `{ entity, rows: [...] }`; `data` juga diterima untuk kompatibilitas. Header `X-MCP-Signature: sha256=<hex>` atau `X-Hub-Signature-256` berisi HMAC-SHA256 atas body mentah dengan `secret` konektor.

Respons `{ received, written, failed }`. Gunakan upsert dengan ID stabil untuk kiriman berulang. Galat: `401` tanda tangan salah, `403` konektor nonaktif atau pemilik tidak lagi berhak/disuspensi, `404` bukan konektor webhook, `400` payload/pemetaan tidak didukung atau >500 baris, `413` body >256 KiB. Payload berlebih ditolak tanpa menulis sebagian.

### Keamanan dan rollout

Terapkan seluruh migrasi, termasuk `0009`, `0010`, dan `0011`, sebelum deploy kode. Setel `MCP_ENCRYPTION_KEY` sebagai Worker secret (minimal 16 karakter; gunakan nilai acak kuat). Tanpa kunci, simpan kredensial ditolak `503`; file tetap dapat dipakai. Rahasia disimpan AES-GCM dan tidak dikembalikan API. Kredensial lama berformat plaintext harus disimpan ulang. Kunci salah/berubah menghasilkan `503` hingga kredensial dipulihkan.

Lock per migrasi dilepas pada penyelesaian atau error yang tertangkap. Setelah penghentian paksa, operator harus memastikan tidak ada request aktif sebelum mereset `mcp_migrations.locked = 0`. Baris yang telah ditulis tetap tercatat di jurnal untuk pemeriksaan/rollback.

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

- `/api/db`: `MAX_LIMIT = 5000` baris per permintaan; kuota per pemilik 500 item katalog VAS dan 2.000 temuan tanpa limbah.
- `/api/mcp/*`: lihat tabel batas di §MCP. Impor/sinkronisasi 500 baris per permintaan, batch tulis 100.
- Rate limit API: belum ada selain pembatasan OTP per email. Ini termasuk `/api/llm/*` dan `/api/mcp/*/sync` — keduanya yang paling mahal. Penambahan rate limit ada di [08_ROADMAP.md](08_ROADMAP.md).
- Kuota Workers AI dan batas D1: mengikuti paket Cloudflare, _TBD_ ([10_RISK_REGISTER.md](10_RISK_REGISTER.md)). Analisis kapan batas itu menggigit ada di [06_SCALABLE_ARCHITECTURE.md](06_SCALABLE_ARCHITECTURE.md) §1.1.
