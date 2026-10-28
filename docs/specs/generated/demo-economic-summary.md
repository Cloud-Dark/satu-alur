# Ringkasan Ekonomi Data Demo (dibuat otomatis)

> **Jangan diedit manual.** Berkas ini dibuat oleh `node scripts/seed-demo.mjs --report md` dari objek ringkasan yang sama dengan `seeds/demo-summary.json`, sehingga angka di sini selalu sama dengan data seed. Untuk membuat ulang tanpa simulasi: `node scripts/seed-demo.mjs --report md --from-summary seeds/demo-summary.json`.

Parameter: 12 bulan s.d. 2026-10-31, as-of 2026-10-28T10:00:00.000Z, seed 20261028. Semua data **DUMMY**. Penjelasan model: [2026-10-28-demo-growth-data-design.md](../2026-10-28-demo-growth-data-design.md).

## 1. Asumsi makro

ASUMSI PERENCANAAN untuk data demo, bukan angka resmi. Verifikasi: PDB/PDRB riil & inflasi IHK → BRS BPS (bps.go.id); UMK → SK Gubernur; pajak → PP 55/2022, UU HPP, Pasal 31E UU PPh.

| Parameter | Nilai | Dipakai untuk |
|---|---|---|
| PDB riil nasional | 5,0%/th | Pembanding pertumbuhan wilayah (riil) |
| Inflasi IHK | 2,8%/th | Nominal wilayah = (1 + riil) × (1 + IHK) − 1; indeks biaya umum |
| Pertumbuhan nominal nasional | 7,94%/th | Bobot wilayah enterprise (kemiringan relatif) |
| Kenaikan tarif jasa Januari | Sole 3%–5%; UKM 3%–5%; Enterprise 4%–6% | Harga tiket jasa ad-hoc |
| Penyesuaian tarif pertengahan tahun | peluang 35%, 1%–2% di Juli | Harga tiket jasa ad-hoc |
| Eskalasi kontrak non-UMK (Januari) | 3%–5% | Kontrak pest, laundry, cleaning, FM cabang |
| Kenaikan UMK (1 Januari) | 6,5% | Gaji pekerja, tarif helper, kontrak per petugas |
| Biaya tenaga all-in | 1,25 × UMK (BPJS 11,5%, THR 8,3%, lain 5,2%) | UKM: 1,167 × UMK per bulan + THR tunai saat Lebaran; enterprise: 1,25 × UMK diakrualkan |
| Inflasi bahan/material | 4,0%/th (bertahap) | Biaya bahan per job |
| Inflasi BBM/transport | 3,0%/th (bertahap) | Transport per job, BBM armada |
| Kenaikan sewa (Januari) | 5,0% | Sewa kantor, gudang, outlet |
| Lembur/harian di atas kapasitas | 1,3 × tarif normal | Beban bulan puncak |
| PPh Final UMKM (PP 55/2022) | 0,5% peredaran bruto; batas Rp4,8 M/th; WP OP bebas Rp500 jt pertama/th | Estimasi pajak sole & UKM (tidak ditulis ke buku besar) |
| PPh Badan (UU HPP) | 22%; Pasal 31E untuk peredaran ≤ Rp50 M | Perkiraan kasar enterprise (tidak ditulis ke buku besar) |

## 2. Profil wilayah

| Kode | Wilayah | Profil | PDRB riil/th | IHK/th | Nominal/th | UMK 2025 (perkiraan) | UMK 2026 (×1,065) | Dipakai oleh |
|---|---|---|---|---|---|---|---|---|
| JKT | DKI Jakarta | nasional | 5,0% | 2,8% | 7,94% | Rp5,4 jt | Rp5,8 jt | mall, fm, rs |
| BDT | Bodetabek | nasional | 5,2% | 2,8% | 8,15% | Rp5,1 jt | Rp5,4 jt | mall, fm |
| BKS | Kota/Kab. Bekasi | nasional | 5,2% | 2,8% | 8,15% | Rp5,6 jt | Rp6,0 jt | ac |
| BDG | Bandung Raya | nasional | 5,0% | 2,8% | 7,94% | Rp4,5 jt | Rp4,8 jt | laundry, mall, fm |
| SBY | Surabaya | nasional | 5,0% | 2,8% | 7,94% | Rp5,0 jt | Rp5,3 jt | pest, mall, fm, rs |
| SDA | Sidoarjo–Gresik | nasional | 5,2% | 2,8% | 8,15% | Rp4,9 jt | Rp5,2 jt | pest |
| MLG | Malang | nasional | 5,0% | 2,8% | 7,94% | Rp3,5 jt | Rp3,7 jt | rs |
| SMG | Semarang | nasional | 5,0% | 2,8% | 7,94% | Rp3,5 jt | Rp3,7 jt | fm, rs |
| MDN | Medan | nasional | 4,8% | 2,8% | 7,73% | Rp3,9 jt | Rp4,2 jt | listrik, mall, fm, rs |
| DPS | Denpasar–Badung | menengah | 5,5% | 2,8% | 8,45% | Rp3,4 jt | Rp3,6 jt | rs |
| BTM | Batam | menengah | 6,0% | 2,8% | 8,97% | Rp5,0 jt | Rp5,3 jt | mall |
| MKS | Makassar | menengah | 5,6% | 2,8% | 8,56% | Rp3,9 jt | Rp4,2 jt | cleaning, mall, fm, rs |
| BPN | Balikpapan & koridor IKN | cepat | 8,5% | 2,8% | 11,54% | Rp3,8 jt | Rp4,0 jt | dinding, mall, fm, rs |
| MRW | Morowali–Kendari | cepat | 10,0% | 2,8% | 13,08% | Rp3,7 jt | Rp3,9 jt | fm |
| MLU | Maluku Utara (Halmahera–Ternate) | cepat | 9,0% | 2,8% | 12,05% | Rp3,4 jt | Rp3,6 jt | (belum dipakai) |

UMK dibulatkan ke Rp0,1 jt dan merupakan **perkiraan**; nilai resmi ada di SK Gubernur masing-masing provinsi. Pertumbuhan riil wilayah adalah asumsi; cek BRS PDRB BPS.

## 3. Hasil per usaha

Semua persentase pertumbuhan adalah **per bulan**, dihitung dari bulan penuh dengan regresi log-linear setelah koreksi musim. Target bisnis (sole/UKM 1–2%/bln, enterprise 5–10%/bln) adalah target **nominal**.

| Akun | Skala | Tren nominal | Volume riil | Kontribusi harga (porsi) | CV | Margin sebelum pajak | Margin setelah pajak (est.) | Headcount awal→akhir | Band |
|---|---|---|---|---|---|---|---|---|---|
| ac | Sole | +1,48% | +1,10% | +0,37% (25%) | 8,9% | 32,4% | 32,4% | 2 → 3 | OK |
| cleaning | Sole | +1,05% | +0,67% | +0,38% (36%) | 5,5% | 31,5% | 31,5% | 3 → 4 | OK |
| listrik | Sole | +1,27% | +0,87% | +0,40% (31%) | 7,6% | 28,8% | 28,8% | 2 → 2 | OK |
| pest | UKM | +1,57% | +1,12% | +0,44% (28%) | 5,5% | 19,9% | 19,4% | 10 → 11 | OK |
| laundry | UKM | +1,52% | +1,17% | +0,34% (23%) | 6,7% | 20,1% | 19,6% | 10 → 12 | OK |
| dinding | UKM | +1,68% | +1,39% | +0,29% (17%) | 9,0% | 15,2% | 14,7% | 12 → 15 | OK |
| mall | Enterprise | +8,75% | +8,19% | +0,52% (6%) | 5,1% | 14,8% | 11,8% | 134 → 302 | OK |
| fm | Enterprise | +7,10% | +6,62% | +0,46% (7%) | 6,7% | 12,7% | 10,2% | 147 → 242 | OK |
| rs | Enterprise | +8,76% | +8,22% | +0,50% (6%) | 4,6% | 11,9% | 9,5% | 134 → 306 | OK |

## 4. Dekomposisi pertumbuhan

`nominal ≈ (1 + volume riil) × (1 + harga) − 1`. Volume riil = pendapatan dideflasi dengan indeks harga yang melekat di tiap tagihan (tarif jasa, atau UMK untuk kontrak per petugas). Pasar wilayah = PDRB riil wilayah per bulan, ditimbang pangsa pendapatan. Tambahan pangsa = volume riil di atas pertumbuhan pasar.

| Akun | g model (nominal) | Tren nominal | Harga | Kenaikan tarif Jan / pertengahan th | Volume riil | Pasar wilayah riil | Tambahan pangsa | Setara tahunan nominal / riil | CMGR mentah |
|---|---|---|---|---|---|---|---|---|---|
| ac | 1,71% | 1,48% | 0,37% | 4,7% / – | 1,10% | 0,42% | 0,68% | 19% / 14% | 2,72% |
| cleaning | 1,35% | 1,05% | 0,38% | 4,9% / – | 0,67% | 0,46% | 0,21% | 13% / 8% | 0,81% |
| listrik | 1,25% | 1,27% | 0,40% | 3,2% / 1,3% | 0,87% | 0,39% | 0,47% | 16% / 11% | 0,69% |
| pest | 1,66% | 1,57% | 0,44% | 4,0% / 1,9% | 1,12% | 0,41% | 0,71% | 21% / 14% | 0,71% |
| laundry | 1,29% | 1,52% | 0,34% | 4,5% / – | 1,17% | 0,41% | 0,76% | 20% / 15% | 1,78% |
| dinding | 1,50% | 1,68% | 0,29% | 3,6% / – | 1,39% | 0,68% | 0,70% | 22% / 18% | 3,58% |
| mall | 8,90% | 8,75% | 0,52% | 4,0% / 1,9% | 8,19% | 0,42% | 7,74% | 174% / 157% | 8,97% |
| fm | 6,90% | 7,10% | 0,46% | 4,0% / 1,7% | 6,62% | 0,43% | 6,16% | 128% / 116% | 7,60% |
| rs | 8,81% | 8,76% | 0,50% | 5,7% / – | 8,22% | 0,43% | 7,76% | 174% / 158% | 9,68% |

## 5. Volatilitas bulanan

| Akun | CV sekitar tren | Band | CV mentah (stdev/mean) | Derau setelah koreksi musim | Rata-rata MoM absolut |
|---|---|---|---|---|---|
| ac | 8,9% | 5%–20% | 14,2% | 2,5% | 6,5% |
| cleaning | 5,5% | 5%–20% | 7,5% | 3,6% | 5,9% |
| listrik | 7,6% | 5%–20% | 7,2% | 5,0% | 7,6% |
| pest | 5,5% | 5%–20% | 5,7% | 4,0% | 6,8% |
| laundry | 6,7% | 5%–20% | 8,7% | 3,5% | 8,6% |
| dinding | 9,0% | 5%–20% | 18,9% | 3,6% | 8,9% |
| mall | 5,1% | – | 29,1% | 3,2% | 9,2% |
| fm | 6,7% | – | 25,2% | 3,1% | 11,5% |
| rs | 4,6% | – | 28,6% | 3,2% | 10,4% |

Definisi: cv = deviasi standar residual ln(pendapatan bulanan) terhadap garis tren log-linear (musim + derau, tanpa pertumbuhan); cv_raw = stdev/mean pendapatan bulanan; cv_noise = residual setelah koreksi musim. CV mentah enterprise besar karena tren 5–10%/bln ikut terhitung.

## 6. Struktur biaya (porsi pendapatan, bulan penuh)

| Akun | Tenaga (tetap / variabel) | Bahan | Transport | Lain-lain | Biaya variabel | Tetap + semi-tetap | Margin kuartal pertama → terakhir |
|---|---|---|---|---|---|---|---|
| ac | 18,6% (0,3% / 18,3%) | 27,0% | 13,3% | 8,7% | 52,8% | 14,8% | 31,6% → 35,1% |
| cleaning | 41,3% (0,9% / 40,4%) | 7,9% | 11,5% | 7,8% | 53,7% | 14,9% | 34,5% → 30,4% |
| listrik | 13,7% (0,5% / 13,2%) | 40,0% | 9,9% | 7,6% | 58,2% | 13,0% | 29,5% → 29,5% |
| pest | 44,4% (44,4% / 0,0%) | 25,4% | 3,7% | 6,7% | 29,1% | 51,0% | 24,5% → 23,4% |
| laundry | 47,4% (47,4% / 0,0%) | 10,0% | 4,5% | 17,9% | 21,2% | 58,7% | 23,0% → 25,4% |
| dinding | 37,7% (37,7% / 0,0%) | 36,5% | 3,7% | 6,9% | 40,2% | 44,6% | 15,5% → 18,6% |
| mall | 60,8% (60,7% / 0,0%) | 13,1% | 3,7% | 7,6% | 17,7% | 67,4% | 11,4% → 16,4% |
| fm | 57,8% (57,7% / 0,1%) | 17,5% | 3,4% | 8,6% | 21,9% | 65,4% | 6,4% → 16,4% |
| rs | 61,1% (61,0% / 0,1%) | 15,5% | 3,1% | 8,5% | 19,5% | 68,6% | 9,8% → 13,4% |

Tenaga tetap = gaji pekerja tetap (headcount × UMK × all-in), staf, dan THR. Tenaga variabel = helper harian per job (sole) dan lembur/harian saat beban melebihi kapasitas. Kenaikan margin dari kuartal pertama ke terakhir menunjukkan *operating leverage* biaya tetap.

## 7. Laba sebelum dan setelah pajak (estimasi)

| Akun | Pendapatan | Biaya | Laba sebelum pajak | Estimasi pajak | Laba setelah pajak (est.) | Peredaran setahun (est.) | Metode |
|---|---|---|---|---|---|---|---|
| ac | Rp205,4 jt | Rp138,8 jt | Rp66,6 jt (32,4%) | Rp0 | Rp66,6 jt (32,4%) | Rp224,0 jt | PPh Final UMKM 0,5% × peredaran bruto di atas Rp500 jt pertama per tahun pajak (WP orang pribadi, PP 55/2022). Peredaran setahun ±Rp224,0 jt < Rp500 jt, jadi estimasi pajak Rp0. |
| cleaning | Rp170,0 jt | Rp116,5 jt | Rp53,5 jt (31,5%) | Rp0 | Rp53,5 jt (31,5%) | Rp185,4 jt | PPh Final UMKM 0,5% × peredaran bruto di atas Rp500 jt pertama per tahun pajak (WP orang pribadi, PP 55/2022). Peredaran setahun ±Rp185,4 jt < Rp500 jt, jadi estimasi pajak Rp0. |
| listrik | Rp181,4 jt | Rp129,1 jt | Rp52,3 jt (28,8%) | Rp0 | Rp52,3 jt (28,8%) | Rp197,9 jt | PPh Final UMKM 0,5% × peredaran bruto di atas Rp500 jt pertama per tahun pajak (WP orang pribadi, PP 55/2022). Peredaran setahun ±Rp197,9 jt < Rp500 jt, jadi estimasi pajak Rp0. |
| pest | Rp2,07 M | Rp1,66 M | Rp410,1 jt (19,9%) | Rp10,3 jt | Rp399,8 jt (19,4%) | Rp2,25 M | PPh Final UMKM 0,5% × peredaran bruto bulanan (CV, PP 55/2022; batas waktu CV 4 tahun pajak diasumsikan belum lewat). Peredaran setahun ±Rp2,25 M ≤ Rp4,8 M. |
| laundry | Rp1,86 M | Rp1,48 M | Rp373,2 jt (20,1%) | Rp9,3 jt | Rp364,0 jt (19,6%) | Rp2,02 M | PPh Final UMKM 0,5% × peredaran bruto bulanan (CV, PP 55/2022; batas waktu CV 4 tahun pajak diasumsikan belum lewat). Peredaran setahun ±Rp2,02 M ≤ Rp4,8 M. |
| dinding | Rp2,19 M | Rp1,86 M | Rp333,1 jt (15,2%) | Rp10,9 jt | Rp322,2 jt (14,7%) | Rp2,39 M | PPh Final UMKM 0,5% × peredaran bruto bulanan (CV, PP 55/2022; batas waktu CV 4 tahun pajak diasumsikan belum lewat). Peredaran setahun ±Rp2,39 M ≤ Rp4,8 M. |
| mall | Rp26,53 M | Rp22,59 M | Rp3,93 M (14,8%) | Rp793,4 jt | Rp3,14 M (11,8%) | Rp28,94 M | Perkiraan PPh Badan 22% × laba sebelum pajak, fasilitas Pasal 31E (peredaran setahun ±Rp28,94 M ≤ Rp50 M; porsi 17% PKP bertarif 50%); tarif efektif ±20,2%. Tanpa koreksi fiskal; hanya ilustrasi, tidak ditulis ke buku besar. |
| fm | Rp25,22 M | Rp22,01 M | Rp3,21 M (12,7%) | Rp644,8 jt | Rp2,57 M (10,2%) | Rp27,51 M | Perkiraan PPh Badan 22% × laba sebelum pajak, fasilitas Pasal 31E (peredaran setahun ±Rp27,51 M ≤ Rp50 M; porsi 17% PKP bertarif 50%); tarif efektif ±20,1%. Tanpa koreksi fiskal; hanya ilustrasi, tidak ditulis ke buku besar. |
| rs | Rp24,56 M | Rp21,64 M | Rp2,91 M (11,9%) | Rp583,8 jt | Rp2,33 M (9,5%) | Rp26,79 M | Perkiraan PPh Badan 22% × laba sebelum pajak, fasilitas Pasal 31E (peredaran setahun ±Rp26,79 M ≤ Rp50 M; porsi 18% PKP bertarif 50%); tarif efektif ±20,0%. Tanpa koreksi fiskal; hanya ilustrasi, tidak ditulis ke buku besar. |

Pajak **tidak** ditulis ke buku besar: aplikasi melabeli pendapatan − biaya sebagai "Laba sebelum pajak", dan `LEDGER_CATEGORIES` belum punya kategori pajak.

## 8. Kapasitas: headcount per bulan

| Akun | Nov-25 | Des-25 | Jan-26 | Feb-26 | Mar-26 | Apr-26 | Mei-26 | Jun-26 | Jul-26 | Agu-26 | Sep-26 | Okt-26 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ac | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 3 |
| cleaning | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 | 4 |
| listrik | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| pest | 10 | 10 | 11 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 11 | 11 |
| laundry | 10 | 11 | 10 | 10 | 10 | 10 | 10 | 10 | 11 | 11 | 12 | 11 |
| dinding | 12 | 11 | 10 | 10 | 10 | 11 | 12 | 13 | 14 | 15 | 15 | 15 |
| mall | 134 | 149 | 150 | 154 | 155 | 193 | 199 | 238 | 249 | 256 | 302 | 315 |
| fm | 147 | 152 | 146 | 146 | 149 | 163 | 168 | 194 | 205 | 224 | 242 | 255 |
| rs | 134 | 153 | 154 | 162 | 187 | 191 | 219 | 236 | 247 | 299 | 306 | 315 |

Sole: owner + helper aktif. UKM: pekerja lapangan tetap (tidak termasuk admin/staf). Enterprise: petugas kontrak + pekerja tetap ad-hoc di semua wilayah (tidak termasuk kantor pusat).

| Akun | Nov-25 | Des-25 | Jan-26 | Feb-26 | Mar-26 | Apr-26 | Mei-26 | Jun-26 | Jul-26 | Agu-26 | Sep-26 | Okt-26 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ac | 77% | 96% | 73% | 82% | 61% | 108% | 127% | 57% | 57% | 59% | 63% | 74% |
| cleaning | 87% | 90% | 93% | 101% | 87% | 106% | 87% | 74% | 64% | 76% | 62% | 76% |
| listrik | 74% | 63% | 84% | 98% | 91% | 49% | 74% | 91% | 91% | 60% | 77% | 95% |
| pest | 93% | 88% | 78% | 91% | 80% | 86% | 81% | 87% | 88% | 88% | 82% | 91% |
| laundry | 86% | 85% | 83% | 85% | 80% | 90% | 88% | 88% | 98% | 81% | 83% | 90% |
| dinding | 76% | 78% | 87% | 80% | 90% | 93% | 86% | 91% | 99% | 84% | 82% | 87% |
| mall | 95% | 97% | 94% | 95% | 96% | 97% | 98% | 100% | 96% | 94% | 95% | 101% |
| fm | 89% | 91% | 84% | 99% | 91% | 95% | 100% | 96% | 97% | 93% | 100% | 96% |
| rs | 93% | 98% | 95% | 99% | 88% | 99% | 98% | 98% | 101% | 91% | 98% | 102% |

Utilisasi = beban kerja (FTE) ÷ headcount. Di atas 100% berarti lembur/harian.

## 9. Indeks musiman (SI)

| Akun | Nov-25 | Des-25 | Jan-26 | Feb-26 | Mar-26 | Apr-26 | Mei-26 | Jun-26 | Jul-26 | Agu-26 | Sep-26 | Okt-26 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ac | 1,01 | 0,97 | 0,85 | 0,81 | 0,86 | 0,99 | 1,05 | 1,01 | 1,04 | 1,09 | 1,13 | 1,20 |
| cleaning | 1,01 | 1,03 | 0,95 | 0,92 | 0,93 | 1,00 | 0,99 | 1,02 | 1,09 | 1,03 | 1,00 | 1,05 |
| listrik | 1,07 | 1,05 | 1,09 | 0,99 | 0,92 | 0,96 | 0,95 | 0,94 | 1,01 | 0,99 | 0,98 | 1,05 |
| pest | 1,03 | 1,06 | 1,05 | 1,03 | 0,94 | 1,01 | 0,95 | 0,95 | 0,99 | 0,95 | 1,00 | 1,05 |
| laundry | 1,01 | 1,07 | 0,97 | 0,97 | 0,92 | 0,99 | 0,97 | 1,02 | 1,08 | 0,98 | 1,00 | 1,03 |
| dinding | 0,93 | 0,91 | 0,85 | 0,82 | 0,86 | 0,99 | 0,99 | 1,06 | 1,19 | 1,11 | 1,15 | 1,14 |
| mall | 1,01 | 1,06 | 0,97 | 0,96 | 0,92 | 1,01 | 0,97 | 1,01 | 1,06 | 0,98 | 1,02 | 1,04 |
| fm | 1,02 | 1,05 | 0,95 | 0,96 | 0,90 | 1,00 | 0,97 | 1,01 | 1,05 | 0,99 | 1,04 | 1,06 |
| rs | 1,01 | 1,01 | 1,03 | 1,00 | 0,92 | 1,00 | 0,97 | 0,99 | 1,03 | 0,99 | 1,02 | 1,03 |

## 10. Pangsa wilayah (bulan penuh pertama → terakhir)

| Akun | Awal | Akhir |
|---|---|---|
| pest | SBY 89%, SDA 11% | SBY 79%, SDA 21% |
| mall | BDT 38%, JKT 27%, BDG 15%, MDN 14%, SBY 5% | JKT 42%, BDT 30%, BDG 12%, SBY 6%, MDN 5%, BPN 4%, MKS 1% |
| fm | SBY 39%, JKT 38%, BDG 18%, MDN 3%, SMG 2%, BDT 0% | JKT 31%, SBY 31%, BDG 11%, BPN 8%, BDT 7%, MDN 5%, MRW 4%, SMG 2%, MKS 0% |
| rs | JKT 44%, MLG 24%, SBY 22%, SMG 8%, DPS 2% | SBY 46%, JKT 17%, MLG 10%, DPS 8%, BPN 8%, SMG 5%, MKS 5%, MDN 0% |

## 11. Bulanan per usaha

### 1. ac: Budi Santoso (Servis AC)

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp17,1 jt | Rp17,1 jt | Rp11,1 jt | Rp6,0 jt | 35,2% | Rp0 | Rp6,0 jt | – | – | 33 | 2 | 1,000 |
| Des-25 | Rp18,0 jt | Rp18,0 jt | Rp11,8 jt | Rp6,1 jt | 34,0% | Rp0 | Rp6,1 jt | +4,7% | +9,4% | 41 | 2 | 1,000 |
| Jan-26 | Rp15,4 jt | Rp14,7 jt | Rp11,6 jt | Rp3,8 jt | 24,8% | Rp0 | Rp3,8 jt | -14,3% | -2,9% | 31 | 2 | 1,047 |
| Feb-26 | Rp15,0 jt | Rp14,4 jt | Rp10,5 jt | Rp4,5 jt | 30,0% | Rp0 | Rp4,5 jt | -2,3% | +3,2% | 35 | 2 | 1,047 |
| Mar-26 | Rp15,6 jt | Rp14,9 jt | Rp11,6 jt | Rp4,0 jt | 25,8% | Rp0 | Rp4,0 jt | +3,9% | -2,3% | 26 | 2 | 1,047 |
| Apr-26 | Rp18,9 jt | Rp18,1 jt | Rp12,5 jt | Rp6,5 jt | 34,3% | Rp0 | Rp6,5 jt | +21,2% | +5,5% | 46 | 2 | 1,047 |
| Mei-26 | Rp20,2 jt | Rp19,2 jt | Rp13,9 jt | Rp6,2 jt | 30,8% | Rp0 | Rp6,2 jt | +6,4% | +0,5% | 54 | 2 | 1,047 |
| Jun-26 | Rp20,0 jt | Rp19,1 jt | Rp13,5 jt | Rp6,5 jt | 32,7% | Rp0 | Rp6,5 jt | -0,7% | +3,1% | 49 | 3 | 1,047 |
| Jul-26 | Rp20,3 jt | Rp19,4 jt | Rp13,8 jt | Rp6,5 jt | 32,0% | Rp0 | Rp6,5 jt | +1,3% | -1,8% | 49 | 3 | 1,047 |
| Agu-26 | Rp22,4 jt | Rp21,4 jt | Rp14,4 jt | Rp8,1 jt | 35,9% | Rp0 | Rp8,1 jt | +10,6% | +5,0% | 50 | 3 | 1,047 |
| Sep-26 | Rp22,4 jt | Rp21,4 jt | Rp14,1 jt | Rp8,3 jt | 37,0% | Rp0 | Rp8,3 jt | +0,1% | -3,1% | 54 | 3 | 1,047 |
| Okt-26* | Rp24,0 jt | Rp22,9 jt | Rp16,7 jt | Rp7,3 jt | 30,5% | Rp0 | Rp7,3 jt | – | – | 56 | 3 | 1,047 |

### 2. cleaning: Rina Kusuma (Rapi Bersih Home Cleaning)

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp15,2 jt | Rp15,2 jt | Rp9,2 jt | Rp6,0 jt | 39,4% | Rp0 | Rp6,0 jt | – | – | 27 | 3 | 1,000 |
| Des-25 | Rp14,6 jt | Rp14,6 jt | Rp10,0 jt | Rp4,6 jt | 31,7% | Rp0 | Rp4,6 jt | -4,1% | -5,5% | 28 | 3 | 1,000 |
| Jan-26 | Rp14,8 jt | Rp14,2 jt | Rp10,1 jt | Rp4,8 jt | 32,1% | Rp0 | Rp4,8 jt | +1,8% | +10,0% | 26 | 3 | 1,049 |
| Feb-26 | Rp13,6 jt | Rp13,0 jt | Rp9,5 jt | Rp4,2 jt | 30,7% | Rp0 | Rp4,2 jt | -8,0% | -4,5% | 29 | 3 | 1,049 |
| Mar-26 | Rp14,8 jt | Rp14,1 jt | Rp12,0 jt | Rp2,8 jt | 19,1% | Rp0 | Rp2,8 jt | +8,3% | +7,2% | 24 | 3 | 1,049 |
| Apr-26 | Rp14,9 jt | Rp14,3 jt | Rp10,2 jt | Rp4,8 jt | 31,9% | Rp0 | Rp4,8 jt | +1,1% | -5,8% | 31 | 3 | 1,049 |
| Mei-26 | Rp15,8 jt | Rp15,1 jt | Rp10,0 jt | Rp5,8 jt | 36,7% | Rp0 | Rp5,8 jt | +5,9% | +7,0% | 24 | 3 | 1,049 |
| Jun-26 | Rp15,4 jt | Rp14,7 jt | Rp10,3 jt | Rp5,1 jt | 33,2% | Rp0 | Rp5,1 jt | -2,9% | -6,1% | 33 | 4 | 1,049 |
| Jul-26 | Rp18,0 jt | Rp17,2 jt | Rp12,5 jt | Rp5,5 jt | 30,5% | Rp0 | Rp5,5 jt | +16,9% | +9,5% | 27 | 4 | 1,049 |
| Agu-26 | Rp16,3 jt | Rp15,6 jt | Rp11,5 jt | Rp4,8 jt | 29,4% | Rp0 | Rp4,8 jt | -9,2% | -4,1% | 34 | 4 | 1,049 |
| Sep-26 | Rp16,5 jt | Rp15,7 jt | Rp11,3 jt | Rp5,1 jt | 31,2% | Rp0 | Rp5,1 jt | +0,9% | +4,6% | 26 | 4 | 1,049 |
| Okt-26* | Rp15,7 jt | Rp14,9 jt | Rp10,5 jt | Rp5,2 jt | 33,1% | Rp0 | Rp5,2 jt | – | – | 29 | 4 | 1,049 |

### 3. listrik: Hendra Siregar (Listrik Siaga Medan)

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp17,0 jt | Rp17,0 jt | Rp12,4 jt | Rp4,6 jt | 27,1% | Rp0 | Rp4,6 jt | – | – | 21 | 2 | 1,000 |
| Des-25 | Rp17,3 jt | Rp17,3 jt | Rp12,6 jt | Rp4,6 jt | 26,8% | Rp0 | Rp4,6 jt | +1,8% | +3,2% | 18 | 2 | 1,000 |
| Jan-26 | Rp17,3 jt | Rp16,7 jt | Rp11,3 jt | Rp6,0 jt | 34,7% | Rp0 | Rp6,0 jt | -0,0% | -3,7% | 24 | 2 | 1,032 |
| Feb-26 | Rp14,7 jt | Rp14,3 jt | Rp10,3 jt | Rp4,4 jt | 29,7% | Rp0 | Rp4,4 jt | -14,7% | -6,0% | 28 | 2 | 1,032 |
| Mar-26 | Rp14,8 jt | Rp14,3 jt | Rp11,7 jt | Rp3,1 jt | 20,9% | Rp0 | Rp3,1 jt | +0,4% | +8,4% | 26 | 2 | 1,032 |
| Apr-26 | Rp16,3 jt | Rp15,8 jt | Rp11,7 jt | Rp4,6 jt | 28,4% | Rp0 | Rp4,6 jt | +10,3% | +5,2% | 14 | 2 | 1,032 |
| Mei-26 | Rp15,6 jt | Rp15,1 jt | Rp10,8 jt | Rp4,8 jt | 30,5% | Rp0 | Rp4,8 jt | -4,5% | -3,2% | 21 | 2 | 1,032 |
| Jun-26 | Rp16,6 jt | Rp16,1 jt | Rp11,7 jt | Rp4,9 jt | 29,4% | Rp0 | Rp4,9 jt | +6,7% | +7,5% | 26 | 2 | 1,032 |
| Jul-26 | Rp18,1 jt | Rp17,3 jt | Rp11,9 jt | Rp6,2 jt | 34,2% | Rp0 | Rp6,2 jt | +9,0% | +1,5% | 26 | 2 | 1,045 |
| Agu-26 | Rp15,8 jt | Rp15,1 jt | Rp11,7 jt | Rp4,1 jt | 25,7% | Rp0 | Rp4,1 jt | -12,9% | -10,5% | 17 | 2 | 1,045 |
| Sep-26 | Rp18,2 jt | Rp17,4 jt | Rp13,1 jt | Rp5,1 jt | 28,1% | Rp0 | Rp5,1 jt | +15,3% | +15,6% | 22 | 2 | 1,045 |
| Okt-26* | Rp13,2 jt | Rp12,6 jt | Rp9,1 jt | Rp4,1 jt | 30,8% | Rp0 | Rp4,1 jt | – | – | 20 | 2 | 1,045 |

### 4. pest: CV Basmi Hama Nusantara

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp190,3 jt | Rp190,3 jt | Rp132,9 jt | Rp57,3 jt | 30,1% | Rp951 rb | Rp56,4 jt | – | – | 30 | 10 | 1,000 |
| Des-25 | Rp179,2 jt | Rp179,2 jt | Rp135,9 jt | Rp43,3 jt | 24,2% | Rp896 rb | Rp42,4 jt | -5,8% | -8,0% | 32 | 10 | 1,000 |
| Jan-26 | Rp189,4 jt | Rp182,2 jt | Rp153,0 jt | Rp36,4 jt | 19,2% | Rp947 rb | Rp35,4 jt | +5,7% | +6,0% | 31 | 11 | 1,040 |
| Feb-26 | Rp189,4 jt | Rp182,2 jt | Rp140,1 jt | Rp49,2 jt | 26,0% | Rp947 rb | Rp48,3 jt | +0,0% | +2,7% | 34 | 10 | 1,040 |
| Mar-26 | Rp166,6 jt | Rp160,3 jt | Rp201,9 jt | −Rp35,3 jt | -21,2% | Rp833 rb | −Rp36,2 jt | -12,0% | -4,2% | 30 | 10 | 1,040 |
| Apr-26 | Rp185,3 jt | Rp178,2 jt | Rp144,6 jt | Rp40,6 jt | 21,9% | Rp926 rb | Rp39,7 jt | +11,2% | +4,2% | 31 | 10 | 1,040 |
| Mei-26 | Rp178,2 jt | Rp171,3 jt | Rp143,4 jt | Rp34,8 jt | 19,5% | Rp891 rb | Rp33,9 jt | -3,8% | +2,1% | 27 | 10 | 1,040 |
| Jun-26 | Rp198,2 jt | Rp190,5 jt | Rp152,2 jt | Rp45,9 jt | 23,2% | Rp991 rb | Rp44,9 jt | +11,2% | +10,9% | 27 | 10 | 1,040 |
| Jul-26 | Rp199,7 jt | Rp190,0 jt | Rp152,6 jt | Rp47,0 jt | 23,6% | Rp998 rb | Rp46,0 jt | +0,8% | -3,3% | 28 | 10 | 1,060 |
| Agu-26 | Rp185,4 jt | Rp176,4 jt | Rp141,5 jt | Rp43,9 jt | 23,7% | Rp927 rb | Rp42,9 jt | -7,2% | -3,6% | 31 | 10 | 1,060 |
| Sep-26 | Rp204,1 jt | Rp194,1 jt | Rp157,1 jt | Rp47,0 jt | 23,0% | Rp1,0 jt | Rp45,9 jt | +10,1% | +5,0% | 36 | 11 | 1,060 |
| Okt-26* | Rp205,0 jt | Rp194,9 jt | Rp155,0 jt | Rp50,0 jt | 24,4% | Rp1,0 jt | Rp48,9 jt | – | – | 36 | 11 | 1,060 |

### 5. laundry: CV Wangi Bersih Laundry

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp156,8 jt | Rp156,8 jt | Rp121,2 jt | Rp35,6 jt | 22,7% | Rp784 rb | Rp34,8 jt | – | – | 57 | 10 | 1,000 |
| Des-25 | Rp170,1 jt | Rp170,1 jt | Rp128,1 jt | Rp42,0 jt | 24,7% | Rp851 rb | Rp41,1 jt | +8,5% | +2,3% | 60 | 11 | 1,000 |
| Jan-26 | Rp156,5 jt | Rp150,2 jt | Rp123,0 jt | Rp33,5 jt | 21,4% | Rp783 rb | Rp32,7 jt | -8,0% | +1,2% | 50 | 10 | 1,045 |
| Feb-26 | Rp159,6 jt | Rp153,2 jt | Rp126,8 jt | Rp32,8 jt | 20,5% | Rp798 rb | Rp32,0 jt | +2,0% | +2,2% | 52 | 10 | 1,045 |
| Mar-26 | Rp152,6 jt | Rp146,5 jt | Rp186,7 jt | −Rp34,2 jt | -22,4% | Rp763 rb | −Rp34,9 jt | -4,4% | -0,0% | 48 | 10 | 1,045 |
| Apr-26 | Rp170,1 jt | Rp163,2 jt | Rp128,2 jt | Rp41,8 jt | 24,6% | Rp850 rb | Rp41,0 jt | +11,5% | +4,2% | 56 | 10 | 1,045 |
| Mei-26 | Rp166,1 jt | Rp159,4 jt | Rp125,4 jt | Rp40,7 jt | 24,5% | Rp831 rb | Rp39,8 jt | -2,3% | -0,1% | 55 | 10 | 1,045 |
| Jun-26 | Rp166,1 jt | Rp159,4 jt | Rp126,8 jt | Rp39,3 jt | 23,7% | Rp831 rb | Rp38,5 jt | +0,0% | -5,4% | 56 | 10 | 1,045 |
| Jul-26 | Rp202,7 jt | Rp194,4 jt | Rp140,3 jt | Rp62,3 jt | 30,8% | Rp1,0 jt | Rp61,3 jt | +22,0% | +15,0% | 72 | 11 | 1,045 |
| Agu-26 | Rp168,8 jt | Rp162,0 jt | Rp134,2 jt | Rp34,5 jt | 20,5% | Rp844 rb | Rp33,7 jt | -16,7% | -7,9% | 60 | 11 | 1,045 |
| Sep-26 | Rp187,0 jt | Rp179,4 jt | Rp142,1 jt | Rp44,9 jt | 24,0% | Rp935 rb | Rp44,0 jt | +10,8% | +8,5% | 63 | 12 | 1,045 |
| Okt-26* | Rp175,7 jt | Rp168,6 jt | Rp136,2 jt | Rp39,5 jt | 22,5% | Rp879 rb | Rp38,6 jt | – | – | 63 | 11 | 1,045 |

### 6. dinding: CV Glasur Dinding Borneo

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp176,4 jt | Rp176,4 jt | Rp144,4 jt | Rp31,9 jt | 18,1% | Rp882 rb | Rp31,0 jt | – | – | 19 | 12 | 1,000 |
| Des-25 | Rp163,1 jt | Rp163,1 jt | Rp145,6 jt | Rp17,4 jt | 10,7% | Rp815 rb | Rp16,6 jt | -7,5% | -5,5% | 12 | 11 | 1,000 |
| Jan-26 | Rp168,3 jt | Rp162,5 jt | Rp139,0 jt | Rp29,3 jt | 17,4% | Rp841 rb | Rp28,4 jt | +3,2% | +10,7% | 18 | 10 | 1,036 |
| Feb-26 | Rp160,5 jt | Rp154,9 jt | Rp138,7 jt | Rp21,8 jt | 13,6% | Rp802 rb | Rp21,0 jt | -4,6% | -0,5% | 13 | 10 | 1,036 |
| Mar-26 | Rp165,3 jt | Rp159,6 jt | Rp186,7 jt | −Rp21,5 jt | -13,0% | Rp826 rb | −Rp22,3 jt | +3,0% | -2,1% | 16 | 10 | 1,036 |
| Apr-26 | Rp188,0 jt | Rp181,5 jt | Rp147,0 jt | Rp41,0 jt | 21,8% | Rp940 rb | Rp40,0 jt | +13,8% | -1,0% | 22 | 11 | 1,036 |
| Mei-26 | Rp202,0 jt | Rp195,1 jt | Rp165,1 jt | Rp36,9 jt | 18,3% | Rp1,0 jt | Rp35,9 jt | +7,4% | +7,5% | 15 | 12 | 1,036 |
| Jun-26 | Rp213,2 jt | Rp205,9 jt | Rp176,7 jt | Rp36,5 jt | 17,1% | Rp1,1 jt | Rp35,5 jt | +5,5% | -2,2% | 25 | 13 | 1,036 |
| Jul-26 | Rp266,2 jt | Rp257,1 jt | Rp214,8 jt | Rp51,4 jt | 19,3% | Rp1,3 jt | Rp50,1 jt | +24,9% | +11,1% | 13 | 14 | 1,036 |
| Agu-26 | Rp234,8 jt | Rp226,7 jt | Rp193,2 jt | Rp41,6 jt | 17,7% | Rp1,2 jt | Rp40,4 jt | -11,8% | -5,0% | 27 | 15 | 1,036 |
| Sep-26 | Rp250,7 jt | Rp242,0 jt | Rp203,9 jt | Rp46,8 jt | 18,7% | Rp1,3 jt | Rp45,5 jt | +6,8% | +2,7% | 22 | 15 | 1,036 |
| Okt-26* | Rp174,2 jt | Rp168,2 jt | Rp169,6 jt | Rp4,6 jt | 2,7% | Rp871 rb | Rp3,7 jt | – | – | 21 | 15 | 1,036 |

### 7. mall: PT Arunika Layanan Ritel

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp1,54 M | Rp1,54 M | Rp1,35 M | Rp192,3 jt | 12,5% | Rp38,8 jt | Rp153,5 jt | – | – | 45 | 134 | 1,000 |
| Des-25 | Rp1,76 M | Rp1,76 M | Rp1,54 M | Rp217,9 jt | 12,4% | Rp44,0 jt | Rp173,9 jt | +14,1% | +8,6% | 48 | 149 | 1,000 |
| Jan-26 | Rp1,76 M | Rp1,66 M | Rp1,59 M | Rp167,9 jt | 9,6% | Rp33,9 jt | Rp134,1 jt | -0,1% | +9,1% | 46 | 150 | 1,040 |
| Feb-26 | Rp1,88 M | Rp1,78 M | Rp1,68 M | Rp205,1 jt | 10,9% | Rp41,4 jt | Rp163,7 jt | +7,1% | +7,5% | 58 | 154 | 1,040 |
| Mar-26 | Rp1,97 M | Rp1,87 M | Rp1,72 M | Rp245,3 jt | 12,5% | Rp49,5 jt | Rp195,8 jt | +4,7% | +9,3% | 61 | 155 | 1,040 |
| Apr-26 | Rp2,27 M | Rp2,15 M | Rp1,97 M | Rp301,4 jt | 13,3% | Rp60,8 jt | Rp240,6 jt | +15,2% | +5,0% | 57 | 193 | 1,040 |
| Mei-26 | Rp2,51 M | Rp2,38 M | Rp2,11 M | Rp396,6 jt | 15,8% | Rp80,0 jt | Rp316,6 jt | +10,5% | +15,5% | 69 | 199 | 1,040 |
| Jun-26 | Rp3,00 M | Rp2,85 M | Rp2,41 M | Rp593,8 jt | 19,8% | Rp119,8 jt | Rp474,0 jt | +19,8% | +14,3% | 76 | 238 | 1,040 |
| Jul-26 | Rp3,08 M | Rp2,89 M | Rp2,57 M | Rp500,5 jt | 16,3% | Rp101,0 jt | Rp399,5 jt | +2,4% | -2,3% | 72 | 249 | 1,059 |
| Agu-26 | Rp3,13 M | Rp2,94 M | Rp2,64 M | Rp490,4 jt | 15,7% | Rp98,9 jt | Rp391,4 jt | +1,6% | +9,7% | 72 | 256 | 1,059 |
| Sep-26 | Rp3,64 M | Rp3,42 M | Rp3,02 M | Rp621,5 jt | 17,1% | Rp125,4 jt | Rp496,1 jt | +16,4% | +12,3% | 73 | 302 | 1,059 |
| Okt-26* | Rp3,80 M | Rp3,58 M | Rp3,15 M | Rp655,4 jt | 17,2% | Rp132,2 jt | Rp523,1 jt | – | – | 90 | 315 | 1,059 |

### 8. fm: PT Prima Layanan Fasilitas

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp1,63 M | Rp1,63 M | Rp1,47 M | Rp157,3 jt | 9,6% | Rp31,6 jt | Rp125,7 jt | – | – | 37 | 147 | 1,000 |
| Des-25 | Rp1,85 M | Rp1,85 M | Rp1,70 M | Rp150,9 jt | 8,1% | Rp30,3 jt | Rp120,6 jt | +13,8% | +10,7% | 31 | 152 | 1,000 |
| Jan-26 | Rp1,64 M | Rp1,56 M | Rp1,62 M | Rp20,7 jt | 1,3% | Rp4,1 jt | Rp16,5 jt | -11,5% | -2,0% | 29 | 146 | 1,040 |
| Feb-26 | Rp1,95 M | Rp1,86 M | Rp1,72 M | Rp229,1 jt | 11,7% | Rp46,0 jt | Rp183,1 jt | +19,0% | +18,4% | 42 | 146 | 1,040 |
| Mar-26 | Rp1,86 M | Rp1,77 M | Rp1,72 M | Rp135,8 jt | 7,3% | Rp27,3 jt | Rp108,5 jt | -4,9% | +1,5% | 36 | 149 | 1,040 |
| Apr-26 | Rp2,20 M | Rp2,09 M | Rp1,94 M | Rp258,8 jt | 11,8% | Rp52,0 jt | Rp206,9 jt | +18,3% | +5,8% | 43 | 163 | 1,040 |
| Mei-26 | Rp2,38 M | Rp2,27 M | Rp2,01 M | Rp373,9 jt | 15,7% | Rp75,1 jt | Rp298,8 jt | +8,4% | +11,4% | 46 | 168 | 1,040 |
| Jun-26 | Rp2,55 M | Rp2,43 M | Rp2,17 M | Rp379,7 jt | 14,9% | Rp76,2 jt | Rp303,4 jt | +7,0% | +3,4% | 52 | 194 | 1,040 |
| Jul-26 | Rp2,89 M | Rp2,74 M | Rp2,47 M | Rp425,0 jt | 14,7% | Rp85,3 jt | Rp339,6 jt | +13,4% | +8,9% | 81 | 205 | 1,057 |
| Agu-26 | Rp2,87 M | Rp2,72 M | Rp2,45 M | Rp421,4 jt | 14,7% | Rp84,6 jt | Rp336,8 jt | -0,6% | +5,1% | 69 | 224 | 1,057 |
| Sep-26 | Rp3,39 M | Rp3,21 M | Rp2,73 M | Rp658,5 jt | 19,4% | Rp132,2 jt | Rp526,2 jt | +18,0% | +12,6% | 76 | 242 | 1,057 |
| Okt-26* | Rp3,28 M | Rp3,10 M | Rp2,80 M | Rp483,0 jt | 14,7% | Rp97,0 jt | Rp386,0 jt | – | – | 58 | 255 | 1,057 |

### 9. rs: PT Sehat Bersih Medika

| Bulan | Pendapatan | Riil (harga awal) | Biaya | Laba sblm pajak | Margin | Pajak est. | Laba stlh pajak est. | MoM | MoM desesonal | Job | Org | Indeks harga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nov-25 | Rp1,36 M | Rp1,36 M | Rp1,27 M | Rp90,6 jt | 6,7% | Rp18,1 jt | Rp72,4 jt | – | – | 52 | 134 | 1,000 |
| Des-25 | Rp1,66 M | Rp1,66 M | Rp1,45 M | Rp208,1 jt | 12,6% | Rp41,7 jt | Rp166,4 jt | +22,0% | +21,5% | 56 | 153 | 1,000 |
| Jan-26 | Rp1,69 M | Rp1,59 M | Rp1,53 M | Rp163,7 jt | 9,7% | Rp32,8 jt | Rp130,9 jt | +2,0% | +0,3% | 64 | 154 | 1,057 |
| Feb-26 | Rp1,88 M | Rp1,77 M | Rp1,64 M | Rp240,7 jt | 12,8% | Rp48,2 jt | Rp192,5 jt | +11,0% | +13,5% | 71 | 162 | 1,057 |
| Mar-26 | Rp1,83 M | Rp1,72 M | Rp1,79 M | Rp40,6 jt | 2,2% | Rp8,1 jt | Rp32,4 jt | -2,5% | +6,3% | 42 | 187 | 1,057 |
| Apr-26 | Rp2,19 M | Rp2,06 M | Rp1,86 M | Rp324,7 jt | 14,8% | Rp65,0 jt | Rp259,7 jt | +19,7% | +9,8% | 77 | 191 | 1,057 |
| Mei-26 | Rp2,24 M | Rp2,11 M | Rp1,98 M | Rp264,4 jt | 11,8% | Rp53,0 jt | Rp211,5 jt | +2,3% | +5,8% | 52 | 219 | 1,057 |
| Jun-26 | Rp2,50 M | Rp2,35 M | Rp2,15 M | Rp349,8 jt | 14,0% | Rp70,1 jt | Rp279,7 jt | +11,6% | +9,2% | 67 | 236 | 1,057 |
| Jul-26 | Rp2,80 M | Rp2,64 M | Rp2,36 M | Rp439,4 jt | 15,7% | Rp88,0 jt | Rp351,4 jt | +12,1% | +7,6% | 95 | 247 | 1,057 |
| Agu-26 | Rp2,99 M | Rp2,81 M | Rp2,75 M | Rp235,1 jt | 7,9% | Rp47,1 jt | Rp188,0 jt | +6,6% | +11,6% | 77 | 299 | 1,057 |
| Sep-26 | Rp3,43 M | Rp3,23 M | Rp2,87 M | Rp557,7 jt | 16,3% | Rp111,7 jt | Rp446,0 jt | +14,7% | +11,1% | 94 | 306 | 1,057 |
| Okt-26* | Rp3,56 M | Rp3,35 M | Rp3,03 M | Rp528,4 jt | 14,8% | Rp105,8 jt | Rp422,6 jt | – | – | 92 | 315 | 1,057 |

\* Bulan berjalan, terpotong di as-of: tidak ikut MoM, regresi tren, maupun total.
