# Analisis Data Skenario Ekonomi

**Proyek:** Satu Alur
**Tanggal:** 28 Oktober 2026
**Sumber data:** `tests/unit/economic-scenario.test.js`, `docs/skenario-ekonomi-testcase.md`, `docs/skenario-ekonomi-testcase.xlsx`

---

## 1. Ringkasan eksekutif

1. **Skala usaha wajar**, tetapi **premis pertumbuhan tercampur**: angka 5% dan 8–10% adalah pertumbuhan ekonomi riil, sementara data menerapkannya langsung ke pendapatan nominal. Dengan inflasi 2,5–3%, data kita sebenarnya hanya merepresentasikan pertumbuhan riil **1,9–2,4% (nasional)** dan **4,9–7,3% (daerah)**.
2. **Data terlalu mulus**: pertumbuhan bulanan identik, simpangan baku 0%, CV setahun hanya 1,4–2,7%. Tidak ada musiman, noise, atau variasi kontrak.
3. **Margin 37% datar setiap bulan** karena semua biaya dibuat proporsional. Tidak ada biaya tetap, inflasi upah, atau operating leverage.
4. **Angka 37% adalah laba kotor, bukan laba bersih.** Setelah opex 15–20% dan PPh final 0,5%, laba bersih realistis **16,5–21,5%**. Dashboard dan laporan memberi label "Laba Bersih" untuk angka sebelum opex/pajak.
5. **Assertion pertumbuhan bersifat self-fulfilling** — dihitung dari rumus yang sama dengan data — sehingga test membuktikan invarian, bukan realisme ekonomi.

---

## 2. Data yang dipakai

| Metrik | Nilai |
|---|---|
| Periode | 12 bulan (Jan–Des 2026) |
| Pendapatan awal | Rp185.000.000/bulan |
| Pertumbuhan | 5% (nasional), 8% dan 10% (daerah) |
| Jumlah pekerja | 12 orang |
| UMK acuan | Rp4.600.000/bulan |
| Struktur biaya | tenaga 34%, bahan 16%, transport 7%, lain-lain 6% |
| Total biaya langsung | 63% pendapatan |
| Margin kotor | 37% (datar sepanjang tahun) |
| Pendapatan tahunan (daerah 8%) | Rp2.300.269.000 |
| Laba kotor tahunan (daerah 8%) | Rp851.099.526 |

**Deret pendapatan (daerah 8%):** Rp185.000.000 (Jan) → Rp198.522.699 (Des), total Rp2.300.269.000.

---

## 3. Analisis pertumbuhan: riil vs nominal

Pertumbuhan ekonomi nasional/daerah yang lazim dikutip adalah **pertumbuhan riil (PDB)**, bukan pertumbuhan pendapatan nominal. Data kita menerapkan angka riil tersebut langsung ke pendapatan.

Dengan asumsi inflasi 2,5–3%:

| Premis | Dipakai di data (nominal) | Nominal seharusnya | Riil yang sebenarnya dimodelkan |
|---|---:|---:|---:|
| Nasional 5% | 5% | 7,6–8,2% | **1,9–2,4%** |
| Daerah 8% | 8% | 10,7–11,2% | **4,9–5,4%** |
| Daerah 10% | 10% | 12,8–13,3% | **6,8–7,3%** |

**Implikasi:** jika targetnya "daerah tumbuh 8–10% secara riil", pendapatan nominal harus tumbuh **±11–13%**. Jika yang dimaksud adalah pertumbuhan pendapatan nominal 8–10%, istilah "pertumbuhan ekonomi" pada dokumen harus diganti.

**Rata-rata provinsi** di Indonesia umumnya tumbuh 4–6%. Angka 8–10% adalah ekor atas dan hanya cocok untuk daerah boom (mis. Sulawesi nikel, Kalimantan IKN, Papua), bukan "kota daerah" generik.

---

## 4. Kualitas data: terlalu deterministik

| Skenario | Growth MoM | Simpangan baku MoM | CV setahun |
|---|---:|---:|---:|
| Nasional 5% | 0,407% | 0,00% | 1,4% |
| Daerah 8% | 0,643% | 0,00% | 2,2% |
| Daerah 10% | 0,797% | 0,00% | 2,7% |

Bisnis jasa riil biasanya memiliki:

- variasi bulanan 5–20% (kontrak batal, pelanggan besar, libur),
- musiman Ramadan/Lebaran dan akhir tahun,
- noise operasional.

Data kita tidak memiliki ketiganya. Akibatnya assertion "annualized 8–10%" **selalu lolos secara konstruksi** — nilainya diturunkan dari rumus yang sama. Yang benar-benar diuji hanya invarian: laba positif, margin dalam rentang, jumlah baris, dan identitas pendapatan − biaya = laba.

---

## 5. Struktur biaya dan margin

### 5.1 Biaya proporsional sempurna

Semua kategori biaya dihitung sebagai persentase tetap dari pendapatan bulanan. Konsekuensinya:

- **Tidak ada biaya tetap** (sewa, admin, marketing) → tidak ada operating leverage.
- **Tidak ada inflasi upah** (UMK biasanya naik 5–6%/tahun) maupun inflasi bahan.
- **Margin kotor selalu 37,00%** setiap bulan.

### 5.2 Unit economics

| Metrik | Januari | Desember |
|---|---:|---:|
| Pendapatan per pekerja | Rp15.416.667 | Rp16.543.558 |
| Biaya tenaga per pekerja | Rp5.241.667 | Rp5.624.810 |
| Rasio terhadap UMK Rp4,6 juta | 1,14× | 1,22× |

Rasio 1,14× masih **tipis** setelah memperhitungkan BPJS, THR, dan lembur; biaya all-in biasanya sekitar **1,25× UMK**.

### 5.3 Komposisi biaya vs praktik umum jasa kebersihan

| Komponen | Data kita | Rentang umum (ilustratif) | Catatan |
|---|---:|---:|---|
| Tenaga kerja | 34% | 40–50% | Data kita rendah untuk usaha padat karya |
| Bahan | 16% | 5–10% | Data kita tinggi |
| Transportasi | 7% | 6–8% | Wajar |
| Lain-lain | 6% | 5–8% | Wajar |

### 5.4 Jumlah pekerja tetap

Pendapatan tumbuh 8% sementara jumlah pekerja tetap 12 orang. Artinya produktivitas per pekerja naik ±8%/tahun. Ini mungkin terjadi karena kenaikan harga, tetapi jika pertumbuhan berasal dari volume, kapasitas tenaga kerja perlu ikut bertambah.

---

## 6. Dampak opex dan pajak

Ledger hanya mencatat biaya langsung. Setelah biaya operasional dan PPh final UMKM 0,5%:

| Opex | Laba sebelum pajak | Setelah PPh final | Laba tahunan |
|---:|---:|---:|---:|
| 15% | 22,0% | 21,5% | Rp494.557.835 |
| 18% | 19,0% | 18,5% | Rp425.549.765 |
| 20% | 17,0% | 16,5% | Rp379.544.385 |

Net margin 16,5–21,5% masih wajar untuk jasa. Namun **37% bukan laba bersih**.

**Verifikasi kode:** `src/stages/dashboard.js` dan `src/stages/report.js` memberi label **"Laba Bersih"** pada `pendapatan − biaya`, sementara kategori ledger tidak memiliki opex atau pajak. Jadi label tersebut memang berpotensi menyesatkan pembaca laporan.

---

## 7. Konsistensi data

Data yang sama saat ini ada di tiga tempat:

1. `tests/unit/economic-scenario.test.js` (sumber perhitungan)
2. `docs/skenario-ekonomi-testcase.md`
3. `docs/skenario-ekonomi-testcase.xlsx`

Risiko drift sudah terbukti: subtotal tenaga dan bahan pada tabel chat sebelumnya berbeda dari Excel (Rp780.088.321 vs Rp782.091.462; Rp367.041.040 vs Rp368.043.040), meskipun total biaya dan laba tetap benar.

**Rekomendasi:** jadikan fixture JS sebagai satu-satunya sumber, lalu generate MD/XLSX dari sana.

---

## 8. Rekomendasi

1. **Putuskan riil vs nominal.** Jika mengikuti premis awal (riil 5% vs 8–10%), ubah growth nominal menjadi ±8,15% dan ±11,2–13,3%, serta dokumentasikan inflasi 3%.
2. **Tambahkan noise dan musiman** (mis. variasi deterministik ±5% dan lonjakan Ramadan/Desember), lalu uji dengan toleransi tahunan.
3. **Pisahkan biaya tetap dan variabel**, tambahkan opex dan PPh final; ubah label "Laba Bersih" menjadi "Laba Kotor" atau masukkan opex ke laporan.
4. **Sesuaikan komposisi biaya**: bahan 8–10%, tenaga 40–45%; pastikan upah all-in minimal ±1,25× UMK.
5. **Satu sumber data** untuk test, Markdown, dan Excel.
6. **Bangun skenario dari bawah**: jumlah job/bulan × tiket rata-rata × utilisasi pekerja, bukan growth top-down.

---

## 9. Batasan analisis

- Angka makro memakai rentang umum (pertumbuhan 5%, inflasi 2,5–3%) dan **belum diverifikasi ke rilis statistik 2026**.
- Rentang komposisi biaya "praktik umum" bersifat ilustratif, bukan hasil survei.
- Klaim label "Laba Bersih" sudah dicek ke `src/stages/dashboard.js` dan `src/stages/report.js`.
- Analisis ini menilai **asumsi data**, bukan kebenaran perilaku aplikasi. Test ekonomi tidak menguji stage/alur produksi.
