# Glosarium

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

| Istilah | Arti |
|---------|------|
| Satu Alur | Nama aplikasi; satu alur dari permintaan sampai laporan |
| Permintaan (Request) | Kebutuhan jasa dari pelanggan; tahap 1 |
| Penawaran (Offer) | Proposal scope, harga, ketentuan untuk satu permintaan; tahap 2 |
| Penugasan (Assignment) | Penetapan pekerja dan jadwal untuk penawaran yang disetujui; tahap 3 |
| Penyelesaian (Completion) | Catatan hasil pekerjaan; tahap 4 |
| Pembukuan / Jurnal (Ledger entry) | Catatan pendapatan atau biaya per penyelesaian; tahap 5 |
| Laporan (Report) | Ringkasan keuangan periode dan penjelasan AI; tahap 6 |
| `owner_id` | Kolom pemilik data; seluruh baris domain dibatasi ke pengguna ini |
| OTP | One-Time Password; kode sekali pakai yang dikirim ke email untuk login |
| Mode demo OTP | `DEMO_OTP=true`; kode OTP dikembalikan di respons API (hanya untuk uji) |
| Bearer token | Token sesi di header `Authorization: Bearer <token>` |
| Worker | Cloudflare Worker; kode server yang berjalan di edge (`worker/index.js`) |
| D1 | Basis data SQLite terkelola Cloudflare; database `satu-alur-db` |
| Workers AI | Layanan inferensi model AI Cloudflare, diakses lewat binding |
| ASSETS | Binding Worker untuk menyajikan berkas statis `dist/` |
| Binding | Sambungan antara Worker dan sumber daya Cloudflare (D1, AI, ASSETS) |
| SSE | Server-Sent Events; format streaming respons untuk `/api/llm/chat` |
| Whitelist | Daftar tabel/kolom/operator yang diizinkan pada `/api/db` |
| RLS | Row Level Security (PostgreSQL); tidak ada di D1, digantikan scoping di Worker |
| Mode mock | Backend palsu berbasis `localStorage` untuk pengembangan lokal (`VITE_USE_MOCK`) |
| MCP | Model Context Protocol; di aplikasi ini berupa konfigurasi konektor WhatsApp/Email di Pengaturan |
| WAPilot | Layanan integrasi WhatsApp yang dikonfigurasi di Pengaturan |
| Agent Skill | Prompt dan parameter AI yang dapat diubah pengguna di Pengaturan |
| AntiSlop | Mesin penegak design token dan kualitas konten UI (`src/ui/antislop.js`) |
| UAT | User Acceptance Test |
| ADR | Architecture Decision Record ([11_DECISIONS.md](11_DECISIONS.md)) |
| WorkBuddy | Platform cloud yang dipakai sebelum port ke Cloudflare (desain lama) |
