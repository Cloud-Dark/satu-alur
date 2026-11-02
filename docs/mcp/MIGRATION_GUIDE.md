# Migrasi data bertahap

Gunakan Enterprise dan konektor aktif yang sudah memiliki pemetaan masuk. Kontrak lengkap: [API.md](../API.md#migrasi). Persiapan Worker dan kunci: [MCP_SPEC.md](MCP_SPEC.md#keamanan-dan-persiapan-deploy).

## Sebelum menjalankan

- Cadangkan sistem sumber dan D1. Rollback fitur ini bukan pemulihan database lengkap.
- Pilih ID sumber yang stabil dan `mode: "upsert"` bila impor akan diulang.
- Uji satu batch kecil dan periksa contoh kolom, Rupiah, tanggal, dan enum.
- Pertahankan sistem lama selama pemeriksaan hasil.

## Fase yang tersedia

| Urutan | Entitas |
|--------|---------|
| Data Master | `workers`, `vas_items` |
| Transaksi Aktif | `requests` |

Impor file mandiri juga mendukung `waste_entries`. Penawaran, penugasan, penyelesaian, dan jurnal belum dapat diimpor: ID dari sistem sumber belum diterjemahkan menjadi referensi internal yang aman. Impor historis ditunda sampai pemetaan referensi tersedia.

Label strategi `parallel`, `phased`, atau `bigbang` disimpan sebagai pilihan operator. Ketiganya memakai mesin eksekusi fase yang sama; label itu tidak melakukan cutover otomatis.

## Melalui Pengaturan

1. Buat dan aktifkan konektor REST atau File, lalu simpan pemetaan untuk entitas yang diperlukan.
2. Pilih Migrasi → Migrasi baru. Isi nama dan sumber, periksa fase, lalu buat migrasi.
3. Untuk File, unggah CSV/JSON per entitas pada fase tersebut. Untuk REST, data diambil dari endpoint dan pemetaan konektor.
4. Pilih Periksa tanpa menyimpan. Hasil pratinjau tidak mengubah data, log, lock, atau progres tersimpan.
5. Jalankan fase. Periksa jumlah berhasil/gagal dan laporan sebelum menjalankan fase berikutnya.

Maksimal 500 baris per permintaan. Fase hanya dijalankan sekali, secara berurutan. Untuk mengulang batch, buat migrasi baru atau gunakan sinkronisasi upsert. Mode mock menyimulasikan progres dan tidak menulis data domain sungguhan.

## Melalui API

```json
{
  "name": "Migrasi tim Q4",
  "connectorId": "<id konektor aktif>",
  "strategy": "parallel",
  "phases": ["master"]
}
```

Kirim body tersebut ke `POST /api/mcp/migrations`. Jalankan `POST /api/mcp/migrations/:id/run`:

```json
{
  "phaseIndex": 0,
  "dryRun": true,
  "rowsByEntity": {
    "workers": [{ "employee_id": "W-101", "nama": "Budi" }]
  }
}
```

Gunakan nama kolom sumber yang cocok dengan pemetaan. Untuk REST, `rowsByEntity` boleh tidak dikirim. Fase yang sudah dijalankan atau permintaan serentak mendapatkan `409`. Konektor nonaktif, sumber kosong untuk File, atau payload tidak valid mendapatkan `400`.

## Rollback

`POST /api/mcp/migrations/:id/rollback` hanya menghapus baris baru yang dicatat dalam jurnal migrasi tersebut. Baris dari sinkronisasi lain, migrasi lain, dan baris yang sudah ada sebelum migrasi tidak dihapus. Perubahan pada baris lama tidak dipulihkan.

Baris baru yang telah diedit setelah impor atau dipakai oleh data lain dipertahankan. Respons:

```json
{ "rolledBack": false, "removedRows": 8, "retainedRows": 2 }
```

`rolledBack` menjadi `true` setelah tidak ada baris jurnal yang tersisa. Fase dan statistik tetap disimpan untuk audit. Periksa baris yang dipertahankan secara manual; jangan menghapus dependensinya hanya untuk memaksa rollback.

Migrasi sebelum `0011_mcp_migration_safety.sql` tidak mempunyai jurnal per run. Baris lama tersebut dipertahankan, bukan ditebak dari semua referensi konektor.

## Jika permintaan terhenti

Baris domain, jurnal, dan referensi ditulis atomik per baris. Bila proses berhenti sesudah beberapa baris, baris yang sudah ditulis tetap dapat diperiksa dan di-rollback; fase mungkin belum memiliki statistik akhir. Jangan mengulang request secara bersamaan.

Worker melepas lock pada penyelesaian normal maupun error yang tertangkap. Setelah penghentian paksa, operator harus memastikan tidak ada request aktif sebelum mereset `mcp_migrations.locked = 0` untuk ID tersebut. Periksa jurnal sebelum mencoba ulang.
