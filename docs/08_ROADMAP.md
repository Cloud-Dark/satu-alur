# Roadmap

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Tanggal target `_TBD_` kecuali disebut. Urutan menunjukkan prioritas, bukan komitmen jadwal.

## Sekarang - Port Cloudflare (Oktober 2026)

- Worker tunggal + D1 + Workers AI menggantikan WorkBuddy Cloud SDK/PostgreSQL.
- Email OTP dengan mode demo.
- Deploy dan UAT pertama ([uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md)).

## Berikutnya

| Item | Alasan | Terkait |
|------|--------|---------|
| Provider email untuk OTP | Mematikan demo OTP di produksi | R-001, R-002 |
| Layar persetujuan/penolakan penawaran | Tanpa ini tahap Penugasan kosong pada data baru | R-009 |
| Rate limit pada `/api/auth/*` dan `/api/llm/*` | Mencegah penyalahgunaan dan kuota habis | R-003, R-004 |
| Simpan laporan ke `reports` | Skema sudah ada, UI belum memakainya | FR-016 |
| Uji otomatis dan CI | Saat ini `npm test` placeholder | [standards/05_TESTING_STANDARD.md](standards/05_TESTING_STANDARD.md) |

## Kemudian

- Konektor WhatsApp (WAPilot) dan email transaksional yang berfungsi.
- Unggah foto penyelesaian (penyimpanan objek, mis. R2) `_TBD_`.
- Ekspor laporan (PDF/CSV) `_TBD_`.
- Peran dan banyak pengguna per organisasi `_TBD_`.
- Observabilitas (log, metrik, alert) `_TBD_`.
