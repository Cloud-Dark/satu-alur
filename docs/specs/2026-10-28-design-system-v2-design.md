# Design System v2 — "Tumbuh"

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Menggantikan gaya v1 (editorial brutalism: hard-shadow, kicker mono, aksen lime). Sumber token: `src/styles/tokens.css`.

## 1. Karakter

Satu Alur membantu bisnis jasa di Indonesia **tumbuh** dengan AI. Kesan yang dituju: tenang, hangat, premium, dan dapat dipercaya. Rasanya seperti layanan keuangan modern, bukan konsol developer.

| Ya | Tidak |
|---|---|
| Kanvas krem, permukaan putih, hijau hutan sebagai warna merek | Hard offset shadow, border tinta tebal |
| Satu aksen kunyit untuk angka kunci / sorotan | Lime / neon, gradien ungu-cyan, biru SaaS generik |
| Judul serif (Instrument Serif) dengan kata kunci *italic* | Label mono uppercase dengan letter-spacing lebar di mana-mana |
| Sudut membulat (10–28px), tombol pill | Sudut tajam / radius 0–6px |
| Bayangan lembut berlapis, glow ambient tipis | Bayangan blur abu-abu generik yang tebal |
| Ilustrasi garis alur yang organik | Emoji sebagai ikon |

## 2. Warna

| Token | Light | Dark | Pemakaian |
|---|---|---|---|
| `--bg` | `#f7f4ee` | `#0b1310` | Kanvas halaman |
| `--surface` | `#ffffff` | `#131f1a` | Kartu, panel, input |
| `--text` | `#16241f` | `#e9efeb` | Teks utama |
| `--text-muted` | `#5f6d66` | `#96a59e` | Teks pendukung |
| `--brand` | `#134235` | `#8fd1b3` | Tombol primer, logo, elemen aktif |
| `--brand-50/100` | tint hijau | tint gelap | Latar lembut, tag, nav aktif |
| `--accent` | `#e7a13a` | `#f0b453` | Sorotan tunggal per tampilan (angka kunci, badge "Rekomendasi", titik benih logo) |
| `--line` | `#e4ded3` | `#23332c` | Garis rambut 1px |
| Semantik | `--success`, `--warning`, `--danger`, `--info` (+ `-bg`) | | Status |

Aturan: teks di atas `--accent` memakai `--text-on-accent`; teks di atas `--brand` memakai `--text-on-brand`. Kontras teks minimum 4.5:1.

## 3. Tipografi

- **Display**: `Instrument Serif` 400 (+ italic) melalui kelas `.display`; dipakai untuk hero, judul section, angka besar KPI opsional. Kata kunci dibungkus `<em>`.
- **UI/Body**: `Plus Jakarta Sans` 400–800 (font karya desainer Indonesia).
- **Eyebrow**: `.eyebrow` — sans 600, 12px, uppercase, tracking 0.08em, warna `--brand-500`. Dipakai hemat (maksimal satu per section).
- Angka: `.tnum` untuk tabel dan KPI.
- Skala: `--fs-xs` … `--fs-hero`.

## 4. Bentuk & kedalaman

- Radius: `--r-sm` 10 (input), `--r-md` 14 (kartu kecil), `--r-lg` 20 (kartu/panel), `--r-xl` 28 (section feature), `--r-pill` (tombol, tag).
- Bayangan: `--shadow-xs/sm/md/lg` — lembut, berlapis, ber-tint hijau. Hover kartu: `translateY(-2px)` + naik satu level bayangan.
- Garis: 1px `--line`; tidak ada border tebal.
- Focus: `--ring` (cincin ganda bg + brand).

## 5. Komponen dasar (di `tokens.css`)

`.btn` + `.btn-primary | .btn-accent | .btn-soft | .btn-ghost | .btn-danger`, ukuran `.btn-sm | .btn-lg`; `.icon-btn`; `.tag` / `.tag-accent`; `.surface`; `.eyebrow`; `.pulse-dot`; `.ambient` (glow hero); `.reveal`; toast.

## 6. Gerak

- Easing utama `--ease` (ease-out lembut), `--ease-spring` untuk pop kecil.
- Durasi 150 / 260 / 620ms. Entri section: fade-up 16px.
- Animasi ringan saja: float lembut, pulse status, garis alur yang "mengalir" (stroke-dashoffset).
- `prefers-reduced-motion` dihormati (scene 3D statis, tanpa marquee).

## 7. Three.js

- Landing: pita alur 3D halus (tube/ribbon ber-shading, material matte "clay" hijau) dengan 6 manik tahap; satu manik kunyit; partikel kecil mengalir. Pencahayaan lembut (hemisphere + directional), latar transparan.
- Login: komposisi tenang dari bentuk-bentuk clay (bola, torus) yang mengorbit perlahan di sekitar garis alur.
- Warna diambil dari token (`cssVar`), diperbarui pada event `themechange`. Pixel ratio ≤ 1.75, jeda saat tidak terlihat, dispose saat cleanup, import bernama (tree-shaking).

## 8. Aksesibilitas & responsif

Breakpoint uji 375 / 768 / 1024 / 1440. Tidak ada scroll horizontal. Landmark semantik, label terhubung, `aria-live` untuk pesan, fokus selalu terlihat.
