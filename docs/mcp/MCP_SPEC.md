# Modul konektor ERP (MCP)

Status implementasi: 2026-11-02. Kontrak HTTP: [API.md](../API.md#mcp-konektor-erp-dan-migrasi).

MCP adalah nama internal modul konektor proyek ini. Modul memakai REST `/api/mcp/*`; modul ini tidak mengimplementasikan standar Model Context Protocol / JSON-RPC.

## Cakupan rilis

| Jalur | Perilaku yang tersedia |
|-------|-------------------------|
| REST | Tarik array JSON dari endpoint HTTPS publik; autentikasi API key, Basic, atau bearer token yang sudah diperoleh operator |
| File | CSV atau array JSON; Excel harus diekspor sebagai CSV dahulu |
| Webhook | Impor masuk dengan HMAC-SHA256 atas body mentah |
| Database langsung | Konfigurasi dapat disimpan, tetapi uji dan sinkronisasi melaporkan kebutuhan bridge agent; bridge belum tersedia |
| Entitas impor | `workers`, `vas_items`, `requests`, `waste_entries` |
| Migrasi | Data master (`workers`, `vas_items`), lalu permintaan (`requests`); dry run dan rollback baris baru |

Sinkronisasi keluar, bidirectional, pemetaan ID relasional untuk penawaran/jurnal, impor historis, pembacaan XLSX/XML, OAuth token refresh, dan eksekusi cron otomatis belum tersedia. Nilai jadwal dalam konfigurasi hanyalah metadata; tombol di UI hanya menawarkan eksekusi manual atau penerimaan webhook. Endpoint ERP vendor mungkin memerlukan adapter agar menghasilkan bentuk JSON yang didukung.

## Alur data

Pengaturan → klien `src/mcp/connector.js` → Worker `worker/mcp.js` → D1.

`src/mcp/rules.js` adalah aturan bersama untuk konfigurasi, pemetaan, transformasi, dan fase. `src/mcp/mapper.js` menyarankan kolom dan membuat pratinjau. Mode mock menyimulasikan UI melalui localStorage; ia tidak membuktikan konektivitas ERP atau penyimpanan domain.

Setiap pemetaan masuk memilih satu entitas, kolom sumber, kolom tujuan, dan transformasi. Transformasi mencakup trim, huruf besar/kecil, tanggal ISO, angka Indonesia, Rupiah, tabel nilai, JSON, dan telepon Indonesia. Kolom wajib dan nilai enum diperiksa sebelum ditulis. Kolom uang dan batas VAS/limbah mengikuti aturan domain aplikasi.

REST menerima array langsung, `{ data: [] }`, `{ records: [] }`, atau `{ rows: [] }`. Path per entitas berada di `mapping.filters.path` atau `config.endpoint.entityPath`; parameter query berada di `mapping.filters.query`. Redirect ditolak agar kredensial tidak diteruskan ke endpoint lain. Maksimal 500 baris per permintaan; respons REST yang lebih besar ditolak, bukan dipotong diam-diam. Pagination vendor belum otomatis.

## Idempotensi dan transaksi

Pilih `mode: "upsert"` dan `externalIdField` yang stabil dari sumber. `mcp_external_refs` menghubungkan ID itu dengan baris lokal. Impor ulang memperbarui baris yang sama. Tanpa ID eksplisit, kunci diturunkan dari kolom natural key; perubahan kolom kunci dapat menghasilkan baris baru. `mode: "insert"` selalu membuat baris baru.

INSERT domain, referensi eksternal, dan jurnal baris migrasi berjalan dalam satu batch transaksional D1. Kegagalan satu pernyataan membatalkan seluruh batch. Duplikat serentak dapat menghasilkan kegagalan satu baris yang aman untuk diulang; tidak meninggalkan INSERT yatim.

Rollback menggunakan `mcp_migration_rows`, bukan semua referensi milik konektor. Hanya baris baru milik migrasi tersebut yang belum berubah dan belum dipakai oleh data lain yang dihapus. Hasilnya `{ rolledBack, removedRows, retainedRows }`; jika ada baris yang dipertahankan, `rolledBack` adalah `false`. Update pada baris lama tidak dibatalkan. Statistik dan fase dipertahankan sebagai audit.

## Keamanan dan persiapan deploy

1. Terapkan seluruh migrasi D1, termasuk `0009_mcp.sql`, `0010_user_plan.sql`, dan `0011_mcp_migration_safety.sql`, sebelum deploy kode.
2. Setel secret `MCP_ENCRYPTION_KEY` (minimal 16 karakter; gunakan nilai acak yang kuat). Simpan kredensial ditolak dengan `503` jika kunci tidak ada. Tidak ada fallback plaintext. Konektor file tidak membutuhkan kunci.
3. Tetapkan `user_flags.plan = 'enterprise'` hanya untuk pengguna berhak. Plan baru/missing adalah `sole`. Pengelolaan entitlement ini masih dilakukan operator; belum terhubung otomatis dengan penagihan.
4. Authenticated routes memeriksa sesi, kepemilikan, dan Enterprise. Webhook memeriksa tanda tangan serta plan dan suspensi pemilik saat event diterima.

Kredensial tidak dikembalikan API atau disimpan di localStorage mode mock. Konfigurasi hanya menyimpan bidang publik yang diizinkan. Kunci yang salah atau kredensial lama berformat plaintext menghasilkan `503`; simpan ulang kredensial dengan kunci yang benar. Mengganti kunci tanpa menyiapkan kredensial pengganti membuat konektor lama tidak dapat dibuka.

Fase migrasi dan rollback memakai lock per migrasi. Jika Worker dihentikan paksa di tengah permintaan, operator harus memastikan permintaan sudah berhenti sebelum mereset `mcp_migrations.locked = 0`. Baris yang sudah ditulis tetap tercatat di jurnal dan dapat diperiksa atau di-rollback.

## Verifikasi

- `npm run test:unit`: aturan, kontrak klien HTTP, serta Worker dengan seluruh migrasi pada SQLite.
- `MCP_RUNTIME_TEST=1 node --test tests/mcp-runtime.test.mjs`: Worker sungguhan pada workerd/D1 lokal; memeriksa batch INSERT/ref/jurnal, upsert, dry run, dan rollback.
- `node tests/e2e/run.cjs mcp settings landing`: alur browser dalam mode mock.

Tes tidak menghubungi ERP vendor atau database produksi.
