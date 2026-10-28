# Backend (Cloudflare Worker)

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Dokumentasi implementasi `worker/index.js`. Kontrak permintaan/respons ada di [API.md](API.md); skema di [20_DATABASE.md](20_DATABASE.md); alasan desain di [11_DECISIONS.md](11_DECISIONS.md).

## Rute

Rute `/api/*` dijalankan Worker lebih dulu (`run_worker_first`). Selain itu dilayani `ASSETS` dengan fallback SPA.

| Rute | Auth | Fungsi |
|------|------|--------|
| `POST /api/auth/send-otp` | Tidak | Buat OTP |
| `POST /api/auth/verify-otp` | Tidak | Verifikasi OTP, buat sesi |
| `GET /api/auth/session` | Ya | Info pengguna sesi |
| `POST /api/auth/signout` | Ya | Hapus sesi |
| `POST /api/db` | Ya | Query generik D1 |
| `GET /api/llm/models` | Ya | Daftar model |
| `POST /api/llm/chat` | Ya | Chat streaming (SSE) |

Path yang dikenal dengan method salah: 405. Path tidak dikenal: 404. Trailing slash diabaikan.

## Format Respons

JSON `{ data, error, count? }`; `error` berbentuk `{ message }` (pesan berbahasa Indonesia). Header `cache-control: no-store` dan `x-content-type-options: nosniff`. Error tak terduga: 500 "Terjadi kesalahan pada server." (detail hanya di log).

## Autentikasi

1. `send-otp`: validasi email, bersihkan OTP dan sesi kedaluwarsa, batasi 5 kode per email per 10 menit (429), buat kode 6 digit acak, simpan `code_hash = SHA-256(id:kode)`, kembalikan `verificationId`, `isExistingUser`. Bila `env.DEMO_OTP === "true"`, ikut `demoCode`. Pengiriman email: belum ada (TODO provider di kode).
2. `verify-otp`: periksa `verificationId`, email, kedaluwarsa, dan batas 5 percobaan. Percobaan dihitung sebelum pembandingan (atomik), pembandingan waktu-konstan, kode dihapus setelah berhasil. Membuat pengguna bila belum ada, lalu membuat token acak 32 byte (hex). D1 menyimpan SHA-256 token; token mentah hanya dikembalikan sekali sebagai `access_token`.
3. Rute terproteksi membaca `Authorization: Bearer <token>`, menghitung hash, dan mencari sesi yang belum kedaluwarsa. Gagal: 401.
4. `signout` menghapus baris sesi.

Konstanta: OTP 10 menit, 5 percobaan, 5 pengiriman per jendela; sesi 30 hari.

## Endpoint `/api/db`

Body JSON: `table`, `action` (`select|insert|update|delete`), serta field per aksi.

### Tabel dan kolom (whitelist)

Tabel: `requests`, `offers`, `assignments`, `completions`, `ledger_entries`, `reports`. Kolom per tabel sama dengan [20_DATABASE.md](20_DATABASE.md). Kolom JSON (`offers.ai_proposal_json`, `completions.photos_path`, `reports.summary_json`) di-serialize saat tulis dan di-parse saat baca; kolom ini tidak dapat dipakai pada filter atau order. Tabel/kolom di luar daftar: 400.

### Semantik

| Field | Berlaku untuk | Arti |
|-------|---------------|------|
| `columns` | select | `"*"` atau daftar kolom dipisah koma (divalidasi) |
| `filters` | select, update, delete | Array `{op, col, val}`; maks 20. `op`: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `match` |
| `order` | select | `{col, asc}`; `asc:false` = menurun; ditambah urutan `id` sebagai pemecah seri |
| `limit` | select | Bilangan bulat >= 0; 0 dianggap tanpa batas; batas atas 1000 (juga bawaan bila tidak diberi) |
| `range` | select | `[dari, sampai]` inklusif berbasis 0; diterapkan sebelum `limit` |
| `single` | select | Harus tepat 1 baris, jika tidak respons 200 dengan `error.message` "Tidak ditemukan." |
| `maybeSingle` | select | Satu baris atau `null` |
| `count` | select | Sertakan `count` total (sebelum `limit`) |
| `head` | select | Hanya `count`, tanpa baris |
| `values` | insert | Objek atau array objek; maks 100 baris |
| `changes` | update | Objek kolom baru |

Catatan perilaku:
- `eq`/`neq` dengan `val: null` menjadi `IS NULL`/`IS NOT NULL`. `in` dengan array kosong tidak cocok dengan apa pun. `match` = rangkaian `eq` dari objek.
- `like`/`ilike`: pola string maks 200 karakter; SQLite membandingkan ASCII tanpa membedakan huruf besar/kecil.
- `update` dan `delete` wajib punya minimal satu filter; hasilnya baris yang terdampak (`RETURNING *`).
- `insert` mengembalikan baris yang dibuat (`RETURNING *`) dan dijalankan sebagai satu batch D1.
- Operator `or` tidak didukung.

### Aturan keamanan

- `owner_id` selalu diambil dari sesi. Pada insert, `id` dan `owner_id` dari klien diabaikan; pada update, mengubah `id`/`owner_id` ditolak (400).
- Setiap query diawali `WHERE owner_id = <pengguna>`; filter klien hanya menambah `AND`.
- Kunci asing (`request_id`, `offer_id`, `assignment_id`, `completion_id`) harus menunjuk baris milik pengguna yang sama; kalau tidak 400 "Referensi ... tidak ditemukan." (mencegah penautan lintas pengguna).
- Nama tabel/kolom divalidasi terhadap whitelist sebelum masuk SQL; semua nilai memakai parameter terikat.
- Batas ukuran: nilai string 20.000 karakter (200.000 untuk hasil serialisasi), body 256 KB.
- Pelanggaran constraint database dipetakan ke 400 "Data tidak valid atau melanggar batasan."
- Tidak ada pembatasan aksi per tabel: pengguna dapat memperbarui/menghapus baris miliknya di semua tabel domain, termasuk `ledger_entries`. Tidak ada validasi status/transisi di sisi server (mis. `OfferTransitions` hanya di klien). Lihat catatan di bawah.

## LLM

- `GET /api/llm/models`: daftar tetap `@cf/meta/llama-3.3-70b-instruct-fp8-fast` dan `@cf/meta/llama-3.1-8b-instruct-fast`.
- `POST /api/llm/chat`: validasi `model` terhadap daftar, `messages` (maks 50 pesan, 100.000 karakter, role `system|user|assistant`), `temperature` 0-2, `max_tokens` (dibatasi 4096), `response_format`. Memanggil `env.AI.run(model, {messages, stream: true, ...})`.
- Mode JSON: bila `response_format.type === "json_object"`, Worker menyisipkan instruksi sistem "hanya JSON" (mode JSON Workers AI tidak mendukung streaming); klien tetap memvalidasi hasil.
- Keluaran diterjemahkan ke SSE gaya OpenAI: `data: {"choices":[{"delta":{"content":"..."}}]}`, chunk akhir dengan `finish_reason: "stop"`, lalu `data: [DONE]`.
- Kegagalan `AI.run`: 502 "Layanan AI tidak tersedia."
- Pembatalan oleh klien menutup koneksi; perilaku penghentian inferensi di sisi Workers AI _TBD_.

## Keamanan: Ringkasan dan Celah Diketahui

| Hal | Status |
|-----|--------|
| Isolasi per pengguna | Di kode Worker; tanpa RLS (R-006) |
| SQL injection | Whitelist + bind (R-007) |
| Token | Hash SHA-256 di D1; token mentah di `localStorage` klien (R-008) |
| OTP demo | `demoCode` di respons bila `DEMO_OTP="true"` (R-001) |
| Provider email | Belum ada (R-002) |
| Rate limit per IP | Belum ada; hanya per email untuk OTP (R-012) |
| Rate limit LLM | Belum ada (R-003) |
| Validasi status/transisi | Hanya di klien |
| CORS | Tidak dikonfigurasi; same-origin |
| Log | `console.error` untuk kesalahan tak terduga dan kegagalan AI; observabilitas lanjutan _TBD_ |

Daftar risiko lengkap: [10_RISK_REGISTER.md](10_RISK_REGISTER.md).

## Menambah Tabel atau Kolom

1. Tambah berkas migrasi baru di `migrations/`.
2. Tambah/ubah entri `TABLES` di `worker/index.js` (kolom, `json`, `fks`).
3. Perbarui [20_DATABASE.md](20_DATABASE.md), [API.md](API.md) bila perlu, dan mock di `src/mock/mock-cloud.js`.
4. Uji isolasi pengguna (UAT) untuk tabel baru.
