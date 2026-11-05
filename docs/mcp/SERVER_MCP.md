# Server MCP Satu Alur (Akses AI)

Satu Alur punya **server MCP (Model Context Protocol)** sendiri. Dengan server ini pemilik usaha bisa
menghubungkan Claude (claude.ai, Claude Desktop, atau Claude Code) ke akun Satu Alur-nya, lalu bertanya
langsung:

- "Pekerjaan PT Maju Jaya sudah sampai mana?"
- "Berapa laba bulan ini?"
- "Invoice mana yang belum lunas?"
- "Pekerjaan apa saja yang perlu dibukukan?"

Claude hanya bisa **membaca** data akun yang memiliki token. Tidak ada tool yang mengubah atau menghapus data.

> Jangan tertukar dengan konektor ERP di `docs/mcp/MCP_SPEC.md` / `worker/mcp.js` / `src/mcp/`. Itu fitur
> integrasi ERP yang kebetulan juga bernama "MCP". Server untuk Claude ada di `worker/mcp-server.js`.

## Endpoint

| URL | Kegunaan |
| --- | --- |
| `POST https://<domain>/mcp` | Endpoint MCP, token di header `Authorization: Bearer sa_mcp_…` |
| `POST https://<domain>/mcp/<token>` | Sama, token di URL (untuk connector kustom claude.ai yang hanya menerima URL) |
| `GET /mcp`, `DELETE /mcp` | 405 (tanpa stream SSE dan tanpa sesi) |
| `GET/POST /api/mcp-tokens`, `DELETE /api/mcp-tokens/:id` | Kelola token (sesi login biasa) |

Transport: MCP *Streamable HTTP* tanpa SSE dan tanpa sesi (stateless). Versi protokol 2025-06-18
(2025-03-26 dan 2024-11-05 juga diterima saat `initialize`). Pesan JSON-RPC 2.0 tunggal maupun batch;
notifikasi dijawab `202 Accepted`. Method: `initialize`, `notifications/initialized`, `ping`, `tools/list`,
`tools/call`.

## Membuat token

1. Masuk ke Satu Alur dengan akun usaha Anda.
2. Buka **Pengaturan › Akses AI (MCP)** (atau langsung `#/app/pengaturan?bagian=mcp`).
3. Isi nama token (misalnya "Claude di laptop kantor"), klik **Buat token**.
4. Token (`sa_mcp_…`) dan petunjuk sambungan **hanya ditampilkan sekali**. Salin sekarang.

Satu token untuk tiap perangkat/aplikasi supaya bisa dicabut sendiri-sendiri. Maksimal 10 token aktif per akun.

## Menghubungkan

### claude.ai (connector kustom)

1. Buka claude.ai → **Settings → Connectors**.
2. Klik **Add custom connector**, beri nama "Satu Alur".
3. Tempel URL `https://<domain>/mcp/<token>` lalu **Add**.

### Claude Code

```bash
claude mcp add --transport http satu-alur https://<domain>/mcp --header "Authorization: Bearer <token>"
```

### Claude Desktop

Tambahkan ke `claude_desktop_config.json` (Settings → Developer → Edit Config), lalu buka ulang Claude Desktop
(perlu Node.js untuk `npx`):

```json
{
  "mcpServers": {
    "satu-alur": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<domain>/mcp/<token>"]
    }
  }
}
```

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

- **Token = kunci baca seluruh data usaha.** Simpan seperti kata sandi. Cabut di Pengaturan › Akses AI (MCP)
  bila bocor atau tidak dipakai lagi; token yang dicabut langsung ditolak (401).
- Server hanya menyimpan **hash SHA-256** token (`mcp_tokens.token_hash`, migrasi `0022_mcp_tokens.sql`) dan
  awalan untuk tampilan. Token asli tidak bisa dilihat lagi setelah dibuat.
- Bentuk URL (`/mcp/<token>`) memasukkan token ke URL, sehingga bisa tercatat di log/riwayat. Untuk Claude Code
  pakai bentuk header bila memungkinkan.
- Setiap query dibatasi `owner_id` pemilik token; data akun lain tidak pernah ikut.
- Pengguna yang ditangguhkan ditolak (403). **Akun demo tidak bisa membuat atau memakai token** (akun demo
  dipakai bersama, jadi token di sana bisa dilihat/dicabut orang lain).
- Batas permintaan per token: 60/menit dan 1.000/jam (best effort, per isolate + Cache API). Lewat batas → 429.
- Header `Origin` (kalau ada) harus dari domain Satu Alur sendiri, claude.ai/claude.com/anthropic.com, atau
  localhost (MCP Inspector). Klien server-ke-server tanpa `Origin` diterima.
- `last_used_at` diperbarui paling sering tiap 5 menit agar hemat kuota tulis D1.

## Deploy

1. Terapkan migrasi baru: `npm run db:migrate:remote` (menambah tabel `mcp_tokens`).
2. `wrangler.toml` dan `wrangler.deploy.toml` sudah memuat `run_worker_first = ["/api/*", "/mcp", "/mcp/*"]`
   supaya `/mcp` dijalankan Worker, bukan dilayani sebagai halaman SPA.
3. Deploy seperti biasa.
