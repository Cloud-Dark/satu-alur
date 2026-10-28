# Dokumentasi Satu Alur

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Indeks dokumentasi. Per 2026-10-28 aplikasi berjalan di Cloudflare (Worker + D1 + Workers AI). Ringkasan proyek: [../README.md](../README.md).

## Mulai Cepat

- Menjalankan lokal: [17_DEVELOPER_SETUP.md](17_DEVELOPER_SETUP.md)
- Deploy ke Cloudflare: [18_INSTALLATION.md](18_INSTALLATION.md)
- Kontrak API: [API.md](API.md)

## Produk dan Perencanaan

| Dokumen | Isi |
|---------|-----|
| [00_PROJECT_CHARTER.md](00_PROJECT_CHARTER.md) | Piagam proyek, tujuan, ruang lingkup |
| [01_PRD.md](01_PRD.md) | Kebutuhan produk |
| [03_FRD.md](03_FRD.md) | Kebutuhan fungsional dan kriteria penerimaan (FR-xxx) |
| [04_TRD.md](04_TRD.md) | Kebutuhan teknis (TR-xxx) |
| [07_MASTER_CHECKLIST.md](07_MASTER_CHECKLIST.md) | Checklist per fase |
| [08_ROADMAP.md](08_ROADMAP.md) | Peta jalan |
| [10_RISK_REGISTER.md](10_RISK_REGISTER.md) | Register risiko |
| [11_DECISIONS.md](11_DECISIONS.md) | Catatan keputusan arsitektur (ADR) |
| [13_GLOSSARY.md](13_GLOSSARY.md) | Glosarium |

## Teknis

| Dokumen | Isi |
|---------|-----|
| [05_ARCHITECTURE.md](05_ARCHITECTURE.md) | Arsitektur, diagram sistem/alur/OTP |
| [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md) | `wrangler.toml`, variabel, skrip |
| [17_DEVELOPER_SETUP.md](17_DEVELOPER_SETUP.md) | Setup pengembangan lokal |
| [18_INSTALLATION.md](18_INSTALLATION.md) | Instalasi dan deploy Cloudflare |
| [20_DATABASE.md](20_DATABASE.md) | Skema D1 |
| [21_BACKEND.md](21_BACKEND.md) | Worker: rute, auth, `/api/db`, keamanan |
| [API.md](API.md) | Kontrak HTTP API |

## Rilis dan Pengujian

| Dokumen | Isi |
|---------|-----|
| [31_CHANGELOG.md](31_CHANGELOG.md) | Riwayat perubahan |
| [uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md) | UAT deploy Cloudflare (PENDING) |

## Standar

[standards/00_STANDARD_INDEX.md](standards/00_STANDARD_INDEX.md): [Kontribusi](standards/01_CONTRIBUTION_STANDARD.md), [Kode](standards/02_CODE_STANDARD.md), [Pengujian](standards/05_TESTING_STANDARD.md), [Dokumentasi](standards/06_DOCUMENTATION_STANDARD.md).

## Dokumen Lama

| Dokumen | Status |
|---------|--------|
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Digantikan oleh [20_DATABASE.md](20_DATABASE.md) (desain PostgreSQL/WorkBuddy lama) |

Nomor dokumen yang dilewati belum dibuat.
