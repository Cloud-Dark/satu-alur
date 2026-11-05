# Skenario Ekonomi — Test Case & Data Dummy

Dokumen pendamping untuk `tests/unit/economic-scenario.test.js`.
Skenario: perusahaan jasa kebersihan di kota daerah, 12 bulan (Jan–Des 2026).

```bash
npx vitest run tests/unit/economic-scenario.test.js
```

## Asumsi dasar

| Parameter | Nilai | Keterangan |
|---|---|---|
| Periode | 12 bulan (Jan–Des 2026) | Satu tahun fiskal |
| Pendapatan awal | Rp185.000.000 | Per bulan, skala UMKM jasa |
| Pertumbuhan nasional | 5%/tahun | Baseline makro |
| Pertumbuhan daerah | 8%–10%/tahun | Diuji di dua batas |
| Jumlah pekerja | 12 orang | Tenaga kerja langsung |
| UMK acuan | Rp4.600.000 | Per pekerja per bulan |
| Biaya tenaga kerja | 34% pendapatan | Komponen terbesar |
| Biaya bahan | 16% pendapatan | |
| Biaya transportasi | 7% pendapatan | |
| Biaya lain-lain | 6% pendapatan | |
| Total biaya langsung | 63% pendapatan | Margin kotor 37% |

## 20 test case

| No | Test case | Data / input | Ekspektasi | Status |
|---:|---|---|---|:---:|
| 1 | Pertumbuhan nasional | Deret 12 bulan, growth 5%/tahun | Annualized 4,5–5,5% | Lulus |
| 2 | Pertumbuhan daerah batas bawah | Deret 12 bulan, growth 8%/tahun | Annualized dalam 8–10%, ≈8% | Lulus |
| 3 | Pertumbuhan daerah batas atas | Deret 12 bulan, growth 10%/tahun | Annualized dalam 8–10%, ≈10% | Lulus |
| 4 | Selisih daerah vs nasional | 8% − 5% dan 10% − 5% | Gap 3–5 poin persen | Lulus |
| 5 | Margin bulanan Jan–Des | 12 bulan × 5 baris ledger | Laba > 0, margin 25–40% (aktual 37%) | Lulus |
| 6 | Laba nominal naik | Laba Jan vs Des | Laba Des > laba Jan | Lulus |
| 7 | Upah per pekerja | Rp62.900.000 ÷ 12 pekerja | > Rp4.600.000 (aktual Rp5.241.667) | Lulus |
| 8 | Komponen biaya terbesar | Tenaga 34%, bahan 16%, transport 7%, lain 6% | Biaya tenaga porsi terbesar | Lulus |
| 9 | Jumlah baris ledger | 12 bulan × 5 kategori | 60 baris | Lulus |
| 10 | Total pendapatan = jumlah deret | Deret daerah 8% | Sama persis dengan Σ bulanan | Lulus |
| 11 | Total pendapatan tahunan | Daerah 8% | Rp2.300.269.000 | Lulus |
| 12 | Total biaya tahunan | 63% dari pendapatan per bulan | Rp1.449.169.474 | Lulus |
| 13 | Persamaan laba | Pendapatan − biaya | = laba, tanpa selisih | Lulus |
| 14 | Laba tahunan | Rp2.300.269.000 − Rp1.449.169.474 | Rp851.099.526, positif | Lulus |
| 15 | Margin tahunan | Laba ÷ pendapatan | 30–40% (aktual 37,00%) | Lulus |
| 16 | Kontrak AC | Rp3.500.000, scope & terms valid | Lolos `validateOffer` | Lulus |
| 17 | Kontrak pest control | Rp4.200.000, scope & terms valid | Lolos `validateOffer` | Lulus |
| 18 | Kontrak deep cleaning | Rp15.000.000, scope & terms valid | Lolos `validateOffer` | Lulus |
| 19 | Baseline Januari | Bulan ke-1 | Rp185.000.000 | Lulus |
| 20 | Akhir periode Desember | Bulan ke-12 daerah 8% | Rp198.522.699 | Lulus |

## Data dummy: pendapatan 12 bulan

| Bulan | Nasional 5% | Daerah 8% | Daerah 10% |
|---|---:|---:|---:|
| Jan | 185.000.000 | 185.000.000 | 185.000.000 |
| Feb | 185.753.713 | 186.190.296 | 186.475.216 |
| Mar | 186.510.497 | 187.388.250 | 187.962.196 |
| Apr | 187.270.363 | 188.593.911 | 189.461.032 |
| Mei | 188.033.326 | 189.807.330 | 190.971.821 |
| Jun | 188.799.397 | 191.028.556 | 192.494.657 |
| Jul | 189.568.589 | 192.257.640 | 194.029.637 |
| Agu | 190.340.915 | 193.494.631 | 195.576.856 |
| Sep | 191.116.388 | 194.739.581 | 197.136.414 |
| Okt | 191.895.019 | 195.992.542 | 198.708.407 |
| Nov | 192.676.823 | 197.253.564 | 200.292.936 |
| Des | 193.461.813 | 198.522.699 | 201.890.100 |
| **Total** | **2.270.426.843** | **2.300.269.000** | **2.319.999.272** |

## Data dummy: biaya & laba (skenario daerah 8%)

| Bulan | Pendapatan | Tenaga | Bahan | Transport | Lain-lain | Total biaya | Laba | Margin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Jan | 185.000.000 | 62.900.000 | 29.600.000 | 12.950.000 | 11.100.000 | 116.550.000 | 68.450.000 | 37,00% |
| Feb | 186.190.296 | 63.304.701 | 29.790.447 | 13.033.321 | 11.171.418 | 117.299.887 | 68.890.409 | 37,00% |
| Mar | 187.388.250 | 63.712.005 | 29.982.120 | 13.117.178 | 11.243.295 | 118.054.598 | 69.333.652 | 37,00% |
| Apr | 188.593.911 | 64.121.930 | 30.175.026 | 13.201.574 | 11.315.635 | 118.814.165 | 69.779.746 | 37,00% |
| Mei | 189.807.330 | 64.534.492 | 30.369.173 | 13.286.513 | 11.388.440 | 119.578.618 | 70.228.712 | 37,00% |
| Jun | 191.028.556 | 64.949.709 | 30.564.569 | 13.371.999 | 11.461.713 | 120.347.990 | 70.680.566 | 37,00% |
| Jul | 192.257.640 | 65.367.598 | 30.761.222 | 13.458.035 | 11.535.458 | 121.122.313 | 71.135.327 | 37,00% |
| Agu | 193.494.631 | 65.788.175 | 30.959.141 | 13.544.624 | 11.609.678 | 121.901.618 | 71.593.013 | 37,00% |
| Sep | 194.739.581 | 66.211.458 | 31.158.333 | 13.631.771 | 11.684.375 | 122.685.937 | 72.053.644 | 37,00% |
| Okt | 195.992.542 | 66.637.464 | 31.358.807 | 13.719.478 | 11.759.553 | 123.475.302 | 72.517.240 | 37,00% |
| Nov | 197.253.564 | 67.066.212 | 31.560.570 | 13.807.749 | 11.835.214 | 124.269.745 | 72.983.819 | 37,00% |
| Des | 198.522.699 | 67.497.718 | 31.763.632 | 13.896.589 | 11.911.362 | 125.069.301 | 73.453.398 | 37,00% |
| **Total** | **2.300.269.000** | **782.091.462** | **368.043.040** | **161.018.831** | **138.016.141** | **1.449.169.474** | **851.099.526** | **37,00%** |

## Data dummy: harga kontrak

| Kontrak | Scope | Harga | Terms |
|---|---|---:|---|
| AC kantor | Pembersihan AC split 15 unit untuk kantor tiga lantai. | Rp3.500.000 | Pembayaran 50% di muka, sisa setelah pekerjaan selesai. |
| Pest control | Pest control rayap dan kecoa untuk gudang seluas 500m2. | Rp4.200.000 | Kontrak tiga bulan dengan garansi enam bulan. |
| Deep cleaning | Deep cleaning 50 kamar hotel setelah musim liburan. | Rp15.000.000 | Termin mingguan, target sepuluh kamar per hari. |

## Catatan

- Semua data dihasilkan fungsi deterministik (`monthlyRevenue` + `buildLedger`), bukan angka hardcode; angka dasar bisa diubah dan deret akan ikut menyesuaikan.
- File ini hanya merepresentasikan **asumsi skenario**, bukan perilaku produksi aplikasi.
