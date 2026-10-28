# seeds/

> **Peringatan kuota D1 (paket gratis):** paket Free membatasi **100.000 baris tulis per hari** (dihitung termasuk indeks). `demo.sql` penuh menulis ±112.000 baris, sehingga menerapkannya di akun Free menghabiskan kuota harian dan seluruh penyimpanan (termasuk login) gagal sampai 00.00 UTC. Terapkan seed penuh hanya di akun Workers Paid, atau buat seed lebih kecil (mis. `--months 3` atau sebagian bisnis) untuk akun Free.

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Berisi **data demo DUMMY** untuk D1. Semua pelanggan, telepon, alamat, pekerja, dan angka di sini **fiktif**. Data ini tidak mewakili pelanggan nyata. Rancangan dan asumsinya ada di [docs/specs/2026-10-28-demo-growth-data-design.md](../docs/specs/2026-10-28-demo-growth-data-design.md).

| File | Isi |
|------|-----|
| `demo.sql` | Hasil `scripts/seed-demo.mjs`: 9 akun demo dan seluruh data alurnya (±39 ribu baris, ±10,6 MB). |
| `demo-summary.json` | Ringkasan per usaha: pendapatan/biaya/laba bulanan, tren pertumbuhan, margin, jumlah baris. |

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
#       --seed 20261028  --only ac,fm  --summary none  --quiet
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

## Batasan yang perlu diketahui saat demo

Aplikasi saat ini (`src/stages/data.js` → endpoint `select`) hanya memuat **1.000 baris terbaru per tabel**. Delapan dari sembilan akun demo punya lebih dari 1.000 jurnal (kecuali `demo-dinding`, 928 jurnal), sehingga:

- KPI "Pendapatan/Biaya" di Ringkasan hanya menjumlah ±1.000 jurnal terakhir.
- Jurnal untuk penyelesaian lama tidak ikut termuat, sehingga penyelesaian lama tampil sebagai "Posting jurnal" di "Perlu tindakan".

Laporan "Bulan ini/Bulan lalu/30 hari" tetap akurat. Perbaikannya ada di sisi aplikasi (paginasi atau agregasi di server), bukan di data.
