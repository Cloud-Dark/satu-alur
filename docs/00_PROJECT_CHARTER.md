# Piagam Proyek Satu Alur

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

## 1. Ringkasan

Satu Alur adalah aplikasi web untuk mengotomasi operasi perusahaan jasa/on-demand di Indonesia dalam satu alur: Permintaan, Penawaran, Penugasan, Penyelesaian, Pembukuan, dan Laporan. Tahap Penawaran dan Laporan dibantu AI.

Per 2026-10-28 aplikasi dipindahkan dari WorkBuddy Cloud SDK/PostgreSQL ke Cloudflare (Worker tunggal, D1, Workers AI). Rinciannya ada di [11_DECISIONS.md](11_DECISIONS.md) dan [05_ARCHITECTURE.md](05_ARCHITECTURE.md).

## 2. Tujuan

1. Menyediakan alur kerja jasa end-to-end yang dapat dijalankan oleh pelaku usaha jasa kecil-menengah.
2. Memakai AI untuk menyusun penawaran dan menjelaskan laporan keuangan, dengan validasi aturan domain sebelum data disimpan.
3. Dapat dideploy sebagai satu unit di Cloudflare tanpa server yang dikelola sendiri.
4. Tetap dapat dijalankan penuh secara lokal tanpa backend (mode mock).

## 3. Ruang Lingkup

Dalam lingkup:

- Enam tahap alur jasa dan dashboard ringkasan.
- Autentikasi email OTP dan sesi bearer token.
- Pengaturan (konektor MCP, agent skill/prompt AI) di sisi klien.
- Backend Cloudflare: Worker, D1, Workers AI.
- Mode mock berbasis `localStorage` untuk pengembangan lokal.

Di luar lingkup (saat ini):

- Pengiriman email OTP sungguhan (belum ada provider email; lihat [10_RISK_REGISTER.md](10_RISK_REGISTER.md)).
- Integrasi WhatsApp (WAPilot) dan SMTP yang berfungsi; saat ini hanya konfigurasi di halaman Pengaturan.
- Unggah foto penyelesaian (kolom `photos_path` ada di skema lama; penyimpanan file `_TBD_`).
- Multi-pengguna dalam satu organisasi (setiap data dibatasi per `owner_id`).

## 4. Pemangku Kepentingan

| Peran | Nama | Catatan |
|-------|------|---------|
| Pemilik produk | _TBD_ | |
| Pengembang | _TBD_ | |
| Penguji/UAT | _TBD_ | Lihat [uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md) |
| Operator Cloudflare | _TBD_ | Pemegang akun dan `database_id` D1 |

## 5. Kriteria Keberhasilan

- Keenam tahap dapat dijalankan berurutan oleh satu pengguna di lingkungan Cloudflare yang sudah dideploy.
- Data pengguna A tidak terlihat oleh pengguna B (isolasi `owner_id`).
- UAT Cloudflare selesai tanpa temuan blocker.
- Dokumentasi pemasangan memungkinkan orang baru mendeploy dalam satu sesi kerja.

## 6. Asumsi dan Batasan

- Platform: Cloudflare Workers, D1, Workers AI. Batas dan kuota akun `_TBD_`.
- Bahasa antarmuka dan dokumentasi: Bahasa Indonesia.
- Mode demo OTP hanya untuk lingkungan uji; bukan untuk produksi.

## 7. Dokumen Terkait

[PRD](01_PRD.md) · [FRD](03_FRD.md) · [TRD](04_TRD.md) · [Arsitektur](05_ARCHITECTURE.md) · [Checklist](07_MASTER_CHECKLIST.md) · [Roadmap](08_ROADMAP.md) · [Indeks docs](README.md)
