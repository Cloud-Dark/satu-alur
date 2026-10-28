# Skrip Demo dan Rekaman Video Satu Alur

> Status: Draft
> Terakhir diperbarui: 2026-10-29
> Pemilik: _TBD_

Skrip untuk mendemokan Satu Alur secara langsung atau merekam video 10–12 menit. Isinya hanya fitur yang benar-benar ada di aplikasi saat ini. Fitur yang masih dikerjakan diberi tanda **(bila sudah dirilis)**. Diadaptasi dari skrip rekan tim (cabang `zul-pr6`), dengan nama tahap, akun demo, dan alur disesuaikan dengan produk sekarang. Lingkungan dan akun: [ENVIRONMENTS.md](ENVIRONMENTS.md). Cara memeriksa tiap langkah: [uat/2026-10-29_test-cases.md](uat/2026-10-29_test-cases.md).

## Persiapan

| Item | Pilihan |
|------|---------|
| URL | Produksi `https://satu-alur.apipedia.workers.dev` (data 12 bulan untuk 9 akun demo, AI asli Workers AI). Cadangan bila produksi bermasalah: lokal `VITE_USE_MOCK=true npm run dev` → `http://localhost:5173` (data mock 8 permintaan, AI simulasi) |
| Peramban | Chrome desktop 1440×900 atau lebih besar, zoom 100%, mode terang (tunjukkan mode gelap sekali) |
| Akun | Mode **Akun demo**: `demo-ac@satualur.id` (Sole Trader), `demo-pest@satualur.id` (UKM), `demo-fm@satualur.id` (Enterprise) |
| Kuota | Cek dasbor Cloudflare: kuota tulis D1 hari itu masih longgar ([batas paket gratis](ENVIRONMENTS.md#batas-paket-gratis)). Satu kali alur lengkap menulis ±20 baris |
| Rekaman | OBS, QuickTime, atau Loom; 1080p 30 fps; sorot kursor |

Catatan penting sebelum merekam:

- Akun demo **dipakai bersama**. Data yang Anda tambahkan terlihat oleh orang lain, dan orang lain bisa saja sedang mengubah data yang sama. Lakukan gladi singkat tepat sebelum merekam.
- Angka di skrip berasal dari seed per 28 Oktober 2026 (`seeds/demo-lean-summary.json`). Bila demo dilakukan di bulan lain, "bulan lalu" ikut bergeser. Baca angka di layar dan jangan menghafal angka skrip.
- Jawaban AI bisa berbeda setiap kali dijalankan. Jangan menjanjikan kalimat tertentu. Yang ditonjolkan adalah bahwa AI memakai angka asli dari data akun.

## Alur Demo (target 10–12 menit)

### Bagian 1. Landing page (0:00–1:00)

**Langkah:**

1. Buka `/` lalu gulir perlahan: hero dengan animasi 3D, Alur kerja (6 tahap), Fitur AI (demo agen penawaran yang "mengetik"), Ide besar (roadmap), Harga, FAQ.
2. Klik menu "Harga" di header (halaman menggulir dan URL tetap `#/`).
3. Klik ikon bulan untuk menunjukkan mode gelap, lalu kembalikan.

**Yang ditunjukkan:** tiga paket **Sole Trader** (Rp0, gratis 3 bulan), **UKM** (Rp349rb/bulan), **Enterprise** (kustom). Harga masih **draf**, jadi sebut "harga awal".

**Narasi:**

> "Satu Alur menyatukan operasional usaha jasa di Indonesia dalam satu alur: permintaan pelanggan, penawaran dengan AI, penugasan tim, penyelesaian, pembukuan, sampai laporan. Di atas alur itu ada alat pertumbuhan yang membaca data Anda sendiri."

### Bagian 2. Masuk dengan akun demo dan Ringkasan (1:00–2:30)

**Langkah:**

1. Klik "Masuk" untuk menuju `#/masuk`. Tunjukkan sekilas mode **Live**: email, lalu kode 6 digit. Selama mode demo OTP aktif, kode tampil di layar karena belum ada pengiriman email.
2. Pindah ke tab **Akun demo**. Pilih Skala bisnis **Sole Trader**, lalu Akun demo **Budi Santoso — Servis AC**. Kartu pratinjau menampilkan "Servis AC rumah & ruko · Bekasi" dan "Target tumbuh 1–2% per bulan".
3. Klik **Masuk ke mode demo**. Ringkasan terbuka.

**Yang ditunjukkan di Ringkasan:**

- 4 KPI: **Laba bersih** (dengan margin), **Pendapatan**, **Biaya**, **Tingkat penyelesaian**. Semua dihitung langsung dari buku besar, tanpa angka tren karangan.
- Grafik **Pendapatan vs biaya** (bisa ganti rentang, arahkan kursor untuk tooltip).
- Panel **Alur kerja**: jumlah dan konversi per tahap. Klik satu baris untuk membuka tahapnya.
- **Perlu tindakan**: permintaan belum ditawar, draf penawaran, pekerjaan belum dibukukan.
- **Aktivitas terbaru**.
- Sidebar: Ringkasan, tahap **01–06**, grup **Pertumbuhan** (Radar peluang, Pencari prospek, Media sosial, Penasihat AI), lalu Pengaturan di bawah.

**Narasi:**

> "Ini usaha servis AC perorangan di Bekasi dengan data setahun. Semua angka di sini dihitung dari transaksi yang tercatat. Contohnya September: pendapatan sekitar Rp23,5 juta dari 60 pekerjaan."

### Bagian 3. Alur kerja end-to-end (2:30–6:00)

Masih di akun `demo-ac`.

#### 01 Permintaan (2:30–3:10)

1. Sidebar → **01 Permintaan**. Wizard 3 langkah.
2. Langkah *Pelanggan*: Nama `Klinik Pratama Sehat`, Lokasi `Bekasi Timur`, Telepon `0812 5555 0101`. Tekan Enter.
3. Langkah *Kebutuhan*: Jenis layanan `Servis AC split`, Deskripsi `Servis rutin 6 unit AC split 1 PK di ruang praktik dan ruang tunggu, cek freon, dikerjakan Sabtu pagi.`
4. Langkah *Tinjau*, lalu **Simpan**. Layar selesai muncul dan permintaan tampil di daftar teratas.

> "Permintaan dicatat dalam tiga langkah singkat, dan formulirnya muat dalam satu layar."

#### 02 Penawaran AI (3:10–4:10)

1. Di layar selesai klik **Buat penawaran**. Tahap 02 terbuka dengan permintaan tadi sudah terpilih.
2. Klik **Hasilkan penawaran**. Konsol AI mengetik proposal: ruang lingkup, harga, ketentuan, catatan.
3. Di langkah tinjau tunjukkan **aturan**: ganti Harga final menjadi `100` sehingga chip aturan merah dan tombol Simpan nonaktif. Lalu isi harga yang wajar, mis. `900000`.
4. Buka "JSON mentah" sebentar, lalu **Simpan**. Penawaran tersimpan berstatus **Disetujui**.

> "AI menulis draf penawaran, tetapi aturan bisnis tetap berlaku: harga minimal Rp10.000, ruang lingkup dan ketentuan harus jelas. Keputusan akhir tetap di tangan pemilik usaha."

Opsional: tunjukkan tombol **Setujui** pada baris penawaran draf di daftar.

#### 03 Penugasan (4:10–4:40)

1. Klik **Tugaskan pekerja**. Isi Nama pekerja atau tim `Budi & Andi`, jadwal besok 08:00.
2. Konfirmasi. Penugasan tampil berstatus **Ditugaskan**.

#### 04 Penyelesaian (4:40–5:00)

1. Lanjut ke 04. Catatan: `6 unit dibersihkan, 1 unit isi freon. Pelanggan puas.`
2. **Tandai selesai**.

#### 05 Pembukuan (5:00–5:30)

1. Lanjut ke 05. Kategori **Pendapatan**, jumlah otomatis terisi dari harga penawaran (900.000). Tinjau, lalu simpan.
2. **Tambah jurnal** dengan kategori **Biaya bahan / material** `150000`, lalu simpan.
3. Tunjukkan ringkasan pendapatan, biaya, laba, dan daftar jurnal.

Kategori yang tersedia: Pendapatan, Biaya tenaga kerja, Biaya bahan / material, Biaya transportasi, Biaya lain-lain.

#### 06 Laporan (5:30–6:00)

1. Sidebar → **06 Laporan**. Ganti periode: 30 hari, Bulan ini, Bulan lalu, Semua. KPI menampilkan perbandingan dengan periode sebelumnya.
2. Tunjukkan **Rincian kategori** dan **Pelanggan teratas**.
3. Klik **Jelaskan dengan AI**. Penjelasan Bahasa Indonesia mengalir. Opsional: klik **Hentikan** untuk menunjukkan pembatalan.

> "Angka laporan berasal langsung dari buku besar. AI menjelaskan artinya dan memberi rekomendasi, tetapi angkanya tetap mengacu ke data."

### Bagian 4. Penasihat AI (6:00–7:45)

Keluar, lalu masuk lagi dengan **Akun demo → UKM → CV Basmi Hama Nusantara** (`demo-pest`). Sidebar → **Penasihat AI**.

**Langkah:**

1. Pilih **Otomatis**. Ketik `Bagaimana saya bisa tumbuh 2% bulan depan?`. Sambil mengetik, petunjuk menyebut agen yang akan menjawab (Strategi pertumbuhan). Tekan Enter.
2. Tunjukkan bahwa jawaban mengutip angka asli: pendapatan bulan lalu (September ±Rp190 juta), pertumbuhan bulan ke bulan, dan rata-rata nilai pekerjaan. Jawaban ditutup dengan "Langkah minggu ini".
3. Di **kalkulator target** klik preset **1%**, **2%**, **5%**, **10%**. Proyeksi 3/6/12 bulan dan jumlah pekerjaan tambahan berubah. 1–2% ditandai realistis untuk UKM, 5–10% agresif (setara enterprise).
4. Klik chip saran **"Biaya mana yang paling bisa dihemat?"**. Pertanyaan otomatis dijawab **Analis keuangan**.
5. Tunjukkan panel **Statistik penasihat** (jumlah jawaban, rata-rata waktu, dari riwayat yang tersimpan).
6. Opsional: pilih satu agen, klik **Hapus** dua kali untuk menghapus percakapan agen itu saja.

**Yang ditunjukkan:** 5 agen (Konsultan bisnis, Analis keuangan, Strategi pertumbuhan, Pemasaran, Operasional) dengan routing otomatis berbasis kata kunci, memori percakapan tersimpan di akun (D1), satu kali coba ulang otomatis bila AI gangguan, dan kalkulator yang dihitung di aplikasi, bukan oleh AI.

> "Penasihat ini tidak menebak. Ia menerima ringkasan angka bisnis Anda sendiri lalu menyarankan langkah yang bisa diukur. Untuk UKM, target sehat itu 1–2% per bulan, dan kalkulator menerjemahkannya menjadi jumlah pekerjaan tambahan."

Jangan menyebut "tool calling" atau "query database oleh AI". Fitur itu tidak ada. Angka dihitung di aplikasi lalu diberikan ke AI.

### Bagian 5. Radar peluang (7:45–8:30) (bila sudah dirilis)

Tetap di `demo-pest` atau kembali ke `demo-ac`. Sidebar → **Radar peluang**.

1. Tunjukkan kartu peluang dari transaksi sendiri: layanan berulang yang jatuh tempo, pelanggan langganan yang mulai sepi, upsell kontrak, cross-sell, penawaran tertunda, tawarkan ulang, musiman. Setiap kartu punya skor dan bukti datanya.
2. Tab **Minggu ini**: daftar tindak lanjut minggu ini.
3. Minta AI menulis pesan tindak lanjut untuk satu kartu. Pesan tidak dikirim otomatis.
4. Tandai satu kartu selesai atau tunda.

> "Radar mencari peluang yang sebenarnya sudah ada di data Anda, misalnya pelanggan yang biasanya servis tiap tiga bulan tapi belum kembali."

### Bagian 6. Pencari prospek (8:30–9:15) (bila sudah dirilis)

Masuk sebagai `demo-fm` (Enterprise) atau tetap di akun saat ini. Sidebar → **Pencari prospek**.

1. Pilih titik di peta (klik peta atau cari alamat), atur radius, lalu pilih kriteria seperti kantor, bank, atau rumah sakit.
2. Klik cari. Daftar usaha dari OpenStreetMap tampil dengan jarak, skor, dan estimasi nilai berdasarkan rata-rata pekerjaan akun ini.
3. Simpan satu prospek, lalu jadikan permintaan + draf penawaran di alur.

> "Prospek dicari dari data peta terbuka dan dinilai memakai riwayat pekerjaan Anda sendiri. Satu Alur tidak mengirim pesan apa pun ke prospek. Keputusan menghubungi tetap di tangan Anda."

### Bagian 7. Media sosial (9:15–10:30)

Sidebar → **Media sosial**.

1. Tab **Konten**: klik chip topik atau isi `Servis AC rumah di Bekasi`. Pilih platform **Instagram**, jenis **Caption**, nada santai, ajakan `Chat WhatsApp kami`. Klik **Buat konten**, lalu **Simpan ke pustaka**.
2. Alat **hashtag**: isi `servis ac bekasi`, klik **Buat hashtag**, lalu klik satu hashtag untuk menyalin.
3. Klik **Jadwalkan** untuk pindah ke tab **Jadwal** dengan isi terisi, lalu **Tambah ke jadwal**. Tunjukkan **Tandai terposting**. Jadwal ini adalah pengingat dan tidak memposting otomatis.
4. Tab **Ide**: tema `Tips perawatan AC di musim hujan`, klik **Mulai brainstorm**, lalu **Simpan semua**.
5. Tab **Iklan Meta**: layanan `Cuci AC`, lokasi `Bekasi`, anggaran harian `100000`, klik **Susun rencana iklan**. Hasilnya audiens, penempatan, pembagian anggaran, 3 materi iklan, dan tips. Tidak ada estimasi jangkauan atau CTR karangan.
6. Tab **Kolaborasi**: ide kerja sama dengan jenis mitra lokal, lengkap dengan pesan ajakan.
7. Tab **Pustaka**: filter, cari, salin.

Platform: Instagram, TikTok, Facebook, LinkedIn, WhatsApp (Status/Channel), X. Jenis konten: Caption, Naskah video, Seri story, Copy iklan, Prompt gambar.

> "Konten ditulis untuk usaha jasa lokal dan memakai layanan yang paling sering diminta pelanggan Anda. AI dilarang mengarang angka performa atau testimoni."

### Bagian 8. Pengaturan (10:30–11:00)

Sidebar bawah → **Pengaturan** (drawer kanan).

1. **Konektor**: konfigurasi WhatsApp (WAPilot) dan Email SMTP tersimpan di peramban ini. Jangan isi kredensial asli saat rekaman.
2. **Agen AI**: prompt sistem penawaran dan laporan (bisa diubah dan dikembalikan ke default), Temperature, Maks token, preferensi model.
3. **Cloud**: status "Cloudflare Worker + D1".

Tekan Esc untuk menutup.

### Bagian 9. Penutup (11:00–11:30)

Klik ikon **Keluar** di sidebar untuk kembali ke landing.

> "Itu Satu Alur: satu alur dari permintaan sampai laporan, ditambah alat pertumbuhan yang membaca data usaha Anda sendiri. Mulai dari paket Sole Trader yang gratis tiga bulan."

## Checklist Fitur yang Diperlihatkan

### Inti

- [ ] Landing: hero, alur kerja, fitur AI, ide besar, harga 3 paket (draf), FAQ, mode gelap
- [ ] Login Live (email + OTP) dan Akun demo (skala → akun, pencarian)
- [ ] Ringkasan: 4 KPI, grafik, alur kerja, perlu tindakan, aktivitas
- [ ] 01 Permintaan (wizard 3 langkah)
- [ ] 02 Penawaran AI (streaming, aturan harga, JSON mentah, simpan Disetujui)
- [ ] 03 Penugasan
- [ ] 04 Penyelesaian
- [ ] 05 Pembukuan (5 kategori, jumlah otomatis dari penawaran)
- [ ] 06 Laporan (4 periode, perbandingan, Jelaskan dengan AI, Hentikan)

### Pertumbuhan

- [ ] Penasihat AI: 5 agen, routing otomatis, angka asli, kalkulator 1/2/5/10%, statistik, hapus per agen
- [ ] Radar peluang (bila sudah dirilis)
- [ ] Pencari prospek (bila sudah dirilis)
- [ ] Media sosial: Konten, hashtag, Jadwal, Ide, Iklan Meta, Kolaborasi, Pustaka

### Lainnya

- [ ] Pengaturan: Konektor, Agen AI, Cloud
- [ ] Keluar

## Hal yang Tidak Boleh Diklaim

| Klaim lama | Kenyataan sekarang |
|------------|--------------------|
| "AI Superpowers" dengan 4 asisten, tool calling kalkulator/query DB/format rupiah | Penasihat AI dengan 5 agen. Angka dihitung di aplikasi dan diberikan ke AI sebagai konteks. Tidak ada tool calling |
| Partnership Hub berisi 3 layanan berbayar (Organic Growth, Influencer Network, AI Agent Marketing) | Tab Kolaborasi berisi ide kerja sama dengan mitra lokal yang dibuat AI, tanpa layanan berbayar |
| Konten dijadwalkan lalu diposting otomatis | Jadwal hanya pengingat dengan status manual "Tandai terposting" |
| Notifikasi WhatsApp/Email otomatis ke pelanggan | Konektor baru berupa konfigurasi lokal, belum mengirim apa pun |
| Laporan AI tersimpan sebagai riwayat | Penjelasan AI belum disimpan ke tabel `reports` |
| Data demo sama di semua lingkungan | Mode mock lokal memakai 8 permintaan contoh, bukan data 12 bulan akun demo |
| Kunjungi satualur.id | Domain belum ditetapkan (_TBD_). Pakai URL produksi di atas |

## Tips Rekaman

| Aspek | Rekomendasi |
|-------|-------------|
| Kecepatan | Jeda 2–3 detik setelah setiap klik. Biarkan streaming AI selesai di layar |
| Kursor | Pakai sorotan kursor |
| Zoom | Perbesar saat mengisi formulir |
| Audio | Mikrofon jernih, ruangan tenang |
| Cadangan | Siapkan mode mock lokal bila AI produksi lambat atau kuota habis. Sebut di narasi bahwa itu "mode demo lokal" |
| Durasi | Target 10–12 menit. Bagian 5 dan 6 boleh dipotong bila fiturnya belum dirilis |
| Resolusi | Minimal 1080p, 30 fps |
