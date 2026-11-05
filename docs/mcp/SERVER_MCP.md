# Server MCP Satu Alur (Akses AI)

Satu Alur punya **server MCP (Model Context Protocol)** sendiri. Dengan server ini pemilik usaha bisa
menghubungkan Claude (claude.ai, Claude Desktop, atau Claude Code) ke akun Satu Alur-nya, lalu bertanya
langsung:

- "Pekerjaan PT Maju Jaya sudah sampai mana?"
- "Berapa laba bulan ini?"
- "Invoice mana yang belum lunas?"
- "Pekerjaan apa saja yang perlu dibukukan?"

Claude hanya bisa **membaca** data akun yang memberi izin. Tidak ada tool yang mengubah atau menghapus data.

> Jangan tertukar dengan konektor ERP di `docs/mcp/MCP_SPEC.md` / `worker/mcp.js` / `src/mcp/`. Itu fitur
> integrasi ERP yang kebetulan juga bernama "MCP". Server untuk Claude ada di `worker/mcp-server.js`, login
> OAuth-nya di `worker/oauth.js`.

## Menghubungkan dengan login (cara utama)

Tidak ada token yang perlu disalin. Cukup alamat server: **`https://<domain>/mcp`**
(produksi: `https://satu-alur.apipedia.workers.dev/mcp`).

### claude.ai dan Claude Desktop

1. Buka **Settings → Connectors**, klik **Add custom connector**.
2. Beri nama "Satu Alur", tempel `https://<domain>/mcp`, lalu **Add**.
3. Klik **Connect**. Claude membuka halaman masuk Satu Alur. Masuk seperti biasa (kode email / Google).
4. Halaman **"Izinkan Claude mengakses data usaha Anda (hanya baca)?"** muncul. Klik **Izinkan**.
5. Anda dikembalikan ke Claude dalam keadaan terhubung.

### Claude Code

```bash
claude mcp add --transport http satu-alur https://<domain>/mcp
```

Lalu di Claude Code ketik `/mcp`, pilih `satu-alur`, pilih **Authenticate**. Browser terbuka ke halaman
masuk Satu Alur; setelah **Izinkan**, Claude Code menerima tokennya sendiri.

### Memutuskan koneksi

**Pengaturan › Akses AI (MCP) › Aplikasi terhubung** menampilkan setiap aplikasi yang sudah diizinkan
(nama, sejak kapan, terakhir dipakai). **Putuskan** langsung mematikan semua token aplikasi itu.

## Cara lain: token manual (lanjutan)

Untuk klien yang belum mendukung login OAuth. Di Pengaturan › Akses AI (MCP), buka
**Cara lain: token manual (lanjutan)**, isi nama token, klik **Buat token**. Token (`sa_mcp_…`) dan petunjuk
sambungan **hanya ditampilkan sekali**. Maksimal 10 token manual aktif per akun.

- claude.ai: URL connector `https://<domain>/mcp/<token>`.
- Claude Code: `claude mcp add --transport http satu-alur https://<domain>/mcp --header "Authorization: Bearer <token>"`.
- Claude Desktop lewat `mcp-remote`:

```json
{
  "mcpServers": {
    "satu-alur": { "command": "npx", "args": ["-y", "mcp-remote", "https://<domain>/mcp/<token>"] }
  }
}
```

## Endpoint

| URL | Kegunaan |
| --- | --- |
| `POST /mcp` | Endpoint MCP. `Authorization: Bearer <token akses OAuth sa_oat_… atau token manual sa_mcp_…>` |
| `POST /mcp/<token>` | Sama, token **manual** di URL (token OAuth tidak pernah diterima di URL) |
| `GET /mcp`, `DELETE /mcp` | 405 (tanpa stream SSE dan tanpa sesi) |
| `GET /.well-known/oauth-protected-resource` (juga `…/mcp`) | RFC 9728: resource `<origin>/mcp`, authorization server `<origin>` |
| `GET /.well-known/oauth-authorization-server` (juga `…/mcp`, `/.well-known/openid-configuration`) | RFC 8414 metadata |
| `POST /oauth/register` | RFC 7591 pendaftaran klien dinamis |
| `GET /oauth/authorize` | Mulai login: validasi klien + PKCE, lalu 302 ke halaman izin `/#/izin-ai?req=…` |
| `POST /oauth/token` | `authorization_code` (+ PKCE S256) dan `refresh_token` |
| `POST /oauth/revoke` | RFC 7009 |
| `GET /api/oauth/request?req=`, `POST /api/oauth/decision` | Halaman izin (sesi login biasa) |
| `GET /api/oauth/grants`, `DELETE /api/oauth/grants/:id` | Aplikasi terhubung / Putuskan (sesi login biasa) |
| `GET/POST /api/mcp-tokens`, `DELETE /api/mcp-tokens/:id` | Token manual (sesi login biasa) |

Transport: MCP *Streamable HTTP* tanpa SSE dan tanpa sesi (stateless). Versi protokol 2025-06-18
(2025-03-26 dan 2024-11-05 juga diterima saat `initialize`). Pesan JSON-RPC 2.0 tunggal maupun batch;
notifikasi dijawab `202 Accepted`. Method: `initialize`, `notifications/initialized`, `ping`, `tools/list`,
`tools/call`.

## Alur OAuth (spesifikasi otorisasi MCP 2025-06-18)

Worker berperan sebagai *authorization server* sekaligus *resource server*.

1. Klien memanggil `/mcp` tanpa token → `401` dengan
   `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`
   (ditambah `error="invalid_token"` bila token dikirim tetapi salah / kedaluwarsa / dicabut).
2. Klien membaca metadata resource lalu metadata authorization server.
3. Klien mendaftar di `POST /oauth/register` (`redirect_uris` wajib `https://`, atau `http://localhost` /
   `http://127.0.0.1` untuk aplikasi desktop/CLI; tanpa fragmen). Klien publik (`token_endpoint_auth_method:
   none`) tidak mendapat secret; `client_secret_post` / `client_secret_basic` juga didukung. Dibatasi
   20 pendaftaran/jam per IP dan 500/jam total.
4. `GET /oauth/authorize?response_type=code&client_id&redirect_uri&code_challenge&code_challenge_method=S256&state&scope&resource`.
   `client_id` tidak dikenal atau `redirect_uri` tidak cocok persis (port bebas untuk loopback, RFC 8252)
   → halaman galat, **tanpa** redirect. Galat lain dikembalikan ke `redirect_uri` dengan `error` dan `state`.
   Parameter disimpan di server (`oauth_requests`, 10 menit) lalu 302 ke `/#/izin-ai?req=<id acak>`.
   SPA tidak pernah dipercaya untuk parameter apa pun.
5. Halaman `#/izin-ai`: belum masuk → halaman masuk biasa (`#/masuk`) lalu kembali otomatis. Sudah masuk →
   kartu izin: nama klien, host tujuan, enam tool hanya-baca, email/nama usaha, tombol **Izinkan / Tolak**.
   Sesi staf, akun demo bersama, dan pengguna yang ditangguhkan tidak bisa mengizinkan (pesan jelas; Tolak
   tetap bisa).
6. `POST /api/oauth/decision {req, approve}` → `{ redirect }`: `redirect_uri?code=…&state=…` (kode sekali
   pakai, 5 menit) atau `redirect_uri?error=access_denied&state=…`. SPA mengarahkan browser ke sana.
7. `POST /oauth/token` (form-urlencoded atau JSON):
   - `grant_type=authorization_code`: kode belum dipakai & belum kedaluwarsa, `client_id` sama,
     `redirect_uri` sama (bila dikirim), `code_verifier` cocok (S256). Kode yang dipakai dua kali →
     ditolak dan seluruh koneksi dicabut.
   - Jawaban: `{ access_token: "sa_oat_…", token_type: "Bearer", expires_in: 3600, refresh_token: "sa_ort_…", scope: "satu-alur.read" }`.
   - `grant_type=refresh_token`: refresh token **dirotasi** setiap kali (berlaku 60 hari). Refresh token
     lama yang muncul lagi = bocor → seluruh koneksi (keluarga token) dicabut.
8. `/mcp` menerima token akses OAuth (cek kedaluwarsa dan koneksi belum diputus) dan token manual.

## Tabel (migrasi `0023_oauth.sql`)

| Tabel | Isi |
| --- | --- |
| `oauth_clients` | Klien terdaftar: `client_id`, nama, `redirect_uris` (JSON), metode auth, hash secret (opsional) |
| `oauth_requests` | Permintaan izin yang menunggu (hash id, PKCE challenge, redirect, state), 10 menit |
| `oauth_grants` | Satu baris per izin = "aplikasi terhubung" (pemilik, klien, sejak, terakhir dipakai, dicabut) |
| `oauth_codes` | Kode otorisasi (hash), sekali pakai, 5 menit |
| `oauth_refresh_tokens` | Refresh token (hash), `used_at` untuk deteksi pemakaian ulang |
| `mcp_tokens` (+ kolom `kind`, `grant_id`, `expires_at`) | Token akses OAuth (`kind='oauth'`, 1 jam) di samping token manual (`kind='manual'`) |

Semua kode, id permintaan, dan token disimpan sebagai **hash SHA-256** saja. Tidak satu pun tabel ini ada di
whitelist `/api/db`.

## Tool

Semua tool hanya baca (`readOnlyHint: true`), hanya melihat data akun pemilik token, dan menjawab berupa teks
(dengan Rupiah) plus `structuredContent`. Daftar dibatasi 20 baris secara bawaan, maksimal 100.

| Tool | Argumen | Isi jawaban |
| --- | --- | --- |
| `cari_pekerjaan` | `q?`, `posisi?` (`request`, `offer`, `assign`, `work`, `book`, `done`), `limit?` | Pekerjaan (satu per permintaan) dengan tahap, status, langkah berikutnya, petugas, harga; jumlah per posisi |
| `progres_pelanggan` | `nama` | Pencocokan nama pelanggan (toleran salah ketik, tanpa PT/CV) dan setiap pekerjaannya, termasuk tanggal |
| `detail_pekerjaan` | `id` | Linimasa 5 tahap, lingkup/harga/syarat penawaran, penugasan & progres, catatan penyelesaian, pembukuan, invoice + item |
| `ringkasan_keuangan` | `periode?` (`bulan_ini` bawaan, `bulan_lalu`, `tahun_ini`, `semua`) | Pendapatan, biaya, laba, rincian biaya, pekerjaan belum dibukukan, invoice belum lunas / lewat jatuh tempo |
| `daftar_invoice` | `status?` (`draft`, `terkirim`, `lunas`, `batal`), `limit?` | Nomor, pelanggan, total, jatuh tempo, status; ringkasan per status |
| `info_akun` | — | Nama usaha, skala akun/paket, jumlah data |

Periode dan tanggal memakai kalender WIB. Logika posisi dan langkah berikutnya sama persis dengan halaman
Alur kerja (`src/domain/workflow.js`, `src/domain/model.js`), pencocokan nama sama dengan Waguri
(`src/waguri/answers.js`).

Kesalahan argumen dijawab sebagai hasil tool dengan `isError: true`; kesalahan protokol (method tidak dikenal,
JSON rusak, tool tidak dikenal) sebagai error JSON-RPC.

## Keamanan

- **Izin = akses baca seluruh data usaha.** Putuskan aplikasi yang tidak dipakai lagi di Pengaturan › Akses AI
  (MCP); token akses dan refresh-nya langsung ditolak (401).
- PKCE S256 wajib; `plain` ditolak. Kode otorisasi sekali pakai (5 menit), token akses 1 jam, refresh token
  dirotasi dengan deteksi pemakaian ulang.
- `redirect_uri` harus cocok persis dengan yang didaftarkan (loopback: port boleh beda). Galat sebelum
  `redirect_uri` tervalidasi tidak pernah me-redirect.
- Token manual = kunci baca. Simpan seperti kata sandi; cabut bila bocor. Bentuk URL (`/mcp/<token>`)
  memasukkan token ke URL (bisa tercatat di log/riwayat), jadi lebih baik pakai login.
- Server hanya menyimpan **hash SHA-256**; token asli tidak bisa dilihat lagi.
- Setiap query dibatasi `owner_id` pemilik token; data akun lain tidak pernah ikut.
- Pengguna yang ditangguhkan ditolak (403 di `/mcp`, `invalid_grant` saat refresh). **Akun demo dan sesi staf
  tidak bisa memberi izin atau membuat token** (akun demo dipakai bersama).
- Batas permintaan `/mcp` per token: 60/menit dan 1.000/jam; `/oauth/token` 60/menit per IP;
  `/oauth/authorize` 120/jam per IP (best effort, per isolate + Cache API).
- Header `Origin` di `/mcp` (kalau ada) harus dari domain Satu Alur sendiri, claude.ai/claude.com/anthropic.com,
  atau localhost (MCP Inspector). Endpoint `/oauth/*` dan `/.well-known/*` mengirim CORS `*` (tanpa cookie).
- `last_used_at` diperbarui paling sering tiap 5 menit agar hemat kuota tulis D1.

## Deploy

1. Terapkan migrasi baru: `npm run db:migrate:remote` (menambah `0023_oauth.sql`: tabel `oauth_*` dan kolom
   `kind`, `grant_id`, `expires_at` di `mcp_tokens`).
2. `wrangler.toml` dan `wrangler.deploy.toml` memuat
   `run_worker_first = ["/api/*", "/mcp", "/mcp/*", "/oauth/*", "/.well-known/*"]` supaya endpoint ini
   dijalankan Worker, bukan dilayani sebagai halaman SPA. Path `/.well-known/*` lain tetap diteruskan ke aset.
3. Build dan deploy seperti biasa: `npx vite build && npx wrangler deploy --config wrangler.deploy.toml`.
4. Uji: `curl https://<domain>/.well-known/oauth-authorization-server` dan `curl -i -X POST https://<domain>/mcp`
   (harus `401` dengan `WWW-Authenticate: Bearer resource_metadata=…`).
