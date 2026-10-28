# Standar Kontribusi

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

## Alur Kerja

1. Fork atau buat branch dari branch utama: `feature/<nama>`, `fix/<nama>`, atau `docs/<nama>`.
2. Kerjakan perubahan kecil dan fokus; satu pull request satu tujuan.
3. Jalankan `npm run build` dan uji manual alur yang diubah (mode mock dan, bila menyentuh Worker/skema, `npm run cf:dev`).
4. Buat pull request dengan deskripsi: apa, mengapa, cara uji, dampak pada skema/API.

## Commit

- Pesan commit ringkas dan deskriptif, gaya yang sudah dipakai: `Add: ...`, `Fix: ...`, `Docs: ...`, `Refactor: ...`.
- Jangan mencampur perubahan skema, kode, dan dokumen yang tidak terkait dalam satu commit.
- Jangan commit rahasia, token, `.env`, `.wrangler/`, atau `database_id` milik pribadi bila repositori publik (keputusan penempatan `database_id`: _TBD_).

## Perubahan yang Menyentuh Kontrak

Perubahan pada tabel/kolom, rute `/api`, atau variabel konfigurasi wajib memperbarui dokumen terkait dalam PR yang sama:

| Perubahan | Dokumen |
|-----------|---------|
| Migrasi/tabel | [20_DATABASE.md](../20_DATABASE.md), whitelist di `worker/index.js`, mock |
| Rute/respons API | [API.md](../API.md), [21_BACKEND.md](../21_BACKEND.md) |
| Variabel/binding | [16_CONFIG_REFERENCE.md](../16_CONFIG_REFERENCE.md) |
| Fitur/perilaku | [03_FRD.md](../03_FRD.md), [31_CHANGELOG.md](../31_CHANGELOG.md) |
| Keputusan besar | [11_DECISIONS.md](../11_DECISIONS.md) |
| Risiko baru | [10_RISK_REGISTER.md](../10_RISK_REGISTER.md) |

## Review

- Minimal satu reviewer selain penulis (kebijakan persetujuan: _TBD_).
- Reviewer memeriksa: isolasi `owner_id`, input tervalidasi, tidak ada rahasia, dokumen diperbarui, tidak ada regresi di mode mock.
- Perubahan pada `worker/index.js` bagian auth atau `/api/db` memerlukan perhatian khusus (lihat [02_CODE_STANDARD.md](02_CODE_STANDARD.md)).

## Migrasi dan Deploy

- Migrasi bersifat maju saja; jangan mengedit berkas migrasi yang sudah diterapkan di remote, tambahkan berkas baru.
- Terapkan migrasi remote sebelum deploy kode yang membutuhkannya ([18_INSTALLATION.md](../18_INSTALLATION.md)).
