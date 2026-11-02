# Roadmap

> Status: Draft
> Terakhir diperbarui: 2026-11-02
> Pemilik: _TBD_

Tanggal target `_TBD_` kecuali disebut. Urutan menunjukkan prioritas, bukan komitmen jadwal.

Peta jalan jangka panjang (fase F0–F5, pemicu angka, bentuk tim, dan keputusan arsitektur yang menyertainya) ada di [06_SCALABLE_ARCHITECTURE.md](06_SCALABLE_ARCHITECTURE.md). Dokumen ini hanya memuat pekerjaan dekat.

## Sekarang - Port Cloudflare (Oktober 2026)

- Worker tunggal + D1 + Workers AI menggantikan WorkBuddy Cloud SDK/PostgreSQL.
- Email OTP dengan mode demo.
- Deploy dan UAT pertama ([uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md)).

## Selesai - 2 November 2026

- **MCP / Konektor ERP** dengan backend sungguhan: 6 tabel D1, 22 rute `/api/mcp/*`, kredensial terenkripsi AES-GCM, upsert idempoten lewat `mcp_external_refs`, dead-letter queue dengan replay, dan migrasi tiga fase yang bisa di-rollback. Lihat [mcp/MCP_SPEC.md](mcp/MCP_SPEC.md).

## Berikutnya

| Item | Alasan | Terkait |
|------|--------|---------|
| `MCP_ENCRYPTION_KEY` di produksi | Tanpa kunci, kredensial ERP tersimpan sebagai base64 yang bisa dibaca siapa pun yang memegang akses baca D1 | §6.2 arsitektur skala |
| Provider email untuk OTP | Mematikan demo OTP di produksi | R-001, R-002 |
| Layar persetujuan/penolakan penawaran | Tanpa ini tahap Penugasan kosong pada data baru | R-009 |
| Rate limit pada `/api/auth/*`, `/api/llm/*`, `/api/mcp/*/sync` | Mencegah penyalahgunaan dan kuota habis | R-003, R-004 |
| Simpan laporan ke `reports` | Skema sudah ada, UI belum memakainya | FR-016 |
| Sinkronisasi MCP terjadwal (Cron + Queue) | Sekarang sinkronisasi hanya manual; integrasi nyata butuh jadwal | Tahap 2 |
| `request_id` dan metrik durasi per rute | Tanpa pengukuran, tahap skala berikutnya dipicu tebakan | §3 tahap 0 |
| Uji otomatis dan CI | Saat ini `npm test` placeholder | [standards/05_TESTING_STANDARD.md](standards/05_TESTING_STANDARD.md) |

## Kemudian

- Ringkasan materialized untuk dasbor dan laporan (tahap 1).
- Antrean untuk migrasi dan sinkronisasi besar (tahap 2).
- Konektor WhatsApp (WAPilot) dan email transaksional yang berfungsi.
- Unggah foto penyelesaian (penyimpanan objek, mis. R2) `_TBD_`.
- Ekspor laporan (PDF/CSV) `_TBD_`.
- Organisasi, peran, dan banyak pengguna per usaha (ADR-013) `_TBD_`.
- Observabilitas (log terstruktur, metrik, alert lima sinyal) `_TBD_`.
