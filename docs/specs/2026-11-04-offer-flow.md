# Alur permintaan & penawaran (v2)

> Status: Draft · Terakhir diperbarui: 2026-11-04

## Permintaan (tahap 01)
- Langkah **Kebutuhan**: tombol **Isi otomatis dengan AI**. Pemilik usaha menulis petunjuk singkat atau menempel chat pelanggan; AI mengisi *Jenis layanan* (memilih dari layanan yang sudah ada / nama template bila cocok) dan *Deskripsi kebutuhan*. Teks mengalir terlihat dan tetap bisa diedit.
- Kuota: dihitung sebagai fitur **`offer`** (Penawaran AI), satu panggilan per pengisian. Akun demo memakai jawaban contoh dari server (`src/ai/simulate.js`, `[agent:request-autofill]`).
- *Jadwal yang diminta klien* tidak lagi ditanyakan di form permintaan. Kolom `requests.requested_at` tetap ada; nilainya diatur di langkah penawaran.

## Penawaran (tahap 02)
1. **Pilih permintaan** + **Template penawaran** (opsional, dapat dicari). Pertanyaan template wajib dijawab bila ditandai wajib.
2. **Susun dengan AI** — daftar langkah dengan status (menunggu → berjalan → selesai/gagal), waktu, tombol *Hentikan* dan *Ulangi dari sini*:
   1. Mengambil data klien (permintaan, riwayat pelanggan, harga penawaran serupa)
   2. Menyesuaikan jadwal (jadwal klien bila masih di masa depan; jika tidak, hari kerja terdekat dengan tugas paling sedikit, pukul 09.00) — bisa diubah langsung
   3. Membuat penawaran (AI, mode JSON di belakang layar; layar menampilkan Ruang lingkup/Harga/Ketentuan/Catatan yang terisi bertahap — tidak pernah JSON mentah)
   4. Membuat PDF penawaran (`src/offer/document.js` + `src/docs/print.js`)
   5. Membuat draf email & WhatsApp
   6. Membuat draf tinjauan (lokal, tanpa AI: harga vs riwayat & kisaran template, data kontak, jadwal, hal yang perlu dicek)
3. **Tinjau & simpan** — semua isian bisa diubah (lingkup, ketentuan, catatan, harga, jadwal); aturan domain tampil sebagai chip; tombol *Unduh PDF*, *Kirim email*, *Kirim WhatsApp*. Draf email/WA mengikuti isian sampai diedit sendiri. Simpan menulis `offers.template_id` + `offers.template_answers_json` dan memperbarui `requests.requested_at`.

Hanya ada satu panggilan AI per penawaran (langkah 3).

## Template penawaran (Kantor › Bisnis)
- Tabel `offer_templates` (migrasi `0018_offer_templates.sql`, 8 template bawaan).
- Admin: daftar berhalaman + cari, tambah/ubah (pembuat pertanyaan: teks/angka/pilihan/tanggal, wajib, opsi, pratinjau), aktif/nonaktif, hapus. Perubahan dicatat di `admin_audit`.
- Bisnis hanya membaca template aktif.

## Rute
| Metode | Rute | Akses |
|---|---|---|
| GET | `/api/offer-templates` | pengguna masuk (aktif saja) |
| GET | `/api/office/admin/offer-templates?page=&per=&q=` | admin |
| POST | `/api/office/admin/offer-templates` | admin |
| PATCH | `/api/office/admin/offer-templates/:id` | admin (template penuh atau `{ active }`) |
| DELETE | `/api/office/admin/offer-templates/:id` | admin |

## Cetak dokumen
`src/docs/print.js` — `openPrintable({ title, html, filename })` membuka dokumen bergaya Tumbuh dan dialog cetak (Simpan sebagai PDF). Bila pop-up diblokir, berkas HTML diunduh. Dipakai ulang untuk invoice/surat jalan.
