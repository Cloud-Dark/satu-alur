# Daftar Induk Test Case Satu Alur

> Status: Draft
> Terakhir diperbarui: 2026-10-29
> Pemilik: _TBD_

Daftar induk test case manual untuk seluruh fitur Satu Alur, dikelompokkan per modul supaya bisa dikerjakan paralel oleh beberapa penguji. Setiap baris bisa langsung dieksekusi. Kolom **Otomatis?** menautkan ke spesifikasi e2e atau unit test yang mencakup kasus yang sama. "Manual" berarti belum ada otomasinya.

Referensi: kebutuhan fungsional [03_FRD.md](../03_FRD.md) (FR-xxx), skenario pertumbuhan [specs/2026-10-28-form-data-sufficiency-review.md](../specs/2026-10-28-form-data-sufficiency-review.md) §7 (Q1–Q14, M1–M7, A1–A6), risiko [10_RISK_REGISTER.md](../10_RISK_REGISTER.md) (R-xxx), UAT deploy [2026-10-28_cloudflare-deploy-uat.md](2026-10-28_cloudflare-deploy-uat.md), lingkungan dan akun [ENVIRONMENTS.md](../ENVIRONMENTS.md).

## 1. Cara memakai dokumen ini

1. Pilih modul, lalu isi kolom **Status** dengan `LULUS`, `GAGAL`, `BLOKIR`, atau biarkan `_PENDING_`. Status hanya boleh diubah setelah langkahnya benar-benar dijalankan.
2. Kalau hasilnya GAGAL, tulis nomor bug atau ringkasannya di **Catatan**, lalu tambahkan bukti (tangkapan layar atau URL) ke tabel [Temuan](#23-temuan).
3. Prioritas: **P1** = alur inti atau keamanan, wajib lulus sebelum demo atau rilis. **P2** = fitur penting. **P3** = kosmetik atau kasus tepi.
4. Untuk modul yang menyimpan data di produksi, gunakan **akun uji sendiri** (mode Live) atau akun demo. Ingat bahwa setiap simpan memakai kuota tulis D1 (lihat [ENVIRONMENTS.md](../ENVIRONMENTS.md#batas-paket-gratis)).

### Lingkungan uji (kolom Prasyarat)

| Kode | Arti |
|------|------|
| **ENV-MOCK** | Lokal: `VITE_USE_MOCK=true npm run dev`, buka `http://localhost:5173`. Data contoh ada di localStorage peramban: 8 permintaan, 7 penawaran, 6 penugasan, 4 penyelesaian, 12 jurnal. Total pendapatan Rp9.750.000, biaya Rp3.800.000, laba Rp5.950.000. AI disimulasikan. Sesi hanya di memori, jadi muat ulang halaman = keluar. Semua email melihat data mock yang sama. |
| **ENV-PROD** | Produksi `https://satu-alur.apipedia.workers.dev` (Worker + D1 + Workers AI). |
| **LIVE** | Masuk mode **Live**: email sendiri, lalu kode OTP. Selama `DEMO_OTP="true"`, kode tampil di layar. |
| **DEMO:x** | Masuk mode **Akun demo** dengan akun `demo-x@satualur.id` (data contoh 12 bulan, dipakai bersama). |
| **DATA** | Akun sudah punya data alur (permintaan sampai jurnal). |

### Ringkasan otomasi

| Jenis | Lokasi | Perintah | Hasil terakhir (2026-10-29, ENV-MOCK) |
|-------|--------|----------|---------------------------------------|
| Unit (node:test) | `tests/*.test.mjs` | `npm run test:unit` | lihat [§22](#22-hasil-otomasi-terakhir) |
| E2E (Playwright, mode mock) | `tests/e2e/*.spec.cjs` | `npm run test:e2e` | lihat [§22](#22-hasil-otomasi-terakhir) |

E2E hanya berjalan di mode mock. Jangan arahkan ke produksi karena alurnya menulis data.

## 2. Landing page (`#/`)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-LND-01 | Semua bagian tampil | ENV-MOCK/PROD, belum masuk | Buka `/`, gulir dari atas ke bawah | - | Hero, ticker, Alur kerja (`#alur`), Fitur AI (`#fitur-ai`), Ide besar (`#ide-besar`), Harga (`#harga`), FAQ (`#faq`), CTA penutup, dan footer tampil tanpa error | P1 | [landing](../../tests/e2e/landing.spec.cjs) | _PENDING_ | |
| TC-LND-02 | Navigasi anchor menjaga hash router | sama | Klik menu "Harga" di header | - | Halaman menggulir ke Harga. URL tetap `#/` (tidak menjadi `#harga`). Tautan menu "Harga" aktif. | P2 | [landing](../../tests/e2e/landing.spec.cjs) | _PENDING_ | |
| TC-LND-03 | Paket harga | sama | Lihat bagian Harga | - | Tiga paket: Sole Trader, UKM, Enterprise. Harga sesuai draf terbaru (angka harga belum final) | P2 | [landing](../../tests/e2e/landing.spec.cjs) (nama paket) | _PENDING_ | Cocokkan angka dengan keputusan bisnis |
| TC-LND-04 | FAQ buka/tutup | sama | Klik pertanyaan FAQ pertama, lalu klik lagi | - | Jawaban terbuka lalu tertutup, `aria-expanded` berganti true/false | P3 | [landing](../../tests/e2e/landing.spec.cjs) | _PENDING_ | |
| TC-LND-05 | Tombol kembali ke atas | sama | Gulir lebih dari 600 px, klik tombol panah atas | - | Tombol muncul setelah digulir. Klik menggulir ke paling atas | P3 | [landing](../../tests/e2e/landing.spec.cjs) | _PENDING_ | |
| TC-LND-06 | Ganti tema dan tersimpan | sama | Klik ikon bulan/matahari, lalu muat ulang | - | Tema berganti terang/gelap, label tombol menawarkan tema lainnya, tema tetap setelah dimuat ulang | P2 | [landing](../../tests/e2e/landing.spec.cjs) | _PENDING_ | |
| TC-LND-07 | Menu seluler | lebar 375 px | Buka menu burger, tekan Esc. Buka lagi, klik "Harga" | - | Menu terbuka dan fokus pindah ke tombol tutup. Esc menutup menu. Klik tautan menutup menu, membuka kunci gulir, menggulir ke Harga, dan hash tetap `#/` | P2 | [landing](../../tests/e2e/landing.spec.cjs) | _PENDING_ | |
| TC-LND-08 | CTA ke login | sama | Klik "Masuk", lalu "Kembali ke beranda" | - | Halaman pindah ke `#/masuk`. Kembali ke landing tanpa elemen ganda | P1 | [landing](../../tests/e2e/landing.spec.cjs) | _PENDING_ | |
| TC-LND-09 | Sudah masuk: CTA berubah | sudah masuk | Buka `#/` | - | Tombol berbunyi "Buka Dashboard" dan menuju `#/app` | P3 | Manual | _PENDING_ | |
| TC-LND-10 | Demo agen AI dan animasi 3D | desktop | Gulir ke Fitur AI. Ulangi dengan "kurangi gerakan" OS aktif | - | Demo agen "mengetik". Dengan reduced motion, animasi berhenti atau statis tanpa error. Tanpa WebGL tampil gambar pengganti | P3 | Manual | _PENDING_ | |

## 3. Login mode Live (email + OTP)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-LIV-01 | Validasi email | `#/masuk` | Klik "Kirim kode" tanpa email, lalu isi format salah | kosong, `bukan-email` | Pesan "Isi alamat email…" lalu "Format email belum benar…", `aria-invalid=true`. Pesan hilang setelah email valid diketik | P2 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | FR-001 |
| TC-LIV-02 | Kirim kode | sama | Isi email, tekan Enter | `uji+a@example.com` | Langkah 2 tampil dengan email tujuan. Kotak digit pertama terfokus. Mode demo menampilkan kode 6 digit dan tombol "Isi otomatis" | P1 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | FR-001. Di produksi hanya selama `DEMO_OTP="true"` (R-001) |
| TC-LIV-03 | Kode salah | langkah 2 | Ketik 6 digit yang salah | kode +1 per digit | Pesan merah "Kode OTP salah…", semua kotak dikosongkan, tetap di `#/masuk` | P1 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | FR-001 |
| TC-LIV-04 | Kode benar masuk ke aplikasi | langkah 2 | Klik "Isi otomatis" atau ketik kode | kode tampil | Otomatis masuk ke `#/app`. Ringkasan tampil dan email muncul di sidebar | P1 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | FR-001 |
| TC-LIV-05 | Kotak digit: Backspace, panah, tempel | langkah 2 | Ketik 2 digit, tekan Backspace 2×. Tempel "9 8 7". Tekan panah kiri | - | Backspace mundur ke kotak 1. Tempel mengisi 3 kotak dan fokus ke kotak 4. Panah memindahkan fokus | P3 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | |
| TC-LIV-06 | Hitung mundur kirim ulang | langkah 2 | Tunggu 30 detik, klik "Kirim ulang kode" | - | Tombol nonaktif dengan "Kirim ulang dalam 0:30…0:01", lalu aktif. Kode baru terkirim dengan pesan "Kode baru terkirim." dan hitung mundur mulai lagi | P2 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | |
| TC-LIV-07 | Ganti email | langkah 2 | Klik "Ganti email" | - | Kembali ke langkah 1 dengan email lama masih terisi | P3 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | |
| TC-LIV-08 | Kode sekali pakai dan kedaluwarsa | ENV-PROD | Pakai kode yang sama dua kali. Tunggu lebih dari 10 menit lalu pakai kode | - | Kedua percobaan ditolak dengan pesan Indonesia | P1 | Unit: [ai-integration](../../tests/ai-integration.test.mjs) (sekali pakai, mock) | _PENDING_ | FR-001, UAT-01 |
| TC-LIV-09 | Batas percobaan dan pengiriman | ENV-PROD | Masukkan kode salah 6×. Minta kode 6× dalam 10 menit | - | Setelah 5 percobaan kode tidak berlaku. Permintaan ke-6 ditolak (429) dengan pesan jelas | P2 | Manual | _PENDING_ | FR-001, R-012. Memakai kuota tulis |
| TC-LIV-10 | Sesi bertahan setelah muat ulang | ENV-PROD, LIVE | Masuk, lalu muat ulang halaman | - | Tetap di `#/app` tanpa login ulang. Di ENV-MOCK sesi hilang, dan itu memang perilaku yang diharapkan | P1 | Unit: [http-cloud](../../tests/http-cloud.test.mjs) (token) | _PENDING_ | FR-002 |
| TC-LIV-11 | Keluar | masuk | Klik ikon "Keluar" di sidebar, lalu buka `#/app` | - | Kembali ke landing. `#/app` dialihkan ke `#/masuk`. Token lama ditolak 401 | P1 | [login-live](../../tests/e2e/login-live.spec.cjs) | _PENDING_ | FR-003, UAT-09 |
| TC-LIV-12 | Email akun baru dan lama | ENV-PROD | Kirim kode untuk email baru, lalu untuk email yang sudah pernah masuk | - | Pesan "Akun baru akan dibuat setelah verifikasi" vs "Selamat datang kembali" | P3 | Manual | _PENDING_ | |

## 4. Login mode Akun demo

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-DEM-01 | Pindah mode | `#/masuk` | Klik tab "Akun demo". Pakai panah kiri/kanan di tab | - | Formulir demo tampil dan panel Live tersembunyi. Panah berpindah mode. Peringatan "Akun demo dipakai bersama…" tampil | P2 | [login-demo](../../tests/e2e/login-demo.spec.cjs) | _PENDING_ | |
| TC-DEM-02 | Pilih skala | mode demo | Buka dropdown "Skala bisnis" | - | Tiga pilihan: Sole Trader, UKM, Enterprise | P2 | [login-demo](../../tests/e2e/login-demo.spec.cjs) | _PENDING_ | |
| TC-DEM-03 | Daftar akun mengikuti skala | mode demo | Pilih Enterprise, buka "Akun demo", lalu ganti ke Sole Trader | - | Enterprise: PT Arunika, PT Prima Layanan Fasilitas, PT Sehat Bersih Medika. Sole: Budi Santoso (AC), Rapi Bersih, Listrik Siaga | P2 | [login-demo](../../tests/e2e/login-demo.spec.cjs) | _PENDING_ | |
| TC-DEM-04 | Cari akun | mode demo | Ketik "fasilitas", tekan Enter | - | Hanya PT Prima Layanan Fasilitas yang tersisa, teks yang cocok disorot, dan pilihan tersimpan | P3 | [login-demo](../../tests/e2e/login-demo.spec.cjs) | _PENDING_ | |
| TC-DEM-05 | Kartu pratinjau | mode demo | Pilih akun | demo-fm | Kartu menampilkan nama, industri · kota ("9 wilayah"), email, dan target ("Target tumbuh 5–10% per bulan"; Sole/UKM 1–2%) | P3 | [login-demo](../../tests/e2e/login-demo.spec.cjs) | _PENDING_ | |
| TC-DEM-06 | Masuk ke mode demo | ENV-PROD | Klik "Masuk ke mode demo" untuk tiap akun dari 9 akun | 9 email ([ENVIRONMENTS](../ENVIRONMENTS.md#akun-demo)) | Masuk tanpa OTP. Sidebar menampilkan email demo. Ringkasan berisi data 12 bulan (bukan data mock 8 permintaan) | P1 | [login-demo](../../tests/e2e/login-demo.spec.cjs) (mock) | _PENDING_ | Di produksi bisa muncul "Data akun demo belum dimuat." (404) bila seed belum ada |
| TC-DEM-07 | Tautan langsung `#/masuk?demo` | belum masuk | Buka `#/masuk?demo` | - | Halaman login langsung terbuka di mode Akun demo | P3 | [login-demo](../../tests/e2e/login-demo.spec.cjs) (KNOWN-BUG) | _PENDING_ | **BUG-01**: terbuka di mode Live |
| TC-DEM-08 | Mode demo dinonaktifkan | ENV-PROD dengan `DEMO_LOGIN="false"` | Coba masuk mode demo | - | Pesan "Mode demo tidak aktif." (403) | P3 | Unit: [http-cloud](../../tests/http-cloud.test.mjs) | _PENDING_ | Hanya bila var diubah |
| TC-DEM-09 | Email demo wajib dari daftar | ENV-PROD | `POST /api/auth/demo-login` dengan email lain | `x@y.z` | 400 "Akun demo tidak dikenal." | P2 | Unit: [demo-accounts](../../tests/demo-accounts.test.mjs) (daftar sinkron dengan Worker) | _PENDING_ | |

## 5. Ringkasan (Dashboard)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-DSH-01 | KPI dari data mock | ENV-MOCK, data contoh baru | Masuk, lihat 4 KPI | seed mock | Laba sebelum pajak Rp5.950.000 (margin ±61%), Pendapatan Rp9.750.000, Biaya Rp3.800.000, Tingkat penyelesaian 67% ("4 dari 6 penugasan selesai") | P1 | [dashboard](../../tests/e2e/dashboard.spec.cjs) | _PENDING_ | FR-017 |
| TC-DSH-02 | KPI = buku besar | ENV-PROD, DEMO:ac | Bandingkan KPI Ringkasan dengan Laporan → "Semua" | - | Pendapatan, biaya, dan laba sama persis | P1 | Unit: [data](../../tests/data.test.mjs) (`totals`) | _PENDING_ | A1 sudah diperbaiki (paging) |
| TC-DSH-03 | Alur kerja (funnel) | ENV-MOCK | Lihat panel "Alur kerja" | seed mock | Permintaan 8, Penawaran 7, Penugasan 6, Penyelesaian 4, Pembukuan 12. Klik baris membuka tahapnya | P2 | [dashboard](../../tests/e2e/dashboard.spec.cjs) | _PENDING_ | |
| TC-DSH-04 | Perlu tindakan | DATA | Lihat "Perlu tindakan", klik salah satu tombol | - | Daftar berisi permintaan tanpa penawaran, draf, disetujui belum ditugaskan, dan penugasan aktif. Penawaran **ditolak** tidak masuk daftar. Tombol membuka tahap yang tepat | P2 | Unit: [data](../../tests/data.test.mjs) (antrean) | _PENDING_ | A2 sudah diperbaiki |
| TC-DSH-05 | Grafik pendapatan vs biaya | DATA | Ganti rentang grafik, arahkan kursor ke grafik | - | Grafik berganti rentang. Tooltip menampilkan tanggal, pendapatan, biaya, laba hari itu, dan akumulasi | P2 | [dashboard](../../tests/e2e/dashboard.spec.cjs) (ganti rentang) | _PENDING_ | |
| TC-DSH-06 | Akun kosong | LIVE akun baru | Masuk dengan email yang belum punya data | - | Tampil "Alur Anda masih kosong" dengan langkah mulai, tanpa angka palsu | P2 | [dashboard](../../tests/e2e/dashboard.spec.cjs) | _PENDING_ | |
| TC-DSH-07 | Baris sinkron | sama | Lihat kanan atas | - | ENV-MOCK: "Mode demo · data lokal". ENV-PROD: "Terhubung · Cloudflare D1 · sinkron hh.mm" | P3 | [dashboard](../../tests/e2e/dashboard.spec.cjs) (mock) | _PENDING_ | |
| TC-DSH-08 | Kinerja akun besar | ENV-PROD, DEMO:rs | Ukur waktu Ringkasan sampai angka tampil | - | Selesai dimuat dalam ≤ 5 detik di koneksi kantor. Catat waktunya | P2 | Manual | _PENDING_ | Data ±3.000 jurnal |

## 6. Permintaan (tahap 01)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-REQ-01 | Wizard 3 langkah | masuk | Buka 01 Permintaan | - | Langkah "Pelanggan" → "Kebutuhan" → "Tinjau" | P2 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | FR-010 |
| TC-REQ-02 | Validasi wajib | langkah 1 | Klik Lanjut tanpa nama | - | Pesan error di bawah field dan fokus pindah ke "Nama pelanggan" | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | |
| TC-REQ-03 | Simpan permintaan lengkap | langkah 1–3 | Isi semua field, tekan Enter di langkah 1, Simpan di langkah 3 | Nama `CV Uji Alur`, lokasi `Bekasi`, telp `0812 7777 1234`, layanan `Servis AC kantor`, deskripsi ≥ 1 kalimat | Langkah Tinjau menampilkan semua data. Setelah disimpan muncul layar selesai + toast, dan baris baru tampil di daftar teratas | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | UAT-02. R-015 (`phone`) sudah ditangani migrasi 0002; pastikan tidak muncul "Kolom tidak dikenal: phone" |
| TC-REQ-04 | Lanjut ke penawaran | layar selesai | Klik "Buat penawaran" | - | Tahap 02 terbuka di langkah kedua dengan permintaan ini sudah terpilih | P2 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | |
| TC-REQ-05 | Data panjang dan karakter khusus | langkah 1–3 | Isi nama 120 karakter, emoji, tanda kutip, `<b>` | `Toko "Jaya" <b>X</b> 😀` | Tersimpan apa adanya dan tampil sebagai teks, tidak dirender sebagai HTML | P2 | Manual | _PENDING_ | XSS |
| TC-REQ-06 | Status di daftar | DATA | Lihat kolom status daftar permintaan | - | Baru / Draf penawaran / Ditawarkan / Ditugaskan / Selesai / Terbukukan / Ditolak sesuai data | P2 | Unit: [data](../../tests/data.test.mjs) (`requestStage`) | _PENDING_ | |

## 7. Penawaran AI (tahap 02)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-OFR-01 | Pilih permintaan | ada permintaan | Buka 02, buka dropdown Permintaan | - | Permintaan tanpa penawaran tampil lebih dulu. Yang sudah ditawarkan diberi label "(sudah ditawarkan)" | P2 | [combobox](../../tests/e2e/combobox.spec.cjs) | _PENDING_ | |
| TC-OFR-02 | Hasilkan penawaran (streaming) | permintaan terpilih | Klik "Hasilkan penawaran" | - | Konsol AI tampil dan teks mengalir bertahap. Setelah selesai, langkah Tinjau berisi ruang lingkup, harga final, ketentuan, dan catatan | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | FR-011, UAT-03. Catat model dan lama respons di produksi |
| TC-OFR-03 | Hentikan stream | streaming | Klik "Hentikan" | - | Stream berhenti dengan status "Dihentikan" dan tidak ada data tersimpan | P2 | Manual (Laporan: [flow](../../tests/e2e/flow.spec.cjs)) | _PENDING_ | |
| TC-OFR-04 | Aturan harga | langkah Tinjau | Isi harga 100, lalu 9.999, 10.000, 1.000.000.001 | angka | < Rp10.000 atau > Rp1 M: chip aturan merah dan Simpan nonaktif. Rp10.000 lulus | P1 | [flow](../../tests/e2e/flow.spec.cjs) + unit [rules](../../tests/rules.test.mjs) | _PENDING_ | FR-011 |
| TC-OFR-05 | Aturan teks | langkah Tinjau | Kosongkan ruang lingkup/ketentuan atau isi < 10 karakter | `pendek` | Simpan nonaktif dengan pesan aturan | P2 | Unit: [rules](../../tests/rules.test.mjs) | _PENDING_ | |
| TC-OFR-06 | Simpan penawaran | valid | Klik Simpan | harga 1.750.000 | Baris baru di daftar berstatus **Disetujui** dengan Rp1.750.000. JSON mentah bisa dibuka | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | Perilaku kode: langsung `approved`. FRD FR-011 masih menulis `draft`, jadi dokumen perlu diselaraskan |
| TC-OFR-07 | Setujui draf dari daftar | ada penawaran draf (data mock: Apartemen GreenView) | Klik "Setujui" di baris draf | - | Status berubah menjadi Disetujui, dan penawaran muncul di pilihan Penugasan | P2 | Manual | _PENDING_ | FR-012, R-009 sebagian tertangani |
| TC-OFR-08 | Respons AI bukan JSON | ENV-PROD | Ulangi beberapa kali dengan model 8B atau deskripsi aneh | deskripsi 1 kata | Bila gagal muncul "Respons AI bukan JSON yang valid. Coba lagi.", dan halaman tidak rusak | P2 | Unit: [agent](../../tests/agent.test.mjs), [ai-integration](../../tests/ai-integration.test.mjs) | _PENDING_ | R-004 |
| TC-OFR-09 | Klik sebelum model termuat | ENV-PROD, jaringan lambat | Segera klik Hasilkan setelah halaman terbuka | - | Aksi menunggu model, tidak gagal | P3 | Manual | _PENDING_ | |

## 8. Penugasan (tahap 03)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-ASG-01 | Hanya penawaran disetujui | ada draf + disetujui | Buka dropdown penawaran | - | Hanya penawaran `approved` yang tampil | P1 | Manual | _PENDING_ | FR-013 |
| TC-ASG-02 | Validasi pekerja | langkah 2 | Klik Lanjut tanpa nama pekerja | - | Pesan error di field | P2 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | |
| TC-ASG-03 | Simpan penugasan | lanjut dari 02 | Isi pekerja dan jadwal, lalu konfirmasi | `Rudi & Tim`, besok 08:00 | Baris penugasan tampil dengan status Ditugaskan dan jadwal yang benar (zona waktu lokal) | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | UAT-04 |
| TC-ASG-04 | Jadwal di masa lalu | langkah 2 | Pilih tanggal kemarin | - | Catat perilakunya (diterima/ditolak/peringatan). Belum ada aturan di FRD | P3 | Manual | _PENDING_ | |

## 9. Penyelesaian (tahap 04)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-CMP-01 | Tandai selesai | ada penugasan aktif | Isi catatan, klik "Tandai selesai" | `Delapan unit dibersihkan…` | Penyelesaian tersimpan, toast tampil, dan penugasan hilang dari pilihan | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | FR-014, UAT-05 |
| TC-CMP-02 | Lanjut ke pembukuan | layar selesai | Klik tombol lanjut | - | Tahap 05 terbuka dengan pekerjaan ini terpilih | P2 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | |

## 10. Pembukuan (tahap 05)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-BKP-01 | Jurnal pendapatan | lanjut dari 04 | Pilih kategori Pendapatan | - | Jumlah otomatis terisi dari harga penawaran (1.750.000). Setelah ditinjau dan disimpan, jurnal tampil | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | FR-015, UAT-06 |
| TC-BKP-02 | Jurnal biaya | layar selesai | "Tambah jurnal" → Biaya tenaga kerja | 250.000 | Dua jurnal untuk pelanggan yang sama. Ringkasan: pendapatan, biaya, dan laba sesuai hitungan manual | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | |
| TC-BKP-03 | Lima kategori | - | Buka dropdown kategori | - | Pendapatan, Biaya tenaga kerja, Biaya bahan / material, Biaya transportasi, Biaya lain-lain | P3 | Unit: [data](../../tests/data.test.mjs) | _PENDING_ | Celah M7 (marketing/sewa/THR belum ada) |
| TC-BKP-04 | Jumlah tidak valid | langkah entri | Isi 0, minus, huruf | `-5`, `abc` | Ditolak dengan pesan | P2 | Manual | _PENDING_ | |

## 11. Laporan AI (tahap 06)

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-RPT-01 | Periode laporan | DATA | Ganti 30 hari / Bulan ini / Bulan lalu / Semua | - | KPI, rincian kategori, dan pelanggan teratas berubah. Baris periode menampilkan pembanding | P1 | [flow](../../tests/e2e/flow.spec.cjs) ("Semua") | _PENDING_ | FR-016 |
| TC-RPT-02 | Angka = Pembukuan | setelah TC-BKP-02 | Pilih "Semua" | mock + 1 pekerjaan | Laba Rp7.450.000 (= 5.950.000 + 1.750.000 − 250.000) | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | UAT-07 |
| TC-RPT-03 | Jelaskan dengan AI | DATA | Klik "Jelaskan dengan AI" | - | Penjelasan HTML Bahasa Indonesia mengalir sampai status "Selesai". Angka di penjelasan sama dengan KPI | P1 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | Catat angka yang dikarang AI sebagai temuan |
| TC-RPT-04 | Hentikan penjelasan | streaming | Klik "Hentikan" | - | Status "Dihentikan" | P2 | [flow](../../tests/e2e/flow.spec.cjs) | _PENDING_ | |
| TC-RPT-05 | Sanitasi HTML | ENV-PROD | Ubah prompt laporan (Pengaturan) agar meminta `<script>alert(1)</script>` dan `<img onerror>` | prompt jahil | Tidak ada skrip yang berjalan. Tag berbahaya dibuang | P1 | [flow](../../tests/e2e/flow.spec.cjs) (tanpa `<script>`) | _PENDING_ | R-010 |
| TC-RPT-06 | Periode tanpa jurnal | akun kosong atau periode kosong | Pilih periode tanpa data | - | Pesan "Tidak ada jurnal di periode ini…" dan tombol AI nonaktif | P2 | Manual | _PENDING_ | |
| TC-RPT-07 | Pelanggan teratas digabung per pelanggan | DATA dengan nama sama beda huruf | Buat 2 permintaan "PT Maju" dan "pt maju" hingga terbukukan | - | Satu baris "PT Maju" dengan total gabungan | P2 | Manual | _PENDING_ | A4 sudah diperbaiki di Laporan; bandingkan dengan Penasihat (BUG-02) |
| TC-RPT-08 | Tanggal periode lokal | zona WIB | Pilih "Bulan lalu" pada tanggal 1 pukul 00.30 WIB | - | Awal periode = tanggal 1 bulan lalu (bukan tanggal terakhir bulan sebelumnya) | P3 | Unit: [data](../../tests/data.test.mjs) (`localDate`) | _PENDING_ | A5 |

## 12. Media sosial

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-SOC-01 | Tab dan keyboard | masuk | Buka Media sosial. Fokus tab, tekan panah kanan dan Home | - | Tab Konten, Jadwal, Ide, Iklan Meta, Kolaborasi, Pustaka. Panah dan Home berpindah tab | P3 | [social](../../tests/e2e/social.spec.cjs) | _PENDING_ | |
| TC-SOC-02 | Buat konten | tab Konten | Klik chip topik, pilih platform/jenis/nada, klik "Buat konten" | `Servis AC rumah` | Konten tanpa emoji dan tanpa angka performa karangan. Hashtag tampil sebagai chip dan tidak tertinggal di isi. Penghitung karakter sesuai batas platform | P1 | [social](../../tests/e2e/social.spec.cjs) + unit [ai-integration](../../tests/ai-integration.test.mjs) | _PENDING_ | |
| TC-SOC-03 | Konteks dari data nyata | DEMO:laundry | Buat konten tanpa menyebut kota | - | Konten boleh menyebut layanan/area dari data permintaan (Bandung), tanpa mengarang pelanggan | P2 | Unit: [ai-integration](../../tests/ai-integration.test.mjs) | _PENDING_ | |
| TC-SOC-04 | Simpan ke pustaka | hasil ada | Klik "Simpan ke pustaka" | - | Tombol berubah menjadi tersimpan, dan item muncul di Pustaka (tersimpan di D1, ada setelah muat ulang) | P1 | [social](../../tests/e2e/social.spec.cjs) | _PENDING_ | |
| TC-SOC-05 | Alat hashtag | tab Konten | Isi topik hashtag, klik "Buat hashtag", lalu klik satu hashtag | `cuci sofa bandung` | Hashtag diawali #, tanpa spasi, dan tidak ganda. Klik menyalin | P2 | [social](../../tests/e2e/social.spec.cjs) + unit [social-agent](../../tests/social-agent.test.mjs) | _PENDING_ | |
| TC-SOC-06 | Jadwalkan | hasil ada | Klik "Jadwalkan", lalu "Tambah ke jadwal". Tambah 1 lagi manual | besok 10:00 | Pindah ke tab Jadwal dengan isi terisi. Dua item akan datang tampil | P1 | [social](../../tests/e2e/social.spec.cjs) | _PENDING_ | Tidak ada posting otomatis ke platform |
| TC-SOC-07 | Tandai terposting dan hapus | ada jadwal | "Tandai terposting" pada satu item. "Hapus" 2× pada item lain. Lihat "Riwayat" | - | Item pindah ke riwayat. Hapus meminta klik kedua | P2 | [social](../../tests/e2e/social.spec.cjs) | _PENDING_ | |
| TC-SOC-08 | Brainstorm ide | tab Ide | Isi tema, klik "Mulai brainstorm", lalu "Simpan semua" | `Tips AC musim hujan`, 10 ide | Muncul 10 ide beragam dengan format, hook, dan konsep. Semua tersimpan ke Pustaka | P2 | [social](../../tests/e2e/social.spec.cjs) | _PENDING_ | |
| TC-SOC-09 | Rencana iklan Meta | tab Iklan Meta | Isi layanan, lokasi, anggaran, lalu klik "Susun rencana iklan" | `Cuci sofa`, `Jakarta`, 100000 | Audiens, penempatan, jam tayang, pembagian anggaran, 3 materi iklan, dan tips. **Tidak ada** estimasi jangkauan/CPM/CTR | P2 | Unit: [ai-integration](../../tests/ai-integration.test.mjs) | _PENDING_ | |
| TC-SOC-10 | Ide kolaborasi | tab Kolaborasi | Isi layanan dan area, klik "Cari ide kolaborasi", lalu simpan satu | `Cuci sofa`, `Bandung` | 5 ide berupa jenis mitra (tanpa nama merek nyata) dengan pesan ajakan | P3 | Manual | _PENDING_ | |
| TC-SOC-11 | Pustaka: filter, cari, salin, hapus | ada item | Filter "Ide", cari kata acak, "Salin", hapus | `zzzz` | Filter mempersempit daftar. Pencarian tanpa hasil menampilkan state kosong. Salin mengisi clipboard. Hapus meminta konfirmasi | P2 | [social](../../tests/e2e/social.spec.cjs) | _PENDING_ | |
| TC-SOC-12 | Hentikan | streaming | Klik Hentikan | - | Status "Dihentikan" tanpa error | P3 | [social](../../tests/e2e/social.spec.cjs) | _PENDING_ | |

## 13. Penasihat AI

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-ADV-01 | Routing otomatis | mode Otomatis | Ketik pertanyaan (lihat petunjuk rute), tekan Enter | `Bagaimana naik 2% bulan depan?` | Petunjuk menyebut "Strategi pertumbuhan". Lencana jawaban: Strategi pertumbuhan. Alasan: "Dipilih otomatis dari kata …" | P1 | [advisor](../../tests/e2e/advisor.spec.cjs) + unit [advisor](../../tests/advisor.test.mjs) | _PENDING_ | |
| TC-ADV-02 | Chip saran | - | Klik "Biaya mana yang paling bisa dihemat?" | - | Dijawab "Analis keuangan" | P2 | [advisor](../../tests/e2e/advisor.spec.cjs) | _PENDING_ | |
| TC-ADV-03 | Agen tetap | pilih "Pemasaran" | Tanya pertanyaan umum | `Apa langkah pertama?` | Dijawab Pemasaran (tidak dirutekan ulang) | P2 | [advisor](../../tests/e2e/advisor.spec.cjs) | _PENDING_ | |
| TC-ADV-04 | Jawaban berbasis angka asli | DATA | Tanya kondisi bisnis | `Ringkas kondisi bisnis saya dalam 5 poin` | Angka Rupiah sama dengan Ringkasan/Laporan dan tidak ada pelanggan/tren karangan. Ada bagian "Langkah minggu ini" | P1 | [advisor](../../tests/e2e/advisor.spec.cjs) (ada Rp) + unit [advisor-tools](../../tests/advisor-tools.test.mjs) | _PENDING_ | |
| TC-ADV-05 | Kalkulator target | - | Klik preset 1, 2, 5, 10% | - | Proyeksi berubah tiap preset. Label tingkat: 1–2% realistis UKM, 5–10% agresif enterprise | P1 | [advisor](../../tests/e2e/advisor.spec.cjs) + unit [advisor-tools](../../tests/advisor-tools.test.mjs) | _PENDING_ | 2%/bulan = 26,8%/tahun |
| TC-ADV-06 | Hentikan jawaban | streaming | Klik Hentikan | - | Jawaban ditandai dihentikan dan tetap tersimpan sebagian | P2 | [advisor](../../tests/e2e/advisor.spec.cjs) | _PENDING_ | |
| TC-ADV-07 | Hapus percakapan per agen | ada riwayat | Pilih agen, klik "Hapus" 2× | - | Hanya percakapan agen itu yang terhapus. Agen lain utuh | P2 | [advisor](../../tests/e2e/advisor.spec.cjs) | _PENDING_ | |
| TC-ADV-08 | Memori lintas perangkat | ENV-PROD, LIVE | Tanya di peramban A, buka akun yang sama di peramban B | - | Riwayat yang sama tampil (tersimpan di D1 `ai_messages`) | P2 | [advisor](../../tests/e2e/advisor.spec.cjs) (muat ulang, mock) | _PENDING_ | |
| TC-ADV-09 | Coba ulang otomatis | ENV-PROD, AI gangguan | Amati saat AI 502 | - | Satu kali coba ulang otomatis. Bila tetap gagal tampil pesan Indonesia, dan error tercatat di statistik | P3 | Unit: [ai-integration](../../tests/ai-integration.test.mjs) | _PENDING_ | |
| TC-ADV-10 | Akun tanpa data | LIVE akun baru | Tanya pertumbuhan | - | Jawaban umum yang jujur ("belum ada data") dan meminta mulai mencatat | P2 | Unit: [advisor-tools](../../tests/advisor-tools.test.mjs) | _PENDING_ | |
| TC-ADV-11 | Pelanggan teratas digabung | DATA dengan nama beda huruf | Tanya "Siapa pelanggan terbesar saya?" | `PT Maju`/`pt  maju ` | Satu pelanggan gabungan | P3 | Unit: [advisor-tools](../../tests/advisor-tools.test.mjs) (TODO) | _PENDING_ | **BUG-02** |

## 14. Radar peluang

Fitur ini masih dalam pengerjaan (`src/stages/radar.js`, `src/ai/radar-engine.js`, migrasi `0005_opportunity_states.sql`). Mesin deteksi sudah punya unit test dari tim fitur ([radar-engine.test.mjs](../../tests/radar-engine.test.mjs)). E2E saat ini hanya smoke test ([radar](../../tests/e2e/radar.spec.cjs)). E2E per kasus: **TODO**.

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-RAD-01 | Menu dan tampilan awal | masuk | Klik "Radar peluang" di grup Pertumbuhan | - | Tab Radar, Minggu ini, Rekomendasi AI, Prediksi. Kartu peluang dengan skor tampil, tanpa error | P1 | [radar](../../tests/e2e/radar.spec.cjs) (smoke) | _PENDING_ | |
| TC-RAD-02 | Jenis peluang dan bukti | DEMO:ac | Buka beberapa kartu | - | Tiap kartu punya jenis (Layanan berulang, Risiko churn, Upsell, Cross-sell, Penawaran tertunda, Tawarkan ulang, Musiman) dan bukti baris data asli (tanggal, nilai). Tidak ada angka tanpa sumber | P1 | Unit: [radar-engine](../../tests/radar-engine.test.mjs) (mesin); E2E TODO | _PENDING_ | |
| TC-RAD-03 | Layanan berulang jatuh tempo | DEMO:ac | Cari kartu "Jatuh tempo" untuk pelanggan servis AC | - | Pelanggan dengan servis terakhir ±3 bulan lalu muncul dengan perkiraan tanggal | P2 | Unit: [radar-engine](../../tests/radar-engine.test.mjs) (`due`); E2E TODO | _PENDING_ | |
| TC-RAD-04 | Filter dan urutan | ada kartu | Filter per jenis, urutkan Skor/Nilai/Terbaru | - | Daftar berubah sesuai filter/urutan, dengan paging 12 per halaman | P2 | TODO | _PENDING_ | |
| TC-RAD-05 | Tandai selesai, tunda, abaikan | ada kartu | Pakai aksi pada 3 kartu, lalu muat ulang | - | Status bertahan setelah dimuat ulang (D1 `opportunity_states`). Tunda kembali setelah 30 hari | P1 | Unit: [radar-engine](../../tests/radar-engine.test.mjs) (`applyStates`); E2E TODO | _PENDING_ | Memakai kuota tulis |
| TC-RAD-06 | Pesan tindak lanjut AI | ada kartu | Minta AI menulis pesan WhatsApp | - | Pesan Indonesia tanpa emoji, merujuk bukti kartu, dan tidak dikirim otomatis | P2 | TODO | _PENDING_ | |
| TC-RAD-07 | Akun kosong | LIVE akun baru | Buka Radar | - | State kosong yang jelas, tanpa kartu karangan | P2 | Unit: [radar-engine](../../tests/radar-engine.test.mjs) (akun kosong); E2E TODO | _PENDING_ | |
| TC-RAD-08 | Musiman | DEMO:dinding | Lihat kartu Musiman | - | Jendela Jul–Okt (kemarau) dan pra-Lebaran disebut berdasarkan riwayat | P3 | Unit: [radar-engine](../../tests/radar-engine.test.mjs) (`season`); E2E TODO | _PENDING_ | Spec §7 |

## 15. Pencari prospek

Fitur ini masih dalam pengerjaan (`src/stages/leads.js`, `src/leads/`, `worker/leads.js`, migrasi `0006_leads.sql`). Pencari prospek memakai OpenStreetMap (atau Google Places bila dikonfigurasi) dan tidak pernah mengirim pesan ke prospek. Pemetaan OSM dan skor sudah punya unit test dari tim fitur ([leads.test.mjs](../../tests/leads.test.mjs)). E2E saat ini hanya smoke test ([leads](../../tests/e2e/leads.spec.cjs)). E2E per kasus: **TODO**.

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-LDS-01 | Menu dan peta | masuk | Klik "Pencari prospek" | - | Peta tampil (bawaan Jabodetabek) dengan kontrol radius dan kriteria | P1 | [leads](../../tests/e2e/leads.spec.cjs) (smoke) | _PENDING_ | |
| TC-LDS-02 | Pilih titik: klik peta, cari alamat, lokasi saya | - | Coba tiga cara memilih titik | `Jl. Asia Afrika Bandung` | Titik berpindah. Pencarian alamat dibatasi 1 permintaan/detik (debounce). Lokasi di luar Indonesia ditolak dengan pesan | P2 | TODO | _PENDING_ | |
| TC-LDS-03 | Cari prospek | titik + radius | Pilih chip kriteria (mis. hotel, klinik), radius 5 km, klik Cari | - | Daftar usaha dengan jarak, skor, dan estimasi nilai (berdasarkan rata-rata pekerjaan + konversi akun). Penjelasan skor transparan | P1 | Unit: [leads](../../tests/leads.test.mjs) (skor, estimasi nilai); E2E TODO | _PENDING_ | |
| TC-LDS-04 | Batas radius, kata kunci, dan kuota | - | Isi radius di luar 0,5–40 km, lebih dari 8 kata kunci atau kata kunci < 2 karakter, lalu cari lebih dari 20× dalam 1 jam | - | Nilai ditolak atau dibatasi dengan pesan Indonesia. Pencarian ke-21 per jam ditolak (hasil dari cache tidak dihitung) | P3 | Unit: [leads](../../tests/leads.test.mjs) (validasi kata kunci); E2E TODO | _PENDING_ | Batas di [16_CONFIG_REFERENCE.md](../16_CONFIG_REFERENCE.md#batas--penyimpanan) |
| TC-LDS-05 | Simpan prospek dan status | ada hasil | Simpan 1 prospek, ubah status Baru → Dihubungi → Penawaran → Ditolak | - | Tersimpan di D1 `leads` dan tetap ada setelah dimuat ulang. Hasil pencarian yang tidak disimpan tidak ikut tersimpan | P1 | TODO | _PENDING_ | Memakai kuota tulis |
| TC-LDS-06 | Draf penawaran AI menjadi alur | prospek tersimpan | Buat draf penawaran AI, lalu jadikan permintaan | - | Muncul permintaan baru + draf penawaran di tahap 01/02 yang lulus aturan harga | P1 | TODO | _PENDING_ | |
| TC-LDS-07 | Tidak ada pengiriman otomatis | - | Periksa seluruh aksi | - | Tidak ada tombol yang mengirim email/WA ke prospek (MVP) | P1 | TODO | _PENDING_ | |
| TC-LDS-08 | Sumber data gagal | ENV-PROD, jaringan OSM lambat/gagal | Cari prospek | - | Pesan error Indonesia dan halaman tetap bisa dipakai | P2 | TODO | _PENDING_ | |
| TC-LDS-09 | Mode mock tanpa jaringan | ENV-MOCK | Cari prospek | - | Hasil contoh deterministik berlabel "Data contoh (mode demo)" | P3 | [leads](../../tests/e2e/leads.spec.cjs) (smoke) | _PENDING_ | |
| TC-LDS-10 | Sumber Google Places | ENV-PROD dengan `GOOGLE_PLACES_API_KEY` | Pilih sumber "Google Places" | - | Pilihan sumber hanya tampil bila secret ada. Key tidak pernah muncul di jaringan klien | P3 | TODO | _PENDING_ | |

## 16. Pengaturan

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-SET-01 | Buka/tutup drawer | masuk | Klik "Pengaturan", tekan Esc. Buka lagi, klik area gelap | - | Drawer modal terbuka dengan fokus di tombol tutup. Esc/klik scrim menutup dan fokus kembali ke "Pengaturan". Tab tidak keluar dari drawer | P2 | [settings](../../tests/e2e/settings.spec.cjs) | _PENDING_ | FR-020 |
| TC-SET-02 | Konektor | tab Konektor | Aktifkan WhatsApp, isi field, klik "Periksa konfigurasi" | data palsu | Status tersimpan di peramban. Tidak ada kredensial yang dikirim ke server | P2 | [settings](../../tests/e2e/settings.spec.cjs) (toggle) | _PENDING_ | R-011: jangan isi kredensial asli |
| TC-SET-03 | Prompt agen | tab Agen AI | Ubah prompt penawaran, tutup, buka lagi, lalu "Kembalikan default" | teks uji | Perubahan tersimpan dan dipakai di Penawaran berikutnya. Default kembali | P2 | [settings](../../tests/e2e/settings.spec.cjs) | _PENDING_ | |
| TC-SET-04 | Parameter model | tab Agen AI | Ubah temperature, maks token, preferensi model | 0.2, 1000 | Nilai tersimpan. Dropdown model berisi model dari `/api/llm/models` (produksi: 2 model Llama) | P3 | Manual | _PENDING_ | |
| TC-SET-05 | Tab Cloud | tab Cloud | Lihat status | - | ENV-MOCK: "Mock lokal…". ENV-PROD: "Cloudflare Worker + D1" | P3 | [settings](../../tests/e2e/settings.spec.cjs) (mock) | _PENDING_ | |
| TC-SET-06 | Sidebar ciut | desktop | Klik tombol ciutkan sidebar | - | Sidebar mengecil dengan ikon saja dan bisa dibuka lagi | P3 | [settings](../../tests/e2e/settings.spec.cjs) | _PENDING_ | |

## 17. Tema dan responsif

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-THM-01 | Mode gelap di semua halaman | - | Aktifkan mode gelap, buka landing, login, dan semua tahap | - | Kontras cukup, tidak ada teks hilang atau warna putih menyilaukan | P2 | Manual | _PENDING_ | |
| TC-THM-02 | Tanpa gulir horizontal | lebar 375/390, 768, 1024, 1440 | Buka semua halaman di setiap lebar | - | Tidak ada gulir horizontal | P2 | [landing](../../tests/e2e/landing.spec.cjs), [login-demo](../../tests/e2e/login-demo.spec.cjs), [settings](../../tests/e2e/settings.spec.cjs) (390) | _PENDING_ | |
| TC-THM-03 | Menu aplikasi seluler | 390 px | Klik tombol menu, pilih tahap, tekan Esc | - | Sidebar terbuka sebagai laci dan tertutup oleh Esc/pilihan | P2 | [settings](../../tests/e2e/settings.spec.cjs) | _PENDING_ | |
| TC-THM-04 | Wizard muat satu layar | 1440×900 dan 390×844 | Jalankan tiap wizard | - | Tombol utama terlihat tanpa menggulir isi wizard | P3 | Manual | _PENDING_ | |
| TC-THM-05 | Peramban | Chrome, Safari iOS, Firefox | Jalankan TC-LIV-04 dan TC-REQ-03 | - | Hasil sama di semua peramban | P2 | Manual | _PENDING_ | |

## 18. Aksesibilitas

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-A11Y-01 | Navigasi keyboard penuh | - | Selesaikan login + satu permintaan hanya dengan Tab/Enter/Spasi | - | Semua kontrol bisa dijangkau dengan cincin fokus terlihat. Tautan "Langsung ke konten" ada | P1 | Sebagian (Enter submit di [flow](../../tests/e2e/flow.spec.cjs)) | _PENDING_ | |
| TC-A11Y-02 | Dropdown pencarian (combobox) | tahap 02 | Fokus dropdown, ArrowDown, ketik, Home/End, Enter, Esc | `hotel` | Terbuka dengan fokus di kotak cari. Daftar tersaring dengan sorotan dan "N dari M pilihan". `aria-activedescendant` mengikuti. Enter memilih dan fokus kembali. Esc/klik luar menutup tanpa mengubah nilai | P2 | [combobox](../../tests/e2e/combobox.spec.cjs) | _PENDING_ | |
| TC-A11Y-03 | Pembaca layar | NVDA/VoiceOver | Dengarkan login, KPI, konsol AI | - | Label dibacakan. Pesan error dan status AI diumumkan (`aria-live`). Grafik punya tabel alternatif | P2 | Manual | _PENDING_ | |
| TC-A11Y-04 | Kurangi gerakan | OS reduced motion | Buka landing dan login | - | Animasi berhenti dan tidak ada yang berkedip | P3 | Manual (dipakai di [login-live](../../tests/e2e/login-live.spec.cjs)) | _PENDING_ | |
| TC-A11Y-05 | Zoom 200% | 1440 px | Zoom peramban 200% | - | Konten tetap terbaca tanpa terpotong | P3 | Manual | _PENDING_ | |

## 19. Keamanan dan isolasi data

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-SEC-01 | Isolasi antar akun di UI | ENV-PROD, LIVE akun A dan B | A membuat permintaan. B masuk dan memeriksa semua tahap, Media sosial, Penasihat, Radar, dan Prospek | - | B tidak melihat data A di mana pun | P1 | Manual | _PENDING_ | FR-030, UAT-08. **ENV-MOCK tidak mengisolasi** (semua email berbagi data) |
| TC-SEC-02 | Isolasi lewat API | token B | Jalankan langkah 4–5 UAT-08 (select/update/delete id milik A, insert `request_id` A, `owner_id` A) | - | Kosong / 400 "Referensi request_id tidak ditemukan." / `owner_id` diabaikan | P1 | Manual | _PENDING_ | Termasuk tabel baru `opportunity_states`, `leads` |
| TC-SEC-03 | Tanpa token | - | `POST /api/db` tanpa Authorization | - | 401 "Belum masuk." | P1 | Manual | _PENDING_ | |
| TC-SEC-04 | Akun demo dipakai bersama | DEMO:x di dua peramban | Ubah data di peramban 1 | - | Terlihat di peramban 2. Ini perilaku yang diharapkan, dan peringatannya tampil di login | P3 | Manual | _PENDING_ | Jangan isi data pribadi di akun demo |
| TC-SEC-05 | Kode OTP di respons | ENV-PROD | `POST /api/auth/send-otp` | email siapa saja | Selama `DEMO_OTP="true"`, `demoCode` ada di respons, sehingga siapa pun bisa masuk sebagai email apa pun. Catat sebagai risiko terbuka sebelum akses publik | P1 | Manual | _PENDING_ | R-001, R-002 |
| TC-SEC-06 | Kolom/tabel tak dikenal | token | `/api/db` dengan tabel `users` atau kolom asing | - | 400, dan tidak ada data pengguna lain yang bocor | P1 | Manual | _PENDING_ | R-007 |

## 20. Kuota D1 dan penanganan error

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-ERR-01 | Kuota tulis harian habis | ENV-PROD saat kuota habis (atau lokal dengan Worker yang dimodifikasi) | Simpan permintaan atau login | - | Pesan 503 "Batas penulisan harian database tercapai… pulih 00.00 UTC / 07.00 WIB", bukan "Terjadi kesalahan pada server." Data lama tetap terbaca | P1 | Unit: [http-cloud](../../tests/http-cloud.test.mjs) (pesan diteruskan), [ai-integration](../../tests/ai-integration.test.mjs) | _PENDING_ | Insiden 2026-10-28. Jangan sengaja menghabiskan kuota |
| TC-ERR-02 | Jaringan putus | DevTools offline | Simpan data / minta AI | - | Pesan Indonesia di area terkait, halaman tidak rusak, dan bisa dicoba lagi | P1 | Unit: [http-cloud](../../tests/http-cloud.test.mjs) | _PENDING_ | FR-032 |
| TC-ERR-03 | AI tidak tersedia | ENV-PROD saat AI 502 | Hasilkan penawaran / jelaskan laporan | - | "Layanan AI tidak tersedia." atau pesan gagal yang jelas. Tombol aktif lagi | P2 | Unit: [ai-integration](../../tests/ai-integration.test.mjs) | _PENDING_ | R-003 |
| TC-ERR-04 | Sesi kedaluwarsa | token lama/dihapus di D1 | Lakukan aksi apa pun | - | Diarahkan ke login dan token lokal dihapus | P2 | Unit: [http-cloud](../../tests/http-cloud.test.mjs) | _PENDING_ | FR-002 |
| TC-ERR-05 | Memuat akun besar tanpa terpotong | DEMO:rs | Bandingkan jumlah "Pembukuan" di funnel dengan jumlah jurnal di DB | - | Jumlah sama (> 1.000 baris, paging 5.000) | P2 | Unit: [ai-integration](../../tests/ai-integration.test.mjs) (paging) | _PENDING_ | A1 |
| TC-ERR-06 | Hemat kuota baca | ENV-PROD | Buka Ringkasan lalu pindah tahap dalam 15 detik | - | Tabel tidak dimuat ulang (cache 15 detik), dan setelah simpan cache dibersihkan | P3 | Unit: [ai-integration](../../tests/ai-integration.test.mjs) (cache) | _PENDING_ | |

## 21. Skenario bisnis dengan 9 akun demo

Angka kunci berasal dari `seeds/demo-lean-summary.json`. Untuk AC, Cleaning, Listrik, Pest, dan Dinding, angkanya sama dengan seed penuh. Laundry, Mall, FM, dan RS berbeda antara seed lean dan penuh, jadi pastikan dulu seed mana yang termuat di produksi (_TBD_, tanyakan ke lead). Jalankan pada **akhir Oktober 2026**: "bulan lalu" = September 2026. Pada tanggal lain angka dasar ikut bergeser. Tujuan utamanya: AI **memakai angka asli**, dan saat data memang tidak cukup, AI **mengakui keterbatasannya** (spec §4, §7).

| ID | Judul | Prasyarat | Langkah | Data uji | Hasil yang diharapkan | Prioritas | Otomatis? | Status | Catatan |
|----|-------|-----------|---------|----------|-----------------------|-----------|-----------|--------|---------|
| TC-BIZ-01 | Rencana tumbuh 1–2%/bulan demo-pest | ENV-PROD, DEMO:pest | Penasihat AI → Otomatis: "Bagaimana saya bisa tumbuh 1–2% per bulan dengan angka saya sekarang?". Klik preset 2% | - | Dirutekan ke Strategi pertumbuhan. Menyebut dasar **Rp189.950.000** (September 2026) dan MoM Agu→Sep **−4,1%** (Rp198.050.000 → Rp189.950.000). 2% = tambahan ±**Rp3.799.000** bulan depan ≈ **0,6 pekerjaan** (rata-rata ±Rp6,4 jt). 1–2% disebut realistis untuk UKM. Tidak ada pelanggan atau kanal karangan | P1 | Manual | _PENDING_ | Kalkulator: unit [advisor-tools](../../tests/advisor-tools.test.mjs) |
| TC-BIZ-02 | Musiman demo-ac di Januari | ENV-PROD, DEMO:ac | (a) Periksa Ringkasan dan Laporan. (b) Tanya Penasihat: "Kenapa Januari turun 13%?" | - | Fakta seed: Des Rp18.215.000 → Jan Rp15.895.000 (−12,7%), indeks musim 0,85 (musim hujan + libur awal tahun). **Ekspektasi saat ini:** Ringkasan (grafik 14/30 hari), Laporan (30 hari/bulan ini/bulan lalu/semua), dan snapshot penasihat (6 bulan terakhir) tidak menampilkan Januari. AI harus mengatakan data Januari tidak ada di konteksnya, tidak mengarang angka. LULUS = jujur. GAGAL = angka karangan | P1 | Manual | _PENDING_ | Celah A3 + Q1/Q14. Usulkan riwayat 12 bulan |
| TC-BIZ-03 | Kenapa Maret rugi (THR) | DEMO:pest / laundry / dinding | Tanya "Kenapa Maret rugi?" | - | Seed: laba Mar pest −Rp9.069.000, dinding −Rp16.329.000, laundry negatif (THR + pekan Lebaran). Maret di luar jendela 6 bulan (bila diuji Okt), jadi AI seharusnya menyatakan keterbatasan. Bila menebak THR, harus disebut sebagai dugaan | P2 | Manual | _PENDING_ | M7, Q11 |
| TC-BIZ-04 | Apakah usaha tumbuh | DEMO:listrik | Tanya "Apakah usaha saya tumbuh tahun ini?" | - | Seed: tren ±1,7%/bulan, tetapi Agu→Sep −0,7% dan CMGR mentah 0,3%. AI menyebut angka MoM/CMGR dari data dan mengingatkan efek musim, bukan menyimpulkan "turun" | P2 | Manual | _PENDING_ | Q1 |
| TC-BIZ-05 | Pertumbuhan enterprise 5–10% | DEMO:fm | Tanya "Dari mana pertumbuhan 7% per bulan berasal dan apakah berkelanjutan?" | - | Menyebut MoM Agu→Sep dari data (lean +7,7%) dan patokan enterprise 5–10%. Mengakui kontrak/wilayah tidak tercatat (M4, M6), tanpa mengarang jumlah kontrak | P1 | Manual | _PENDING_ | Q8, Q9 |
| TC-BIZ-06 | Perlu rekrut? | DEMO:rs | Tanya "Apakah saya perlu rekrut?" | - | Memakai pertumbuhan pendapatan dari data. Menyatakan jumlah petugas/kapasitas tidak tercatat (S2, S4) | P2 | Manual | _PENDING_ | Q7 |
| TC-BIZ-07 | Konversi penawaran | DEMO:mall | Tanya "Berapa konversi penawaran saya dan kenapa kalah?" | - | Angka konversi dari snapshot. Alasan kalah dinyatakan tidak tercatat (S1) | P2 | Manual | _PENDING_ | Q5 |
| TC-BIZ-08 | Pelanggan terpenting | DEMO:laundry | Tanya "Pelanggan mana paling penting?" lalu bandingkan dengan Laporan → Pelanggan teratas | - | Daftar pelanggan sama dengan Laporan. Rekap walk-in disebut apa adanya | P2 | Manual | _PENDING_ | M1, BUG-02 |
| TC-BIZ-09 | Kapan promosi | DEMO:dinding | Media sosial → Ide: "Kapan sebaiknya saya promosi?" + Penasihat Pemasaran | - | Saran puncak Jul–Okt (kemarau) bila disimpulkan dari data, dan tanpa klaim performa iklan | P3 | Manual | _PENDING_ | M4, S5 |
| TC-BIZ-10 | Pelanggan baru vs lama | semua akun | Tanya "Berapa pelanggan baru bulan ini vs pelanggan lama?" | - | Memakai angka "pelanggan berulang" dari snapshot (berbasis nama) dan menyebut keterbatasannya | P2 | Manual | _PENDING_ | M1 |
| TC-BIZ-11 | Ringkasan demo-cleaning | DEMO:cleaning | Bandingkan KPI Ringkasan vs Laporan "Bulan lalu" | - | Bulan lalu (Sep 2026) pendapatan **Rp16.485.000**. Margin total ±31% | P2 | Manual | _PENDING_ | |
| TC-BIZ-12 | Semua 9 akun bisa dibuka | ENV-PROD | Masuk tiap akun demo dan buka semua tahap | 9 akun | Tidak ada error. Ringkasan terisi. Sole ≈ Rp16–24 jt/bulan, UKM ≈ Rp180–250 jt/bulan, Enterprise ≈ Rp3,1–3,7 M/bulan (Sep 2026) | P1 | Manual | _PENDING_ | Login demo menulis 1 baris sesi |

## 22. Hasil otomasi terakhir

| Tanggal | Lingkungan | Unit | E2E | Catatan |
|---------|------------|------|-----|---------|
| 2026-10-29 | ENV-MOCK (lokal, Vite port 5199) | 139 test: 138 lulus, 0 gagal, 1 TODO (BUG-02). Termasuk 36 test Radar/Prospek dari tim fitur | 11 spec, 221 cek lulus, 0 gagal, 1 KNOWN-BUG (BUG-01). Radar/Prospek baru smoke | Isi baris baru setiap kali suite dijalankan |

## 23. Temuan

| ID | Test case | Keparahan | Deskripsi | Langkah reproduksi | Tindak lanjut |
|----|-----------|-----------|-----------|--------------------|---------------|
| BUG-01 | TC-DEM-07 | Rendah | Tautan `#/masuk?demo` membuka mode Live. `src/ui/app.js` `render()` menormalkan hash menjadi `#/masuk` (`history.replaceState`) **sebelum** halaman login membaca `?demo` dari `location.hash` | Buka `https://satu-alur.apipedia.workers.dev/#/masuk?demo` saat belum masuk. Tab "Live" aktif dan URL menjadi `#/masuk` | Simpan query sebelum replaceState atau teruskan lewat `ctx`. E2E menandainya KNOWN-BUG |
| BUG-02 | TC-ADV-11, TC-BIZ-08 | Sedang | Penasihat AI ("Pelanggan teratas" di snapshot) mengelompokkan per `customer_name` mentah, sedangkan Laporan memakai `customerKey` (huruf kecil + spasi dirapikan). "PT Maju" dan "pt  maju " menjadi 2 pelanggan, dan hitungan pelanggan berulang tidak merapikan spasi ganda | Buat 2 permintaan sampai terbukukan dengan nama `PT Maju` dan `pt  maju `, lalu tanya penasihat "siapa pelanggan terbesar" | Pakai `customerKey` di `src/ai/advisor-tools.js`. Unit test TODO sudah ada |
| DOC-01 | TC-OFR-06 | Info | FRD FR-011 dan UAT-03/04 menyebut penawaran disimpan `draft` dan belum ada layar persetujuan, padahal kode menyimpan `approved` dan daftar punya tombol "Setujui" | - | Selaraskan FRD/UAT dan R-009 |
| _TBD_ | | | | | |
