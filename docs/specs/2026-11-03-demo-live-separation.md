# Pemisahan Akun Demo dan Akun Live

> Status: Draft
> Terakhir diperbarui: 2026-11-03
> Pemilik: _TBD_

## Aturan

- **Akun demo** (9 akun `demo-*@satualur.id`, masuk lewat tab "Akun demo") sepenuhnya demo: data contoh, peta dan prospek contoh, tanpa memanggil sumber data luar.
- **Akun live** (masuk dengan email) 100% memakai datanya sendiri. Akun baru mulai kosong, tanpa baris contoh atau angka buatan.
- Satu-satunya daftar akun demo ada di `worker/demo.js` (`DEMO_EMAILS`, `isDemoUser`). Klien memakai `src/auth/demo-accounts.js` (`isDemoEmail`); unit test memastikan keduanya sama.

## Hasil audit

| Area | Akun demo | Akun live | Diverifikasi dengan |
|------|-----------|-----------|---------------------|
| `/api/db` (13 tabel alur, sosial, AI, prospek) | Data contoh milik akun demo itu | Hanya baris `owner_id` sendiri; akun baru 0 baris | Worker lokal + D1 baru: akun OTP baru membaca 0 baris di 14 tabel (requests … workers) |
| Pencari prospek: cari | Usaha fiktif di sekitar titik, deterministik per akun, alamat "(contoh)", telepon `0812-0000-xxxx`, `source: demo` | OpenStreetMap (Overpass, cadangan Nominatim) atau Google Places | Unit test: fetch palsu menghitung **0** panggilan untuk akun demo; worker lokal: log tanpa Overpass/Nominatim |
| Pencari prospek: cari alamat | Gazetir offline 34 kota/area Indonesia, label "(contoh)" | Nominatim | Unit test (`demoGeocode`), worker lokal (`q=Medan`) |
| Pencari prospek: cache | Tidak memakai dan tidak mengisi cache | Cache per titik/radius/kata kunci (data publik) | Kode: cabang demo kembali sebelum cache |
| Pencari prospek: tampilan | Catatan "Data contoh (akun demo)", tag "contoh" di tiap kartu | Tanpa label demo | E2E `demo-live` |
| Halaman Pertumbuhan | Isi contoh tetap (peluang, notifikasi, prediksi, jawaban asisten), kini diberi label "Data contoh (akun demo)" | **Diperbaiki:** sebelumnya isi contoh yang sama tampil ke semua akun. Kini akun live melihat arahan ke Radar peluang, Pencari prospek, dan Penasihat AI yang dihitung dari datanya sendiri | E2E `demo-live` (akun live tidak melihat "Hotel Horizon" dan sejenisnya) |
| AI Superpowers (riwayat chat, statistik) | Per akun | **Diperbaiki:** sebelumnya disimpan per perangkat, sehingga chat sesi demo terlihat oleh akun live di browser yang sama. Kini per akun (`setOwner` dari shell) dan kunci lama dihapus | Unit test (`legacy-ai-integration`): akun lain melihat riwayat dan statistik kosong |
| Penasihat AI (riwayat) | Per akun | Per akun (`satualur_advisor_v1:<uid>`) | Kode |
| Ruang optimasi VAS / Tanpa limbah | Per akun | Per akun (`<uid>:<scope>`) | Kode |
| Riwayat Pencari prospek | Per akun | Per akun (`satualur_leads_v1:<uid>`) | Kode, e2e `leads` |
| Ringkasan, Radar, Penasihat (snapshot), Laporan | Dihitung dari data demo | Dihitung dari data sendiri; kosong menampilkan keadaan kosong | Worker lokal: semua tabel 0 baris untuk akun baru |
| Kuota AI | Tidak dibatasi, tetap dihitung | Paket Free (trial) bila belum berlangganan | Worker lokal: `/api/me/plan` → `free`, `demo: false`, terpakai 0 |
| Kantor Satu Alur (admin) | Ditolak | Ditolak kecuali staf/admin | Worker lokal: "Khusus tim Satu Alur." |
| Data contoh Kantor (`seeds/office.sql`) | — | 4 pengguna fiktif `@contoh.satualur.id` dan baris `customer_accounts` hanya muncul di daftar admin, tidak pernah di data bisnis mana pun (semua bacaan bisnis disaring `owner_id`) | Kode |
| AI di akun demo | Dibuat simulasi oleh cabang lain (`claude/admin-system`) | Model sungguhan | — |
| Mode mock (pengembangan lokal) | Data contoh tanpa pemilik, terlihat oleh semua akun mock | Sama (khusus `npm run dev`, tidak pernah di production) | Disengaja untuk e2e |

## Tindak lanjut (di luar cabang ini)

- **Pengaturan di browser:** prompt agen (`satualur_settings_agent`) dan pengaturan WhatsApp/SMTP lama (`satualur_settings_mcp`) masih disimpan per perangkat. Bagian ini sedang dipindah ke server oleh cabang `claude/repliz-wapilot` dan `claude/admin-system`; setelah itu tidak ada lagi data bisnis yang tersimpan per perangkat.
- **Daftar pengguna di Kantor:** beri tanda "contoh" untuk email `@contoh.satualur.id` dan "demo" untuk 9 akun demo, supaya admin tidak mengira itu pelanggan sungguhan.
