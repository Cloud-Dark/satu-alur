# Panduan Migrasi Database ke Satu Alur

> Versi: 1.0.0  
> Terakhir diperbarui: 2026-11-02  
> Target: Tim IT dan Administrator Sistem

---

## Daftar Isi

1. [Strategi Migrasi](#1-strategi-migrasi)
2. [Persiapan](#2-persiapan)
3. [Proses Migrasi Bertahap](#3-proses-migrasi-bertahap)
4. [Pemetaan Data](#4-pemetaan-data)
5. [Validasi](#5-validasi)
6. [Rollback](#6-rollback)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Strategi Migrasi

### 1.1 Pendekatan yang Direkomendasikan: Parallel Running

Satu Alur tidak merekomendasikan migrasi "big bang" (migrasi total dalam satu malam). Sebagai gantinya, gunakan pendekatan **Parallel Running**:

```
Bulan 1-2: Persiapan & Pemetaan
  └─ Ekspor data dari sistem lama
  └─ Bersihkan dan format data
  └─ Buat konfigurasi pemetaan

Bulan 2-3: Migrasi Data Master
  └─ Pelanggan → requests (historis)
  └─ Produk/Layanan → vas_items
  └─ Karyawan → workers
  └─ Validasi dan perbaiki

Bulan 3-4: Migrasi Transaksi Aktif
  └─ Pesanan aktif → requests + offers
  └─ Jadwal kerja → assignments
  └─ Dua sistem berjalan paralel

Bulan 4-5: Cutover Bertahap
  └─ Modul 1: Permintaan baru masuk ke Satu Alur
  └─ Modul 2: Penawaran via Satu Alur
  └─ Modul 3: Penugasan via Satu Alur
  └─ Modul 4: Pembukuan via Satu Alur
  └─ Modul 5: Laporan via Satu Alur

Bulan 5+: Legacy Read-Only
  └─ Sistem lama hanya untuk referensi
  └─ Semua operasi di Satu Alur
  └─ Arsipkan data lama setelah 6 bulan
```

### 1.2 Keuntungan Parallel Running

| Aspek | Big Bang | Parallel Running |
|-------|----------|------------------|
| Risiko gagal | Tinggi | Rendah |
| Downtime | Berjam-jam | Hampir nol |
| Kesiapan pengguna | Terburu-buru | Bertahap |
| Validasi data | Sulit | Mudah |
| Rollback | Sulit | Mudah |
| Biaya kesalahan | Besar | Minimal |

---

## 2. Persiapan

### 2.1 Checklist Pra-Migrasi

- [ ] Backup penuh database sistem lama
- [ ] Dokumentasikan skema database lama (tabel, kolom, relasi)
- [ ] Identifikasi data yang benar-benar perlu dimigrasi
- [ ] Bersihkan data duplikat dan tidak valid
- [ ] Siapkan akun Satu Alur dan tim pengguna
- [ ] Latih 1-2 "champion user" yang memahami kedua sistem
- [ ] Tetapkan tanggal cutover per modul

### 2.2 Informasi yang Dibutuhkan

| Informasi | Contoh | Pentingnya |
|-----------|--------|------------|
| Versi ERP/Database | Odoo 16, MySQL 8.0 | Menentukan metode koneksi |
| Jumlah record | 5.000 pelanggan, 50.000 transaksi | Estimasi waktu |
| Struktur tabel | `customers`, `orders`, `products` | Pemetaan bidang |
| Custom field | `kode_wilayah`, `tier_pelanggan` | Transformasi |
| Relasi antar tabel | FK: `orders.customer_id` → `customers.id` | Integritas data |
| Format tanggal | `DD/MM/YYYY` atau `YYYY-MM-DD` | Konversi |
| Format mata uang | Rupiah tanpa desimal | Validasi |

---

## 3. Proses Migrasi Bertahap

### 3.1 Fase 1: Data Master (Minggu 1-2)

**Data master** adalah data yang jarang berubah dan menjadi fondasi untuk transaksi:

```
Sistem Lama                    →    Satu Alur
─────────────────────────────────────────────────
Tabel: customers               →    requests (historis)
                                   workers
                                   
Tabel: products/services       →    vas_items
                                   requests.service_type
                                   
Tabel: employees/technicians   →    workers
                                   assignment_workers
```

**Langkah-langkah:**

1. Buka **Pengaturan → Migrasi → Fase 1: Data Master**
2. Pilih sumber data (CSV upload atau database connection)
3. Pilih entitas yang akan dimigrasi: `workers`, `vas_items`
4. Konfigurasikan pemetaan bidang
5. Klik **Pratinjau** — periksa 10 baris pertama
6. Klik **Validasi** — sistem memeriksa:
   - Duplikat (nama/telepon sama)
   - Nilai wajib yang kosong
   - Format data yang salah
7. Perbaiki error yang ditemukan
8. Klik **Jalankan Migrasi**
9. Verifikasi hasil: bandingkan jumlah record di kedua sistem

### 3.2 Fase 2: Transaksi Aktif (Minggu 3-4)

**Transaksi aktif** adalah data yang sedang berlangsung:

```
Sistem Lama                    →    Satu Alur
─────────────────────────────────────────────────
Pesanan yang belum selesai     →    requests (status: draft)
                                   offers (status: draft/sent)
                                   
Jadwal kerja aktif             →    assignments (status: pending)
                                   
Invoice yang belum lunas       →    ledger_entries
```

**Langkah-langkah:**

1. Buka **Pengaturan → Migrasi → Fase 2: Transaksi Aktif**
2. Filter data lama: hanya yang `status = 'open'` atau `created_at > 3 bulan terakhir`
3. Pilih entitas: `requests`, `offers`, `assignments`
4. Konfigurasikan pemetaan bidang
5. Jalankan **Dry Run** (simulasi tanpa menulis data)
6. Periksa laporan dry run:
   - Jumlah record yang akan dimigrasi
   - Jumlah record yang akan dilewati (tidak valid)
   - Estimasi waktu
7. Jika dry run berhasil, jalankan migrasi live
8. Verifikasi: buka modul Permintaan dan Penawaran di Satu Alur

### 3.3 Fase 3: Data Historis (Minggu 5-6, Opsional)

Data historis untuk laporan dan analisis:

```
Sistem Lama                    →    Satu Alur
─────────────────────────────────────────────────
Transaksi yang sudah selesai   →    completions
                                   ledger_entries
                                   reports
```

> **Catatan:** Data historis bisa dimigrasi nanti setelah cutover. Tidak wajib dilakukan sebelum sistem aktif.

---

## 4. Pemetaan Data

### 4.1 Pemetaan Standar

Berikut pemetaan umum untuk sistem ERP populer di Indonesia:

#### Odoo → Satu Alur

| Odoo (res.partner) | Satu Alur (requests) | Transformasi |
|-------------------|---------------------|--------------|
| `name` | `customer_name` | `trim` |
| `phone` | `phone` | `trim`, hapus spasi |
| `street` | `location` | `concat` dengan `city` |
| `comment` | `description` | `trim` |
| `create_date` | `created_at` | `date:ISO8601` |

| Odoo (product.product) | Satu Alur (vas_items) | Transformasi |
|-----------------------|----------------------|--------------|
| `name` | `name` | `trim` |
| `lst_price` | `price` | `number` |
| `standard_price` | `cost` | `number` |
| `categ_id.name` | `category` | `map` ke kategori Satu Alur |

#### MySQL/Custom Database → Satu Alur

```sql
-- Contoh query ekstraksi dari MySQL
SELECT 
  c.nama_pelanggan AS customer_name,
  c.telepon AS phone,
  CONCAT(c.alamat, ', ', c.kota) AS location,
  p.jenis_layanan AS service_type,
  p.deskripsi AS description,
  p.tanggal_pesanan AS requested_at,
  p.status AS status
FROM pesanan p
JOIN pelanggan c ON p.pelanggan_id = c.id
WHERE p.status IN ('baru', 'diproses', 'menunggu')
  AND p.tanggal_pesanan >= '2026-08-01';
```

### 4.2 Kategori Pemetaan

| Kategori Sumber | Kategori Satu Alur | Contoh |
|-----------------|-------------------|--------|
| Layanan AC | `ac` | Cleaning, Repair, Installation |
| Layanan Plumbing | `plumbing` | Pipe repair, Installation |
| Layanan Cleaning | `cleaning` | General, Deep cleaning |
| Layanan Listrik | `electrical` | Repair, Installation |
| Custom | `other` | Layanan khusus |

### 4.3 Status Pemetaan

| Status Sumber | Status Satu Alur | Kapan Dipakai |
|---------------|-----------------|---------------|
| `baru`, `draft`, `open` | `draft` | Permintaan baru |
| `dikirim`, `sent` | `sent` | Penawaran dikirim |
| `diterima`, `approved` | `approved` | Penawaran diterima |
| `ditolak`, `rejected` | `rejected` | Penawaran ditolak |
| `dikerjakan`, `in_progress` | `in_progress` | Sedang dikerjakan |
| `selesai`, `completed`, `done` | `completed` | Pekerjaan selesai |

---

## 5. Validasi

### 5.1 Checklist Pasca-Migrasi

**Data Master:**
- [ ] Jumlah pelanggan di sistem lama = jumlah requests di Satu Alur
- [ ] Jumlah produk/layanan = jumlah vas_items
- [ ] Jumlah karyawan/teknisi = jumlah workers
- [ ] Tidak ada duplikat (cek berdasarkan nama + telepon)

**Transaksi:**
- [ ] Jumlah pesanan aktif sama
- [ ] Total nilai pesanan aktif sama (±1% toleransi)
- [ ] Jadwal kerja aktif sama
- [ ] Status pesanan sesuai pemetaan

**Integritas:**
- [ ] Setiap offer memiliki request_id yang valid
- [ ] Setiap assignment memiliki offer_id yang valid
- [ ] Tidak ada orphan records (record tanpa parent)

### 5.2 Query Validasi

```sql
-- Di D1 (Satu Alur), jalankan via worker:

-- 1. Hitung jumlah record per entitas
SELECT 'requests' AS entity, COUNT(*) AS count FROM requests WHERE owner_id = 'USER_ID'
UNION ALL
SELECT 'workers', COUNT(*) FROM workers WHERE owner_id = 'USER_ID'
UNION ALL
SELECT 'vas_items', COUNT(*) FROM vas_items WHERE owner_id = 'USER_ID'
UNION ALL
SELECT 'offers', COUNT(*) FROM offers WHERE owner_id = 'USER_ID'
UNION ALL
SELECT 'assignments', COUNT(*) FROM assignments WHERE owner_id = 'USER_ID';

-- 2. Cek duplikat pelanggan
SELECT customer_name, COUNT(*) 
FROM requests 
WHERE owner_id = 'USER_ID' 
GROUP BY customer_name 
HAVING COUNT(*) > 1;

-- 3. Cek orphan offers
SELECT o.id 
FROM offers o 
LEFT JOIN requests r ON o.request_id = r.id 
WHERE o.owner_id = 'USER_ID' AND r.id IS NULL;
```

---

## 6. Rollback

### 6.1 Kapan Rollback Diperlukan

Rollback harus dipertimbangkan jika:
- >5% data tidak valid setelah migrasi
- Pengguna tidak bisa menemukan data yang mereka butuhkan
- Total nilai transaksi tidak sesuai (>2% selisih)
- Sistem lambat atau error setelah migrasi

### 6.2 Proses Rollback

1. Buka **Pengaturan → Migrasi → Riwayat**
2. Temukan migrasi yang ingin di-rollback
3. Klik **Rollback**
4. Pilih scope:
   - **Partial:** Hapus data yang bermasalah saja
   - **Full:** Hapus semua data hasil migrasi
5. Konfirmasi — sistem akan:
   - Membuat backup tabel terlebih dahulu
   - Menghapus data yang sesuai scope
   - Mengembalikan ke status sebelum migrasi
6. Verifikasi data kembali bersih

### 6.3 Backup Otomatis

Setiap migrasi otomatis membuat backup:

```
migration_backup_20261102_001/
├── requests_backup.sql
├── offers_backup.sql
├── assignments_backup.sql
└── manifest.json
```

Backup disimpan selama 30 hari dan bisa diunduh manual.

---

## 7. Troubleshooting

### 7.1 Masalah Umum

| Masalah | Penyebab | Solusi |
|---------|----------|--------|
| "Koneksi timeout" | Firewall atau network | Periksa port dan IP whitelist |
| "Autentikasi gagal" | API key salah | Reset dan perbarui kredensial |
| "Kolom tidak ditemukan" | Skema berubah | Perbarui konfigurasi pemetaan |
| "Duplikat ditemukan" | Data tidak unik | Tambahkan aturan deduplikasi |
| "Format tanggal salah" | Format tidak sesuai | Ubah transformasi di pemetaan |
| "Nilai terlalu panjang" | Batas karakter | Potong atau perbesar kolom |
| "Foreign key tidak valid" | Data tidak konsisten | Perbaiki data sumber terlebih dahulu |

### 7.2 Performance

| Jumlah Record | Estimasi Waktu | Rekomendasi |
|---------------|---------------|-------------|
| < 1.000 | < 5 menit | Jalankan langsung |
| 1.000 - 10.000 | 5-30 menit | Jalankan di jam non-peak |
| 10.000 - 100.000 | 30-120 menit | Bagi menjadi batch |
| > 100.000 | > 2 jam | Jalankan di malam hari |

### 7.3 Dukungan

Jika mengalami masalah yang tidak bisa diatasi:

1. Buka **Pengaturan → Migrasi → Log**
2. Klik **Ekspor Log** untuk mendapatkan file JSON lengkap
3. Kirim ke tim dukungan via:
   - Email: dukungan@satualur.id
   - Tiket: Buka **Pengaturan → Bantuan → Kirim Tiket**
4. Sertakan:
   - File log
   - Screenshots error
   - Jenis sistem sumber (Odoo, MySQL, dll.)
   - Jumlah record yang dimigrasi

---

## Lampiran A: Template Pemetaan

Gunakan template ini saat mendokumentasikan pemetaan:

```
Migrasi: [Nama Proyek]
Tanggal: [YYYY-MM-DD]
Sumber: [Nama Sistem Lama]
Target: Satu Alur

Entitas: [requests|workers|vas_items|...]
┌─────────────────┬─────────────────┬─────────────┬──────────┐
│ Field Sumber    │ Field Target    │ Transformasi│ Wajib    │
├─────────────────┼─────────────────┼─────────────┼──────────┤
│                 │                 │             │          │
└─────────────────┴─────────────────┴─────────────┴──────────┘

Filter Sumber:
  - 

Filter Target:
  - 

Validasi:
  - 

Catatan:
  - 
```
