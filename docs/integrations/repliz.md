# Media sosial lewat Repliz

> Status: Draft
> Terakhir diperbarui: 2026-11-03

Setiap usaha menghubungkan **workspace Repliz miliknya sendiri**. Lewat Repliz, Satu Alur bisa menyambungkan Instagram, Facebook, Threads, TikTok, YouTube, LinkedIn, X, dan Pinterest, lalu mengunggah atau menjadwalkan konten.

## Alur pengguna

1. **Media Sosial › Akun** (atau Pengaturan › Konektor): isi **Access key** dan **Secret key** dari repliz.com › Setting › Public API.
   - Kunci diperiksa dengan `GET /me/addon`, lalu disimpan terenkripsi (`integration_credentials`, AES-GCM `TOKEN_KEY`).
2. Kartu platform menampilkan akun di workspace Repliz usaha itu. Tombol yang tersedia: **Hubungkan**, **Tambah akun**, **Sambungkan ulang**, dan **Putuskan**.
3. **Hubungkan** membuka halaman masuk platform (`POST /api/social/repliz/authorize`), lalu platform kembali ke `GET /api/social/repliz/callback/:platform`.
   - Halaman callback membaca `?code=` atau, khusus Facebook, `#access_token=`, lalu mengirimnya ke `POST /api/social/repliz/complete/:platform`.
   - Pemilik usaha dikenali dari cookie `__Host-repliz_state` yang ditandatangani `TOKEN_KEY` dan berlaku 10 menit.
   - Instagram, Threads, TikTok, X, dan Pinterest langsung tersambung.
   - Facebook, YouTube, dan LinkedIn menukar kode dulu. Bila ada lebih dari satu Halaman, Kanal, atau Organisasi, pengguna memilih di panel pilihan (`repliz_pick`). Pilihan disimpan terenkripsi di `social_oauth_picks` selama 10 menit, dan tokennya tidak pernah sampai ke browser.
4. **Konten** dan **Jadwal › Daftar konten** punya tombol **Unggah ke akun terhubung**. Dialognya berisi:
   - pilihan akun dan jenis unggahan (teks, gambar, video, album sesuai platform);
   - judul untuk YouTube, Pinterest, TikTok, dan Facebook;
   - teks dan tautan media `https://`, atau unggah berkas ke penyimpanan Repliz;
   - papan untuk Pinterest dan privasi untuk YouTube;
   - waktu: **Sekarang** atau **Jadwalkan**.
5. **Jadwal › Laporan tayang** menampilkan unggahan dari Satu Alur (`repliz_posts`) dengan status Terjadwal, Diproses, Tayang, atau Gagal, tautan bila tersedia, dan tombol Batalkan selama masih terjadwal.

## Batasan

- Kapasitas akun mengikuti paket Repliz usaha itu (`GET /account/count` → `limit`). Paket Free: 1 akun.
- Repliz memakai alamat `redirect` yang kita kirim sebagai alamat balik dari platform. Alamatnya tetap per platform: `https://<domain>/api/social/repliz/callback/<platform>`. **Perlu diuji di produksi**, karena Meta, TikTok, dan X bisa menolak alamat yang tidak terdaftar di aplikasi Repliz. Bila ditolak, tanyakan ke Repliz cara mendaftarkan domain.
- Akun demo bersama tidak bisa menyimpan kunci, menghubungkan akun, atau mengunggah.
- Selama `DEMO_OTP="true"`, integrasi mati kecuali `INTEGRATIONS_ALLOW_DEMO_OTP="true"`.
- Integrasi langsung Meta/Threads milik Zulfikar (`worker/social.js`) tetap ada. Bila Repliz terhubung, integrasi itu tampil sebagai pilihan kedua di tab Akun.

## Kode

- `worker/repliz-client.js`: klien Public API (Basic auth).
- `worker/repliz.js`: rute.
- `src/repliz/rules.js`: tabel platform, validasi unggahan, tautan unggahan.
- `src/repliz/state.js`: cookie state yang ditandatangani.
- `src/stages/social-media/repliz.js`: kartu akun, dialog unggah, daftar unggahan.
