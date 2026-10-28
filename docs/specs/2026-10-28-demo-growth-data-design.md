# Data Demo Pertumbuhan Usaha (Dummy)

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Rancangan data demo yang mensimulasikan pertumbuhan 9 usaha jasa di Indonesia selama 12 bulan (November 2025 – Oktober 2026). Data ini dipakai untuk (1) demo produk dan (2) pengujian oleh analis bisnis: apakah input formulir yang ada cukup bagi AI untuk memberi saran pertumbuhan yang akurat. Hasil kajian kedua ada di [2026-10-28-form-data-sufficiency-review.md](2026-10-28-form-data-sufficiency-review.md).

> **Peringatan.** Seluruh data adalah **DUMMY**. Nama pelanggan, perusahaan, rumah sakit, telepon, alamat jalan, dan pekerja dibuat acak dan fiktif. Kemiripan dengan entitas nyata tidak disengaja. Angka pertumbuhan wilayah adalah **asumsi demo**, bukan data BPS. Data ini tidak boleh dipakai sebagai acuan bisnis nyata atau dibagikan sebagai data pelanggan.

## 1. Ringkasan

| Item | Nilai |
|------|-------|
| Generator | `scripts/seed-demo.mjs` (Node ESM, tanpa dependency, PRNG ber-seed, deterministik) |
| Output | Penuh: `seeds/demo.sql` (±10,6 MB, 415 `INSERT`), `seeds/demo-summary.json`. Lean: `seeds/demo-lean.part{1..3}of3.sql`, `seeds/demo-lean-summary.json` (§7.1). |
| Jendela data | 12 bulan, bulan terakhir = bulan `--end` (default Oktober 2026) |
| Batas "hari ini" (as-of) | Default `2026-10-28 17:00 WIB`. Tidak ada baris yang lebih baru dari as-of. |
| Volume | 9 akun, ±39.200 baris (requests 5.582 · offers 5.493 · assignments 4.900 · completions 4.792 · ledger 18.316 · reports 99) |
| Target pertumbuhan | Sole trader & UKM 1–2%/bulan · Enterprise 5–10%/bulan |
| Konteks makro | Nasional ~5%/tahun; wilayah menengah ~6,5%/tahun; wilayah cepat ~8–10%/tahun |

## 2. Usaha yang disimulasikan

| # | Akun | Usaha | Skala | Wilayah (profil) | Pendapatan Nov-25 → Sep-26 | Margin 11 bln |
|---|------|-------|-------|------------------|------------------------|-----------|
| 1 | demo-ac | Budi Santoso (Servis AC): cuci, freon, bongkar pasang, perbaikan | Sole | Bekasi (nasional) | Rp18,5 jt → Rp23,5 jt | 31,4% |
| 2 | demo-cleaning | Rina Kusuma (Rapi Bersih Home Cleaning): rumah & kos, langganan mingguan | Sole | Makassar (cepat) | Rp15,2 jt → Rp16,5 jt | 31,4% |
| 3 | demo-listrik | Hendra Siregar (Listrik Siaga Medan): korsleting, titik lampu, panel, pompa | Sole | Medan (nasional) | Rp17,1 jt → Rp17,7 jt | 31,6% |
| 4 | demo-pest | CV Basmi Hama Nusantara: kontrak bulanan F&B/gudang, rayap, fogging, fumigasi | UKM | Surabaya + Sidoarjo–Gresik (nasional) | Rp182 jt → Rp190 jt | 23,7% |
| 5 | demo-laundry | CV Wangi Bersih Laundry: 3 outlet kiloan + kontrak linen hotel/resto/klinik | UKM | Bandung (nasional) | Rp158 jt → Rp181 jt | 22,4% |
| 6 | demo-dinding | CV Glasur Dinding Borneo: cat interior/eksterior, waterproofing, coating glasur | UKM | Balikpapan & koridor IKN (cepat) | Rp174 jt → Rp249 jt | 17,8% |
| 7 | demo-mall | PT Arunika Layanan Ritel: kontrak kebersihan & MEP mal + work order | Enterprise | 8 wilayah, HQ Jakarta | Rp1,56 M → Rp3,66 M | 14,6% |
| 8 | demo-fm | PT Prima Layanan Fasilitas: integrated FM kantor BUMN, bank, perkantoran | Enterprise | 9 wilayah, HQ Jakarta | Rp1,65 M → Rp3,21 M | 12,7% |
| 9 | demo-rs | PT Sehat Bersih Medika: housekeeping RS, klinik bersalin, lab | Enterprise | 8 wilayah, HQ Surabaya | Rp1,41 M → Rp3,28 M | 11,6% |

Detail katalog layanan, rentang harga, porsi biaya, roster pekerja, dan overhead per usaha ada di konstanta `BUSINESSES` dalam generator.

Ciri industri yang sengaja dimodelkan:

| Usaha | Ciri |
|-------|------|
| AC, listrik | Tiket kecil (Rp150 rb – Rp1,5 jt). Biaya bahan tinggi untuk freon dan sparepart. Helper dibayar per job. |
| Cleaning rumah/kos | Porsi tenaga ±45% dari harga. Sekitar 18% pendapatan dari langganan kos/rumah bulanan. |
| Pest control | 45% kontrak bulanan. Permintaan naik di musim hujan (rayap, nyamuk/DBD, tikus). |
| Laundry | Volume tinggi, tiket rendah. Penjualan walk-in dicatat sebagai **rekap kas harian per outlet** (±60–80 rekap/bulan), karena aplikasi tidak punya POS. 42% dari kontrak linen B2B. Overhead listrik/gas/air besar. |
| Glasur & dinding | Proyek per m² (Rp3–80 jt). Porsi bahan 32–44%. Puncak di musim kemarau, eksterior turun saat hujan. Lonjakan cat ulang menjelang Lebaran. |
| Mal, FM, RS | 60–66% **tagihan kontrak bulanan berulang** (per petugas/teknisi/cabang) ditambah **work order** ad-hoc (Rp1,2 jt – Rp85 jt). Ekspansi cabang ke wilayah cepat. RS: biaya consumable/APD lebih tinggi dan potongan SLA sesekali (`biaya_lain`). |

## 3. Model pertumbuhan

### 3.1 Rumus

Untuk usaha *b* dan bulan ke-*m* (m = 0 untuk bulan pertama):

```
trend_m   = base_b × (1 + g_b)^m
S_m       = Σ_hari intensitas_b(d) / rata-rata 12 bulan       (indeks musiman ad-hoc)
SI_m      = c_b + (1 − c_b) × S_m                             (kontrak tidak musiman)
target_m  = trend_m × SI_m × ε_m,  ε_m ~ LogNormal(0, σ=0,025)
```

| Simbol | Arti |
|--------|------|
| `g_b` | Pertumbuhan bulanan yang diundi seragam di dalam band dengan margin aman: sole/UKM 1,2–1,8%, enterprise 6–9%. |
| `c_b` | Porsi pendapatan dari kontrak berulang (0 – 0,66). |
| Kontrak | Pendapatan kontrak = Σ nilai kontrak aktif. Kontrak baru dimenangkan sampai mencapai `trend_m × c_b`. Churn 0,6–4%/bulan. Eskalasi harga 3–6% tiap Januari. |
| Ad-hoc | Pekerjaan ad-hoc diundi (layanan, kuantitas, harga) sampai jumlahnya mencapai `target_m − kontrak`. |
| Harga | Ikut inflasi harga jasa ±0,25%/bulan (±3%/tahun). Volume menyesuaikan agar target tercapai. |

Dekomposisi yang dipakai untuk menjelaskan angka: `g_b ≈ g_wilayah/12 + g_pangsa`. Contoh UKM nasional: 5%/12 ≈ 0,41%/bulan dari ekonomi, sisanya ±1% dari tambahan pelanggan atau pangsa pasar. Enterprise tumbuh jauh di atas makro (5–10%/bulan) karena menang kontrak dan membuka cabang. Profil wilayah hanya menentukan **dari mana** pertumbuhan itu datang (lihat §5).

### 3.2 Cek band

Generator menghitung ulang angka dari jurnal yang benar-benar ditulis, per bulan kalender WIB berdasarkan `posted_at`, dan hanya memakai bulan penuh:

| Metrik | Cara hitung |
|--------|-------------|
| Tren desesonal | Regresi log-linear `ln(pendapatan_m / SI_m)` terhadap *m*, lalu `g = e^slope − 1`. **Inilah yang diuji terhadap band.** |
| CMGR mentah | `(pendapatan_akhir / pendapatan_awal)^(1/n) − 1`. Ikut terdistorsi musim. |
| Setara tahunan | `(1 + g)^12 − 1` |
| Margin | (Σ pendapatan − Σ biaya) / Σ pendapatan |

Bila tren atau margin di luar target, generator mengulang dengan sub-seed berikutnya (maksimal 40 kali). Pada seed default semua usaha lolos di percobaan pertama.

| Akun | g model | Tren desesonal | CMGR mentah | Setara tahunan | Margin (target) | Job/bulan | Pelanggan | Kontrak aktif/total |
|------|---------|----------------|-------------|----------------|-----------------|-----------|-----------|---------------------|
| ac | 1,71% | **1,18%** | 2,43% | 15% | 31,4% (25–35) | 32–60 | 487 | – |
| cleaning | 1,47% | **1,75%** | 0,84% | 23% | 31,4% (25–35) | 16–36 + langganan | 304 | 4/7 |
| listrik | 1,25% | **1,67%** | 0,34% | 22% | 31,6% (25–35) | 18–32 | 290 | – |
| pest | 1,66% | **1,62%** | 0,41% | 21% | 23,7% (15–25) | 22–35 | 214 | 15/16 |
| laundry | 1,28% | **1,49%** | 1,36% | 19% | 22,4% (15–25) | 58–78 | 125 | 10/12 |
| dinding | 1,50% | **1,23%** | 3,67% | 16% | 17,8% (15–25) | 14–24 | 189 | – |
| mall | 8,90% | **9,06%** | 8,93% | 183% | 14,6% (10–18) | 37–91 | 379 | 16/21 |
| fm | 6,90% | **7,01%** | 6,92% | 125% | 12,7% (10–18) | 29–85 | 288 | 15/15 |
| rs | 8,81% | **8,70%** | 8,78% | 172% | 11,6% (10–18) | 37–107 | 419 | 18/18 |

Catatan untuk analis:

- **MoM mentah sengaja naik-turun.** Contoh: AC Januari −12,7%, karena puncak hujan. Listrik CMGR mentah hanya 0,34% karena puncak musiman (korsleting) ada di awal jendela, November–Januari. Dinding 3,67% karena puncak kemarau ada di akhir jendela. Band 1–2% hanya terlihat setelah musim dikoreksi. Ini kasus uji yang bagus: AI yang hanya membandingkan bulan ini dengan bulan lalu akan salah menyimpulkan.
- **Bulan berjalan dikecualikan.** Oktober 2026 terpotong di as-of, jadi tidak ikut regresi dan tidak dihitung MoM.

Ringkasan lengkap per bulan (pendapatan, biaya, laba, MoM, MoM desesonal, indeks musiman) tercetak saat skrip dijalankan dan tersimpan di `seeds/demo-summary.json`.

## 4. Kalender musiman (Nov 2025 – Okt 2026)

Intensitas harian per usaha dihitung dengan rumus berikut:

```
intensitas(d) = faktor_bulan[b][bulan] × faktor_hari[skala][hari]
                × libur × akhir_tahun × Ramadan/Lebaran
```

### 4.1 Faktor kalender

| Periode (perkiraan) | Faktor | Alasan |
|---------------------|--------|--------|
| Musim hujan Nov–Mar | Layanan outdoor ×0,55. Layanan "hujan" ×1,15–1,6 (fogging/DBD, rayap, korsleting, laundry kiloan, disinfeksi RS). | Pekerjaan luar ruang tertunda; masalah musim hujan naik. Catatan penyelesaian kadang berisi "Sempat tertunda hujan". |
| 10–23 Des | ×1,2–1,25 | Puncak akhir tahun: persiapan Natal/Tahun Baru, serapan anggaran korporat/instansi. |
| 24 Des – 1 Jan | ×0,45–0,6 | Libur akhir tahun. |
| Ramadan ±18 Feb – 19 Mar 2026 | Pra-Lebaran (H-20 s.d. H-5): sole ×1,4, UKM ×1,35, enterprise ×1,12 | Bersih-bersih rumah, cuci AC, cat ulang, cuci karpet masjid, gorden. THR mulai cair. |
| Pekan Lebaran H-4 s.d. H+5 (±16–25 Mar 2026; Idulfitri ±20–21 Mar) | ×0,1–0,12 | Mudik dan cuti bersama. |
| Pasca-Lebaran H+6 s.d. H+12 | ×0,7–0,8 | Pekerja belum kembali penuh. |
| Libur sekolah Jun–Jul | Laundry/hotel ×1,06; cleaning & pest pada sekolah; mal ×1,04 | Okupansi hotel dan trafik mal naik; sekolah dibersihkan sebelum tahun ajaran baru. |
| Kemarau Jul–Okt | AC ×1,06–1,14; dinding ×1,06–1,12 | Cuaca panas; waktu ideal untuk cat eksterior dan waterproofing sebelum hujan. |
| Januari | Enterprise ×0,86–0,9 | Anggaran klien korporat/BUMN belum cair. |
| Hari libur nasional | Sole ×0,5, UKM ×0,2, enterprise ×0,1 | Daftar perkiraan di `HOLIDAYS`; cek SKB 3 Menteri untuk tanggal resmi. |
| Hari dalam minggu | Sole: Sabtu ×1,35, Minggu ×1,15, Jumat ×0,85. UKM: Minggu ×0,35. Enterprise: Sabtu ×0,5, Minggu ×0,15. | Rumah tangga memesan saat akhir pekan; B2B di hari kerja. |

### 4.2 Biaya musiman

| Usaha | Perlakuan | Dampak |
|-------|-----------|--------|
| UKM | THR dibayar tunai ±H-10 Lebaran. Laundry Rp4,1 jt/orang, pest Rp4,6 jt/orang, dinding Rp4,4 jt/orang × roster aktif. | Maret: margin −5% s.d. −10% meski pendapatan naik. |
| Sole | THR helper Rp1–1,5 jt. | Margin Maret ±19–22%. |
| Enterprise | THR diakrualkan dalam porsi biaya tenaga bulanan. | Tidak ada lonjakan. |

Perbedaan ini sengaja dibuat untuk menguji apakah AI memahami penyebab penurunan margin di bulan Maret.

### 4.3 Indeks musiman hasil (SI, Nov → Okt)

| Akun | Nov | Des | Jan | Feb | Mar | Apr | Mei | Jun | Jul | Agu | Sep | Okt |
|------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| ac | 1,01 | 0,97 | 0,85 | 0,81 | 0,86 | 0,99 | 1,04 | 1,01 | 1,04 | 1,09 | 1,13 | 1,20 |
| cleaning | 1,01 | 1,03 | 0,95 | 0,92 | 0,93 | 0,99 | 0,98 | 1,02 | 1,09 | 1,03 | 0,99 | 1,05 |
| listrik | 1,07 | 1,05 | 1,09 | 0,99 | 0,92 | 0,96 | 0,95 | 0,94 | 1,01 | 0,98 | 0,98 | 1,05 |
| pest | 1,03 | 1,06 | 1,05 | 1,03 | 0,94 | 1,00 | 0,95 | 0,95 | 0,99 | 0,95 | 1,00 | 1,04 |
| laundry | 1,00 | 1,07 | 0,97 | 0,97 | 0,92 | 0,99 | 0,97 | 1,02 | 1,08 | 0,98 | 1,00 | 1,03 |
| dinding | 0,93 | 0,91 | 0,85 | 0,81 | 0,86 | 0,99 | 0,98 | 1,06 | 1,19 | 1,11 | 1,15 | 1,14 |
| mall | 1,00 | 1,05 | 0,97 | 0,96 | 0,92 | 1,01 | 0,97 | 1,01 | 1,06 | 0,98 | 1,02 | 1,03 |
| fm | 1,02 | 1,05 | 0,95 | 0,95 | 0,90 | 1,00 | 0,97 | 1,01 | 1,05 | 0,99 | 1,04 | 1,06 |
| rs | 1,00 | 1,01 | 1,03 | 1,00 | 0,92 | 1,00 | 0,97 | 0,99 | 1,03 | 0,99 | 1,02 | 1,03 |

Maret tampak rendah secara bulanan karena lonjakan pra-Lebaran (awal Maret dan akhir Februari) tertutup oleh pekan Lebaran. Indeks enterprise lebih datar karena porsi kontraknya besar.

## 5. Profil wilayah

| Kode | Wilayah | Profil | Asumsi pertumbuhan/th | Dipakai oleh |
|------|---------|--------|-----------------------|--------------|
| JKT | DKI Jakarta | nasional | 5,0% | mall (HQ), fm (HQ), rs |
| BDT | Bodetabek | nasional | 5,2% | mall, fm |
| BKS | Kota/Kab. Bekasi | nasional | 5,2% | ac |
| BDG | Bandung Raya | nasional | 5,0% | laundry, mall, fm |
| SBY / SDA | Surabaya / Sidoarjo–Gresik | nasional | 5,0% / 5,2% | pest, mall, fm, rs (HQ) |
| MLG, SMG | Malang, Semarang | nasional | 5,0% | fm, rs |
| MDN | Medan | nasional | 4,9% | listrik, mall, fm, rs |
| DPS | Denpasar–Badung | menengah | 6,5% | rs |
| BTM | Batam | menengah | 6,5% | mall |
| MKS | Makassar | cepat | 8,0% | cleaning, mall, fm, rs |
| BPN | Balikpapan & koridor IKN | cepat | 9,0% | dinding, mall, fm, rs |
| MRW | Morowali–Kendari (kawasan industri) | cepat | 10,0% | fm |

Bobot wilayah untuk enterprise di bulan *m*:

```
w_r(m) = w_r × ramp_r(m) × ((1 + G_r) / 1,05)^(α·m/12),  α = 8
```

| Komponen | Arti |
|----------|------|
| `w_r` | Bobot dasar wilayah. |
| `ramp_r(m)` | 0 sebelum cabang dibuka, lalu naik linear selama 3 bulan. Jadwal buka cabang: mall BTM m3, MKS m2, BPN m6; fm BPN m1, MKS m4, MRW m6; rs MKS m2, BPN m5, MDN m7. |
| `α = 8` | Penguat yang mencerminkan upaya penjualan enterprise yang mengikuti ekonomi lokal. Dengan α=8, wilayah 10%/th mendapat ±+40% bobot relatif terhadap wilayah 5%/th setelah 11 bulan. |

Wilayah dan cabang baru juga menambah overhead (sewa cabang Rp12–15 jt/bulan per cabang).

Hasil pangsa pendapatan, bulan penuh pertama → terakhir:

| Akun | Perubahan pangsa |
|------|------------------|
| fm | JKT 63% → 49%. Pangsa baru: MRW 5%, BPN 2%, MKS 1%. |
| rs | Baru: MKS 14% dan BPN 2%. DPS (menengah) 3% → 10%. |
| mall | Baru: MKS 4%, BPN 2%, BTM 2%. |

Karena kontrak besar bersifat "menggumpal", pangsa per wilayah bisa melompat ketika satu kontrak dimenangkan. Ini realistis untuk B2B.

Wilayah tidak disimpan di kolom tersendiri (skema tidak punya kolomnya). Wilayah hanya tersirat dari teks `location`, dari `notes` penawaran ("Wilayah: …"), dan dari nama tim di `worker_name` ("Tim MKS-01 · Spv. …"). Ini salah satu temuan di kajian kecukupan data.

## 6. Pemetaan ke skema dan UI

### 6.1 Isian per tabel

| Tabel | Isian |
|-------|-------|
| `users` | 9 baris, UUID tetap `0d3e5a11-7c1a-4b5e-9a0K-5a7a1a1d000K`, `name` = nama usaha. |
| `requests` | `customer_name` (individu "Bapak/Ibu …", UMKM, PT, hotel, RS, mal, kantor BUMN/bank fiktif), `service_type` = nama layanan katalog, `phone` fiktif (0812-xxxx-xxxx atau `(kode area) xxxx-xxxx`; `NULL` untuk pelanggan walk-in laundry), `location`, `description` (kuantitas dan keluhan dalam teks bebas), `status` = `draft` (sama seperti yang ditulis aplikasi). |
| `offers` | `ai_proposal_json` = `{scope, price, terms, notes}`. `price` AI ±10% dari harga final. Lolos `validateOffer`: harga Rp10 rb – Rp1 M, `scope`/`terms` ≥ 10 karakter. `validated_price`/`validated_scope` = keputusan manusia. Status: `approved` (menang), `rejected` (kalah; 537 baris), `pending_approval`/`draft` (masih terbuka, ±7 hari terakhir). |
| `assignments` | `worker_name`: owner/helper (sole), petugas atau "Tim {lead} (n orang)" dari roster 8–15 orang yang membesar mengikuti pendapatan (UKM), "Tim {WIL}-nn · Spv. …" (enterprise). `status` `done` atau `assigned`. |
| `completions` | `notes` hasil kerja realistis, `status='done'`, `completed_at = created_at`, `photos_path = NULL`. |
| `ledger_entries` | Per pekerjaan: `pendapatan` (6% sedikit di atas harga penawaran: sparepart/volume tambahan), `biaya_tenaga`, `biaya_bahan`, `biaya_transport`, dan `biaya_lain` untuk potongan SLA RS. Overhead bulanan (gaji staf, sewa, iklan/marketing, asuransi, IT, BBM armada, THR) juga dicatat sebagai baris ledger. Karena `completion_id` wajib, baris overhead **dilekatkan ke penyelesaian terakhir sebelum tanggal posting**. Kategori hanya memakai 5 kunci `LEDGER_CATEGORIES`; marketing dan sewa masuk `biaya_lain`. `posted_at = created_at`. |
| `reports` | 11 laporan bulanan final per akun (Nov–Sep). Dibuat 1–4 hari setelah bulan tutup. `summary_json` mengikuti bentuk objek `report` di `src/stages/report.js`: `period, period_start, period_end, total_revenue, total_cost, net_profit, margin_pct, previous_period, by_category, top_customers, entries`. `entries` dibatasi 300 jurnal terakhir dengan tambahan `entries_total`/`entries_truncated` agar statement < 100 KB. `explanation_html` berisi ringkasan contoh berlabel "DATA DEMO". |

### 6.2 Urutan waktu dan realisme funnel

Urutan waktu dijamin: `request.created_at < offer.created_at < assignment.created_at < scheduled_at < completed_at ≤ ledger.posted_at`. Sudah diverifikasi dengan SQL: 0 pelanggaran.

| Jenis | Urutan |
|-------|--------|
| Ad-hoc | Permintaan masuk 0–3 hari (sole), 1–9 hari (UKM), atau 4–22 hari (enterprise) sebelum jadwal. Penawaran dibuat beberapa jam (sole) sampai 1–6 hari (enterprise) setelahnya. Posting 0–9 hari setelah selesai: admin UKM/enterprise sering membukukan per batch. 8–10% pekerjaan baru ditandai selesai 1–5 hari setelah dikerjakan. |
| Kontrak | Tiap kontrak punya tanggal siklus tagihan sendiri (1–26). Permintaan/penawaran "Tagihan kontrak bulanan … (siklus tgl N)" dibuat menjelang periode. Penugasan = awal periode layanan. `scheduled_at` = kunjungan BAST bulanan. Selesai = BAST. Invoice diposting 1–20 jam kemudian. |

Pemotongan di as-of menghasilkan antrean "Perlu tindakan" yang alami:

| Kondisi | Jumlah (seed default) |
|---------|-----------------------|
| Permintaan tanpa penawaran | 2–29 per akun (0–12 di antaranya masuk 7 hari terakhir; sisanya prospek lama yang batal) |
| Penawaran terbuka (`draft`/`pending_approval`) | 22 total |
| Penugasan aktif | 108 total; 0–4 per akun sudah lewat jadwal (tanda "Lewat jadwal") |
| Penyelesaian yang belum dibukukan (di database) | 0–6 per akun |
| Prospek yang tidak jadi (permintaan tanpa penawaran atau penawaran `rejected`) | Sole 10%, UKM 16%, enterprise 22% dari pekerjaan ad-hoc |

### 6.3 ID dan pelanggan berulang

| Item | Aturan |
|------|--------|
| ID | `K × 1.000.000 + n` per tabel (K = nomor usaha 1–9). FK selalu menunjuk baris milik owner yang sama. |
| Pelanggan berulang | Pool per wilayah dengan *preferential attachment*. Peluang repeat: sole 35%, UKM 45%, enterprise 70%. Kontrak berulang tiap bulan. Repeat customer hanya bisa dikenali dari kesamaan nama dan telepon (lihat kajian). |

## 7. Cara membuat ulang dan menerapkan

```bash
# 1) Generate (deterministik; ringkasan per usaha tercetak di terminal)
node scripts/seed-demo.mjs --months 12 --end 2026-10-31 --out seeds/demo.sql
#    --asof YYYY-MM-DD[THH:MM+07:00] | now   batas "hari ini"; default 2026-10-28 17:00 WIB
#    --seed N  --only ac,fm  --summary seeds/demo-summary.json|none  --quiet

# 2) Lokal
npx wrangler d1 migrations apply satu-alur-db --local
npx wrangler d1 execute satu-alur-db --local --file seeds/demo.sql

# 3) Produksi: hanya oleh lead, dengan --remote
```

### 7.1 Anggaran tulis D1 (`--lean`, `--split`, `--only`)

D1 Free membatasi 100.000 *rows written* per hari, termasuk entri indeks, untuk insert maupun delete. Setelah migrasi 0004, satu baris domain = 2 writes dan satu `users` = 3 writes. Skrip membaca indeks dari `migrations/`, mencetak estimasi tiap usaha (insert + hapus data lama), dan memberi peringatan keras bila total > 90.000. Data lama dibaca dari `--existing-counts` (output `wrangler --json`, `demo-summary.json` lama, atau objek per akun). Bila tidak ada, skrip mengasumsikan seed penuh sebelumnya.

| Mode | Baris | Writes (DB kosong) | Writes (mengganti seed penuh) |
|------|-------|--------------------|-------------------------------|
| Penuh | 39.182 | 78.400 | 156.764 |
| `--lean` | 17.504 | 35.044 | 113.408 → `--split 3` = 3 × ±38 ribu |

Perubahan pada mode lean:

| Aspek | Penuh | Lean |
|-------|-------|------|
| Jurnal per pekerjaan | 2–5 baris | 2 baris: pendapatan + 1 biaya gabungan (kategori = komponen terbesar) |
| Overhead | 4–7 baris/bulan | 1 baris/bulan; total biaya bulanan tetap sama |
| Laundry walk-in | Rekap harian per outlet | Rekap mingguan per outlet |
| Enterprise | Work order satuan | Work order kecil ditagih sebagai "Rekap work order bulanan" per klien; proyek ×1,8 lebih besar dan ×0,5 lebih jarang; kontrak ×1,6 lebih besar |
| Job per bulan | Enterprise 29–107 | Enterprise 6–34 |

Untuk 5 usaha yang katalognya tidak diubah lean (ac, cleaning, listrik, pest, dinding), pendapatan dan biaya bulanan **identik** dengan mode penuh. Seluruh band tetap lolos dan sudah dihitung ulang dengan SQL di lokal.

`--split N` membagi usaha (utuh) ke N file. Tiap file menghapus dan mengisi ulang hanya akun-akunnya sendiri. Terapkan satu file per hari UTC; resep lengkapnya di [seeds/README.md](../../seeds/README.md#free-tier-lean--split).

Skrip mengembalikan exit code 2 bila ada usaha di luar band. Untuk demo di tanggal lain, buat ulang dengan `--end` dan `--asof` yang sesuai. Contoh: `--end 2026-11-30 --asof 2026-11-20`. Tanpa itu, KPI "7 hari terakhir" kosong karena data berhenti di as-of. Detail keamanan re-run, akun yang sudah pernah login, dan efek `AUTOINCREMENT` ada di [seeds/README.md](../../seeds/README.md).

## 8. Verifikasi (lokal, 2026-10-28)

| Cek | Hasil |
|-----|-------|
| `wrangler d1 execute --local --file seeds/demo.sql` | 436 statement sukses, ±8 detik |
| Jumlah baris per akun | Cocok dengan `demo-summary.json` |
| Integritas FK dan kepemilikan (offer→request, ledger→completion) | 0 yatim |
| Urutan waktu di 4 transisi | 0 pelanggaran |
| Baris setelah as-of | 0 |
| Pendapatan/biaya bulanan dihitung ulang dengan SQL (`strftime('%Y-%m', datetime(posted_at,'+7 hours'))`) | Identik dengan ringkasan skrip. Tren desesonal ulang sama dengan tabel §3.2. |
| Dijalankan dua kali | Jumlah baris sama. Akun demo yang sudah login dengan UUID acak direkonsiliasi ke UUID tetap. |
| Generate dua kali | MD5 file identik |
| UI (`wrangler dev --local`, login OTP demo) | Ringkasan demo-pest, demo-fm, demo-rs tampil tanpa error. Laporan "Bulan lalu" demo-laundry = Rp180.800.000, sama dengan skrip. |

## 9. Batasan dan catatan

1. **[Sudah diperbaiki di aplikasi dengan keyset paging, 5.000 baris/halaman.]** Batas 1.000 baris per tabel. Sebelumnya `loadFlow()` memanggil `select` tanpa paginasi, dan worker membatasi `MAX_LIMIT = 1000`. 8 dari 9 akun punya lebih dari 1.000 jurnal. Akibatnya:
   - KPI total di Ringkasan hanya mencakup ±1.000 jurnal terbaru.
   - Penyelesaian lama tampil sebagai "Posting jurnal" di "Perlu tindakan", karena jurnalnya tidak ikut termuat.

   Laporan per bulan, 30 hari, dan 7 hari tetap benar. Perbaikan perlu di aplikasi (paginasi `range()` di `fetchTable`, atau agregasi di server).
2. **Penawaran `rejected` dihitung sebagai draf.** `draftOffers()` = semua status selain `approved`, sehingga 537 penawaran yang kalah muncul di antrean dan badge "Penawaran". Untuk data nyata hal yang sama akan terjadi.
3. **Overhead menempel ke penyelesaian pelanggan.** Gaji, sewa, iklan, dan THR tampil di Buku besar dengan nama pelanggan dari penyelesaian tempatnya dilekatkan. Ini konsekuensi skema (`completion_id NOT NULL`, tanpa kolom keterangan).
4. **Kontrak dan rekap kas adalah konvensi pencatatan**, bukan fitur aplikasi. Tagihan kontrak bulanan dibuat sebagai permintaan baru tiap bulan. Penjualan walk-in laundry dicatat sebagai satu "pekerjaan" rekap harian per outlet.
5. **Tanggal libur dan Ramadan/Lebaran** adalah perkiraan. Profil pertumbuhan wilayah adalah asumsi demo.
6. **Pajak tidak dimodelkan.** Harga enterprise "belum termasuk PPN 11%"; nilai ledger = DPP.
