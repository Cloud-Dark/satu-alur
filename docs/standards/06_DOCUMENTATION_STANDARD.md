# Standar Dokumentasi

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

## Format

- Bahasa Indonesia, nada profesional dan ringkas; istilah teknis baku boleh Inggris.
- Berkas Markdown di `docs/`. Nama bernomor `NN_NAMA.md` (huruf besar, garis bawah) untuk dokumen proyek; standar di `docs/standards/`; hasil uji di `docs/uat/`.
- Judul `# Judul`, lalu blok kutipan:

```
> Status: Draft|Review|Final
> Terakhir diperbarui: YYYY-MM-DD
> Pemilik: _TBD_
```

- Tanpa emoji. Tabel untuk daftar atribut, diagram dengan Mermaid.
- Tautan antardokumen memakai path relatif.

## Kebenaran Isi

- Dokumentasikan hanya yang dapat diverifikasi dari kode atau keputusan tertulis.
- Hal yang belum diketahui ditandai `_TBD_`; jangan mengarang nilai.
- Kutip berkas sumber (mis. `worker/index.js`) bila menjelaskan perilaku.
- Perubahan kode yang mengubah kontrak harus memperbarui dokumen terkait di PR yang sama ([01_CONTRIBUTION_STANDARD.md](01_CONTRIBUTION_STANDARD.md)).

## Status

| Status | Arti |
|--------|------|
| Draft | Ditulis, belum ditinjau |
| Review | Menunggu/sedang ditinjau |
| Final | Disetujui pemilik; perubahan lewat PR dan memperbarui tanggal |

Pemilik diisi nama/peran, bukan `_TBD_`, saat dokumen naik ke Review.

## Changelog dan ADR

- [31_CHANGELOG.md](../31_CHANGELOG.md): format Keep a Changelog; setiap perubahan yang terlihat pengguna atau operator dicatat di `Unreleased`.
- [11_DECISIONS.md](../11_DECISIONS.md): satu ADR per keputusan arsitektur (Konteks, Keputusan, Konsekuensi); ADR lama tidak dihapus, tandai digantikan.

## Dokumen Lama

Dokumen yang digantikan tidak dihapus; tambahkan catatan "Superseded by <dokumen>" di bagian atas (contoh: [DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md)).

## Indeks

Setiap dokumen baru ditautkan dari [docs/README.md](../README.md).
