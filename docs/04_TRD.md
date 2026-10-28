# Technical Requirements Document (TRD)

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Kebutuhan teknis untuk versi Cloudflare. Kebutuhan fungsional di [03_FRD.md](03_FRD.md); desain di [05_ARCHITECTURE.md](05_ARCHITECTURE.md); alasan keputusan di [11_DECISIONS.md](11_DECISIONS.md).

## Platform dan Deployment

| ID | Kebutuhan |
|----|-----------|
| TR-001 | Aplikasi dideploy sebagai satu Cloudflare Worker (`worker/index.js`) yang melayani aset statis hasil `vite build` (`dist/`) lewat binding `ASSETS` dan rute `/api/*`. |
| TR-002 | Konfigurasi deployment berada di `wrangler.toml` (binding D1, AI, ASSETS, variabel). Lihat [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md). |
| TR-003 | Skrip npm: `deploy`, `cf:dev`, `db:migrate:local`, `db:migrate:remote` (selain `dev`, `build`, `preview`). |
| TR-004 | Frontend tetap Vite + Vanilla JavaScript (ES Modules), tanpa framework tambahan. |
| TR-005 | Node.js 18+ untuk pengembangan (disarankan 22+, sesuai README). |

## Database (D1)

| ID | Kebutuhan |
|----|-----------|
| TR-010 | Database D1 bernama `satu-alur-db` dengan tabel `users`, `sessions`, `otp_codes`, `requests`, `offers`, `assignments`, `completions`, `ledger_entries`, `reports`. Skema di [20_DATABASE.md](20_DATABASE.md) (berkas `migrations/0001_init.sql`). |
| TR-011 | Skema dikelola lewat berkas migrasi di `migrations/` dan diterapkan dengan `db:migrate:local` / `db:migrate:remote`. |
| TR-012 | Seluruh tabel domain memiliki kolom `owner_id` yang merujuk ke pengguna. |
| TR-013 | Tipe PostgreSQL pada desain lama (`JSONB`, `TIMESTAMPTZ`, `TEXT[]`, `GENERATED ALWAYS AS IDENTITY`) dipetakan ke tipe SQLite; pemetaan: `JSONB`/`TEXT[]` menjadi `TEXT` berisi JSON, `TIMESTAMPTZ`/`DATE` menjadi `TEXT` ISO 8601, identitas menjadi `INTEGER PRIMARY KEY AUTOINCREMENT`. Lihat 20_DATABASE.md. |

## Autentikasi dan Keamanan

| ID | Kebutuhan |
|----|-----------|
| TR-020 | Autentikasi email OTP lewat `POST /api/auth/send-otp` dan `POST /api/auth/verify-otp`. |
| TR-021 | Sesi memakai bearer token; Worker hanya menyimpan hash token di tabel `sessions` (bukan token mentah). Hash SHA-256 (hex) dihitung di Worker dengan Web Crypto. |
| TR-022 | Kode OTP 6 digit disimpan sebagai hash (`code_hash`, SHA-256 dari `verificationId:kode`) di `otp_codes`. Masa berlaku 10 menit, maksimal 5 percobaan verifikasi per kode, maksimal 5 permintaan kode per email per 10 menit, sekali pakai. Masa berlaku sesi 30 hari. |
| TR-023 | Mode demo: bila variabel `DEMO_OTP` bernilai string `"true"`, kode OTP dikembalikan pada field `demoCode` di respons `send-otp`. Bila bukan `true`, kode tidak boleh dikembalikan. Mode demo wajib dimatikan di produksi setelah provider email dipasang. |
| TR-024 | Karena D1 tidak memiliki Row Level Security, Worker wajib menambahkan `owner_id = <pengguna sesi>` pada setiap query `/api/db` dan menyuntikkan `owner_id` pada insert. Nilai `owner_id` dari klien tidak dipercaya. |
| TR-025 | `/api/db` hanya menerima tabel dan kolom pada daftar putih (whitelist). Nama tabel/kolom tidak boleh disisipkan langsung ke SQL tanpa validasi; nilai selalu lewat parameter terikat (bind). |
| TR-026 | Seluruh rute `/api/*` kecuali `send-otp` dan `verify-otp` memerlukan bearer token valid; selain itu respons 401. |
| TR-027 | Rahasia tidak boleh masuk repositori atau bundel klien. Saat ini tidak ada rahasia; kunci provider email di masa depan (`env.EMAIL_API_KEY`, lihat TODO di Worker) memakai `wrangler secret`. |

## AI (Workers AI)

| ID | Kebutuhan |
|----|-----------|
| TR-030 | LLM dipanggil lewat binding Workers AI dari Worker; klien tidak memegang kunci apa pun. |
| TR-031 | `POST /api/llm/chat` mengembalikan SSE dengan chunk bergaya OpenAI (`choices[0].delta.content`) agar `src/ai/agent.js` tetap kompatibel. |
| TR-032 | `GET /api/llm/models` mengembalikan daftar model yang diizinkan (daftar tetap di `worker/index.js`: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` dan `@cf/meta/llama-3.1-8b-instruct-fast`). Klien memakai model pertama dalam daftar sebagai bawaan (`pickDefaultModel`). Rute ini memerlukan autentikasi. |
| TR-033 | Pembatalan di klien (`AbortController`) harus menghentikan stream; Worker menghentikan pembacaan saat koneksi ditutup. |
| TR-034 | Penawaran meminta keluaran JSON (`response_format`); klien tetap memvalidasi dengan `validateOffer` dan menangani JSON tidak valid. |

## Klien

| ID | Kebutuhan |
|----|-----------|
| TR-040 | Klien memakai lapisan `getCloud()` (`src/cloud.js`) dengan antarmuka yang sama untuk mode Worker dan mode mock; stage tidak mengetahui perbedaannya. |
| TR-041 | Mode mock aktif dengan `VITE_USE_MOCK=true`, atau pada mode dev dengan `localStorage.satualur_use_mock = '1'`; hanya untuk pengembangan lokal. Build produksi tanpa `VITE_USE_MOCK=true` selalu memakai API. |
| TR-042 | Token sesi disimpan di `localStorage` (kunci `satualur_token`) dan dikirim sebagai header `Authorization: Bearer`. |

## Non-fungsional

| ID | Kebutuhan |
|----|-----------|
| TR-050 | Semua lalu lintas melalui HTTPS (disediakan Cloudflare). |
| TR-051 | Respons API berbentuk JSON dengan struktur error yang konsisten ([API.md](API.md)). |
| TR-052 | Batas Worker: body auth/db 256 KB, body chat 512 KB, insert maks 100 baris, filter maks 20, `in` maks 100 nilai, `limit` maks 1000, `max_tokens` dibatasi 4096, chat maks 50 pesan dan 100.000 karakter. Batas D1, kuota Workers AI, dan batas CPU Worker mengikuti paket akun; nilai `_TBD_` (lihat [10_RISK_REGISTER.md](10_RISK_REGISTER.md)). |
| TR-053 | Tidak ada uji otomatis saat ini (`npm test` hanya placeholder); target uji di [standards/05_TESTING_STANDARD.md](standards/05_TESTING_STANDARD.md). |
