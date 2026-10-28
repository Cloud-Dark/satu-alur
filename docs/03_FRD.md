# Functional Requirements Document (FRD)

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Dokumen ini diturunkan dari kode di `src/stages/`, `src/auth/`, `src/domain/`, dan `src/ai/`. Kebutuhan teknis ada di [04_TRD.md](04_TRD.md). Pengujian penerimaan di [uat/2026-10-28_cloudflare-deploy-uat.md](uat/2026-10-28_cloudflare-deploy-uat.md).

Prioritas: M = wajib, S = sebaiknya, C = opsional.

## Autentikasi

### FR-001 Login email OTP (M)

Pengguna masuk dengan email dan kode OTP.

Kriteria penerimaan:
- Memasukkan email valid lalu meminta kode memanggil `POST /api/auth/send-otp`.
- Memasukkan kode benar memanggil `POST /api/auth/verify-otp` dan menghasilkan sesi; aplikasi menampilkan alur utama.
- Kode salah atau kedaluwarsa menampilkan pesan error berbahasa Indonesia dan tidak membuat sesi.
- Meminta kode verifikasi tanpa permintaan kode sebelumnya untuk email yang sama ditolak (`auth.js`: "Minta kode OTP untuk email ini terlebih dahulu").
- Pada mode demo (`DEMO_OTP=true`) kode OTP dikembalikan di field `demoCode` pada respons dan ditampilkan ke pengguna; pada mode non-demo kode tidak boleh ada di respons.
- Kode kedaluwarsa setelah 10 menit, dibatasi 5 percobaan, dan sekali pakai; lebih dari 5 permintaan kode per email dalam 10 menit ditolak (429).

### FR-002 Sesi (M)

Kriteria penerimaan:
- Setelah login, token bearer disimpan di klien dan dikirim pada setiap permintaan `/api/*` yang memerlukan autentikasi.
- Membuka ulang aplikasi memanggil `GET /api/auth/session` dan memulihkan sesi bila token masih valid.
- Token yang tidak valid atau kedaluwarsa menghasilkan 401 dan pengguna diarahkan ke layar login.
- Masa berlaku sesi 30 hari.

### FR-003 Keluar (M)

Kriteria penerimaan:
- Tombol keluar memanggil `POST /api/auth/signout`; token tidak dapat dipakai lagi setelahnya.
- Klien menghapus token lokal dan menampilkan layar login.

## Tahap Alur

### FR-010 Permintaan (M)

Sumber: `src/stages/request.js`.

Kriteria penerimaan:
- Formulir: Nama Pelanggan (wajib), Jenis Layanan (wajib), Lokasi, Nomor Telepon, Deskripsi Kebutuhan.
- Simpan berhasil menampilkan pesan sukses dan toast, mengosongkan formulir, dan memuat ulang daftar.
- Daftar diurutkan terbaru lebih dulu dan hanya berisi data milik pengguna login.
- Daftar kosong menampilkan pesan ajakan membuat permintaan pertama.
- Catatan (temuan): formulir mengirim field `phone`, sedangkan tabel `requests` dan whitelist Worker tidak memiliki kolom `phone`. Worker menolak kolom tak dikenal dengan 400 (`Kolom tidak dikenal: phone`), sehingga simpan permintaan dapat gagal di mode Cloudflare sampai field dihapus dari formulir atau kolom ditambahkan lewat migrasi. Lihat R-015 di [10_RISK_REGISTER.md](10_RISK_REGISTER.md).

### FR-011 Penawaran AI (M)

Sumber: `src/stages/offer.js`, `src/ai/agent.js`, `src/domain/rules.js`.

Kriteria penerimaan:
- Pengguna memilih satu permintaan dan menekan tombol hasilkan; AI dipanggil lewat `POST /api/llm/chat` dengan streaming (SSE).
- Teks dari AI tampil bertahap; tombol Batal menghentikan stream dan menampilkan "Dibatalkan".
- Hasil harus JSON dengan `scope`, `price`, `terms`, `notes`; bila bukan JSON valid, tampil error "Respons AI bukan JSON yang valid".
- Validasi domain: harga antara Rp10.000 dan Rp1.000.000.000; `scope` dan `terms` minimal 10 karakter. Hasil tidak valid menampilkan daftar kesalahan.
- Menekan Simpan membuat baris `offers` berstatus `draft` dengan `ai_proposal_json`, `validated_price`, `validated_scope`.
- Bila tidak ada model tersedia, tampil "Model AI tidak tersedia".
- Daftar model berasal dari `GET /api/llm/models`; model pertama dipakai sebagai bawaan.

### FR-012 Persetujuan penawaran (S)

Kriteria penerimaan:
- Transisi status penawaran mengikuti `OfferTransitions`: `draft -> pending_approval -> approved | rejected`.
- Antarmuka untuk mengubah status: belum ada di kode saat ini (_TBD_, lihat R-009 di [10_RISK_REGISTER.md](10_RISK_REGISTER.md)).

### FR-013 Penugasan (M)

Sumber: `src/stages/assign.js`.

Kriteria penerimaan:
- Pilihan penawaran hanya memuat penawaran berstatus `approved`.
- Nama Pekerja dan Jadwal Pelaksanaan wajib diisi.
- Simpan membuat `assignments` dengan status `assigned`.
- Daftar penugasan menampilkan badge status.

### FR-014 Penyelesaian (M)

Sumber: `src/stages/complete.js`.

Kriteria penerimaan:
- Pilihan penugasan hanya memuat penugasan berstatus `assigned`.
- Simpan membuat `completions` berstatus `done` dengan catatan hasil pekerjaan.
- Penugasan terkait diperbarui menjadi `done`; penugasan tersebut tidak muncul lagi di pilihan.

### FR-015 Pembukuan (M)

Sumber: `src/stages/bookkeeping.js`.

Kriteria penerimaan:
- Pilihan penyelesaian hanya memuat `completions` berstatus `done`.
- Input: Jumlah (Rp) dan Kategori wajib. Kategori: `pendapatan`, `biaya_tenaga`, `biaya_bahan`, `biaya_transport`, `biaya_lain`.
- Simpan membuat `ledger_entries` berstatus `posted` dengan `posted_at`.
- Ringkasan menampilkan Total Pendapatan, Total Biaya, dan Laba/Rugi; entri `pendapatan` dihitung sebagai pendapatan, kategori lain sebagai biaya.

### FR-016 Laporan dan penjelasan AI (M)

Sumber: `src/stages/report.js`.

Kriteria penerimaan:
- Ringkasan (periode, total pendapatan, total biaya, laba bersih) dihitung dari `ledger_entries` milik pengguna.
- Tombol "Jelaskan dengan AI" memanggil `POST /api/llm/chat` (streaming); keluaran HTML ditampilkan bertahap.
- Tombol Batal menghentikan stream.
- Penyimpanan laporan ke tabel `reports`: belum dilakukan UI (_TBD_).
- Keluaran AI berupa HTML; kebijakan sanitasi sebelum ditampilkan `_TBD_` (lihat [10_RISK_REGISTER.md](10_RISK_REGISTER.md) R-010).

### FR-017 Dashboard (S)

Sumber: `src/stages/dashboard.js`.

Kriteria penerimaan:
- Menampilkan ringkasan jumlah per tahap (mis. penawaran disetujui) dan aktivitas terbaru dari data pengguna.

## Pengaturan

### FR-020 Pengaturan (S)

Sumber: `src/stages/settings.js`.

Kriteria penerimaan:
- Tab MCP Connectors (WhatsApp/WAPilot, Email SMTP), Agent Skills (prompt penawaran dan laporan, temperature, max tokens, preferensi model), dan tab Cloud.
- Tab Cloud menampilkan status mode (Cloudflare Worker + D1 atau mock lokal) tanpa konfigurasi tambahan di peramban.
- Nilai pengaturan disimpan di `localStorage` peramban dan dipakai oleh `src/ai/agent.js`.
- Kredensial SMTP/API key di `localStorage` tidak dikirim ke Worker (lihat R-011).

## Lintas Fitur

### FR-030 Isolasi data (M)

Kriteria penerimaan:
- Semua operasi `/api/db` hanya melihat dan mengubah baris dengan `owner_id` = pengguna login, tanpa bergantung pada filter dari klien.
- Pengguna B tidak dapat membaca, mengubah, atau menghapus baris pengguna A, termasuk dengan menebak `id`.
- `owner_id` yang dikirim klien pada `values`/`changes` diabaikan atau ditolak.

### FR-031 Mode mock (S)

Kriteria penerimaan:
- Dengan `VITE_USE_MOCK=true` (atau `satualur_use_mock=1` di localStorage pada mode dev; lihat [16_CONFIG_REFERENCE.md](16_CONFIG_REFERENCE.md)) seluruh enam tahap berjalan tanpa Worker, memakai `localStorage` dan data contoh.
- Mode mock tidak dipakai pada build deploy produksi.

### FR-032 Penanganan error (M)

Kriteria penerimaan:
- Kegagalan jaringan atau error server tampil sebagai pesan berbahasa Indonesia di area terkait tanpa merusak halaman.
- Respons error API memakai bentuk yang didokumentasikan di [API.md](API.md).
