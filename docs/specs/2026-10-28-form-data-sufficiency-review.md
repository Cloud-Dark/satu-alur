# Kajian Kecukupan Data Formulir untuk Saran Pertumbuhan AI

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

## 1. Pertanyaan dan jawaban singkat

**Pertanyaan.** Apakah input formulir yang ada sekarang cukup bagi AI untuk memberi saran pertumbuhan yang akurat bagi usaha dengan target 1–2%/bulan (sole trader, UKM) dan 5–10%/bulan (enterprise)?

**Jawaban singkat: belum cukup.** Data saat ini cukup untuk *melaporkan* apa yang terjadi (pendapatan, biaya, laba, margin per periode, pelanggan teratas). Data ini belum cukup untuk *menjelaskan mengapa* dan *menyarankan apa*.

| Target | Mengapa belum cukup |
|--------|---------------------|
| 1–2%/bulan | Sinyal pertumbuhan lebih kecil daripada derau musiman dan derau bulanan. Contoh dari data demo: tren listrik 1,67%/bulan, tetapi CMGR mentahnya 0,34%. MoM bulanan AC berayun dari −12,7% sampai +20%. Tanpa riwayat ≥ 12 bulan, penanda musim, dan pemecahan pendorong (pelanggan baru vs repeat, volume vs harga), AI akan salah membaca arah. |
| 5–10%/bulan | Pertumbuhan enterprise datang dari kontrak baru, retensi kontrak, dan ekspansi wilayah. Ketiganya tidak punya field sama sekali: tidak ada kontrak/MRR, tidak ada wilayah atau cabang, tidak ada churn, tidak ada nilai pipeline. |

Rekomendasi: tambah **7 field Must** (§5) yang sebagian besar berupa dropdown di formulir yang sudah ada. Field ini menutup ±70% kebutuhan diagnosis tanpa membebani pengguna kecil.

Metode: inventaris field per tahap alur, lalu dipetakan ke pohon pendorong pertumbuhan dan diuji dengan 9 akun data demo ([2026-10-28-demo-growth-data-design.md](2026-10-28-demo-growth-data-design.md)). Data demo menyimpan "kebenaran dasar" (wilayah, tipe pelanggan, kontrak, alasan musiman) yang **tidak** tersimpan di skema. Selisih antara yang diketahui generator dan yang bisa dibaca dari database adalah celah datanya.

## 2. Pohon pendorong pertumbuhan

```
Laba = Pendapatan − Biaya langsung − Overhead
Pendapatan = Σ_segmen ( Jumlah pekerjaan × Nilai rata-rata )
  Jumlah pekerjaan = Prospek × Tingkat konversi + Pekerjaan berulang (repeat/kontrak)
    Prospek          ← kanal akuisisi × belanja marketing × musim × wilayah
    Konversi         ← harga vs pesaing, kecepatan respon, alasan kalah
    Berulang         ← retensi, churn kontrak, interval servis
  Nilai rata-rata    ← harga satuan × kuantitas × upsell
  Kapasitas (batas)  ← jumlah pekerja × jam tersedia × utilisasi
Biaya langsung       ← tenaga, bahan, transport per pekerjaan
Overhead             ← sewa, gaji staf, marketing, cabang
Kas (batas)          ← termin bayar, piutang, THR
```

Untuk target 1–2%/bulan, tuas yang realistis adalah: repeat/retensi, harga dan upsell, konversi, dan kanal yang efisien. Untuk 5–10%/bulan: kemenangan kontrak dan pipeline, kapasitas (rekrut tim), ekspansi wilayah, dan arus kas.

## 3. Inventaris data saat ini

| Tahap | Field | Tersimpan sebagai | Yang bisa dibaca AI dengan andal | Yang hanya bisa ditebak |
|-------|-------|-------------------|----------------------------------|-------------------------|
| 01 Permintaan | `customer_name` | teks bebas | nama per permintaan | identitas pelanggan lintas permintaan (salah ketik = pelanggan baru), tipe pelanggan (dari "PT", "Ibu", "RS") |
| | `service_type` | teks bebas | jenis layanan bila konsisten | kategori layanan (ejaan berbeda = layanan berbeda) |
| | `phone` | teks | kontak | kunci pelanggan berulang (opsional, sering kosong) |
| | `location` | teks bebas, opsional | — | kota/wilayah/cabang |
| | `description` | teks bebas | keluhan | kuantitas (unit, m², petugas), urgensi, sumber prospek |
| | `created_at` | otomatis | waktu masuk | — |
| 02 Penawaran | `ai_proposal_json` {scope, price, terms, notes} | JSON | harga usulan AI | termin bayar, durasi (teks) |
| | `validated_price`, `validated_scope` | angka/teks | harga final | diskon vs harga usulan |
| | `status` | approved/draft/pending/rejected | menang/kalah | **alasan kalah**; UI belum punya layar tolak/setujui |
| 03 Penugasan | `worker_name`, `scheduled_at` | teks, waktu | jadwal | jumlah orang, jam kerja, kapasitas, cabang |
| 04 Penyelesaian | `notes`, `completed_at` | teks, waktu | waktu selesai | durasi aktual, masalah, peluang upsell |
| 05 Pembukuan | `amount`, `category` (5 kategori) | angka | pendapatan dan biaya per pekerjaan | marketing vs sewa vs gaji (semua `biaya_lain`); biaya non-pekerjaan wajib menempel ke satu pekerjaan; status bayar |
| 06 Laporan | dihitung dari buku besar | — | total per periode, top 5 per **permintaan** | tren multi-bulan, musim |

## 4. Uji per pertanyaan pertumbuhan, dengan bukti data demo

| # | Pertanyaan yang perlu dijawab AI | Bisa? | Bukti dari data demo / alasan |
|---|----------------------------------|-------|-------------------------------|
| Q1 | Apakah usaha benar tumbuh dan berapa trennya? | **Sebagian** | Pendapatan bulanan bisa dihitung, tetapi laporan hanya membandingkan dengan 1 periode sebelumnya dan UI memuat ≤ 1.000 jurnal terbaru. Listrik: tren 1,67%/bln vs CMGR mentah 0,34%. Dinding: tren 1,23% vs mentah 3,67%. AC Januari −12,7% MoM. Tanpa koreksi musim dan riwayat 12 bulan, kesimpulan "tumbuh/turun" sering keliru. |
| Q2 | Pertumbuhan datang dari pelanggan baru atau pelanggan lama? | **Tidak andal** | Tidak ada ID pelanggan. Generator tahu repeat rate (sole 35%, UKM 45%, enterprise 70%), tetapi dari DB hanya bisa ditebak lewat nama dan telepon. Telepon `NULL` untuk walk-in laundry. Laporan "Pelanggan teratas" dikelompokkan per **permintaan**, bukan per pelanggan, sehingga 30 rekap harian satu outlet tidak dijumlahkan. |
| Q3 | Segmen mana yang paling menguntungkan (individu, UMKM, korporat, instansi)? | **Tidak** | Tipe pelanggan tidak disimpan. Di demo, harga korporat sengaja di kuartil atas; AI tidak bisa melihatnya. |
| Q4 | Kanal marketing mana yang efektif, dan berapa biaya akuisisinya? | **Tidak** | Tidak ada sumber prospek. Belanja iklan tercampur di `biaya_lain` bersama sewa dan asuransi. |
| Q5 | Kenapa penawaran kalah, dan berapa konversinya? | **Sebagian** | Konversi bisa dihitung dari status (demo: 537 `rejected`), tetapi tidak ada alasan (harga, jadwal, kompetitor). Penawaran `rejected` juga dihitung sebagai "draf" oleh UI. |
| Q6 | Apakah harga perlu dinaikkan atau per-unit terlalu murah? | **Sebagian** | Harga total ada. Kuantitas dan satuan (unit AC, m², petugas, kg) hanya ada di teks `description`/`scope` (demo: "Cuci 3 unit AC", "±250 m²", "30 petugas"). Harga per satuan tidak bisa dihitung dengan andal. |
| Q7 | Apakah kapasitas cukup untuk tumbuh, dan kapan harus rekrut? | **Tidak** | `worker_name` berupa teks bebas ("Tim Agus Salim (3 orang)", "Tim MKS-01 · Spv. …"). Tidak ada jumlah orang, jam kerja, atau durasi. Roster UKM di demo tumbuh 8 → 15 orang mengikuti pendapatan; AI tidak bisa melihat utilisasinya. |
| Q8 | Wilayah atau cabang mana yang mendorong pertumbuhan? | **Tidak** | Tidak ada kolom wilayah. Di demo, pangsa wilayah cepat naik (fm: MRW 0 → 5%; rs: MKS 0 → 14%; JKT di fm turun 63 → 49%), tetapi hanya tersirat di `location` teks bebas. |
| Q9 | Berapa pendapatan berulang (MRR), churn kontrak, dan pipeline? | **Tidak** | Kontrak dicatat sebagai permintaan baru tiap bulan ("Tagihan kontrak bulanan … siklus tgl N"). Tidak ada nilai kontrak, durasi, tanggal mulai/berakhir, atau churn. Pada enterprise demo, kontrak = 60–66% pendapatan, dan inilah pendorong utama 5–10%/bln. |
| Q10 | Pekerjaan atau layanan mana yang marginnya tipis? | **Ya, terbatas** | Biaya per pekerjaan tersedia bila pengguna disiplin memposting biaya per job. Overhead terpaksa dilekatkan ke satu pekerjaan (skema `completion_id NOT NULL`), sehingga margin pekerjaan itu terdistorsi. |
| Q11 | Kenapa margin Maret anjlok? | **Sebagian** | Biaya tenaga terlihat melonjak, tetapi tidak ada label "THR" (ledger tanpa keterangan). Demo: margin Maret UKM −5% s.d. −10%. AI harus menebak dari kalender. |
| Q12 | Apakah kas cukup untuk ekspansi (termin NET 30, piutang)? | **Tidak** | Tidak ada status pembayaran atau tanggal jatuh tempo. Termin hanya teks di `terms`. Enterprise demo memakai NET 30. |
| Q13 | Berapa pekerjaan yang batal dan apa penyebabnya? | **Tidak** | Tidak ada status batal atau alasan. Prospek batal tetap tampil "Baru" selamanya. |
| Q14 | Bagaimana pengaruh musim (hujan, Lebaran, libur sekolah)? | **Sebagian** | Tanggal tersedia, tetapi AI perlu kalender Indonesia dan riwayat ≥ 12 bulan. Penyebab ("tertunda hujan") hanya ada di catatan teks. |

## 5. Celah dan usulan field (MoSCoW)

Prinsip: (a) sebanyak mungkin berupa **pilihan** (dropdown/chip), bukan teks bebas; (b) diisi di tahap tempat informasinya muncul secara alami; (c) **opsional** bagi sole trader, dengan nilai default yang masuk akal; (d) bisa diisi otomatis oleh AI dari deskripsi, lalu dikonfirmasi pengguna.

### Must (diperlukan agar saran pertumbuhan tidak menyesatkan)

| ID | Field usulan | Tahap / tempat | Format | Saran yang dimungkinkan | Q |
|----|--------------|----------------|--------|-------------------------|---|
| M1 | **Pelanggan sebagai entitas**: `customer_id` (pilih pelanggan lama atau buat baru; cocokkan dengan telepon) | 01 Permintaan (combobox nama) | relasi ke tabel `customers` | Pelanggan baru vs repeat, retensi, nilai seumur pelanggan, top pelanggan yang benar | Q2, Q3 |
| M2 | **Tipe/segmen pelanggan**: individu, UMKM, korporat, instansi/pemerintah, (industri: hotel, RS, mal, kantor) | 01 Permintaan (melekat di pelanggan) | enum | Segmen paling menguntungkan, fokus penjualan, strategi harga per segmen | Q3, Q6 |
| M3 | **Sumber prospek**: WhatsApp/telepon, referensi pelanggan, Google Maps/Search, Instagram/TikTok, marketplace, tender/e-procurement, pelanggan lama, papan nama/walk-in | 01 Permintaan | enum | Efektivitas kanal, alokasi anggaran marketing, biaya akuisisi (dengan M7) | Q4 |
| M4 | **Wilayah/cabang** (kota/kabupaten terstruktur + cabang internal) | 01 Permintaan (`location` menjadi pilihan kota + alamat opsional), 03 Penugasan (cabang tim) | enum provinsi/kota + cabang | Kontribusi wilayah, keputusan ekspansi, mencocokkan profil pertumbuhan regional (5% vs 8–10%) | Q8 |
| M5 | **Kuantitas dan satuan** (`qty`, `unit`: unit AC, titik, m², kg, petugas, kunjungan, kamar) | 02 Penawaran (AI mengisi dari deskripsi; pengguna mengoreksi) | angka + enum satuan | Harga per satuan vs pasar, kapasitas (m²/hari, unit/teknisi), elastisitas harga | Q6, Q7 |
| M6 | **Kontrak berulang**: `is_recurring`, nilai per bulan, mulai, akhir/perpanjangan, siklus tagih | 02 Penawaran ("Jadikan kontrak bulanan") dengan tagihan bulanan dibuat otomatis | tabel `contracts` | MRR, churn, pipeline perpanjangan; inti saran enterprise 5–10%/bln | Q9 |
| M7 | **Kategori dan keterangan jurnal**, plus jurnal **tanpa** pekerjaan (overhead) | 05 Pembukuan: tambah kategori `biaya_marketing`, `biaya_sewa`, `biaya_gaji_staf`, `thr_bonus`, `pajak`; kolom `keterangan`; `completion_id` boleh kosong | enum + teks pendek | Rasio overhead, biaya akuisisi (marketing ÷ pelanggan baru), penjelasan anomali (THR Maret) | Q4, Q10, Q11 |

### Should (meningkatkan akurasi saran secara nyata)

| ID | Field usulan | Tahap / tempat | Format | Saran yang dimungkinkan | Q |
|----|--------------|----------------|--------|-------------------------|---|
| S1 | **Alasan kalah/batal** (harga, jadwal, pilih kompetitor, tidak jadi, di luar area, tidak respons) | 02 Penawaran (tombol "Tandai kalah"); 01 Permintaan ("Batalkan") | enum + catatan | Perbaikan konversi, posisi harga, perluasan area layanan | Q5, Q13 |
| S2 | **Jumlah pekerja dan durasi rencana/aktual** (orang × jam) | 03 Penugasan (rencana), 04 Penyelesaian (aktual) | angka | Utilisasi, kapan rekrut, produktivitas per tim, estimasi harga yang lebih tepat | Q7 |
| S3 | **Status pembayaran**: termin (tunai/DP/NET 30), jatuh tempo, tanggal lunas | 02 Penawaran (termin terstruktur), 05 Pembukuan (lunas/belum) | enum + tanggal | Arus kas, piutang macet, kelayakan ekspansi | Q12 |
| S4 | **Roster pekerja** (daftar pekerja/tim dengan status aktif dan biaya per bulan/per job) | Pengaturan, dipilih di 03 Penugasan | tabel `workers` | Kapasitas total, biaya tenaga per pekerja, rencana rekrut | Q7 |
| S5 | **Kategori layanan baku** (katalog per usaha) | 01 Permintaan (`service_type` jadi pilihan dari katalog + "lainnya") | enum per owner | Bauran layanan, layanan paling menguntungkan, paket upsell | Q6, Q10 |
| S6 | **Target pertumbuhan dan profil usaha** (skala, target %/bulan, wilayah utama, tahun berdiri) | Pengaturan / onboarding | form profil | Saran yang dikalibrasi terhadap target (1–2% vs 5–10%) dan konteks wilayah | semua |

### Could (nilai tambah, setelah Must/Should)

| ID | Field usulan | Tahap / tempat | Saran yang dimungkinkan |
|----|--------------|----------------|-------------------------|
| C1 | Belanja marketing per kanal per bulan (bila tidak dicatat per jurnal) | Pengaturan / Pembukuan | ROI kanal |
| C2 | Rating/kepuasan pelanggan dan komplain (skor SLA untuk B2B) | 04 Penyelesaian | Risiko churn kontrak, referensi |
| C3 | Peluang upsell/tindak lanjut ("perlu ganti kapasitor", "rekomendasi kontrak bulanan") sebagai checkbox + tanggal follow-up | 04 Penyelesaian | Pendapatan dari follow-up; pengingat servis berkala (AC 3 bulanan) |
| C4 | Harga pesaing atau harga pasar per satuan | 02 Penawaran | Posisi harga |
| C5 | Pajak (PPN/PPh 23) terpisah dari DPP | 02 Penawaran, 05 Pembukuan | Laba setelah pajak, kepatuhan |
| C6 | Penyebab tertunda (cuaca, material, akses lokasi) | 03/04 | Dampak musim hujan pada kapasitas |

### Won't (untuk rilis ini)

| ID | Item | Alasan |
|----|------|--------|
| W1 | Data makro/PDRB wilayah otomatis dari BPS | Cukup dengan profil wilayah statis di konfigurasi (M4 + S6). |
| W2 | POS per transaksi untuk laundry/retail | Rekap harian per outlet cukup untuk saran pertumbuhan. |
| W3 | Integrasi akuntansi penuh (neraca, aset) | Di luar fokus alur jasa. |

## 6. Masalah sistem yang memengaruhi akurasi (bukan formulir)

Ditemukan saat menerapkan data demo. Perlu ditangani pemilik `src/`/`worker/`.

| # | Masalah | Dampak pada saran AI | Usulan |
|---|---------|----------------------|--------|
| A1 | **Sudah diperbaiki (keyset paging).** Sebelumnya `loadFlow()` tidak berpaginasi; worker `MAX_LIMIT = 1000` | Ringkasan dan "Semua" hanya mencakup ±1.000 baris terbaru per tabel. Penyelesaian lama tampil "belum dibukukan" (demo-fm: 339 di UI vs 3 di DB). AI yang membaca data UI akan salah. | Paginasi `range()` di `fetchTable`, atau endpoint agregat bulanan di server. |
| A2 | `draftOffers()` menganggap `rejected` sebagai draf | Antrean "Perlu tindakan" dan badge Penawaran membengkak (demo-fm 112). Konversi salah dibaca. | Kecualikan `rejected`; tambah layar setujui/tolak (FR-012). |
| A3 | Laporan membandingkan hanya dengan 1 periode | Tren 1–2% tidak terlihat. | Kirim 12 bulan terakhir + indeks musiman ke prompt penjelasan/penasihat. |
| A4 | "Pelanggan teratas" dikelompokkan per permintaan | Pelanggan berulang dan kontrak terpecah. | Kelompokkan per pelanggan (M1). |
| A5 | `period_start` laporan dihitung dengan `toISOString()` dari tengah malam lokal | Di WIB tanggal awal mundur 1 hari (September tercatat mulai "2026-08-31"). | Format tanggal lokal (`YYYY-MM-DD` dari komponen tanggal lokal). |
| A6 | Laporan belum disimpan ke tabel `reports` oleh UI (PRD §6) | Tidak ada riwayat penjelasan untuk dibandingkan. | Simpan saat AI selesai menjelaskan. Data demo sudah mengisi 99 laporan sebagai contoh bentuknya. |

## 7. Skenario uji untuk analis

Gunakan akun demo (login OTP mode demo), lalu ajukan pertanyaan ke AI (penjelasan laporan atau penasihat AI). Bandingkan jawabannya dengan kunci di bawah. Kunci ini berasal dari generator dan **tidak bisa** diturunkan sepenuhnya dari field yang ada. Jawaban yang tidak tepat menjadi bukti kebutuhan field §5.

| Akun | Pertanyaan ke AI | Kunci jawaban (dari generator) | Field yang dibutuhkan |
|------|------------------|--------------------------------|-----------------------|
| demo-listrik | "Apakah usaha saya tumbuh tahun ini?" | Ya, tren ±1,7%/bln. Data mentah Nov→Sep tampak datar (+0,3%/bln) karena puncak musim hujan (korsleting) di awal periode. | riwayat 12 bln, musim (A3) |
| demo-ac | "Kenapa Januari turun 13%?" | Puncak musim hujan (permintaan cuci AC rendah) + libur awal tahun; bukan kehilangan pelanggan. | musim, M1 |
| demo-pest / demo-laundry / demo-dinding | "Kenapa Maret rugi?" | THR tunai ±H-10 Lebaran (±Rp41–51 jt, 10–11 orang × Rp4,1–4,6 jt) + pekan Lebaran sepi; pendapatan sebenarnya stabil. | M7 (kategori THR, keterangan) |
| demo-laundry | "Pelanggan mana paling penting?" | Kontrak linen hotel/resto (±42% pendapatan) + 3 outlet walk-in (rekap harian; terpecah di "Pelanggan teratas"). | M1, M6 |
| demo-dinding | "Kapan sebaiknya saya promosi?" | Puncak Jul–Okt (kemarau) dan pra-Lebaran; eksterior anjlok Nov–Mar; lokasi Balikpapan (profil wilayah cepat ±9%/th). | M4, S5 |
| demo-fm | "Dari mana pertumbuhan 7%/bln berasal dan apakah berkelanjutan?" | Kontrak FM baru (15 kontrak aktif, ±60% pendapatan) dan cabang baru di wilayah cepat (BPN, MKS, MRW); Jakarta turun dari 63% ke 49% pangsa. | M4, M6 |
| demo-rs | "Apakah perlu rekrut?" | Pendapatan naik ±8,7%/bln; 18 kontrak housekeeping aktif yang dihargai per petugas; jumlah petugas perlu naik sebanding. Margin tertekan consumable/APD dan potongan SLA. | S2, S4, M5 |
| demo-mall | "Berapa konversi penawaran saya dan kenapa kalah?" | Sekitar 18% prospek ad-hoc kalah (±0,22 prospek kalah per pekerjaan yang dimenangkan); alasan tidak tercatat. | S1 |
| semua | "Berapa pelanggan baru bulan ini vs pelanggan lama?" | Generator: repeat sole 35%, UKM 45%, enterprise 70%; dari DB hanya bisa ditebak lewat nama/telepon. | M1 |

## 8. Usulan urutan implementasi

| Tahap | Isi | Dampak |
|-------|-----|--------|
| 1 (cepat, tanpa skema besar) | M2, M3 (dropdown di formulir Permintaan); S1 (alasan kalah); M7 (kategori ledger tambahan + keterangan); perbaiki A1–A2 | Sudah cukup untuk saran sole trader/UKM yang tidak menyesatkan. |
| 2 | M1 (tabel pelanggan), M4 (kota/cabang terstruktur), M5 (qty/satuan diisi AI dari deskripsi) | Membuka analisis repeat, segmen, wilayah, dan harga per satuan. |
| 3 | M6 (kontrak & tagihan berulang), S2–S4 (kapasitas, pembayaran, roster), S6 (profil & target) | Wajib untuk enterprise 5–10%/bln. |

Setelah tiap tahap, buat ulang data demo dengan field baru (generator sudah menyimpan nilai kebenarannya: tipe pelanggan, wilayah, kontrak, roster), lalu ulangi skenario §7.
