# UAT Deploy Cloudflare

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Template UAT pasca-deploy Satu Alur di Cloudflare. Semua hasil berstatus `_PENDING_` sampai diisi oleh pelaksana deployment. Jangan mengubah status tanpa menjalankan skenario. Referensi: [18_INSTALLATION.md](../18_INSTALLATION.md), [03_FRD.md](../03_FRD.md), [API.md](../API.md).

## Informasi Eksekusi

| Item | Nilai |
|------|-------|
| URL Worker | _TBD_ |
| Tanggal eksekusi | _TBD_ |
| Penguji | _TBD_ |
| Commit/versi yang dideploy | _TBD_ |
| `DEMO_OTP` saat uji | _TBD_ |
| Peramban dan versi | _TBD_ |
| Akun uji A | _TBD_ (mis. `uji+a@example.com`) |
| Akun uji B | _TBD_ (mis. `uji+b@example.com`) |

Prasyarat: langkah 1-6 di [18_INSTALLATION.md](../18_INSTALLATION.md) selesai, termasuk smoke test curl.

## Ringkasan Hasil

| ID | Skenario | Status |
|----|----------|--------|
| UAT-01 | Login OTP | _PENDING_ |
| UAT-02 | Buat permintaan | _PENDING_ |
| UAT-03 | Penawaran AI | _PENDING_ |
| UAT-04 | Penugasan | _PENDING_ |
| UAT-05 | Penyelesaian | _PENDING_ |
| UAT-06 | Pembukuan (ledger) | _PENDING_ |
| UAT-07 | Laporan AI | _PENDING_ |
| UAT-08 | Isolasi tenant | _PENDING_ |
| UAT-09 | Sign out | _PENDING_ |

Status yang diizinkan: `_PENDING_`, `LULUS`, `GAGAL`, `BLOKIR`. Kesimpulan akhir: _PENDING_.

## Skenario

### UAT-01 Login OTP (FR-001, FR-002)

Langkah:
1. Buka URL Worker, masukkan email akun A, minta kode.
2. Catat kode yang tampil (mode demo) atau diterima.
3. Masukkan kode salah, lalu kode benar.
4. Muat ulang halaman.

Hasil diharapkan: kode salah ditolak dengan pesan Indonesia; kode benar masuk ke aplikasi; setelah muat ulang sesi tetap aktif; kode yang sama tidak dapat dipakai dua kali.

Status: _PENDING_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-02 Buat Permintaan (FR-010)

Langkah: isi Nama Pelanggan, Jenis Layanan, Lokasi, Nomor Telepon, Deskripsi; simpan.

Hasil diharapkan: pesan sukses, permintaan muncul di daftar teratas. Perhatikan R-015: bila simpan gagal dengan "Kolom tidak dikenal: phone", catat sebagai GAGAL.

Status: _PENDING_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-03 Penawaran AI (FR-011)

Langkah: pilih permintaan, hasilkan penawaran, amati streaming, uji tombol Batal pada satu percobaan, lalu simpan hasil yang valid.

Hasil diharapkan: teks tampil bertahap; Batal menghentikan dan menampilkan "Dibatalkan"; hasil tervalidasi (harga/scope/terms) dan tersimpan berstatus `draft`. Catat model yang dipakai dan lama respons.

Status: _PENDING_ | Model: _TBD_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-04 Penugasan (FR-013)

Prasyarat: ada penawaran berstatus `approved`. Karena belum ada layar persetujuan (R-009), ubah status lewat prosedur yang disepakati: _TBD_ (mis. `wrangler d1 execute --remote` atau panggilan `/api/db` dengan token akun A). Catat prosedur yang dipakai.

Langkah: pilih penawaran, isi nama pekerja dan jadwal, simpan.

Hasil diharapkan: penugasan berstatus `assigned` muncul di daftar.

Status: _PENDING_ | Prosedur persetujuan: _TBD_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-05 Penyelesaian (FR-014)

Langkah: pilih penugasan, isi catatan hasil, simpan.

Hasil diharapkan: penyelesaian `done` tersimpan; penugasan hilang dari pilihan karena berstatus `done`.

Status: _PENDING_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-06 Pembukuan / Ledger (FR-015)

Langkah: pilih penyelesaian, isi jumlah, simpan sebagai `pendapatan`; tambah satu entri biaya.

Hasil diharapkan: entri tampil di jurnal; ringkasan Total Pendapatan, Total Biaya, dan Laba/Rugi sesuai penjumlahan manual.

Status: _PENDING_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-07 Laporan AI (FR-016)

Langkah: buka Laporan, periksa ringkasan, jalankan "Jelaskan dengan AI", uji Batal.

Hasil diharapkan: angka ringkasan sama dengan Pembukuan; penjelasan HTML tampil bertahap dalam Bahasa Indonesia; Batal berfungsi; tidak ada skrip yang dieksekusi dari keluaran.

Status: _PENDING_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-08 Isolasi Tenant (FR-030)

Langkah:
1. Sebagai akun A, buat satu permintaan dan catat `id`-nya.
2. Keluar; masuk sebagai akun B.
3. Pastikan daftar permintaan B tidak memuat data A di semua tahap dan dashboard.
4. Dengan token B, panggil `POST /api/db` select `requests` dengan filter `id` = id data A; lalu update dan delete dengan filter yang sama; lalu insert `offers` dengan `request_id` data A.
5. Coba insert dengan `owner_id` milik A pada `values`.

Hasil diharapkan: select mengembalikan array kosong; update/delete mengembalikan array kosong dan data A tidak berubah; insert offers dengan `request_id` data A ditolak (400 "Referensi request_id tidak ditemukan."); `owner_id` dari klien diabaikan (baris dibuat atas nama B).

Status: _PENDING_ | Bukti: _TBD_ | Catatan: _TBD_

### UAT-09 Sign Out (FR-003)

Langkah: tekan keluar; coba `GET /api/auth/session` dan `POST /api/db` dengan token lama; muat ulang aplikasi.

Hasil diharapkan: layar login tampil; token lama menghasilkan 401; data tidak tampil tanpa login.

Status: _PENDING_ | Bukti: _TBD_ | Catatan: _TBD_

## Temuan

| ID | Skenario | Keparahan | Deskripsi | Tindak lanjut |
|----|----------|-----------|-----------|---------------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

Temuan berulang atau berdampak keamanan ditambahkan ke [10_RISK_REGISTER.md](../10_RISK_REGISTER.md).

## Persetujuan

| Peran | Nama | Tanggal | Keputusan |
|-------|------|---------|-----------|
| Penguji | _TBD_ | _TBD_ | _PENDING_ |
| Pemilik produk | _TBD_ | _TBD_ | _PENDING_ |
