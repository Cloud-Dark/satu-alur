# seeds/

> **Peringatan kuota D1 (paket gratis):** paket Free membatasi **100.000 baris tulis per hari**, dihitung termasuk entri indeks. Sebelum migrasi 0004, `demo.sql` penuh menulis ±112.000 baris. Akibatnya kuota harian habis dan semua penyimpanan, termasuk login, gagal sampai 00.00 UTC. Di akun Free pakai **mode lean dan file terpisah**: lihat [Free tier](#free-tier-lean--split).

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Berisi **data demo DUMMY** untuk D1. Semua pelanggan, telepon, alamat, pekerja, dan angka di sini **fiktif**. Data ini tidak mewakili pelanggan nyata. Rancangan dan asumsinya ada di [docs/specs/2026-10-28-demo-growth-data-design.md](../docs/specs/2026-10-28-demo-growth-data-design.md).

| File | Isi |
|------|-----|
| `demo.sql` | Mode penuh: 9 akun demo dan seluruh data alurnya (39.182 baris, ±10,6 MB). Ditujukan untuk lokal atau akun Workers Paid. |
| `demo-summary.json` | Ringkasan mode penuh per usaha: pendapatan/biaya/laba bulanan, tren, margin, jumlah baris, estimasi tulis. |
| `demo-lean.part1of3.sql` … `part3of3.sql` | Mode `--lean` dibagi 3 file (17.504 baris total). Masing-masing ±37–38 ribu writes bila mengganti seed penuh. Terapkan **satu file per hari** di akun Free. |
| `demo-lean-summary.json` | Ringkasan mode lean, termasuk `write_estimate`. |

## Akun demo

Login lewat OTP mode demo (`DEMO_OTP=true`; kode muncul di respons `send-otp`).

| # | Email | Usaha | Skala |
|---|-------|-------|-------|
| 1 | demo-ac@satualur.id | Budi Santoso (Servis AC), Bekasi | Sole trader |
| 2 | demo-cleaning@satualur.id | Rina Kusuma (Rapi Bersih Home Cleaning), Makassar | Sole trader |
| 3 | demo-listrik@satualur.id | Hendra Siregar (Listrik Siaga Medan) | Sole trader |
| 4 | demo-pest@satualur.id | CV Basmi Hama Nusantara, Surabaya–Sidoarjo | UKM |
| 5 | demo-laundry@satualur.id | CV Wangi Bersih Laundry, Bandung | UKM |
| 6 | demo-dinding@satualur.id | CV Glasur Dinding Borneo, Balikpapan | UKM |
| 7 | demo-mall@satualur.id | PT Arunika Layanan Ritel (mal, multi-kota) | Enterprise |
| 8 | demo-fm@satualur.id | PT Prima Layanan Fasilitas (FM kantor BUMN/bank) | Enterprise |
| 9 | demo-rs@satualur.id | PT Sehat Bersih Medika (housekeeping RS/klinik/lab) | Enterprise |

UUID pemilik tetap: `0d3e5a11-7c1a-4b5e-9a0K-5a7a1a1d000K` (K = 1..9). ID baris memakai rentang `K × 1.000.000 + n` per tabel.

## Membuat ulang

```bash
node scripts/seed-demo.mjs --months 12 --end 2026-10-31 --out seeds/demo.sql
# opsi: --asof 2026-11-20 | --asof now   (batas "hari ini" data; default 2026-10-28 17:00 WIB)
#       --seed 20261028  --only demo-ac,demo-rs  --summary none  --quiet
#       --lean  --split N  --existing-counts seeds/existing.json  --budget 90000  --per-file 45000
```

Output deterministik: seed dan argumen yang sama menghasilkan file yang identik byte per byte. Untuk demo di tanggal lain, buat ulang dengan `--asof` hari demo supaya KPI "7 hari terakhir" dan antrean "Perlu tindakan" tetap segar.

## Menerapkan

```bash
npx wrangler d1 migrations apply satu-alur-db --local   # bila skema belum ada
npx wrangler d1 execute satu-alur-db --local --file seeds/demo.sql
```

Produksi (`--remote`) hanya dijalankan oleh lead.

- **Aman dijalankan ulang.** File ini menghapus dulu seluruh baris domain milik 9 akun demo (anak dulu, termasuk `reports`, `social_*`, `ai_messages`), lalu mengisi ulang.
- Bila email demo sudah pernah login sebelum seed (sehingga punya UUID acak), baris dan sesi milik UUID lama ikut dihapus, lalu user dibuat ulang dengan UUID tetap. Akibatnya sesi login akun demo itu ikut keluar.
- Tidak ada `BEGIN/COMMIT` karena D1 menolaknya. Setiap `INSERT` berisi maksimal 100 baris dan maksimal 90 KB (batas statement D1 100 KB).
- **Efek samping `AUTOINCREMENT`.** Setelah seed, ID baris nyata yang baru akan melompat ke atas 9.000.000 (mengikuti ID demo tertinggi per tabel, misalnya `ledger_entries` ±9.003.200). Ini tidak berbahaya. Jangan menaikkan volume seed (misalnya `--months 24`) setelah ada data nyata di produksi, karena ID demo bisa bertabrakan dengan ID nyata. Bila tabrakan terjadi, `INSERT` gagal dan tidak menimpa apa pun.

## Free tier (lean + split)

D1 Free: **100.000 rows written per hari**, reset 00.00 UTC. Setiap baris yang disisipkan **atau dihapus** ikut menulis entri indeksnya. Setelah migrasi 0004, satu baris domain = 2 writes (baris + indeks `owner_id`), dan satu `users` = 3 writes. Skrip membaca indeks dari `migrations/` dan **selalu mencetak estimasinya**. Bila total > 90.000, skrip memberi peringatan keras.

| Skenario (9 akun, default) | Baris insert | Writes insert | Writes hapus data lama | **Total** |
|----------------------------|--------------|---------------|------------------------|-----------|
| Penuh, DB kosong | 39.182 | 78.400 | 0 | **78.400** |
| Penuh, mengganti seed penuh | 39.182 | 78.400 | 78.364 | **156.764** |
| Lean, DB kosong | 17.504 | 35.044 | 0 | **35.044** |
| Lean, mengganti seed penuh | 17.504 | 35.044 | 78.364 | **113.408**, jadi 3 file × ±38 ribu |

Yang diringkas mode `--lean`:

- Biaya per pekerjaan digabung jadi satu baris (kategori = komponen terbesar). Overhead digabung jadi satu baris per bulan. Total biaya bulanan tidak berubah.
- Laundry walk-in dicatat sebagai rekap mingguan.
- Work order kecil enterprise ditagih sebagai rekap bulanan per klien, ditambah lebih sedikit proyek yang lebih besar dan kontrak yang lebih besar.

Sembilan usaha, 12 bulan, dan seluruh band pertumbuhan/margin tetap dicek.

Langkah:

1. **Hitung data lama di produksi** (hanya baca, tidak memakai kuota tulis). Simpan hasilnya sebagai `seeds/existing.json`:
   ```bash
   npx wrangler d1 execute satu-alur-db --remote --json --command "SELECT u.email, \
     (SELECT COUNT(*) FROM requests t WHERE t.owner_id=u.id) requests, (SELECT COUNT(*) FROM offers t WHERE t.owner_id=u.id) offers, \
     (SELECT COUNT(*) FROM assignments t WHERE t.owner_id=u.id) assignments, (SELECT COUNT(*) FROM completions t WHERE t.owner_id=u.id) completions, \
     (SELECT COUNT(*) FROM ledger_entries t WHERE t.owner_id=u.id) ledger_entries, (SELECT COUNT(*) FROM reports t WHERE t.owner_id=u.id) reports \
     FROM users u WHERE u.email LIKE 'demo-%@satualur.id'" > seeds/existing.json
   ```
   Tanpa file ini, skrip mengasumsikan seed penuh sebelumnya sudah ada. Ini perlu dicek, karena seed penuh yang gagal di tengah jalan kemungkinan hanya masuk sebagian. Format lain yang diterima: `demo-summary.json` lama, objek `{ "demo-ac": {requests: …}, … }`, atau total datar `{requests: …}`.
2. **Buat file dan baca estimasinya:**
   ```bash
   node scripts/seed-demo.mjs --lean --split 3 --existing-counts seeds/existing.json --out seeds/demo-lean.sql
   ```
   Usaha dibagi utuh ke N file. Tiap file menghapus lalu mengisi ulang hanya akun-akunnya sendiri, jadi setiap akun selalu konsisten. Naikkan `--split` atau pakai `--only demo-ac,demo-rs` bila ada file di atas 45.000 writes.
3. **Terapkan satu file per hari UTC:**
   ```bash
   npx wrangler d1 migrations apply satu-alur-db --remote        # pastikan 0004 sudah diterapkan
   npx wrangler d1 execute satu-alur-db --remote --file seeds/demo-lean.part1of3.sql   # hari 1
   # hari 2: part2of3, hari 3: part3of3
   ```
   Sisakan ruang kuota untuk pemakaian aplikasi di hari yang sama. Satu login OTP saja menulis beberapa baris.

Estimasi ini adalah model, bukan meteran. Pada insiden produksi, model ini menghitung ±111.900 writes untuk data yang sebenarnya menulis 112.316 (selisih ±0,4%). Wrangler lokal tidak melaporkan `rows_written`, jadi tidak bisa diukur di lokal.

## Catatan pemuatan data

Sejak commit "keyset paging", aplikasi memuat semua baris per tabel (halaman 5.000 baris). Batas 1.000 baris yang dulu memotong KPI Ringkasan sudah tidak berlaku.
