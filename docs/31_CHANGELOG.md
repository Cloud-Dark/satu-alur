# Changelog

> Status: Draft
> Terakhir diperbarui: 2026-11-03
> Pemilik: _TBD_

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/). Versi mengikuti `package.json` (saat ini `0.1.0`); penetapan nomor versi rilis: _TBD_.

## [Unreleased]

### 2026-11-04 - Alur permintaan & penawaran v2

#### Ditambahkan
- Permintaan: **Isi otomatis dengan AI** (jenis layanan + deskripsi kebutuhan dari petunjuk singkat atau chat; dihitung sebagai fitur `offer`).
- Penawaran: proses AI enam langkah yang terlihat (data klien, jadwal, penawaran, PDF, draf email & WhatsApp, draf tinjauan), tanpa JSON mentah di layar; tinjauan dengan semua isian bisa diubah, Unduh PDF, Kirim email, Kirim WhatsApp.
- **Template penawaran** (Kantor › Bisnis): tabel `offer_templates` + 8 template bawaan (migrasi `0018_offer_templates.sql`), CRUD admin dengan pembuat pertanyaan; bisnis memilih template dan menjawab pertanyaannya sebelum AI menyusun penawaran. `offers.template_id`, `offers.template_answers_json`.
- `src/docs/print.js`: dokumen cetak/PDF bergaya Tumbuh, dipakai juga untuk dokumen lain.

#### Diubah
- *Jadwal yang diminta klien* pindah dari form permintaan ke langkah penawaran (kolom `requests.requested_at` tetap).

### 2026-11-04 - Progres penugasan, invoice, petugas akun demo

#### Ditambahkan
- **Invoice** (menu Pendapatan › Invoice): buat dari pekerjaan selesai (juga dari Penyelesaian dan Pembukuan), baris jumlah × harga, diskon, PPN 11% opsional, tempo, cara pembayaran bawaan. Unduh PDF/cetak, kirim lewat email atau WhatsApp (akun demo disimulasikan), Tandai lunas → pendapatan (tanpa PPN) diposting ke Pembukuan sekali saja, atau ditautkan bila sudah ada. Nomor `INV-YYYY-0001` per bisnis per tahun lewat `POST /api/invoices/next-number` (atomik).
- **Progres penugasan**: Belum dikerjakan / Sedang dikerjakan / Ditunda / Selesai, dengan catatan dan riwayat. "Selesai" lewat tahap Penyelesaian sehingga tetap satu penyelesaian per penugasan. Tampil di Daftar penugasan, popup Peta, Performa, dan aksi dasbor ("Lewat jadwal" hanya untuk yang belum dikerjakan).
- **Petugas contoh** untuk 9 akun demo: `seeds/demo-workers.sql` (75 baris: 44 petugas + 31 keahlian, dibuat oleh `scripts/seed-demo-workers.mjs` dari `src/demo/demo-workers.js`); juga ikut di `scripts/seed-demo.mjs`.
- Migrasi `0019_progress_invoices.sql`: kolom progres di `assignments`, tabel `assignment_progress_log`, `invoices`, `invoice_items`, `invoice_seq`, `invoice_settings`.

#### Diubah
- Pilihan penawaran di form Tugaskan hanya berisi penawaran disetujui yang belum ditugaskan.

### 2026-11-03 - Rapikan tampilan mobile, keahlian petugas, peta petugas

#### Diperbaiki
- Pengaturan di HP: bar tab tidak lagi mendorong isi drawer keluar layar; tab menggulir di kotaknya sendiri dengan tepi memudar dan tab aktif selalu terlihat (`C.segmented({ scroll: true })`). Tabel Log dan pemetaan ERP menggulir di dalam kartu.
- Teks "null" di Penugasan › Tim (dan 4 tempat serupa): `append()`/`replaceChildren()` bawaan DOM mengubah `null` menjadi teks.
- Login: tombol Google (GIS / cadangan) dipindah ke atas form email.
- Checkbox, radio, fieldset, dan input file memakai gaya design system.

#### Ditambahkan
- Keahlian petugas per bisnis (migrasi `0017_worker_skills.sql`, tabel `worker_skills`): tambah, ubah nama, hapus (keahlian yang dihapus dilepas dari petugas setelah konfirmasi). Daftar bawaan dibuat saat pertama dibuka. Form petugas memakai chip pilihan dan bisa menambah keahlian langsung.
- Penugasan › Peta memakai Leaflet + OpenStreetMap: alamat petugas di-geocode lewat `/api/leads/geocode` (akun demo: gazetteer offline) dan koordinatnya disimpan.
- `tests/e2e/mobile-sweep.spec.cjs` (cek overflow 390 px di semua halaman) dan `tests/e2e/petugas.spec.cjs`; dokumen `docs/specs/2026-11-03-mobile-ui-sweep.md`.

### 2026-11-03 - Menu profil, paging Kantor, SMTP platform, cari pelanggan dari peta

#### Ditambahkan
- Avatar di topbar menjadi tombol menu akun (Profil saya, Paket & kuota, Pengaturan, Kantor Satu Alur / Kembali ke usaha saya untuk admin email, tema, Keluar); `PUT /api/me/profile` mengubah nama tampilan (akun demo dan staf tidak bisa).
- Kantor › Sistem › Mesin AI: admin memilih penyedia AI platform (Workers AI, OpenAI-compatible, Anthropic-compatible) dengan daftar model dari penyedia, uji sebelum simpan, dan cadangan otomatis ke Workers AI yang tercatat di Log aktivitas. Pengaturan › Email & AI bisnis mendapat "Ambil daftar model" dan uji nilai yang belum disimpan.
- Kantor › Sistem › Email: admin memilih transport email platform, Resend atau SMTP kustom (password terenkripsi), dengan cadangan otomatis ke Resend.
- Paging di semua daftar Kantor (server untuk Permintaan dan Log aktivitas) dan di daftar bisnis yang sebelumnya tanpa batas (konten & jadwal media sosial, unggahan Repliz, permintaan kolaborasi/iklan, tiket Bantuan).
- Wizard Permintaan: tombol "Cari dari peta" (OpenStreetMap lewat pencari prospek; akun demo memakai data contoh) dan "Isi manual". Migrasi `0016_request_coords.sql` menambah `requests.lat/lng` (nullable).

### 2026-11-03 - Google Identity Services

#### Ditambahkan
- Tombol resmi "Lanjutkan dengan Google" dan One Tap (Google Identity Services, FedCM bila didukung peramban) di halaman Masuk (`src/auth/gis.js`). Script GIS dimuat hanya di halaman Masuk dan hanya bila Google dikonfigurasi; bila gagal dimuat, tombol redirect lama tetap dipakai.
- `GET /api/auth/google/nonce` dan `POST /api/auth/google/credential`: ID token diverifikasi di Worker (RS256 dengan JWKS Google yang di-cache, `iss`, `aud`, `exp`, `email_verified`, nonce sekali pakai), lalu sesi dibuat seperti login lain. Batas 30 permintaan per 10 menit per IP.
- Migrasi `0015_gis_nonces.sql` (tabel `gis_nonces`).
- `/api/auth/providers` kini menyertakan `google_client_id` bila Google aktif.

#### Diubah
- Jalur redirect Google juga menolak alamat 9 akun demo (masuk lewat tab "Akun demo").

### 2026-11-03 - Integrasi milik usaha: WhatsApp (WAPilot/WAConsole) dan Repliz

#### Ditambahkan
- Kunci integrasi per usaha (`integration_credentials`, AES-GCM `TOKEN_KEY`), dengan rute `GET/PUT/DELETE /api/integrations/:provider`. Kunci diperiksa saat disimpan dan hanya ditampilkan sebagai "…abcd".
- WhatsApp dari akun usaha sendiri lewat WAPilot atau WAConsole (`worker/wa/`, `worker/whatsapp.js`):
  - pilihan penyedia per usaha;
  - tombol **WhatsApp** di Permintaan dan Penawaran dengan dialog konfirmasi;
  - pesan uji;
  - batas 200 pesan per hari;
  - log `wa_messages`;
  - akun demo disimulasikan.
- Media sosial lewat Repliz milik usaha (`worker/repliz.js`):
  - hubungkan Instagram, Facebook, Threads, TikTok, YouTube, LinkedIn, X, dan Pinterest;
  - unggah sekarang atau jadwalkan dari Konten/Jadwal;
  - status di Laporan tayang (`repliz_posts`).
- Migrasi `0013_integrations.sql`; dokumentasi di `docs/integrations/`.

#### Diubah
- Kartu WhatsApp di Pengaturan tidak lagi menyimpan API key di browser. Kunci lama di localStorage dihapus otomatis.
- Kunci WhatsApp milik platform hanya dipakai bila `WA_PLATFORM_FALLBACK="true"` (bawaan mati).
### 2026-11-03 - Admin, email, penyedia AI, dan login Google

#### Ditambahkan
- Email: Resend sebagai pengirim bawaan (`RESEND_API_KEY`, `EMAIL_FROM`) dan SMTP milik bisnis (klien SMTP di Worker, password terenkripsi `TOKEN_KEY`); email penawaran ke pelanggan, laporan ke pemilik, email uji; semua tercatat di `email_log` ([docs/integrations/email.md](integrations/email.md)).
- Login kode email sungguhan: kode dikirim ke inbox; `DEMO_OTP` di konfigurasi menjadi `"false"`. Tab "Akun demo" tetap ada.
- Mesin AI per bisnis: bawaan, OpenAI-compatible, atau Anthropic-compatible dengan API key sendiri; tidak memakai kuota Satu Alur ([docs/integrations/ai-providers.md](integrations/ai-providers.md)).
- Admin lewat email (`ADMIN_EMAILS`) dan grup Kantor › Sistem (Dasbor sistem, Email, Mesin AI, Login, WhatsApp & sosial, Log aktivitas), detail pengguna dengan skala akun ([docs/admin.md](admin.md)).
- Masuk dengan Google (OIDC + PKCE, kode serah-terima sekali pakai).
- Kantor › Sistem › Akses admin: admin dipilih dari daftar `admin_users` (bawaan `apipedia22@gmail.com`, `ADMIN_EMAILS` tetap bootstrap), admin terakhir tidak bisa dihapus, semua perubahan tercatat di `admin_audit`.
- Akun demo 100% demo: AI disimulasikan di Worker (`src/ai/simulate.js`, dipakai juga oleh mock), integrasi hanya-baca, email ke pelanggan disimulasikan; helper `isDemoUser` di `worker/demo.js`.
- Migrasi `0014_admin_system.sql`: `system_settings`, `business_integrations`, `email_log`, `oauth_logins`, `admin_users`, `admin_audit`, kolom `users.last_login_at`.

### 2026-11-03 - Rilis gabungan dan materi lomba

#### Ditambahkan
- Gabungan `main` Zulfikar (Kantor Satu Alur, VAS & Tanpa limbah, konektor ERP, Threads) dengan kuota trial per fitur dan voucher (migrasi `0012_quota_vouchers.sql`), data contoh kantor (`seeds/office.sql`) dan panduan uji lokal (`docs/TESTING_LOKAL.md`).
- Materi lomba di `docs/lomba/`: dokumen submisi, PDF 16 halaman, naskah dan skrip rekam video demo dengan narasi dan musik latar orisinal.
- `wrangler.deploy.toml`: konfigurasi deploy production tanpa binding R2 dan cron (keduanya belum tersedia di akun).

#### Deploy
- Migrasi `0003_workers` dan `0007`–`0012` diterapkan ke D1 production; `seeds/office.sql` dimuat (201 baris tertulis).

### 2026-11-02 - Integrasi ERP Enterprise

- Konektor REST, CSV/JSON, dan webhook masuk; pemetaan, pratinjau, sinkronisasi upsert, log, dan dead letter.
- Migrasi data master (`workers`, `vas_items`) dan permintaan (`requests`). Impor relasional/historis, database bridge, XLSX/XML, sinkronisasi keluar, dan cron ERP otomatis belum tersedia.
- Pemeriksaan Enterprise di UI dan Worker; webhook memeriksa entitlement dan suspensi pemilik saat event diterima.
- Kredensial wajib terenkripsi AES-GCM. Kunci hilang, kunci salah, atau format plaintext lama menghasilkan `503`; tidak ada fallback plaintext.
- Payload konfigurasi klien dinormalisasi tanpa mengekspos rahasia. Basic/bearer token dan PATCH tanpa `enabled` bekerja sesuai kontrak.
- ID eksternal dari pemetaan tersimpan digunakan saat upsert agar impor ulang tidak menduplikasi data.
- Dry run tidak mengubah progres atau data. INSERT domain, referensi, dan jurnal migrasi ditulis dalam satu batch transaksional.
- Rollback memakai jurnal per migrasi dan mempertahankan baris yang berubah/dipakai serta baris dari run lain. Update pada data lama tidak dibatalkan.
- Wizard migrasi, callback select, unggah sumber, dan alur pratinjau diperbaiki; regresi browser mencakup alur ini.
- Styling halaman kontak diperbaiki; landing menjelaskan integrasi Enterprise. Dokumen arsitektur, integrasi, UAT, dan video story pack ditambahkan.
- CI menjalankan unit/API tests, regresi workerd/D1 lokal, build, dan pemeriksaan whitespace PR.

**Rollout:** terapkan `0009_mcp.sql`, `0010_user_plan.sql`, dan `0011_mcp_migration_safety.sql` sebelum deploy, lalu setel `MCP_ENCRYPTION_KEY`. Kontrak dan batas implementasi ada di [API.md](API.md#mcp-konektor-erp-dan-migrasi).

### 2026-10-31 - Landing menampilkan Pendapatan dan Pertumbuhan

Landing sebelumnya hanya bercerita tentang enam tahap alur. Dua grup menu terbaru — sumber nilai jual yang paling mudah dijelaskan ke calon pelanggan — tidak terlihat sama sekali. Sekarang keduanya punya bagian sendiri.

#### Ditambahkan
- Bagian **Pendapatan** (`#pendapatan`): dua kartu mesin pendapatan — **Layanan tambahan** (katalog add-on dengan batang serapan per item) dan **Tanpa limbah** (cincin persentase bebas limbah plus tiga kebocoran terbesar) — lalu strip **Ruang optimasi** dengan lima chip tim AI dan pil "Pimpinan optimasi". Semua angka pratinjau diberi label "Contoh".
- Bagian **Pertumbuhan** (`#pertumbuhan`): empat kartu menu (Radar peluang, Rekomendasi & prediksi, Pencari prospek, Media Sosial) dan dua kartu pendamping (Penasihat AI, AI Superpowers), ditutup catatan bahwa Media Sosial memerlukan Halaman Facebook dan Instagram Bisnis.
- Navigasi header dan menu seluler bertambah "Pendapatan" dan "Pertumbuhan"; "Roadmap" tetap ada di halaman dan footer tetapi keluar dari navigasi utama agar tetap enam tautan.
- Ticker kemampuan diperluas dari 11 menjadi 16 pil (katalog add-on, lima aliran pemborosan, ruang optimasi lima tim, radar peluang, pencari prospek, media sosial).
- FAQ baru: "Apa itu Layanan tambahan dan Tanpa limbah?" dan "Apakah fitur Pertumbuhan memakai data pelanggan saya?".

#### Diubah
- Statistik di bagian Alur kerja menjadi **6 tahap kerja · 5 tim AI · 2 grup tambahan**, dan paragrafnya menyebut bahwa dua grup menu memakai data alur untuk menambah pendapatan dan mencari pertumbuhan.
- Hero: subjudul menyebut kedua mesin baru; poin di bawah CTA menambahkan "Pendapatan & pertumbuhan sudah aktif".
- Kolom footer "Produk" menautkan kedua bagian baru.
- Hero memakai sumber default yang sama dengan editor, sehingga subjudul baru benar-benar tampil. Klaim serapan VAS diperjelas sebagai perkiraan yang diatur pengguna; prediksi diberi keterangan data demonstrasi.
- Angka dan jawaban ilustratif Pertumbuhan diberi label "Contoh"; persyaratan akun sosial menjelaskan Facebook, Instagram, dan Threads secara terpisah.

#### Pengujian
- `tests/e2e/landing.spec.cjs`: 81 pemeriksaan (dari 38), termasuk keberadaan kedua bagian, jumlah kartu, lima chip tim, baris pratinjau, dan navigasi anchor ke `#pendapatan`.
- Kasus UAT TC-LND-11 dan TC-LND-12 ditambahkan; TC-LND-01 diperbarui.
- Total 368 tes Node dan 122 pemeriksaan browser landing/site lulus. Chromium menguji 1440, 1024, 960, 959, 390, dan 320 px pada tema terang/gelap, termasuk reduced motion, overflow, dan benturan navigasi. Build produksi berhasil dengan peringatan ukuran bundel.

### 2026-10-31 - Halaman kontak didesain ulang

Halaman publik `#/kontak` sebelumnya memakai komponen formulir yang bergantung pada `.app-shell` — padahal halaman publik tidak memuat shell aplikasi. Akibatnya seluruh input, label, dan tombol tampil dengan gaya browser bawaan: tanpa border, tanpa fokus ring, dan tanpa layout card.

#### Diperbaiki
- Desain ulang layout menjadi **dua kolom pada desktop** (intro di kiri, kartu formulir di kanan) dan **tumpuk pada seluler**.
- Tambah stylesheet `.contact-page` penuh di `landing.css`: field label dengan badge "WAJIB", input dengan border, hover, dan fokus ring; textarea memenuhi lebar; tombol primer penuh lebar; pesan sukses dengan ikon cek hijau dan latar hijau muda.
- Semua style tidak bergantung `.app-shell`, menggunakan token desain yang sama dengan halaman publik lainnya, dan mendukung tema gelap lewat `prefers-color-scheme`.

#### Ditambahkan
- Dua kolom grid pada lebar ≥840 px; form 2-kolom pada ≥560 px dengan `Pesan` dan tombol melebar penuh lewat `.field-full`.

### 2026-10-31 - Persistensi dan validasi produksi Pendapatan

Dua menu Pendapatan (**Layanan Tambahan** dan **Tanpa Limbah**) sebelumnya hanya UI di atas mock tanpa tabel D1, tanpa validasi server, dan tanpa pencarian. Perubahan ini menambahkan penyimpanan D1 dan validasi server untuk keduanya.

#### Ditambahkan
- Migrasi `0008_pendapatan.sql`: tabel `vas_items` dan `waste_entries` dengan CHECK constraint yang mencerminkan aturan aplikasi (`saved <= monthly_loss`, enum kategori/aliran/status, batas uang), indeks `(owner_id, created_at)` dan `(owner_id, stream)`, serta kolom `ledger_entries.vas_item_id`.
- `src/pendapatan/rules.js`: satu sumber aturan untuk formulir, Worker, dan mock — enum, batas panjang, batas uang, `validateVasItem`, `validateWasteEntry`, `assertWasteInvariants`, `withWasteCompletion`, `splitDuplicates`, `assertImportSize`. Galat membawa `validation: true` sehingga Worker memetakannya ke 400, bukan 500.
- Worker `/api/db`: `vas_items` dan `waste_entries` masuk whitelist; insert **dan** update divalidasi (update terhadap baris hasil gabungan), kuota 500 item katalog dan 2000 temuan per pemilik, `updated_at` diisi server. `assertFlowRules` diekspor untuk pengujian kontrak.
- Pencarian (dengan debounce), filter status/aliran, paginasi, dan ekspor CSV di tab Katalog (VAS) dan Tindakan (Tanpa Limbah).
- Impor massal sadar duplikat: kotak "Lewati item yang sudah ada" dengan pratinjau `N item baru · M sudah ada dan dilewati`; baris duplikat dilewati, bukan digandakan.
- Tombol "Coba lagi" pada keadaan galat di kedua tahap; data yang gagal dimuat tidak lagi menjadi layar kosong.
- Pembukuan: pemilih add-on opsional (`vas_item_id`) untuk baris pendapatan, sehingga "Porsi VAS" di dasbor diukur dari data, bukan diasumsikan.

#### Diperbaiki
- `C.button` mendapat opsi `dismiss`, dan `C.modal` menutup dialog ketika tombol "Batal" diklik. Sebelumnya tombol dirender `type="button"` di dalam form `method="dialog"` sehingga batal tidak melakukan apa pun. Handler tingkat dialog yang memanggil `preventDefault()` (konfirmasi form kotor) tetap menang.
- `percentInt` mengembalikan `NaN` untuk teks non-numerik, sehingga `"abc"` ditolak alih-alih diam-diam menjadi 0.
- Kolom UPDATE SQL disusun sesudah normalisasi menambahkan `saved`/`updated_at`, agar jumlah parameter tetap sesuai. Update temuan dibatasi ke satu `id`; constraint database juga menjaga temuan selesai selalu terhenti penuh.
- Format uang negatif tidak lagi diubah menjadi positif; CSV melindungi teks yang bisa dibaca sebagai formula spreadsheet.
- Riwayat dan proses optimasi dipisahkan per pengguna; riwayat lama tanpa pemilik tidak ditampilkan.

#### Pengujian
- Total 368 tes Node lulus, termasuk pengujian Worker melalui HTTP dengan SQLite asli setelah seluruh migrasi: UPDATE, isolasi pemilik, referensi VAS, dan invarian penghematan. Pengujian SQLite membutuhkan Node 22.13+; versi lama melewatinya.
- Seluruh 44 pemeriksaan browser `pendapatan` lulus pada server Vite dengan backend mock, termasuk pemisahan riwayat akun dan pemilih VAS pembukuan. Build produksi berhasil dengan peringatan ukuran bundel. Seluruh sembilan migrasi berhasil pada D1 lokal terisolasi.
- Dua kegagalan `flow` pada tahap Penugasan muncul identik pada commit PR sebelumnya (`1773d9f`) dan perubahan ini; kegagalan tersebut mendahului perubahan ini. Suite browser lengkap tidak dijalankan ulang.

#### Catatan
- Tabel baru butuh `npm run db:migrate:local` / `db:migrate:remote`; tanpa itu `/api/db` mengembalikan galat SQL untuk kedua tabel.
- Jalankan migrasi remote sebelum men-deploy Worker/frontend; database produksi dan layanan AI langsung belum diuji dalam pemeriksaan ini.
- Batas 100 baris per `insert` tetap berlaku; tempelan lebih besar ditolak dan perlu dibagi menjadi beberapa impor.

### 2026-10-29 - Publikasi Meta dan Kantor Satu Alur

#### Ditambahkan
- Tahap **Media sosial** dengan tab Akun, Konten, Jadwal (Daftar konten / Laporan tayang), Brainstorm, Iklan, Kolaborasi: hubungkan Halaman Facebook (+ Instagram tertaut) lewat OAuth Meta, terbit sekarang atau jadwalkan (1 menit sampai 75 hari), unggah gambar JPEG ke R2 (maks. 8 MB), laporan tayang.
- Rute `/api/social/*` dan `GET /api/media/:key` (`worker/social.js`); cron 5 menit yang menerbitkan maks. 25 posting jatuh tempo, mengulang galat batas laju sampai 3 kali, dan tidak mengulang galat tak pasti ("Status tidak pasti, periksa halaman Anda").
- Tahap admin **Kantor Satu Alur** dan rute `/api/office/*` (`worker/office.js`): katalog influencer, permintaan Kolaborasi dan Iklan dari bisnis, kotak masuk admin (status Baru/Diproses/Selesai + catatan). Khusus staf: login username + password di `/super-admin-login` (`POST /api/auth/staff-login`, tabel `staff_accounts`, perintah `npm run staff`); `GET /api/auth/session` mengembalikan `is_admin`.
- Migrasi `0007_social_meta.sql`: `social_accounts`, `social_posts`, `influencers`, `service_requests`, dan kolom `social_contents.image_key`. Konfigurasi baru: `META_APP_ID`, `META_APP_SECRET`, `TOKEN_KEY`, `PUBLIC_BASE_URL`, binding R2 `MEDIA` ([16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md)).
- Mode demo: konten berisi `#gagal` sengaja gagal diterbitkan.

#### Catatan
- Pakai di bisnis lain butuh App Review Meta; sebelum itu hanya admin/developer/tester aplikasi yang bisa terhubung.

### 2026-10-29 - Tampilan ringkas, data tetap di perangkat

#### Diubah
- Header besar di setiap halaman (pil tahap, judul besar, paragraf penjelasan) diganti tooltip ⓘ di samping nama halaman pada topbar. Judul tetap ada untuk pembaca layar; baris aksi hanya muncul bila halaman punya aksi.
- Tulisan teknis dihapus dari UI: "Terhubung · Cloudflare D1", nama model AI, tab Cloud di Pengaturan, "JSON mentah", label sumber data peta.
- Pencari prospek: hasil dan riwayat pencarian (maks. 8) disimpan di localStorage per pengguna; pencarian berjalan di belakang layar walau pindah halaman (`src/leads/job.js`); peta dan form dikunci selama mengambil data.
- Penasihat AI: percakapan disimpan di localStorage per pengguna (maks. 60 pesan per agen) dan jawaban tetap mengalir saat pindah halaman; riwayat chat tidak lagi ditulis ke D1.
- Media sosial: Threads ditambahkan, plus tab "Akun terhubung" untuk menyimpan akun media sosial. (Catatan merge: tahap Media sosial lama digabung ke menu Media Sosial, jadi Threads dan tab ini tidak tampil lagi; `src/stages/social-accounts.js` belum dipakai.)

### 2026-10-29 - Tindak lanjut audit kode

#### Diperbaiki
- Worker menolak jurnal dengan jumlah nol/negatif atau kategori tak dikenal, pendapatan ganda untuk satu pekerjaan selesai (409), dan penyelesaian ganda untuk satu penugasan (409). Mock memakai aturan yang sama.
- Pembukuan memberi pesan validasi bila pendapatan pekerjaan itu sudah diposting; biaya tetap boleh berkali-kali.
- Penyelesaian menampilkan peringatan bila status penugasan gagal diperbarui (sebelumnya hanya `console.warn`).
- Mock menolak `update`/`delete` tanpa filter, sama seperti Worker.

#### Dihapus
- `scripts/setup.js` dan skrip `npm run setup` (sisa WorkBuddy), serta helper mati `typewriterEffect` dan `createParticleBackground`.

#### Pengujian
- `tests/flow-rules.test.mjs`: 7 tes untuk aturan uang dan alur (total 152 unit test).

### Integrasi Tumbuh dan ruang kerja AI

- Menggabungkan `Cloud-Dark/satu-alur` main pada `e5beb83`, termasuk backend Cloudflare, landing/login, desain Tumbuh, dan combobox pencarian.
- Memindahkan Social Media dan AI Superpowers ke grup navigasi Ruang kerja tanpa mengubah enam tahap operasional.
- Menyesuaikan halaman konten, brainstorming, jadwal lokal, rekomendasi Meta Ads, partnership, dan percakapan AI ke panel, tipografi, ikon, tema terang/gelap, serta layout responsif yang sama.
- Hasil AI disanitasi dengan helper bersama. Pembatalan diteruskan ke stream HTTP; fallback tidak menggabungkan jawaban parsial; hasil tool lengkap disimpan dalam memori.
- Menjaga key konten/jadwal lokal yang sudah ada, menambahkan pesan kegagalan penyimpanan dan menyimpan hasil brainstorming ke pustaka ide.
- `npm test` menjalankan pemeriksaan integrasi AI berbasis Node/Vite: mock, tool, pembatalan, fallback, dan memori. Build serta smoke browser desktop (login mock, chat, generate/simpan konten) lulus.
- Belum diuji: layanan Cloudflare/Workers AI langsung dan layout perangkat seluler. Jadwal tetap berupa catatan lokal, bukan publikasi otomatis; percakapan memakai satu spesialis per sesi.

### 2026-10-28 - Port ke Cloudflare

#### Ditambahkan
- Cloudflare Worker tunggal (`worker/index.js`) yang melayani aset `dist/` lewat binding `ASSETS` dan rute `/api/*`.
- Database D1 `satu-alur-db` dengan migrasi `migrations/0001_init.sql` (tabel `users`, `sessions`, `otp_codes`, `requests`, `offers`, `assignments`, `completions`, `ledger_entries`, `reports`).
- Autentikasi email OTP: `POST /api/auth/send-otp`, `POST /api/auth/verify-otp`, `GET /api/auth/session`, `POST /api/auth/signout`; token sesi bearer disimpan sebagai hash.
- Mode demo OTP (`DEMO_OTP`) yang mengembalikan kode di respons karena belum ada provider email.
- Endpoint generik `POST /api/db` dengan whitelist tabel/kolom dan pembatasan `owner_id` di Worker.
- LLM lewat Workers AI: `GET /api/llm/models` dan `POST /api/llm/chat` (SSE gaya OpenAI).
- Klien HTTP `src/http-cloud.js` dan pemilih backend di `src/cloud.js`.
- Skrip npm `deploy`, `cf:dev`, `db:migrate:local`, `db:migrate:remote`; devDependency `wrangler`.
- Proksi `/api` ke `localhost:8787` pada Vite dev server.
- Set dokumentasi `docs/` bernomor, standar, dan template UAT Cloudflare ([README.md](README.md)).

#### Diubah
- Backend berpindah dari WorkBuddy Cloud SDK/PostgreSQL ke Cloudflare Worker + D1 + Workers AI ([11_DECISIONS.md](11_DECISIONS.md)).
- Mode mock (`localStorage`) hanya untuk pengembangan lokal, dipilih dengan `VITE_USE_MOCK=true`.
- `docs/API.md` ditulis ulang untuk kontrak `/api`.
- `docs/DATABASE_SCHEMA.md` diberi catatan "Superseded by 20_DATABASE.md (D1)".
- Bagian Tech Stack, aktivasi cloud, struktur, dan skrip di `README.md` disesuaikan dengan Cloudflare.

#### Dihapus
- Dependensi `@tencent-ai/workbuddy-cloud-sdk` dan konfigurasi `src/cloud.config.example.js` (sisa referensi lama seperti `scripts/setup.js` dan entri `.gitignore` untuk `src/cloud.config.js`: pembersihan _TBD_).

#### Diketahui / Belum Selesai
- OTP belum dikirim lewat email; hanya mode demo (R-001, R-002).
- Formulir Permintaan mengirim `phone` yang tidak ada di skema D1 (R-015).
- Belum ada layar persetujuan penawaran (R-009).
- Belum ada rate limit per IP/LLM dan belum ada uji otomatis.

Lihat [10_RISK_REGISTER.md](10_RISK_REGISTER.md).

## [0.1.0]

Tanggal rilis: _TBD_ (riwayat git: `initial project`, `initiate main feature and fix ui design`).

### Ditambahkan
- Prototype enam tahap (Permintaan, Penawaran, Penugasan, Penyelesaian, Pembukuan, Laporan), dashboard, dan pengaturan.
- Penawaran dan penjelasan laporan berbasis AI dengan streaming dan validasi domain.
- Mode prototype dengan data di `localStorage`.
- Desain awal untuk WorkBuddy Cloud SDK/PostgreSQL (`docs/API.md`, `docs/DATABASE_SCHEMA.md`).

### Changed

- Desain ulang total ke Design System v2 "Tumbuh" (krem, hijau hutan, aksen kunyit; Instrument Serif + Plus Jakarta Sans). Spesifikasi: [specs/2026-10-28-design-system-v2-design.md](specs/2026-10-28-design-system-v2-design.md).
- Landing page baru (`#/`) dengan scene Three.js 6 pilar tumbuh (benih kunyit melompat antar tahap), pricing 3 paket (Sole Trader, UKM, Enterprise — harga draf), FAQ, dan demo agen AI.
- Halaman login baru (`#/masuk`) dengan OTP 6 kotak dan scene Three.js; dashboard dan semua tahap didesain ulang dengan metrik yang dihitung dari data (tanpa angka tren palsu).
- Logo baru: satu garis bertangga naik dengan titik kunyit (menggantikan bentuk S).
- Routing hash: `#/` landing, `#/masuk` login, `#/app` aplikasi.
- Semua dropdown kini memakai combobox dengan pencarian (`src/ui/combobox.js`): ketik untuk menyaring, sorotan teks cocok, navigasi keyboard, tetap memakai `<select>` asli sebagai sumber nilai.

- Grup "Pertumbuhan" di sidebar: **Media sosial** (konten, jadwal, ide, iklan Meta, kolaborasi, pustaka) dan **Penasihat AI** (5 agen + routing otomatis, snapshot bisnis dari data asli, kalkulator target pertumbuhan, memori di D1). Diport selektif dari PR #3 (maszulfikarsuweleh/satu-alur); fitur dengan angka karangan tidak dibawa. Migrasi `0003_growth_tools.sql`.
- Form tahap menjadi wizard 2–3 langkah (`C.wizard`) sehingga muat dalam satu layar.
- Data demo 9 bisnis (3 Sole Trader, 3 UKM, 3 Enterprise) selama 12 bulan dengan target pertumbuhan dan musiman Indonesia: `scripts/seed-demo.mjs`, `seeds/`, [specs/2026-10-28-demo-growth-data-design.md](specs/2026-10-28-demo-growth-data-design.md); analisis kecukupan form: [specs/2026-10-28-form-data-sufficiency-review.md](specs/2026-10-28-form-data-sufficiency-review.md).

- Halaman login punya dua mode: **Live** (email + OTP) dan **Akun demo** (pilih skala dan bisnis dari dropdown yang bisa dicari, masuk tanpa OTP lewat `POST /api/auth/demo-login`, hanya untuk 9 email demo; nonaktifkan dengan `DEMO_LOGIN="false"`). Tautan langsung: `#/masuk?demo`.

- **Radar peluang**: peluang dihitung dari transaksi asli (layanan berulang jatuh tempo, risiko churn, upsell kontrak, cross-sell, penawaran tertunda, tawarkan ulang, musiman) dengan skor transparan dan bukti; migrasi `0005_opportunity_states.sql`.
- **Pencari prospek** (MVP B2B): titik + radius + kriteria di peta OpenStreetMap (Google Places opsional lewat secret), ranking AI, estimasi nilai dari rata-rata pekerjaan asli, draf penawaran ke alur; migrasi `0006_leads.sql`. Tidak ada pengiriman otomatis.
- Pagination (`C.pager`/`C.paginate`) di semua daftar panjang; Penasihat AI muat satu layar (pemilih penasihat di header chat, panel bertab Snapshot/Kalkulator/Statistik).
- Label "Laba bersih" menjadi "Laba sebelum pajak".
- Test suite: `npm test` (unit + e2e), master test case, `docs/ENVIRONMENTS.md`, `docs/DEMO_SCRIPT.md`; generator seed dengan lapisan makro (riil vs nominal, inflasi, upah, pajak).

### Fixed

- Pencari prospek: server Overpass publik timeout dari Cloudflare; kini mencoba mirror lalu otomatis memakai cadangan Nominatim (dibatasi kotak radius), dengan jeda 5 menit sebelum mencoba Overpass lagi.
- Ranking AI prospek diputus (502) karena JSON mode tidak streaming; Worker kini membuka SSE segera dan mengirim keep-alive selama model bekerja; batch ranking 25 prospek.

- Hemat kuota D1: paging data memakai keyset (`id > last`) sehingga D1 hanya membaca baris yang dikirim (sebelumnya OFFSET/sort membaca 3–6× lebih banyak); migrasi `0004_drop_unused_fk_indexes.sql` menghapus 4 indeks relasi yang tidak dipakai query sehingga setiap insert hanya 2 tulisan (sebelumnya 3).

- Error D1 "daily row write limit" (paket Free) kini dikembalikan sebagai 503 dengan pesan jelas, bukan 500 generik.

- Data hanya memuat 1.000 baris terbaru per tabel sehingga total dashboard dan "Perlu tindakan" salah untuk akun besar; kini dimuat per halaman.
- Penawaran berstatus `rejected` dihitung sebagai draf; kini tampil "Ditolak" dan tidak masuk antrean.
- "Pelanggan teratas" di laporan dikelompokkan per pelanggan (bukan per permintaan); `period_start/end` laporan memakai tanggal lokal.
- Aksi AI yang diklik sebelum daftar model termuat kini menunggu, bukan gagal.

- Penawaran AI sering gagal "bukan JSON yang valid": Worker kini memakai JSON mode Workers AI dengan skema (`scope`, `price`, `terms`, `notes`) lalu mengalirkan hasilnya sebagai SSE; klien memakai parser toleran yang memperbaiki key tanpa kutip penutup, code fence, dan koma berlebih, serta membuang key di luar skema.
- Pratinjau permintaan di tahap Penawaran menampilkan nomor telepon sebagai lokasi.

- Deploy pertama ke Cloudflare (https://satu-alur.apipedia.workers.dev, D1 `satu-alur-db` 085c9a7a-64c5-4ced-b0f3-3158870d64f4).
- Form Permintaan mengirim kolom `phone` yang tidak ada di skema: ditambahkan kolom `phone` (migrasi `0002_requests_phone.sql`) dan whitelist Worker.
- Penawaran yang disimpan kini berstatus `approved` agar muncul di tahap Penugasan (sebelumnya `draft`, alur terhenti).
