# Data Demo Pertumbuhan Usaha (Dummy)

> Status: Draft
> Terakhir diperbarui: 2026-10-28 (revisi lapisan makro setelah audit QA)
> Pemilik: _TBD_

Rancangan data demo yang mensimulasikan pertumbuhan 9 usaha jasa di Indonesia selama 12 bulan (November 2025 – Oktober 2026). Data ini dipakai untuk (1) demo produk dan (2) pengujian oleh analis bisnis: apakah input formulir yang ada cukup bagi AI untuk memberi saran pertumbuhan yang akurat. Hasil kajian kedua ada di [2026-10-28-form-data-sufficiency-review.md](2026-10-28-form-data-sufficiency-review.md).

> **Peringatan.** Seluruh data adalah **DUMMY**. Nama pelanggan, perusahaan, rumah sakit, telepon, alamat jalan, dan pekerja dibuat acak dan fiktif. Kemiripan dengan entitas nyata tidak disengaja. Semua angka makro (pertumbuhan PDB/PDRB, inflasi, UMK, tarif pajak) adalah **asumsi perencanaan**, bukan rilis resmi. Data ini tidak boleh dipakai sebagai acuan bisnis nyata atau dibagikan sebagai data pelanggan.

> **Satu sumber angka.** Semua tabel angka hasil (pertumbuhan, dekomposisi harga/volume, CV, margin sebelum/setelah pajak, headcount, indeks musiman, pangsa wilayah, bulanan per usaha) ada di **[generated/demo-economic-summary.md](generated/demo-economic-summary.md)** (mode penuh) dan **[generated/demo-economic-summary-lean.md](generated/demo-economic-summary-lean.md)** (mode lean, yang diterapkan ke D1). Kedua berkas dibuat otomatis dari `seeds/demo-summary.json` / `seeds/demo-lean-summary.json` oleh `--report md`. Dokumen ini hanya menjelaskan model dan mengutip sedikit angka sebagai contoh; bila berbeda, yang berlaku adalah berkas *generated*.

## 1. Ringkasan

| Item | Nilai |
|------|-------|
| Generator | `scripts/seed-demo.mjs` (Node ESM, tanpa dependency, PRNG ber-seed, deterministik) |
| Output | Penuh: `seeds/demo.sql` (±9,6 MB, 369 `INSERT`), `seeds/demo-summary.json`. Lean: `seeds/demo-lean.part{1..3}of3.sql`, `seeds/demo-lean-summary.json` (§8.1). Laporan: `docs/specs/generated/demo-economic-summary*.md` |
| Jendela data | 12 bulan, bulan terakhir = bulan `--end` (default Oktober 2026) |
| Batas "hari ini" (as-of) | Default `2026-10-28 17:00 WIB`. Tidak ada baris yang lebih baru dari as-of. |
| Volume (penuh) | 9 akun, 34.822 baris (requests 5.428 · offers 5.332 · assignments 4.741 · completions 4.652 · ledger 14.570 · reports 99) |
| Target pertumbuhan | Sole trader & UKM 1–2%/bulan · Enterprise 5–10%/bulan, **nominal** (§3) |
| Konteks makro | PDB riil nasional ±5%/th, IHK ±2,8%/th, UMK +6,5% tiap Januari; wilayah boom (Morowali, Balikpapan/IKN, Maluku Utara) 8–10%/th riil (§4) |

## 2. Usaha yang disimulasikan

| # | Akun | Usaha | Skala | Wilayah (profil) | Model tenaga kerja |
|---|------|-------|-------|------------------|--------------------|
| 1 | demo-ac | Budi Santoso (Servis AC): cuci, freon, bongkar pasang, perbaikan | Sole | Bekasi (nasional) | Owner + helper harian per job |
| 2 | demo-cleaning | Rina Kusuma (Rapi Bersih Home Cleaning): rumah & kos, langganan mingguan | Sole | Makassar (menengah) | Owner + helper harian, kru berdua |
| 3 | demo-listrik | Hendra Siregar (Listrik Siaga Medan): korsleting, titik lampu, panel, pompa | Sole | Medan (nasional) | Owner + helper harian per job |
| 4 | demo-pest | CV Basmi Hama Nusantara: kontrak bulanan F&B/gudang, rayap, fogging, fumigasi | UKM | Surabaya + Sidoarjo–Gresik (nasional) | Teknisi tetap bergaji UMK |
| 5 | demo-laundry | CV Wangi Bersih Laundry: 3 outlet kiloan + kontrak linen hotel/resto/klinik | UKM | Bandung (nasional) | Operator tetap bergaji UMK |
| 6 | demo-dinding | CV Glasur Dinding Borneo: cat interior/eksterior, waterproofing, coating glasur | UKM | Balikpapan & koridor IKN (boom) | Tukang tetap bergaji UMK |
| 7 | demo-mall | PT Arunika Layanan Ritel: kontrak kebersihan & MEP mal + work order | Enterprise | 8 wilayah, HQ Jakarta | Petugas kontrak per wilayah + tim mobile |
| 8 | demo-fm | PT Prima Layanan Fasilitas: integrated FM kantor BUMN, bank, perkantoran | Enterprise | 9 wilayah, HQ Jakarta | Petugas kontrak per wilayah + tim mobile |
| 9 | demo-rs | PT Sehat Bersih Medika: housekeeping RS, klinik bersalin, lab | Enterprise | 8 wilayah, HQ Surabaya | Petugas kontrak per wilayah + tim mobile |

Pendapatan bulan pertama → terakhir, margin, dan headcount per akun: lihat [generated §3 dan §11](generated/demo-economic-summary.md#3-hasil-per-usaha). Detail katalog layanan, rentang harga, porsi biaya, roster, dan overhead ada di konstanta `BUSINESSES` dalam generator.

Ciri industri yang sengaja dimodelkan:

| Usaha | Ciri |
|-------|------|
| AC, listrik | Tiket kecil (Rp150 rb – Rp1,5 jt). Bahan tinggi untuk freon, kabel, MCB, dan sparepart (listrik ±40% pendapatan). Helper dibayar per job. |
| Cleaning rumah/kos | Tenaga ±41% dari pendapatan, bahan 5–10%. Sekitar 19% pendapatan dari langganan kos/rumah bulanan. |
| Pest control | ±47% kontrak bulanan. Bahan kimia ±25%. Permintaan naik di musim hujan (rayap, nyamuk/DBD, tikus). |
| Laundry | Volume tinggi, tiket rendah. Walk-in dicatat sebagai **rekap kas harian per outlet** (aplikasi tidak punya POS). ±42% dari kontrak linen B2B. Deterjen/chemical 8–13%, listrik/gas/air sebagai biaya variabel terpisah. |
| Glasur & dinding | Proyek per m² (Rp3–80 jt). Bahan (cat, coating) 31–44%. Puncak di musim kemarau, eksterior turun saat hujan. |
| Mal, FM, RS | 59–66% **tagihan kontrak bulanan berulang** (per petugas/teknisi/cabang) ditambah **work order** ad-hoc (Rp1,2 jt – Rp85 jt). Kontrak per petugas dihargai dari UMK wilayah. Ekspansi cabang ke wilayah boom. RS: consumable/APD lebih tinggi, pelatihan PPI per petugas, potongan SLA sesekali. |

## 3. Model pertumbuhan

### 3.1 Target bisnis = pertumbuhan pendapatan NOMINAL

Target yang ditetapkan tim (sole/UKM 1–2%/bulan, enterprise 5–10%/bulan) **tetap**, tetapi kini dinyatakan dengan tegas sebagai **target pendapatan nominal** (rupiah yang tercatat di buku besar). Pendorong utamanya adalah **volume** (jumlah pekerjaan, pelanggan, kontrak, cabang), bukan kenaikan harga. Generator memecahnya menjadi dua komponen dan mencetaknya per usaha:

```
(1 + g_nominal) = (1 + g_volume_riil) × (1 + g_harga)
g_volume_riil   = g_pasar_wilayah_riil ⊕ g_tambahan_pangsa
```

Pada seed default, kenaikan harga menyumbang ±0,3–0,45%/bulan (±17–36% dari pertumbuhan nominal sole/UKM, ±6–7% untuk enterprise). Sisanya volume riil. Volume riil sole/UKM ±0,7–1,4%/bulan berada di atas pasar wilayah riil (±0,4–0,7%/bulan). Selisihnya adalah tambahan pangsa (pelanggan baru, repeat, kanal). Angka per akun: [generated §4](generated/demo-economic-summary.md#4-dekomposisi-pertumbuhan).

### 3.2 Rumus

Untuk usaha *b* dan bulan ke-*m* (m = 0 untuk bulan pertama):

```
trend_m   = base_b × (1 + g_b)^m                               (target NOMINAL)
S_m       = Σ_hari intensitas_b(d) / rata-rata 12 bulan         (indeks musiman ad-hoc)
SI_m      = c_b + (1 − c_b) × S_m                               (kontrak tidak musiman)
target_m  = trend_m × SI_m × ε_m,  ε_m ~ LogNormal(0, σ)        σ: sole 0,04 · UKM 0,035 · enterprise 0,025
harga_m   = harga_katalog × P_m        (ad-hoc)
          = q × UMK_wilayah(tahun) × kelipatan   (kontrak per petugas)
volume_m  = target_m ÷ harga_m         (jumlah pekerjaan diundi sampai target tercapai)
```

| Simbol | Arti |
|--------|------|
| `g_b` | Pertumbuhan nominal bulanan yang diundi seragam di dalam band dengan margin aman: sole/UKM 1,2–1,8%, enterprise 6–9%. |
| `P_m` | Indeks tarif jasa: naik **tiap Januari** (sole/UKM 3–5%, enterprise 4–6%) dan, pada ±35% usaha, sekali lagi **di bulan Juli** (1–2%). Bukan lagi kenaikan halus 0,25%/bulan. |
| `c_b` | Porsi pendapatan dari kontrak berulang (0 – 0,66). |
| Kontrak | Pendapatan kontrak = Σ nilai kontrak aktif. Kontrak baru dimenangkan sampai mencapai `trend_m × c_b`. Churn 0,6–4%/bulan. Eskalasi Januari: kontrak per petugas **+6,5% mengikuti UMK**; kontrak lain +3–5%. |
| Ad-hoc | Pekerjaan diundi (layanan, kuantitas, harga) sampai jumlahnya mencapai `target_m − kontrak`. |

### 3.3 Cek band

Generator menghitung ulang angka dari jurnal yang benar-benar ditulis, per bulan kalender WIB berdasarkan `posted_at`, dan hanya memakai bulan penuh:

| Metrik | Cara hitung | Diuji? |
|--------|-------------|--------|
| Tren nominal desesonal | Regresi log-linear `ln(pendapatan_m / SI_m)` terhadap *m*, `g = e^slope − 1` | **Ya**, terhadap band skala |
| Tren volume riil | Regresi yang sama atas `Σ(pendapatan ÷ indeks harga tagihan) / SI_m` | Dilaporkan |
| Kontribusi harga | `(1 + tren nominal) / (1 + tren riil) − 1` | Dilaporkan |
| CMGR mentah | `(pendapatan_akhir / pendapatan_awal)^(1/n) − 1`, ikut terdistorsi musim | Dilaporkan |
| CV sekitar tren | Deviasi standar residual `ln(pendapatan_m)` terhadap garis tren log-linear (musim + derau, tanpa pertumbuhan) | **Ya** untuk sole/UKM: 5–20% |
| Margin sebelum pajak | (Σ pendapatan − Σ biaya) / Σ pendapatan | **Ya**, terhadap target usaha |
| Peredaran UKM | Peredaran setahun ≤ Rp4,8 M (syarat rezim PPh Final) | **Ya** |

Bila salah satu cek gagal, generator mengulang dengan sub-seed berikutnya (maksimal 40 kali) dan keluar dengan kode 2 bila tetap gagal. Pada seed default semua akun lolos (mode penuh dan lean) di percobaan pertama atau kedua.

Catatan untuk analis:

- **MoM mentah sengaja naik-turun.** Contoh seed default: AC Januari −14,3% (puncak hujan). Listrik CMGR mentah hanya ±0,7% karena puncak korsleting ada di awal jendela; dinding ±3,6% karena puncak kemarau ada di akhir jendela. Band 1–2% baru terlihat setelah musim dikoreksi.
- **Bulan berjalan dikecualikan.** Oktober 2026 terpotong di as-of, jadi tidak ikut regresi, MoM, maupun total.

## 4. Lapisan makro: riil vs nominal, inflasi, upah, pajak

Semua parameter berada di satu blok `MACRO` (plus `PROFILES` dan `REG`) di awal generator. Setiap nilai diberi komentar sebagai **asumsi perencanaan** beserta sumber yang wajib dicek: Berita Resmi Statistik BPS (PDB/PDRB riil, inflasi IHK), SK Gubernur (UMK), serta PP 55/2022 dan UU HPP (pajak). Generator tidak mengklaim angka resmi apa pun. Tabel parameter lengkap dirender otomatis di [generated §1–2](generated/demo-economic-summary.md#1-asumsi-makro).

### 4.1 Riil vs nominal

Angka pertumbuhan "5% nasional, 8–10% wilayah boom" adalah pertumbuhan **riil** PDB/PDRB. Pendapatan di buku besar adalah **nominal**. Generator memakai:

```
nominal_wilayah = (1 + riil_wilayah) × (1 + IHK) − 1        contoh nasional: 1,05 × 1,028 − 1 ≈ 7,9%/th
```

| Profil | PDRB riil (asumsi) | Wilayah di generator |
|--------|--------------------|----------------------|
| Nasional (metro Jawa–Sumatra) | 4,5–5,5%/th | JKT, BDT, BKS, BDG, SBY, SDA, MLG, SMG, MDN |
| Menengah (pariwisata, industri) | 5,5–6,0%/th | DPS, BTM, MKS |
| Boom (nikel, IKN) | 8–10%/th | BPN (Balikpapan/IKN), MRW (Morowali–Kendari), MLU (Maluku Utara, tersedia tetapi belum dipakai) |

Perubahan dibanding versi sebelumnya: Makassar dipindah dari profil "cepat 8%" ke "menengah 5,6%", karena 8–10% hanya wajar untuk wilayah boom. Angka aktual provinsi tambang bisa jauh berbeda dan berfluktuasi; cek BRS PDRB provinsi.

Penerapan:

| Mekanisme | Rumus/perlakuan |
|-----------|-----------------|
| Drift permintaan wilayah (enterprise) | `w_r(m) = w_r × ramp_r(m) × ((1 + nominal_r) / (1 + nominal_nasional))^(α·m/12)`, α = 8. Kemiringan memakai **nominal** (riil + inflasi). |
| Pasar wilayah (sole/UKM) | Dilaporkan sebagai pembanding: `(1 + riil_r)^(1/12) − 1` ditimbang pangsa pendapatan. Tambahan pangsa = volume riil di atasnya. |

### 4.2 Inflasi harga jual, upah, bahan, sewa

| Indeks | Kapan naik | Besaran (asumsi) | Dipakai untuk |
|--------|-----------|------------------|---------------|
| Tarif jasa `P` | Tiap Januari; ±35% usaha juga di Juli | Sole/UKM 3–5%, enterprise 4–6%; Juli 1–2% | Harga tiket ad-hoc |
| UMK `W` | Tiap 1 Januari | +6,5% | Gaji tetap, tarif helper harian, harga kontrak per petugas, THR |
| Bahan/material | Bertahap per bulan | 4%/th | Biaya bahan per job |
| BBM/transport | Bertahap per bulan | 3%/th | Transport per job, BBM armada |
| Sewa | Tiap Januari | +5% | Sewa kantor, gudang, outlet |
| Langganan aplikasi/internet | Tiap Januari | +3% | Biaya software |

Biaya per job dihitung sebagai `pendapatan × porsi × indeks_biaya ÷ indeks_harga_jual`. Karena UMK (+6,5%) naik lebih cepat daripada tarif jasa (+3–5%), margin usaha padat karya sedikit tertekan setiap Januari, kecuali kontrak per petugas yang eskalasinya mengikuti UMK. Ini perilaku yang realistis dan bisa diuji ke AI ("kenapa margin Januari turun padahal harga sudah naik?").

### 4.3 Struktur biaya: tetap vs variabel, tenaga all-in

| Komponen | Jenis | Perlakuan |
|----------|-------|-----------|
| Helper sole trader | Variabel | Dibayar per job. Tarifnya mengikuti indeks UMK. |
| Pekerja lapangan UKM | Semi-tetap | `headcount × UMK_wilayah × 1,167` per bulan (BPJS ±11,5% + seragam/APD/uang makan ±5,2%), ditambah **THR tunai 1 bulan UMK** saat H-10 Lebaran. Rata-rata setahun ≈ **1,25 × UMK**. |
| Petugas enterprise | Semi-tetap | `Σ (petugas × keahlian) × UMK_wilayah × 1,25` per wilayah per bulan (THR diakrualkan). Keahlian: kebersihan 1,0, housekeeping RS/FM 1,05, teknisi cabang 1,3, teknisi MEP 1,4. |
| Lembur/harian | Variabel | Beban di atas kapasitas pekerja tetap × UMK × 1,25 × 1,3. |
| Staf kantor (admin, supervisor, estimator, HQ) | Semi-tetap | Kelipatan UMK, bertambah bertingkat (misalnya 1 supervisor per 12 teknisi, 1 staf HR/payroll per 60 petugas). |
| Sewa, aplikasi, penyusutan alat, cicilan kendaraan | Tetap | Nominal tetap, naik hanya lewat indeks (Januari). |
| Marketing | Tetap | Anggaran tetap per bulan, dinaikkan di bulan kampanye (misalnya pra-Lebaran, musim ramai). Bukan lagi persentase pendapatan. |
| Bahan, transport per job, BBM armada, listrik/gas laundry, asuransi kontrak | Variabel | Sebanding volume riil × indeks biayanya. |

Kontrak per petugas dihargai `q × UMK_wilayah × kelipatan` (kebersihan mal 1,9–2,05×, FM 1,9–2,05×, housekeeping RS/klinik 2,0–2,15×, teknisi MEP 2,6–2,85×). Hasilnya, biaya tenaga ±60–64% dari nilai kontrak, consumable 6–14%, dan sisanya fee manajemen. Porsi bahan sudah diselaraskan: cleaning 5–10%, laundry 8–13%, pest 18–26%, cat/coating 31–44%.

Akibat biaya tetap dan semi-tetap, margin naik seiring volume (*operating leverage*). Contoh seed default: margin kuartal pertama → terakhir mal 11,4% → 16,4%, FM 6,4% → 16,4%. Rincian porsi biaya per akun: [generated §6](generated/demo-economic-summary.md#6-struktur-biaya-porsi-pendapatan-bulan-penuh).

### 4.4 Kapasitas dan headcount berbasis utilisasi

Headcount kini mengikuti volume, tidak lagi tetap atau berbasis pendapatan nominal:

| Skala | Aturan |
|-------|--------|
| Sole | Helper aktif = `ceil(rata-rata job 3 bulan × peluang memakai helper ÷ job maksimum per helper per bulan)` (AC 32, cleaning 17, listrik 20), minimal 1–2. Helper baru masuk saat beban melewati kapasitas. Jumlah helper tidak turun hanya karena satu bulan sepi. |
| UKM & enterprise | FTE = beban kerja riil (pendapatan riil × porsi tenaga ÷ biaya all-in UMK dasar). Kontrak per petugas: FTE = jumlah petugas di kontrak, ditempatkan penuh per wilayah. Pekerja tetap = `ceil(rata-rata FTE 3 bulan × (1 + g) ÷ 0,9)`. Pengurangan hanya lewat atrisi bertahap (±10%/bulan). Enterprise mengelola pekerja ad-hoc sebagai satu tim mobile lintas wilayah. |

Pada seed default, headcount AC 2 → 3 orang, cleaning 3 → 4, pest 10 → 11, laundry 10 → 12, dinding 12 → 15 (turun ke 10 saat musim hujan lalu naik lagi), dan enterprise ±134–147 → 242–306 orang. Listrik tetap 2 orang karena jumlah job mentahnya datar: puncak musim korsleting ada di awal jendela. Utilisasi per bulan ada di [generated §8](generated/demo-economic-summary.md#8-kapasitas-headcount-per-bulan).

### 4.5 Pajak: laba sebelum pajak vs estimasi setelah pajak

Aplikasi kini melabeli pendapatan − biaya sebagai **"Laba sebelum pajak"**. Karena itu pajak **tidak ditulis ke buku besar**: `LEDGER_CATEGORIES` (`src/stages/data.js`) belum punya kategori pajak, dan memakai `biaya_lain` akan membuat angka "Laba sebelum pajak" di aplikasi sebenarnya menjadi laba setelah pajak. Estimasi pajak hanya ada di ringkasan JSON dan laporan *generated*.

| Skala | Rezim (asumsi, wajib diverifikasi) | Estimasi di ringkasan |
|-------|------------------------------------|-----------------------|
| Sole (WP orang pribadi) | PPh Final UMKM 0,5% × peredaran bruto (PP 55/2022). Rp500 jt pertama peredaran per tahun pajak tidak dikenai pajak. Berlaku bila peredaran ≤ Rp4,8 M/th, batas waktu 7 tahun pajak. | Peredaran ketiga akun ±Rp185–224 jt/th, di bawah Rp500 jt, sehingga **pajak Rp0**. |
| UKM (CV) | PPh Final UMKM 0,5% × peredaran bruto bulanan, tanpa pembebasan Rp500 jt. Berlaku bila peredaran ≤ Rp4,8 M/th; batas waktu CV 4 tahun pajak (diasumsikan belum lewat). | ±0,5 poin dari margin. Generator memeriksa peredaran setahun ±Rp2,0–2,4 M ≤ Rp4,8 M. |
| Enterprise (PT) | PPh Badan 22% atas laba fiskal (UU HPP). Fasilitas Pasal 31E: peredaran ≤ Rp50 M mendapat pengurangan 50% tarif atas porsi PKP dari Rp4,8 M peredaran. | Perkiraan kasar: tarif efektif ±20% × laba sebelum pajak, tanpa koreksi fiskal. Hanya ilustrasi; tidak ditulis ke buku besar. |

Di luar estimasi: PPN 11% (pass-through; nilai ledger = DPP), PPh 23 2% yang dipotong klien B2B (kredit pajak, bukan biaya tambahan), PPh 21 karyawan (bagian dari gaji), dan pajak daerah.

### 4.6 Volatilitas bulanan

CV sekitar tren untuk sole/UKM diuji di rentang 5–20% (seed default: 5,5–9,0%). Derau bulanan dinaikkan dari σ = 0,025 menjadi 0,04 (sole) dan 0,035 (UKM). Enterprise tetap 0,025 karena porsi kontraknya besar (CV ±4–7%, tidak diuji). CV mentah (stdev/mean) juga dilaporkan; untuk enterprise nilainya ±25–29% karena tren 5–10%/bulan ikut terhitung.

### 4.7 Satu sumber kebenaran: `--report md`

```bash
node scripts/seed-demo.mjs --report md                     # simulasi + tulis docs/specs/generated/demo-economic-summary.md
node scripts/seed-demo.mjs --report md --from-summary seeds/demo-summary.json   # render ulang dari JSON, tanpa simulasi
node scripts/seed-demo.mjs --lean --split 3 --out seeds/demo-lean.sql --summary seeds/demo-lean-summary.json \
  --report md --report-out docs/specs/generated/demo-economic-summary-lean.md
```

Markdown dirender dari objek ringkasan yang sama dengan yang ditulis ke JSON. `--from-summary` menghasilkan berkas yang identik byte per byte. Berkas *generated* tidak boleh diedit manual; ubah generator atau `MACRO`, lalu buat ulang.

## 5. Kalender musiman (Nov 2025 – Okt 2026)

Intensitas harian per usaha dihitung dengan rumus berikut:

```
intensitas(d) = faktor_bulan[b][bulan] × faktor_hari[skala][hari]
                × libur × akhir_tahun × Ramadan/Lebaran
```

### 5.1 Faktor kalender

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

### 5.2 Biaya musiman

| Usaha | Perlakuan | Dampak (seed default) |
|-------|-----------|-----------------------|
| UKM | THR tunai ±H-10 Lebaran = 1 bulan UMK × (pekerja lapangan + staf). Pest ±Rp66 jt, laundry ±Rp62 jt, dinding ±Rp51 jt. | Margin Maret −13% s.d. −22% meski pendapatan stabil. Lebih dalam dibanding versi lama (−5% s.d. −10%) karena THR kini dihitung dari UMK untuk seluruh karyawan, sesuai praktik pembukuan kas. |
| Sole | THR helper Rp650–900 rb per helper aktif. | Margin Maret ±19–26%. |
| Enterprise | THR diakrualkan dalam faktor all-in 1,25. | Tidak ada lonjakan. |
| Semua | Kenaikan UMK, sewa, dan tarif setiap Januari. | Margin padat karya sedikit turun di Januari bila kenaikan tarif < kenaikan UMK. |

Perbedaan ini sengaja dibuat untuk menguji apakah AI memahami penyebab penurunan margin di bulan Maret dan Januari.

### 5.3 Indeks musiman hasil

Tabel SI per akun per bulan: [generated §9](generated/demo-economic-summary.md#9-indeks-musiman-si). Maret tampak rendah secara bulanan karena lonjakan pra-Lebaran (awal Maret dan akhir Februari) tertutup oleh pekan Lebaran. Indeks enterprise lebih datar karena porsi kontraknya besar.

## 6. Profil wilayah dan ekspansi

Tabel wilayah (profil, PDRB riil, nominal, UMK perkiraan, pemakai): [generated §2](generated/demo-economic-summary.md#2-profil-wilayah).

| Komponen | Arti |
|----------|------|
| `w_r` | Bobot dasar wilayah. |
| `ramp_r(m)` | 0 sebelum cabang dibuka, lalu naik linear selama 3 bulan. Jadwal buka cabang: mall BTM m3, MKS m2, BPN m6; fm BPN m1, MKS m4, MRW m6; rs MKS m2, BPN m5, MDN m7. |
| `α = 8` | Penguat yang mencerminkan upaya penjualan enterprise yang mengikuti ekonomi lokal. Dengan α = 8, wilayah 10%/th riil mendapat ±+40% bobot relatif terhadap wilayah 5%/th setelah 11 bulan. |
| UMK wilayah | Menentukan harga kontrak per petugas dan gaji petugas di wilayah itu. |

Wilayah dan cabang baru juga menambah overhead semi-tetap (sewa cabang Rp8–9 jt/bulan, marketing/tender Rp3,5–4 jt/bulan per cabang). Pangsa pendapatan wilayah bulan penuh pertama → terakhir: [generated §10](generated/demo-economic-summary.md#10-pangsa-wilayah-bulan-penuh-pertama--terakhir). Contoh seed default: FM memperoleh pangsa baru di BPN (8%) dan MRW (4%); RS di BPN (8%) dan MKS (5%). Karena kontrak besar bersifat "menggumpal", pangsa per wilayah bisa melompat ketika satu kontrak dimenangkan. Ini realistis untuk B2B.

Wilayah tidak disimpan di kolom tersendiri (skema tidak punya kolomnya). Wilayah hanya tersirat dari teks `location`, dari `notes` penawaran ("Wilayah: …"), dan dari nama tim di `worker_name` ("Tim MKS-01 · Spv. …"). Ini salah satu temuan di kajian kecukupan data.

## 7. Pemetaan ke skema dan UI

### 7.1 Isian per tabel

| Tabel | Isian |
|-------|-------|
| `users` | 9 baris, UUID tetap `0d3e5a11-7c1a-4b5e-9a0K-5a7a1a1d000K`, `name` = nama usaha. |
| `requests` | `customer_name` (individu "Bapak/Ibu …", UMKM, PT, hotel, RS, mal, kantor BUMN/bank fiktif), `service_type` = nama layanan katalog, `phone` fiktif (`NULL` untuk walk-in laundry), `location`, `description` (kuantitas dan keluhan dalam teks bebas), `status` = `draft`. |
| `offers` | `ai_proposal_json` = `{scope, price, terms, notes}`. `price` AI ±10% dari harga final. Lolos `validateOffer`. Status: `approved` (menang), `rejected` (kalah; 527 baris), `pending_approval`/`draft` (masih terbuka, ±7 hari terakhir). |
| `assignments` | `worker_name`: owner/helper aktif (sole), petugas atau "Tim {lead} (n orang)" dari roster yang aktif sesuai headcount bulan itu (UKM), "Tim {WIL}-nn · Spv. …" dengan jumlah tim mengikuti pekerja tetap ad-hoc (enterprise). `status` `done` atau `assigned`. |
| `completions` | `notes` hasil kerja realistis, `status='done'`, `completed_at = created_at`, `photos_path = NULL`. |
| `ledger_entries` | Per pekerjaan: `pendapatan` (6% sedikit di atas harga penawaran), `biaya_bahan`, `biaya_transport`, `biaya_tenaga` **hanya untuk helper sole trader**, dan `biaya_lain` untuk potongan SLA RS. Per bulan: gaji pekerja lapangan tetap (UKM 1 baris, enterprise 1 baris per wilayah), lembur/harian bila ada, gaji staf/HQ, THR, sewa, aplikasi, marketing, asuransi, BBM armada. Karena `completion_id` wajib, baris bulanan **dilekatkan ke penyelesaian terakhir sebelum tanggal posting**. Kategori hanya memakai 5 kunci `LEDGER_CATEGORIES`; sewa, marketing, dan software masuk `biaya_lain`. **Tidak ada baris pajak** (§4.5). |
| `reports` | 11 laporan bulanan final per akun (Nov–Sep), dibuat 1–4 hari setelah bulan tutup. `summary_json` mengikuti bentuk objek `report` di `src/stages/report.js`. `explanation_html` memakai istilah "laba sebelum pajak" dan menambahkan catatan pajak sesuai skala, berlabel "DATA DEMO". |

### 7.2 Urutan waktu dan realisme funnel

Urutan waktu dijamin: `request.created_at < offer.created_at < assignment.created_at < scheduled_at < completed_at ≤ ledger.posted_at`. Sudah diverifikasi dengan SQL: 0 pelanggaran.

| Jenis | Urutan |
|-------|--------|
| Ad-hoc | Permintaan masuk 0–3 hari (sole), 1–9 hari (UKM), atau 4–22 hari (enterprise) sebelum jadwal. Penawaran dibuat beberapa jam (sole) sampai 1–6 hari (enterprise) setelahnya. Posting 0–9 hari setelah selesai. 8–10% pekerjaan baru ditandai selesai 1–5 hari setelah dikerjakan. |
| Kontrak | Tiap kontrak punya tanggal siklus tagihan sendiri (1–26). Penugasan = awal periode layanan. `scheduled_at` = kunjungan BAST bulanan. Selesai = BAST. Invoice diposting 1–20 jam kemudian. |

Pemotongan di as-of menghasilkan antrean "Perlu tindakan" yang alami (seed default, mode penuh):

| Kondisi | Jumlah |
|---------|--------|
| Permintaan tanpa penawaran | 1–29 per akun (0–16 di antaranya masuk 7 hari terakhir; sisanya prospek lama yang batal) |
| Penawaran terbuka (`draft`/`pending_approval`) | 21 total |
| Penugasan aktif | 89 total; 0–5 per akun sudah lewat jadwal |
| Penyelesaian yang belum dibukukan | 0–8 per akun |
| Prospek yang tidak jadi | Sole 10%, UKM 16%, enterprise 22% dari pekerjaan ad-hoc |

### 7.3 ID dan pelanggan berulang

| Item | Aturan |
|------|--------|
| ID | `K × 1.000.000 + n` per tabel (K = nomor usaha 1–9). FK selalu menunjuk baris milik owner yang sama. |
| Pelanggan berulang | Pool per wilayah dengan *preferential attachment*. Peluang repeat: sole 35%, UKM 45%, enterprise 70%. Kontrak berulang tiap bulan. |

## 8. Cara membuat ulang dan menerapkan

```bash
# 1) Generate (deterministik; ringkasan per usaha tercetak di terminal)
node scripts/seed-demo.mjs --months 12 --end 2026-10-31 --out seeds/demo.sql --report md
#    --asof YYYY-MM-DD[THH:MM+07:00] | now   batas "hari ini"; default 2026-10-28 17:00 WIB
#    --seed N  --only ac,fm  --summary seeds/demo-summary.json|none  --quiet
#    --report md [--report-out file.md] [--from-summary seeds/demo-summary.json]

# 2) Lokal
npx wrangler d1 migrations apply satu-alur-db --local
npx wrangler d1 execute satu-alur-db --local --file seeds/demo-lean.part1of3.sql   # dst. part2, part3

# 3) Produksi (--remote): JANGAN dijalankan sekarang (lihat §8.1)
```

### 8.1 Anggaran tulis D1 (`--lean`, `--split`, `--only`)

> **Jangan re-seed produksi saat ini.** Kuota tulis D1 produksi sedang ketat. Revisi ini hanya diverifikasi di D1 lokal. Penerapan `--remote` ditunda dan hanya boleh dilakukan oleh lead, satu file per hari UTC, setelah menghitung data lama dengan `--existing-counts`.

D1 Free membatasi 100.000 *rows written* per hari, termasuk entri indeks, untuk insert maupun delete. Satu baris domain = 2 writes dan satu `users` = 3 writes. Skrip membaca indeks dari `migrations/`, mencetak estimasi per usaha (insert + hapus data lama), dan memberi peringatan keras bila total > 90.000.

| Mode | Baris | Writes (DB kosong) | Writes (mengganti seed penuh revisi ini) |
|------|-------|--------------------|------------------------------------------|
| Penuh | 34.822 | 69.680 | 139.324 |
| `--lean` | 17.763 | 35.562 | 105.206 → `--split 3` = 3 file × ±34–36 ribu |

Seed penuh kini lebih ringan (−11% baris), karena UKM dan enterprise tidak lagi menulis baris `biaya_tenaga` per pekerjaan (gaji dicatat bulanan).

| Aspek | Penuh | Lean |
|-------|-------|------|
| Jurnal per pekerjaan | 2–4 baris | 2 baris: pendapatan + 1 biaya gabungan (kategori = komponen terbesar) |
| Overhead & gaji bulanan | 6–17 baris/bulan | 1 baris/bulan; total biaya bulanan tetap sama |
| Laundry walk-in | Rekap harian per outlet | Rekap mingguan per outlet |
| Enterprise | Work order satuan | Work order kecil ditagih sebagai "Rekap work order bulanan" per klien; proyek ×1,8 lebih besar dan ×0,5 lebih jarang; kontrak ×1,6 lebih besar |

Untuk 5 usaha yang katalognya tidak diubah lean (ac, cleaning, listrik, pest, dinding), pendapatan dan biaya bulanan **identik** dengan mode penuh. Analisis memakai rincian kategori × jenis biaya yang tersimpan di baris gabungan, sehingga struktur biaya mode lean tetap akurat. Seluruh band lolos di kedua mode.

`--split N` membagi usaha (utuh) ke N file. Tiap file menghapus dan mengisi ulang hanya akun-akunnya sendiri. Resep lengkapnya di [seeds/README.md](../../seeds/README.md#free-tier-lean--split).

## 9. Verifikasi (lokal, 2026-10-28)

| Cek | Hasil |
|-----|-------|
| `wrangler d1 migrations apply --local` lalu `execute --local --file` ketiga file lean | Sukses. Part 1 dijalankan dua kali untuk menguji re-run: jumlah baris tetap sama. |
| Jumlah baris per akun di D1 lokal | Cocok dengan `seeds/demo-lean-summary.json` untuk 9 akun |
| Pendapatan/biaya bulanan dihitung ulang dengan SQL (`strftime('%Y-%m', datetime(posted_at,'+7 hours'))`) | Identik dengan ringkasan untuk 9 akun × 12 bulan |
| Band dari SQL (tren nominal desesonal, margin sebelum pajak) | 9/9 lolos; tren dan margin SQL sama dengan JSON (selisih ≤ 0,01 poin karena pembulatan SI) |
| Integritas FK dan kepemilikan (offer→request, assignment→offer, completion→assignment, ledger→completion) | 0 yatim |
| Urutan waktu di 4 transisi | 0 pelanggaran |
| Baris setelah as-of, jumlah ≤ 0, kategori di luar `LEDGER_CATEGORIES` | 0 |
| Generate dua kali | MD5 file identik |
| `--report md --from-summary` | Identik byte per byte dengan hasil `--report md` saat generate |
| `node --test tests/*.test.mjs` | 145/145 lulus (termasuk `seed summary covers the same nine accounts`) |
| `--remote` | **Tidak dijalankan** |

## 10. Batasan dan catatan

1. **Overhead dan gaji menempel ke penyelesaian pelanggan.** Gaji, sewa, iklan, dan THR tampil di Buku besar dengan nama pelanggan dari penyelesaian tempatnya dilekatkan. Ini konsekuensi skema (`completion_id NOT NULL`, tanpa kolom keterangan). Margin per pekerjaan UKM/enterprise di database hanya memuat biaya variabel, karena gaji tetap dicatat bulanan.
2. **Penawaran `rejected` dihitung sebagai draf** oleh `draftOffers()` (lihat kajian §6).
3. **Kontrak dan rekap kas adalah konvensi pencatatan**, bukan fitur aplikasi.
4. **Tanggal libur dan Ramadan/Lebaran** adalah perkiraan.
5. **Semua angka makro adalah asumsi perencanaan** (§4): PDB/PDRB riil dan IHK perlu dicek ke BRS BPS, UMK ke SK Gubernur, dan aturan pajak ke PP 55/2022, UU HPP, serta konsultan pajak.
6. **Pajak hanya estimasi di ringkasan**, tidak ditulis ke buku besar (§4.5). PPN, PPh 23, dan PPh 21 tidak dimodelkan terpisah; nilai ledger = DPP.
7. **Margin target tidak diubah.** Dengan model biaya baru, target 10–18% enterprise masih tercapai karena campuran kontrak (labour ±60–64% nilai kontrak) dan work order yang marginnya lebih tinggi, ditambah *operating leverage*. Margin kontrak per petugas murni secara realistis hanya ±8–12% sebelum overhead. Karena itu enterprise demo berada di bagian bawah band (±12–15%), dan margin setelah pajaknya ±9,5–12%.

## 11. Tanggapan untuk QA: poin audit yang diadopsi

Ringkasan untuk QA/analis bisnis atas audit skenario ekonomi dummy:

| # | Poin audit | Status | Cara diterapkan |
|---|-----------|--------|-----------------|
| 1 | Riil vs nominal; inflasi; profil provinsi; UMK; inflasi bahan/BBM | **Diadopsi** | Blok `MACRO` + `PROFILES` + `REG` dengan komentar "asumsi perencanaan, cek BPS/SK Gubernur" per nilai. Nominal = (1 + riil)(1 + IHK) − 1 dipakai untuk drift wilayah. Tarif jasa naik tiap Januari (dan Juli pada ±35% usaha). UMK +6,5% tiap Januari untuk gaji, tarif helper, dan kontrak per petugas. Bahan 4%/th, BBM 3%/th, sewa 5% Januari. Makassar diturunkan ke profil menengah; 8–10% hanya untuk BPN, MRW, MLU (§4.1–4.2). |
| 2 | Target bisnis tetap, tetapi nyatakan sebagai nominal dan tunjukkan dekomposisi | **Diadopsi** | Target 1–2% dan 5–10%/bulan tidak diubah dan dinyatakan sebagai target **nominal**. Ringkasan JSON (`growth`) dan laporan *generated* §3–4 menampilkan tren nominal, volume riil, kontribusi harga (dan porsinya), pasar wilayah riil, serta tambahan pangsa per usaha (§3.1). |
| 3 | Biaya tetap vs variabel; tenaga all-in 1,25 × UMK; porsi bahan realistis; estimasi pajak | **Diadopsi**, dengan satu penyesuaian | Overhead dipisah tetap/semi-tetap/variabel; marketing jadi anggaran tetap; gaji UKM/enterprise = headcount × UMK × all-in (1,25; UKM 1,167 + THR tunai); porsi bahan diselaraskan (§4.3). Pajak: PPh Final 0,5% (sole dengan pembebasan Rp500 jt, CV tanpa pembebasan, cek batas Rp4,8 M) dan perkiraan PPh Badan untuk PT, dilaporkan sebagai `profit_pre_tax` dan `profit_after_tax_estimate`. **Penyesuaian:** pajak tidak ditulis ke `biaya_lain`, karena akan membuat label "Laba sebelum pajak" di aplikasi salah (§4.5). |
| 4 | CV realistis dan dicetak; headcount mengikuti volume | **Diadopsi** | CV sekitar tren, CV mentah, dan derau desesonal dicetak dan disimpan di `volatility`. Sole/UKM diuji 5–20% (derau dinaikkan sedikit). Headcount berbasis utilisasi: kapasitas job per helper (sole) dan FTE ÷ utilisasi 90% (UKM/enterprise), dengan lembur untuk beban puncak dan atrisi bertahap (§4.4, §4.6). |
| 5 | Ringkasan JSON sebagai sumber tabel dokumen; `--report md` | **Diadopsi** | `--report md` menulis `docs/specs/generated/demo-economic-summary.md` dari objek ringkasan yang sama; `--from-summary` merender ulang dari JSON. Tabel angka di dokumen ini diganti tautan ke berkas *generated* (§4.7). |
| – | Margin target | Tidak diubah | Semua band lolos dengan model biaya baru; alasannya dicatat di §10 butir 7. |
| – | Produksi | Ditunda | Tidak ada penerapan `--remote`. Verifikasi hanya di D1 lokal (§9). |

Hal yang perlu dicek QA sebelum angka dipakai di luar demo: nilai UMK 2025/2026 per kota/kabupaten, PDRB riil provinsi terbaru, IHK tahunan, status dan batas waktu PP 55/2022 untuk tiap badan usaha, dan apakah fasilitas Pasal 31E relevan untuk profil PT yang dimaksud.
