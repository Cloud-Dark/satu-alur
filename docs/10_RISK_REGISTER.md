# Register Risiko

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Skala: Kemungkinan dan Dampak = Rendah / Sedang / Tinggi. Penilaian awal, perlu ditinjau pemilik.

| ID | Risiko | Kemungkinan | Dampak | Mitigasi | Status |
|----|--------|-------------|--------|----------|--------|
| R-001 | Paparan OTP demo: dengan `DEMO_OTP=true` kode OTP ada di respons API, sehingga siapa pun yang mengetahui email dapat login sebagai pemilik email itu. | Tinggi (bila aktif di publik) | Tinggi | Gunakan hanya di lingkungan uji; set `DEMO_OTP` selain `true` di produksi; pasang provider email (R-002); catat nilai variabel di checklist deploy. | Terbuka |
| R-002 | Belum ada provider email: OTP tidak dapat dikirim ke pengguna nyata. | Tinggi | Tinggi | Pilih dan integrasikan provider (_TBD_) sebelum akses publik; sampai itu, akses dibatasi ke penguji. | Terbuka |
| R-003 | Kuota/model Workers AI: kuota harian/bulanan, ketersediaan atau perubahan/penghentian model, latensi. | Sedang | Sedang | Daftar model saat ini tetap di `worker/index.js` (dua model Llama) sehingga penghentian model perlu perubahan kode; pesan error 502 "Layanan AI tidak tersedia" ditangani di UI; pantau penggunaan; belum ada rate limit per pengguna pada `/api/llm/chat`. Nilai kuota: _TBD_. | Terbuka |
| R-004 | Kualitas keluaran LLM: JSON tidak valid, harga tidak masuk akal. | Sedang | Sedang | Validasi domain (`validateOffer`), parse JSON dengan penanganan error, pengguna meninjau sebelum simpan. | Dimitigasi sebagian |
| R-005 | Batas D1: ukuran database, jumlah baris dibaca/ditulis, ukuran kueri, konsistensi dan latensi. | Rendah-Sedang | Sedang | Indeks pada `owner_id` dan kunci asing; `limit`/`range` pada `/api/db`; pantau penggunaan. Nilai batas paket: _TBD_. | Terbuka |
| R-006 | Tanpa RLS: isolasi `owner_id` hanya di kode Worker; satu bug dapat membocorkan data antar pengguna. | Sedang | Tinggi | Scoping terpusat di satu fungsi; whitelist tabel/kolom; tolak `owner_id` dari klien; uji isolasi (UAT skenario tenant isolation) dan uji otomatis. | Terbuka |
| R-007 | Injeksi SQL lewat generik `/api/db` (nama tabel/kolom/operator dari klien). | Rendah | Tinggi | Whitelist tabel, kolom, dan operator; nilai selalu bind; tolak input tak dikenal. | Dimitigasi di kode (whitelist tabel/kolom/operator, bind parameter); perlu uji otomatis |
| R-008 | Pencurian token sesi (disimpan di sisi klien). | Rendah-Sedang | Tinggi | Server hanya menyimpan hash; sesi berlaku 30 hari; signout menghapus sesi; hindari XSS (R-010). Token disimpan di `localStorage` (`satualur_token`), yang dapat dibaca skrip apa pun di origin yang sama. | Terbuka |
| R-009 | Tidak ada layar persetujuan penawaran: penawaran dibuat `draft`, sedangkan Penugasan hanya menampilkan `approved`. Pada lingkungan baru alur terhenti setelah tahap Penawaran. | Tinggi | Sedang | Tambahkan layar persetujuan (roadmap); sementara itu ubah status lewat prosedur manual _TBD_. | Terbuka |
| R-010 | XSS: keluaran AI berformat HTML ditampilkan lewat `innerHTML` (laporan). | Sedang | Tinggi | Sanitasi HTML dan/atau whitelist tag sebelum render. | Terbuka |
| R-011 | Kredensial konektor (API key WA, kata sandi SMTP) disimpan di `localStorage`. | Sedang | Sedang | Jangan isi kredensial produksi sampai ada penyimpanan aman di server (`wrangler secret`/D1 terenkripsi) _TBD_. | Terbuka |
| R-012 | Penyalahgunaan endpoint auth (spam OTP, tebak kode). | Sedang | Sedang | Sudah ada: OTP berlaku 10 menit, 5 percobaan per kode, 5 permintaan kode per email per 10 menit. Belum ada: rate limit per IP; pembatasan `verify-otp` per email di luar per kode. | Dimitigasi sebagian |
| R-013 | Kehilangan data saat migrasi dari WorkBuddy/PostgreSQL. | Rendah | Sedang | Mode prototype memakai localStorage, belum ada data produksi yang diketahui di repositori; konfirmasi dengan pemilik. | Perlu konfirmasi |
| R-014 | Ketergantungan pada satu vendor (Cloudflare). | Rendah | Sedang | Akses data lewat lapisan `getCloud()`; skema SQL standar SQLite. | Diterima |
| R-015 | Formulir Permintaan mengirim field `phone` yang tidak ada di skema/whitelist; Worker menolak kolom tak dikenal (400), sehingga simpan permintaan dapat gagal di mode Cloudflare. | Tinggi | Tinggi | Hapus field dari formulir atau tambah kolom `phone` di migrasi dan whitelist; verifikasi di UAT skenario Buat Permintaan. | Terbuka (temuan 2026-10-28) |
