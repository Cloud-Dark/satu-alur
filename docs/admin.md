# Admin Kantor Satu Alur

> Status: Draft
> Terakhir diperbarui: 2026-11-03

## Siapa admin

| Cara | Keterangan |
|------|------------|
| Akun staf | Username + password di `/super-admin-login` (`npm run staff`). Hanya melihat menu Kantor. |
| Admin lewat email | Email di tabel `admin_users` (diatur di Kantor › Sistem › Akses admin; migrasi 0014 mengisi `apipedia22@gmail.com`) atau di var `ADMIN_EMAILS` (bootstrap yang selalu berlaku, agar tidak ada yang terkunci). Masuk dengan kode email atau Google; berlaku hanya saat `DEMO_OTP` bukan `"true"`; akun demo dan alamat staf tidak pernah bisa menjadi admin. Admin ini tetap punya aplikasi bisnisnya sendiri dan berpindah lewat tombol "Kantor Satu Alur" / "Kembali ke usaha saya" di sidebar. |

Semua rute `/api/office/admin/*` memakai `requireAdmin` (worker/office.js) yang mengakui keduanya.

## Yang bisa diatur

- **Konten situs, Bisnis, Pelanggan, Agensi Influencer**: halaman yang sudah ada (landing, legal, paket, payment gateway, voucher, pelanggan, pengguna, Contact Us, tiket CS, influencer, permintaan, kampanye).
- **Pengguna**: daftar dengan pencarian dan halaman, skala akun, paket, pemakaian AI bulan ini, saldo AI; tombol Detail (skala akun bisa diubah, kecuali akun demo), Tangguhkan/Pulihkan, Akhiri sesi.
- **Sistem › Dasbor sistem**: jumlah pengguna, aktif 7 hari, panggilan AI, email, voucher, dan status kesehatan (Resend, kunci enkripsi, OTP email, Google, admin email).
- **Sistem › Email**: transport email platform (Resend bawaan atau SMTP kustom: host, port 465/587/2465/2587, TLS/STARTTLS, username, password terenkripsi `TOKEN_KEY`, pengirim, reply-to; `PUT /api/office/admin/system/email-transport`, disimpan di `system_settings` kunci `email_transport`). Transport ini membawa kode masuk, notifikasi, dan email bisnis yang belum memakai SMTP sendiri; jika SMTP kustom gagal, email otomatis lewat Resend dan kegagalannya tercatat di `email_log`. Juga: nama pengirim, izinkan SMTP milik bisnis, batas email penawaran per hari, kirim email uji.
- **Semua daftar Kantor berhalaman**: Permintaan dan Log aktivitas memakai paging server (`?page=`, 20 baris); Pengguna, Pelanggan, Contact Us, Pengaduan CS, Kampanye sudah berhalaman; Influencer, Voucher, Penukaran, Akses admin, dan Catatan audit memakai paging di layar.
- **Sistem › Mesin AI**: model bawaan default, izinkan penyedia AI milik bisnis, uji mesin AI.
- **Sistem › Login**: status OTP email/demo/Google, redirect URI Google, sakelar "masuk dengan kode email".
- **Sistem › Akses admin**: tambah admin lewat email, cabut akses (admin terakhir di daftar tidak bisa dihapus), daftar admin bawaan (`ADMIN_EMAILS`), dan catatan audit 50 terbaru (tambah/hapus admin, ubah pengaturan, ubah skala akun) dari tabel `admin_audit`.
- **Sistem › WhatsApp & sosial**: jumlah bisnis yang menghubungkan WAPilot/WAConsole/Repliz (bila tabelnya ada) dan status cadangan pengirim platform (`WA_PLATFORM_FALLBACK`, mati secara bawaan). Kredensial tiap bisnis tidak ditampilkan.
- **Sistem › Log aktivitas**: 100 email terbaru (filter per jenis) dan pemakaian AI per fitur bulan ini.

Pengaturan non-rahasia disimpan di tabel `system_settings` (kunci `email`, `ai`, `login`). Rahasia (Resend, Google, `TOKEN_KEY`) hanya di secret Worker dan tampil sebagai "Terkonfigurasi / Belum".

## Google Cloud Console

Jenis klien: Web application.

- Authorized JavaScript origins: `https://satu-alur.apipedia.workers.dev`
- Authorized redirect URIs: `https://satu-alur.apipedia.workers.dev/api/auth/google/callback`
- Scope: `openid email profile`

## Akun demo vs akun sungguhan

Sembilan akun demo (`worker/demo.js`, `isDemoUser(user)`) 100% demo: semua jawaban AI disimulasikan di Worker (`src/ai/simulate.js`, format SSE dan tempo sama seperti model, tanpa Workers AI/penyedia dan tanpa kuota), pengaturan Email & AI hanya-baca, dan email ke pelanggan tidak pernah dikirim. Akun sungguhan 100% sungguhan: data sendiri, mesin AI pilihan, dan email nyata.
