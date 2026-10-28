# Standar Kode

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Linter dan formatter belum dikonfigurasi (`npm run lint` placeholder). Aturan di bawah mengikuti gaya kode yang sudah ada.

## Umum

- JavaScript ES Modules, Vanilla JS (tanpa framework). Tanpa TypeScript saat ini.
- Teks antarmuka, pesan error, dan komentar yang menjelaskan perilaku: Bahasa Indonesia. Nama variabel/fungsi: Inggris.
- Berkas klien memakai tanpa titik koma dan kutip tunggal (gaya `src/`); `worker/index.js` memakai titik koma. Ikuti gaya berkas yang diedit.
- Jangan menambah dependensi tanpa alasan; catat di PR.

## Klien (`src/`)

- Stage mengakses data hanya lewat `getCloud()`; jangan memanggil `fetch('/api/...')` langsung dari stage.
- Hasil panggilan data selalu diperiksa `error` lebih dulu; tampilkan pesan berbahasa Indonesia dan jangan biarkan halaman rusak.
- Aturan bisnis (validasi penawaran, transisi status) berada di `src/domain/`; bukan di komponen UI.
- Jangan merender teks dari AI atau pengguna dengan `innerHTML` tanpa sanitasi (lihat R-010 di [10_RISK_REGISTER.md](../10_RISK_REGISTER.md)). Untuk teks biasa pakai `textContent`.
- Rahasia tidak boleh masuk bundel; variabel `VITE_*` terbaca publik.
- Panggilan AI mendukung pembatalan lewat `AbortController` dan menangani `AbortError`.
- Penyimpanan `localStorage` dibungkus `try/catch`.
- Mode mock harus tetap menyediakan antarmuka yang sama dengan klien HTTP; ubah keduanya bersamaan.

## Worker (`worker/index.js`)

Wajib:

1. Setiap rute selain `send-otp`/`verify-otp` memanggil `authenticate()` lebih dulu.
2. Query domain selalu memuat `owner_id = <user.id>`; `owner_id` berasal dari sesi, tidak pernah dari body.
3. Nama tabel/kolom/operator hanya dari whitelist; nilai hanya lewat `.bind()`. Dilarang menggabungkan input klien ke string SQL.
4. Validasi dan batasi ukuran semua input (body, string, jumlah baris, filter).
5. Kembalikan error dengan `HttpError` dan pesan berbahasa Indonesia; jangan membocorkan detail internal. Log detail dengan `console.error`.
6. Bandingkan rahasia/hash dengan fungsi waktu-konstan (`safeEqual`); gunakan Web Crypto untuk acak dan hash.
7. Jangan menulis token, kode OTP, atau email lengkap ke log.
8. Kunci asing yang dikirim klien harus diverifikasi kepemilikannya (`assertFkOwnership`).

Menambah tabel: ikuti [21_BACKEND.md](../21_BACKEND.md) bagian "Menambah Tabel atau Kolom".

## SQL dan Migrasi

- Berkas bernomor `NNNN_deskripsi.sql` di `migrations/`; gunakan `IF NOT EXISTS` bila memungkinkan.
- Waktu `TEXT` ISO 8601 UTC; JSON sebagai `TEXT`.
- Tambahkan indeks untuk `owner_id` dan kolom FK pada tabel baru.

## Penamaan

- Tabel/kolom: `snake_case`, tabel jamak. File JS: huruf kecil, `kebab-case` atau nama tunggal (mengikuti yang ada).
- Konstanta batas di Worker: `UPPER_SNAKE_CASE` di bagian atas berkas.
