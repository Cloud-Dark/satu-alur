# Sweep UI mobile (390 px)

> Status: Selesai
> Tanggal: 2026-11-03
> Spec otomatis: `tests/e2e/mobile-sweep.spec.cjs` (jalankan `SWEEP_VERBOSE=1 node tests/e2e/run.cjs mobile-sweep` untuk daftar pelanggar)

## Cara memeriksa

Playwright 390×844 di mode mock membuka setiap tahap bisnis (akun live dan akun demo; Penugasan juga tab Tim, Peta, Performa), setiap tab Pengaturan, dan setiap halaman Kantor (login staf). Per halaman:

- `document.scrollWidth > innerWidth` (dan lebar isi drawer Pengaturan) → gagal.
- Elemen terlihat yang keluar layar, kecuali di dalam penggulir horizontal (tab, tabel), peta Leaflet, atau drawer/dialog tertutup.
- Kontrol kecil yang saling tumpuk (tag, tombol, chip, avatar, tab).
- Teks `null` / `undefined` yang bocor ke layar.

## Temuan dan perbaikan

| Area | Sebelum | Sesudah |
|------|---------|---------|
| Pengaturan (6 tab) | Bar tab lebih lebar dari drawer (+146 px); seluruh isi drawer bergeser dan terpotong di kiri | Bar tab menggulir di kotaknya sendiri (`C.segmented({ scroll: true })`): tepi memudar saat ada tab tersembunyi, tab aktif digulir ke tengah; isi drawer `min-width: 0` |
| Pengaturan › Log, ERP mapping | Tabel 7 kolom melebar keluar drawer | Tabel dibungkus `.table-wrap` (gulir horizontal di dalam kartu) |
| Penugasan › Tim | Teks `null` di bawah panel saat tidak ada petugas nonaktif | Diperbaiki (lihat akar masalah) |
| Pengaturan › Log, Migrasi; Pencari prospek (statistik nilai); Media Sosial › Jadwal | Pola yang sama dapat menampilkan `null` | Diperbaiki |
| Tambah petugas › Keahlian | `<fieldset>` bawaan browser (bingkai abu-abu) + checkbox polos | Chip pilihan bergaya Tumbuh + tambah keahlian langsung; checkbox/radio/fieldset/file input global mengikuti design system |
| Login | Google di bawah form email | Google di atas, lalu "atau dengan email", lalu form |
| Penugasan › Peta | Diagram SVG statis / "Lokasi muncul setelah integrasi peta aktif" | Peta Leaflet + OpenStreetMap, penanda per petugas (warna status), popup, lokasi job hari ini bila permintaan punya koordinat |
| Tumpukan kontrol | 0 temuan di 42 halaman | — |

## Akar masalah "null"

`Element.append()` / `replaceChildren()` bawaan DOM mengubah `null` menjadi teks `"null"` (berbeda dengan helper `el()` yang melewati `null`). Panel Tim memanggil `target.append(..., inactive.length ? panel : null)`. Pemindaian AST atas `src/**/*.js` menemukan 5 pemanggilan serupa; semuanya sekarang memberi `''`.
