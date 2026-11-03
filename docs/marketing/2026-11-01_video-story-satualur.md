# Satu Alur — Video Story Pack untuk AI Video Generator

> Status: Draft produksi
> Terakhir diperbarui: 2026-11-01
> Durasi utama: 60 detik · versi pendek: 30 detik dan 15 detik
> Bahasa narasi: Indonesia · Teks di layar: Indonesia
> Gaya: hiperrealis, konsep masa depan, cerdas, fleksibel

Dokumen ini adalah **paket produksi siap tempel**. Setiap bidikan punya prompt bahasa Inggris yang bisa langsung dimasukkan ke Veo 3, Sora, Kling, Runway Gen-3, atau Hailuo. Narasi, musik, dan teks layar ada di bagian terpisah supaya bisa dirakit di editor.

Fitur yang muncul di video **hanya yang benar-benar ada di aplikasi**. Daftar larangan ada di [Bagian 9](#9-guardrail-akurasi--jangan-tampilkan-ini).

---

## 0. Cara Pakai

1. Baca [Bagian 2](#2-brand-lock--dna-visual) dan [Bagian 3](#3-dunia--karakter-consistency-bible) sekali. Semua prompt mengasumsikan dua bagian itu.
2. Generate **per bidikan**, bukan satu video 60 detik. Model video kehilangan konsistensi di atas ~10 detik.
3. Simpan `reference image` dari bidikan pertama yang berhasil, lalu pakai sebagai `reference_images` untuk bidikan berikutnya. Ini satu-satunya cara menjaga wajah Rani dan warna hijau tetap sama.
4. Rakit di editor, tambahkan narasi Indonesia dan musik.
5. Untuk versi 30 detik dan 15 detik, pakai peta potong di [Bagian 8](#8-peta-potong-versi-30-detik-dan-15-detik).

---

## 1. Creative Brief

**Judul kerja:** *Satu Alur — Dari Serakan Menjadi Satu Alur*

**Ide besar.** Pemilik usaha jasa di Indonesia tidak kekurangan kerja. Mereka kekurangan **satu tempat** untuk menyimpan kerja itu. Video membuka dengan kekacauan yang akrab — catatan tempel, chat, spreadsheet, struk — lalu memperlihatkan satu pita cahaya yang menyatukan semuanya menjadi satu alur yang hidup.

**Metafora visual utama: "Alur".** Sebuah pita cahaya hijau hutan yang mengalir. Ia bukan garis abstrak: ia **menyentuh benda nyata** — kertas, layar, ponsel, struk — dan benda itu ikut menyala. Pita ini adalah produknya, dan ia hadir di setiap adegan.

**Tiga kata yang harus terasa di setiap frame:**

| Kata | Wujudnya di layar |
|------|-------------------|
| **Hiperrealis** | Tekstur nyata: butir kayu, uap AC, keringat, debu di sinar matahari sore. Tidak ada render plastik. |
| **Cerdas** | Cahaya tidak berteriak. Angka muncul karena ada yang menghitungnya. AI tampil sebagai **tangan yang membantu**, bukan robot. |
| **Fleksibel** | Satu pita yang sama bisa jadi alur kerja, jadi katalog, jadi radar, jadi laporan. Bentuk berubah, identitas tetap. |

**Perasaan akhir yang dituju:** lega, lapang, dan percaya diri. Bukan "teknologi itu menakutkan", tapi "akhirnya ada yang merapikan".

**Yang harus dihindari secara kreatif:** estetika cyberpunk biru-ungu, grid heksagon, hologram melayang tanpa sebab, robot humanoid, kota neon hujan, dan wajah AI yang sempurna tanpa ekspresi. Satu Alur adalah produk **hangat** — hutan dan kunyit, bukan laboratorium.

---

## 2. Brand Lock — DNA Visual

Ambil dari token desain asli (`src/styles/tokens.css`), jangan dikarang.

| Peran | Nilai | Pemakaian di video |
|-------|-------|--------------------|
| Hijau hutan dalam | `#134235` | Warna pita Alur, latar malam, teks utama di layar terang |
| Hijau hutan sedang | `#2b7560` | Pendar pita, garis grafik, elemen aktif |
| Hijau muda | `#8fbfab` | Sorot lembut, tepi cahaya, isian grafik sekunder |
| Krim kanvas | `#f7f4ee` | Latar siang, dinding, meja, kertas |
| Kunyit (accent) | `#e7a13a` | **Satu** penekanan per bidikan: angka penting, cincin, label harga |
| Putih permukaan | `#ffffff` | Layar perangkat, kartu |

**Aturan kunyit:** maksimal satu objek kunyit per frame. Kalau semua kuning, tidak ada yang penting.

**Material & tekstur:** kayu jati matte, beton hangat, kain linen, kertas berbutir, logam kuningan sikat, kaca lembut (bukan chrome cermin). Bayangan lembut dan panjang — arah cahaya selalu dari satu sumber hangat di kiri atas.

**Tipografi di layar:** sans-serif geometris tebal untuk judul, huruf kecil berjarak lebar untuk label. Warna krim di atas hijau, atau hijau di atas krim. Tidak ada font sci-fi.

**Lensa & film:** 35mm dan 50mm anamorphic, T2.0, sedikit halation di sorotan, grain halus. Rasio 2.39:1 untuk versi sinematik, 16:9 untuk web, 9:16 untuk Reels/TikTok.

---

## 3. Dunia & Karakter (Consistency Bible)

Tempel blok ini ke **setiap** prompt supaya model tidak melenceng.

> **WORLD BLOCK (tempel di semua prompt):**
> Indonesia, tahun 2030, tetapi terasa seperti hari ini yang sedikit lebih baik. Warm tropical light, jati wood, cream walls, brass details. No neon, no cyberpunk, no blue-purple glow, no hexagon grids, no humanoid robots. Color palette strictly forest green #134235 / #2b7560, cream #f7f4ee, turmeric #e7a13a. Soft long shadows from a single warm key light upper-left. Shot on 35mm anamorphic, T2.0, fine grain, gentle halation. Hyperrealistic photographic texture.

**Rani** — protagonis. 34 tahun, pemilik usaha servis AC di Bekasi. Kulit sawo matang, rambut hitam diikat rendah, kemeja linen krem lengan panjang digulung, jam tangan kulit tua. Ekspresi: lelah yang tenang di awal, lapang di akhir. **Jangan** glamor, jangan model katalog. Dia orang yang benar-benar bekerja.

> **RANI BLOCK:** Indonesian woman, 34, warm medium-brown skin, black hair tied low, cream linen shirt with rolled sleeves, worn leather watch, no makeup glam, calm tired eyes. Photorealistic skin texture with visible pores and a faint sheen of sweat.

**Pak Dedi** — teknisi, 45, seragam hijau hutan, tas alat kanvas. Muncul satu bidikan saja (penugasan).

**Latar:** rumah tinggal dan ruko di Bekasi, siang terik; bengkel kecil; atap beton saat senja; dapur pelanggan dengan uap AC.

---

## 4. Storyboard — 12 Bidikan, 60 Detik

Setiap bidikan: durasi, deskripsi, prompt siap tempel, negative prompt, teks layar, narasi.

---

### BIDIKAN 01 · 0:00–0:05 · "Serakan"

**Visual.** Makro. Meja kayu jati penuh catatan tempel kuning, struk, dan dua ponsel. Sinar sore masuk miring, debu melayang. Tangan Rani menempel satu catatan lagi — meja sudah tidak muat.

**Prompt (EN):**
```
Extreme close-up, macro shot of a jati wood desk covered in overlapping yellow sticky notes, crumpled receipts, a printed spreadsheet, and two phones face-up. Late afternoon sunlight rakes across from upper left, dust motes drifting in the beam. A woman's hand in a cream linen sleeve presses one more sticky note onto the pile. Shallow depth of field, focus on the sticky notes, background falling into warm bokeh. Hyperrealistic, 50mm macro, T2.0, fine grain, warm cream and forest green palette, no text legible on the notes.
```
**Negative:** `neon, cyberpunk, blue light, hologram, clean minimal desk, stock photo, oversaturated, text overlays, logo`

**Teks layar:** — (biarkan kosong, biarkan kekacauan bicara)
**Narasi:** *"Tiap hari kerja Anda ada. Tapi tidak pernah di satu tempat."*

---

### BIDIKAN 02 · 0:05–0:10 · "Bunyi notifikasi"

**Visual.** Close-up ponsel di atas tumpukan kertas. Layar menyala: pesan masuk. Kaca layar memantulkan wajah Rani yang menghela napas. Fokus bergeser dari layar ke matanya.

**Prompt (EN):**
```
Close-up of a smartphone lying on a pile of papers, screen lighting up with an incoming message notification, screen glow reflecting on a woman's face just above frame. Rack focus from the phone screen to her tired eyes. Warm dim interior, cream walls, forest green shadows. Hyperrealistic, 85mm, T1.8, shallow depth of field, natural skin texture, no readable text on screen.
```
**Negative:** `readable UI text, brand logos, blue screen glow, cartoon, neon, perfect skin`

**Teks layar:** —
**Narasi:** *"Permintaan lewat chat. Penawaran di catatan. Pembukuan di spreadsheet."*

---

### BIDIKAN 03 · 0:10–0:16 · "Pita menyala" — **titik balik**

**Visual.** Rani membuka tablet di atas meja. Dari layar, sehelai **pita cahaya hijau hutan** terangkat — bukan hologram kaku, tapi seperti asap sutra yang mengalir. Pita itu menyapu meja: setiap catatan tempel, struk, dan kertas **ikut menyala hijau** lalu menyatu ke dalam pita.

**Prompt (EN):**
```
A woman opens a tablet on a cluttered wooden desk. From the tablet screen, a single ribbon of soft forest-green light lifts and flows upward like silk smoke. The ribbon sweeps across the desk; each sticky note and receipt it passes over glows forest green and dissolves into the ribbon, leaving the desk clean. Slow, graceful motion, volumetric light, particles of warm dust. Cream walls, jati wood, turmeric accent only on her watch strap. Hyperrealistic practical-light VFX, 35mm anamorphic, T2.0, gentle halation.
```
**Negative:** `hologram UI panels, floating blue screens, hexagon grid, cyberpunk, hard sci-fi, robot, lens flare overload`

**Teks layar:** —
**Narasi:** *"Satu Alur menyatukan semuanya — dalam satu alur."*

---

### BIDIKAN 04 · 0:16–0:24 · "Enam tahap"

**Visual.** Kamera mengikuti pita saat ia membentuk **enam simpul cahaya** di udara, berurutan, seperti untaian. Setiap simpul menyala saat tugasnya lewat. Kita melihat, di latar belakang yang sedikit blur, Rani mengangguk dan Pak Dedi mengangkat tas alat.

**Prompt (EN):**
```
Camera tracks alongside a flowing forest-green ribbon of light as it forms six evenly spaced glowing nodes in mid-air, one after another, like beads on a thread. Each node brightens in sequence. In the soft-focus background, an Indonesian woman in a cream linen shirt nods at a tablet, and a technician in a forest-green uniform lifts a canvas tool bag. Warm interior, cream and jati palette, single turmeric highlight. Smooth dolly move, shallow depth of field, volumetric light, hyperrealistic, 35mm anamorphic, T2.0.
```
**Negative:** `hologram icons, floating text, UI panels, blue glow, robot hands, sci-fi cockpit`

**Teks layar (muncul berurutan, kecil, huruf berjarak lebar):**
`PERMINTAAN` · `PENAWARAN` · `PENUGASAN` · `PENYELESAIAN` · `PEMBUKUAN` · `LAPORAN`

**Narasi:** *"Permintaan. Penawaran dari AI. Penugasan. Penyelesaian. Pembukuan. Laporan."*

---

### BIDIKAN 05 · 0:24–0:30 · "Penawaran yang divalidasi"

**Visual.** Over-the-shoulder. Di tablet, draf penawaran tersusun sendiri — baris demi baris — lalu sebuah **garis kunyit** menandai bagian yang lolos aturan. Jari Rani mengetuk "Setujui". Pita berdenyut sekali, lalu mengalir ke simpul berikutnya.

**Prompt (EN):**
```
Over-the-shoulder shot of a woman's hands holding a tablet. On the screen, a quotation document assembles itself line by line, then a thin turmeric-gold underline sweeps across it as if confirming each rule. Her thumb taps to approve. The forest-green ribbon beside the tablet pulses once and flows onward. Warm interior, cream walls, soft shadows, screen glow is warm not blue. Hyperrealistic, 50mm, T2.0, shallow depth of field. No readable text on screen, only abstract document structure.
```
**Negative:** `readable text, blue screen, coding, matrix, robot, neon`

**Teks layar:** `Penawaran AI · selalu divalidasi`
**Narasi:** *"AI menyusun penawarannya. Aturan bisnis Anda yang menyetujuinya."*

---

### BIDIKAN 06 · 0:30–0:34 · "Dua mesin" — **pita bercabang**

**Visual.** Pita membelah menjadi dua cabang hangat. Kiri: kuningan dan katalog. Kanan: radar dan peta. Kamera mundur perlahan, kedua cabang berdenyut seperti napas.

**Prompt (EN):**
```
A forest-green ribbon of light splits into two warm branches in mid-air. The left branch glows with brass and turmeric tones and hints of a catalog structure; the right branch glows with concentric radar rings and a faint map. Camera pulls back slowly, both branches pulsing gently like breathing. Cream and jati interior, volumetric haze. Hyperrealistic practical-light VFX, 35mm anamorphic, T2.0, elegant and calm, no hard sci-fi.
```
**Negative:** `split screen UI, blue hologram, hexagons, cyberpunk, text`

**Teks layar:** `PENDAPATAN` (kiri) · `PERTUMBUHAN` (kanan)
**Narasi:** *"Setelah rapi, dua mesin menyusul."*

---

### BIDIKAN 07 · 0:34–0:40 · "Layanan tambahan"

**Visual.** Cabang kiri mekar menjadi **katalog** — kartu-kartu layanan tambahan tersusun seperti dedaunan kuningan. Batang serapan naik satu per satu. Satu label kunyit menonjol: potensi tambahan per bulan.

**Prompt (EN):**
```
The left branch of light blooms into a floating catalog of service add-on cards arranged like brass leaves on a branch. Beside each card, a thin bar rises smoothly to show an attach rate. One turmeric-gold label lifts slightly forward, catching the light. Warm cream background, jati wood surface below, soft shadows. Elegant, calm, premium. Hyperrealistic 3D with photographic lighting, 50mm, T2.0, shallow depth of field, no readable text.
```
**Negative:** `dashboard screenshot, blue UI, neon, clutter, robot`

**Teks layar:** `Layanan tambahan · jual ke pekerjaan yang sudah ada`
**Narasi:** *"Layanan tambahan: jual lebih banyak ke pekerjaan yang sudah ada."*

---

### BIDIKAN 08 · 0:40–0:46 · "Tanpa limbah"

**Visual.** Lima titik kebocoran menyala merah lembut di sepanjang alur — waktu, perjalanan, bahan, pengerjaan ulang, air & kimia. Satu per satu **tertutup**, dan sebuah **cincin** menutup dari kunyit ke hijau. Angka persentase naik.

**Prompt (EN):**
```
Five soft red glowing leak points along a forest-green ribbon, each labelled only by an abstract icon: clock, road, material stack, redo arrow, water droplet. One by one each leak seals shut with a gentle pulse, turning from red to forest green. A thin turmeric ring closes around them and fills to green. Warm cream and jati environment, soft volumetric light. Hyperrealistic, 50mm, T2.0, calm and satisfying motion, no readable text.
```
**Negative:** `alarm red flashing, danger, blue hologram, smoke, chaos`

**Teks layar:** `Tanpa limbah · lima sumber pemborosan, diukur dalam Rupiah`
**Narasi:** *"Tanpa limbah: lima kebocoran, diukur dalam Rupiah, ditutup satu per satu."*

---

### BIDIKAN 09 · 0:46–0:51 · "Radar & prospek"

**Visual.** Cabang kanan: radar menyapu peta Bekasi dari atas, cincin radius menyebar, pin-pin muncul dengan skor. Lalu kamera turun ke satu pin — sebuah ruko — dan pita menyentuhnya.

**Prompt (EN):**
```
Top-down view of a Bekasi neighborhood map rendered as warm cream and forest-green terrain with jati-colored rooftops. A soft radar sweep rotates outward, concentric rings expanding. Small glowing pins appear with tiny score badges. Camera descends smoothly toward one pin, a small shophouse, and a forest-green ribbon of light touches it. Warm sunset light, soft haze, hyperrealistic aerial photography blended with subtle VFX, 35mm, T2.0.
```
**Negative:** `google maps screenshot, blue UI, neon city, satellite harshness, text`

**Teks layar:** `Radar peluang & pencari prospek · dari data Anda sendiri`
**Narasi:** *"Radar peluang membaca transaksi Anda. Pencari prospek memetakan yang belum Anda layani."*

---

### BIDIKAN 10 · 0:51–0:56 · "Lima tim AI"

**Visual.** Lima pendar warna berbeda — hijau, biru, jingga, ungu, teal — mengorbit sebuah hub di tengah, mengalirkan benang-benang insight. Lalu semuanya menyatu menjadi **satu rekomendasi** yang diserahkan ke Rani.

**Prompt (EN):**
```
Five distinct glowing orbs of light — forest green, deep blue, warm orange, muted purple, teal — orbit slowly around a central hub of soft white light. Thin threads of light stream from each orb into the hub. The threads converge into a single beam that extends toward the viewer and resolves into a folded paper recommendation held by a woman's hand. Warm cream environment, jati desk, volumetric light, elegant and calm. Hyperrealistic practical VFX, 50mm, T2.0.
```
**Negative:** `robot, humanoid AI, blue sci-fi HUD, hexagon grid, neon`

**Teks layar:** `Lima tim AI · satu keputusan`
**Narasi:** *"Lima tim AI bekerja bersamaan. Satu rekomendasi yang bisa Anda jalankan."*

---

### BIDIKAN 11 · 0:56–0:59 · "Senja di atap" — **puncak emosi**

**Visual.** Rani berdiri di atap beton saat senja, tablet di tangan, angin lembut. Pita cahaya kini **melingkar** seluruh kota di bawahnya — sebuah cincin hijau hutan yang tenang di atas Jakarta yang hangat. Wajahnya lapang.

**Prompt (EN):**
```
Wide cinematic shot from behind: an Indonesian woman in a cream linen shirt stands on a concrete rooftop at golden hour, tablet held loosely at her side, hair and fabric moving gently in the wind. Below and beyond her, the Jakarta skyline glows warm amber. A vast forest-green ring of light arcs gently across the sky above the city, calm and continuous. Slow push-in, anamorphic flare, fine grain, hyperrealistic, 35mm, T2.0, epic but intimate.
```
**Negative:** `cyberpunk skyline, neon signs, flying cars, dystopia, blue tone, sci-fi city`

**Teks layar:** `Satu alur. Dari permintaan sampai keputusan.`
**Narasi:** *"Satu alur. Dari permintaan pertama sampai keputusan berikutnya."*

---

### BIDIKAN 12 · 0:59–1:00 · "Logo"

**Visual.** Cincin menyusut menjadi satu titik, lalu mekar menjadi logo Satu Alur di atas krim. Satu kilau kunyit lewat.

**Prompt (EN):**
```
The vast green ring of light contracts smoothly into a single point, then blooms into a clean minimal logo mark on a cream background: a flowing S-curve inside a circle, forest green. A single turmeric-gold highlight sweeps across it once. Static end card, generous negative space, soft shadow beneath the mark. Hyperrealistic render, 50mm, T2.0.
```
**Negative:** `text, tagline, clutter, gradient mesh, blue`

**Teks layar:** `SATU ALUR` / `Bisnis jasa Anda, tumbuh dalam satu alur.` / `Mulai gratis — satualur.id`

---

## 5. Naskah Narasi (Indonesia) + Arahan Suara

**Total kata: 101. Pada 60 detik, ini ritme santai — beri ruang bernapas.**

| Waktu | Narasi |
|-------|--------|
| 0:00 | Tiap hari kerja Anda ada. |
| 0:05 | Tapi tidak pernah di satu tempat. |
| 0:08 | Permintaan lewat chat. Penawaran di catatan. Pembukuan di spreadsheet. |
| 0:13 | Satu Alur menyatukan semuanya — dalam satu alur. |
| 0:18 | Permintaan. Penawaran dari AI. Penugasan. Penyelesaian. Pembukuan. Laporan. |
| 0:26 | AI menyusun penawarannya. Aturan bisnis Anda yang menyetujuinya. |
| 0:31 | Setelah rapi, dua mesin menyusul. |
| 0:35 | Layanan tambahan: jual lebih banyak ke pekerjaan yang sudah ada. |
| 0:41 | Tanpa limbah: lima kebocoran, diukur dalam Rupiah, ditutup satu per satu. |
| 0:47 | Radar peluang membaca transaksi Anda. Pencari prospek memetakan yang belum Anda layani. |
| 0:52 | Lima tim AI bekerja bersamaan. Satu rekomendasi yang bisa Anda jalankan. |
| 0:57 | Satu alur. Dari permintaan pertama sampai keputusan berikutnya. |

**Arahan suara.** Perempuan, 30-an, timbre hangat dan rendah, bukan suara iklan TV yang ceria berlebihan. Tempo santai, sedikit lebih lambat dari percakapan normal. Berhenti penuh setelah "satu tempat" (0:05) dan setelah "dua mesin menyusul" (0:31) — dua jeda itu yang membuat cerita terasa.

**Ucapkan angka dengan jelas:** "Rupiah" penuh, bukan "rupiah" cepat. "AI" dibaca "a-i", bukan "ai".

**Alternatif pria:** timbre bariton tenang, 40-an, untuk versi B2B/Enterprise.

---

## 6. Musik & Sound Design

**Musik.** Satu tema, tiga lapisan, naik perlahan — jangan ada drop.

| Waktu | Lapisan | Instrumen |
|-------|---------|-----------|
| 0:00–0:13 | Lapisan 1 — gelisah | Piano felt bertalu pelan, tekstur tape hiss, denyut rendah tidak stabil |
| 0:13–0:31 | Lapisan 2 — lapang | Masuk pad hangat, senar pizzicato ringan, denyut menjadi stabil |
| 0:31–0:51 | Lapisan 3 — tumbuh | Perkusi ringan (shaker, rim), bas hangat, melodi utama muncul |
| 0:51–1:00 | Resolusi | Melodi penuh, lalu menyusut ke piano tunggal di dua detik terakhir |

**Kunci:** 100 BPM, D mayor, instrumen akustik asli (bukan synth EDM). Referensi rasa: Hania Rani, Ólafur Arnalds, tapi lebih hangat dan sedikit lebih berirama.

**Sound design (lapisan penting, jangan dilewat)**

| Bidikan | Suara |
|---------|-------|
| 01 | Kertas berdesir, gesekan catatan tempel, dengung AC jauh |
| 02 | Notifikasi tunggal — lembut, bukan tajam |
| 03 | Whoosh halus saat pita terangkat; desis pelan saat kertas menyatu |
| 04 | Enam "ting" berbeda nada, satu per simpul — nada naik |
| 05 | Ketukan jari di kaca; satu "klik" konfirmasi rendah |
| 06 | Dua denyut napas, satu kiri satu kanan |
| 07 | Gesekan logam ringan, satu "ting" kunyit |
| 08 | Lima "blup" tertutup, nada menurun lalu naik di cincin |
| 09 | Sapuan radar halus, satu "ping" pin |
| 10 | Lima nada berbeda menyatu menjadi satu akor |
| 11 | Angin atap, lalu hening sesaat sebelum narasi terakhir |
| 12 | Satu nada bersih, lalu senyap |

**Campuran akhir:** narasi −14 LUFS, musik −26 LUFS di bawah narasi, efek −20 LUFS. Target keseluruhan −14 LUFS, true peak −1 dB.

---

## 7. Adaptasi per Model

| Model | Batas | Cara pakai dokumen ini |
|-------|-------|------------------------|
| **Veo 3 / 3.1** | 8 detik + audio native | Generate per bidikan. Pakai `image` dari frame terakhir bidikan sebelumnya sebagai first frame. Audio native Veo hanya untuk ambience — narasi tetap direkam terpisah. |
| **Sora 2** | 10–20 detik, audio native | Bisa menggabungkan bidikan 01+02 dan 11+12. Minta audio hanya ambience. |
| **Kling 2.x** | 5–10 detik | Kualitas gerak terbaik untuk pita cahaya. Pakai `reference_images` wajib. |
| **Runway Gen-3/4** | 5–10 detik | Gunakan `motion brush` untuk mengarahkan gerak pita. |
| **Hailuo / MiniMax** | 6–10 detik | Paling kuat untuk tekstur kulit dan makro (bidikan 01, 02, 05). |

**Tips konsistensi lintas model:**
- Selalu hasilkan **bidikan 03 lebih dulu** (pita cahaya), lalu ekstrak satu frame sebagai `reference_images` untuk semua bidikan lain. Pita itu identitas visual video.
- Generate Rani di bidikan 02, ekstrak frame wajah, pakai sebagai referensi karakter.
- Kalau model menolak `negative prompt`, tulis larangan di akhir prompt positif: *"Avoid neon, blue light, cyberpunk, hexagon grids, and humanoid robots."*

---

## 8. Peta Potong: Versi 30 Detik dan 15 Detik

**30 detik (untuk pre-roll dan feed):**

| Baru | Dari bidikan | Durasi |
|------|--------------|--------|
| 0:00 | 01 (dipotong 3s) | 3s |
| 0:03 | 02 (dipotong 3s) | 3s |
| 0:06 | 03 penuh | 6s |
| 0:12 | 04 (dipotong 5s, hanya 3 simpul pertama lalu lompat) | 5s |
| 0:17 | 05 (dipotong 3s) | 3s |
| 0:20 | 08 penuh | 6s |
| 0:26 | 11 (dipotong 3s) | 3s |
| 0:29 | 12 | 1s |

Narasi versi 30 detik: *"Tiap hari kerja Anda ada — tapi tidak pernah di satu tempat. Satu Alur menyatukan permintaan, penawaran AI, penugasan, pembukuan, dan laporan. Lalu dua mesin menyusul: pendapatan dari layanan tambahan, dan pertumbuhan dari data Anda sendiri. Satu alur. Mulai gratis."* (40 kata)

**15 detik (untuk bumper dan Reels):** bidikan 03 (4s) → 04 (4s) → 08 (4s) → 11 (2s) → 12 (1s). Narasi: *"Satu Alur. Permintaan, penawaran AI, pembukuan, laporan — dalam satu alur. Mulai gratis."*

**9:16 vertikal:** ulangi generate bidikan 03, 04, 08, 11 dengan `aspect_ratio: 9:16` dan prompt ditambah *"vertical composition, subject centered, safe margins top and bottom for captions."* Jangan crop dari 16:9 — pita cahaya akan terpotong.

---

## 9. Guardrail Akurasi — Jangan Tampilkan Ini

Produk ini punya batas yang jelas, dan video tidak boleh menjanjikan lebih. Kalau ragu, cek `docs/01_PRD.md` dan `docs/DEMO_SCRIPT.md`.

| Jangan tampilkan | Kenapa | Ganti dengan |
|------------------|--------|--------------|
| AI mengirim pesan/penawaran otomatis ke pelanggan | Tidak ada. Semua pengiriman manual | Tangan yang menekan "Setujui" / "Bagikan" |
| AI membaca database sendiri (tool calling) | Angka dihitung aplikasi lalu diberikan ke AI | Angka muncul dari grafik, lalu AI menjelaskan |
| Robot humanoid sebagai "AI" | Bertentangan dengan brand hangat | Pita cahaya + lima pendar tim |
| Dashboard penuh angka palsu yang terbaca | Melanggar kejujuran produk | Grafik abstrak tanpa teks terbaca |
| "Gratis selamanya" | Paket gratis 3 bulan, lalu Rp349rb | "Mulai gratis" saja |
| Integrasi WhatsApp aktif | Di luar rilis saat ini (P3) | Tidak disebut sama sekali |
| Kota futuristik dengan mobil terbang | Bukan produk ini | Bekasi/Jakarta 2030 yang hangat dan realistis |

**Fitur yang **boleh** dan **sebaiknya** muncul** (semua sudah ada di aplikasi):

Enam tahap alur · penawaran AI dengan validasi aturan · penugasan & jadwal · penyelesaian dengan foto · pembukuan & laba/rugi · laporan yang dijelaskan AI · katalog layanan tambahan dengan serapan · lima aliran pemborosan dalam Rupiah · radar peluang dari transaksi sendiri · pencari prospek berbasis peta & radius · media sosial (Facebook, Instagram, Threads) dengan jadwal · lima agen Penasihat AI · lima tim AI ruang optimasi · kalkulator target 1/2/5/10% · login email OTP · data terisolasi per akun di Cloudflare.

---

## 10. Deliverable & Spesifikasi Teknis

| Item | Spesifikasi |
|------|-------------|
| Master | 3840×2160, 2.39:1 (letterbox), 24 fps, ProRes 422 HQ |
| Web | 1920×1080, 16:9, H.264, 12 Mbps |
| Vertikal | 1080×1920, 9:16, H.264, 8 Mbps |
| Feed persegi | 1080×1080, 1:1 |
| Audio | 48 kHz, 24-bit, stereo; narasi mono di trek terpisah |
| Subtitle | `.srt` Indonesia + `.vtt`; maks 42 karakter per baris |
| Judul file | `satualur_commercial_{60|30|15}s_{16x9|9x16|1x1}_v{n}` |

**Teks layar akhir (end card):**

```
SATU ALUR
Bisnis jasa Anda, tumbuh dalam satu alur.
Mulai gratis — satualur.id
```

---

## Lampiran A · Prompt Cepat (satu blok per bidikan)

Untuk model yang hanya menerima satu kolom prompt, gabungkan: `WORLD BLOCK` + `RANI BLOCK` (kalau ada Rani) + prompt bidikan + `Avoid: neon, blue light, cyberpunk, hexagon grids, humanoid robots, readable text on screens.`

Contoh bidikan 03 lengkap:

```
Indonesia, 2030, warm tropical light, jati wood, cream walls, brass details. No neon, no cyberpunk, no blue-purple glow, no hexagon grids, no humanoid robots. Palette strictly forest green #134235 / #2b7560, cream #f7f4ee, turmeric #e7a13a. Soft long shadows from a single warm key light upper-left. 35mm anamorphic, T2.0, fine grain, gentle halation, hyperrealistic.

Indonesian woman, 34, warm medium-brown skin, black hair tied low, cream linen shirt with rolled sleeves, worn leather watch, calm tired eyes, photorealistic skin texture.

A woman opens a tablet on a cluttered wooden desk. From the tablet screen, a single ribbon of soft forest-green light lifts and flows upward like silk smoke. The ribbon sweeps across the desk; each sticky note and receipt it passes over glows forest green and dissolves into the ribbon, leaving the desk clean. Slow graceful motion, volumetric light, drifting dust particles.

Avoid: neon, blue light, cyberpunk, hexagon grids, humanoid robots, readable text on screens, hologram UI panels, lens flare overload.
```
