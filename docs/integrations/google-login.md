# Masuk dengan Google

> Status: Draft
> Terakhir diperbarui: 2026-11-03

Satu Alur menyediakan dua jalur masuk dengan Google. Keduanya memakai klien OAuth yang sama dan berakhir di sesi Satu Alur biasa (token bearer yang sama seperti login OTP).

| Jalur | Kapan dipakai | Rute Worker |
|-------|---------------|-------------|
| **Google Identity Services (GIS)**: tombol resmi "Lanjutkan dengan Google" + One Tap, lewat FedCM bila peramban mendukung | Utama. Script `https://accounts.google.com/gsi/client` dimuat hanya di halaman Masuk | `GET /api/auth/google/nonce`, `POST /api/auth/google/credential` |
| **Redirect OAuth 2.0 + PKCE** | Cadangan otomatis bila script GIS gagal dimuat (diblokir, offline, peramban tidak didukung) | `GET /api/auth/google/start`, `GET /api/auth/google/callback`, `POST /api/auth/google/exchange` |

## Alur GIS

1. Halaman Masuk memanggil `GET /api/auth/providers`. Bila `google: true`, respons juga berisi `google_client_id` (publik).
2. Peramban memuat script GIS, meminta nonce sekali pakai ke `GET /api/auth/google/nonce` (disimpan sebagai SHA-256 di tabel `gis_nonces`, berlaku 5 menit), lalu menjalankan `google.accounts.id.initialize({ client_id, nonce, use_fedcm_for_prompt: true, use_fedcm_for_button: true, itp_support: true, ux_mode: 'popup', context: 'signin', auto_select: false })`.
3. Tombol resmi digambar dengan `renderButton` (tema `outline` atau `filled_black` mengikuti tema aplikasi, bahasa Indonesia). One Tap (`prompt()`) tampil sekali per sesi peramban; bila ditutup tidak ditampilkan lagi sampai tab baru.
4. Google mengembalikan ID token (JWT). Peramban mengirim `{ credential, nonce }` ke `POST /api/auth/google/credential`.
5. Worker:
   - menghapus baris nonce (sekali pakai; nonce kedaluwarsa atau dipakai ulang → 400);
   - memverifikasi tanda tangan RS256 dengan kunci publik Google (`https://www.googleapis.com/oauth2/v3/certs`, disimpan di memori isolate dan Cache API sesuai `Cache-Control`, diambil ulang bila `kid` tidak dikenal);
   - memeriksa `iss` (`accounts.google.com`), `aud` = `GOOGLE_CLIENT_ID`, `exp`, `iat`, `email_verified`, dan `nonce` = nonce yang dikirim;
   - mencari atau membuat pengguna berdasarkan email terverifikasi (aturan sama dengan jalur redirect: email staf dan 9 akun demo ditolak, akun yang ditangguhkan ditolak);
   - membuat sesi dan mengembalikan `{ user, access_token }`.
6. Batas ringan: 30 permintaan per 10 menit per IP untuk kedua rute GIS.

Bila verifikasi gagal, halaman Masuk menampilkan pesannya dan GIS diinisialisasi ulang dengan nonce baru.

## Pengaturan Google Cloud Console

Di klien OAuth "Web application" (ID: lihat `GOOGLE_CLIENT_ID` di `wrangler.toml`):

| Isian | Nilai produksi | Wajib untuk |
|-------|----------------|-------------|
| Authorized JavaScript origins | `https://satu-alur.apipedia.workers.dev` | **GIS** (tombol dan One Tap tidak muncul tanpa origin ini) |
| Authorized redirect URIs | `https://satu-alur.apipedia.workers.dev/api/auth/google/callback` | Jalur redirect (cadangan) |

Untuk domain lain, tambahkan origin dan redirect URI domain itu (redirect URI dibangun dari `PUBLIC_BASE_URL`, atau origin permintaan bila kosong).

## Konfigurasi

| Nama | Jenis | Isi |
|------|-------|-----|
| `GOOGLE_CLIENT_ID` | var | ID klien OAuth (publik; juga dikirim ke peramban untuk GIS) |
| `GOOGLE_CLIENT_SECRET` | secret | Hanya dipakai jalur redirect saat menukar kode |

Google aktif bila kedua nilai ada. Tidak ada Content-Security-Policy untuk aplikasi saat ini; bila nanti ditambahkan, izinkan `https://accounts.google.com/gsi/client` (script-src), `https://accounts.google.com/gsi/` (frame-src, connect-src, style-src) dan `identity-credentials-get` (Permissions-Policy, untuk FedCM).

## Mode mock (dev/e2e)

Tanpa jaringan: `localStorage.setItem('satualur_mock_google', '1')` menampilkan tombol GIS simulasi yang langsung masuk sebagai `pengguna.google@contoh.satualur.id`. Nilai `'script'` memuat script GIS asli (e2e memblokirnya untuk menguji tombol cadangan).
