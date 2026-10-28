# Setup Pengembang

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Panduan menjalankan Satu Alur di mesin lokal. Untuk deploy ke Cloudflare lihat [18_INSTALLATION.md](18_INSTALLATION.md).

## Prasyarat

- Node.js 18+ (disarankan 22+) dan npm.
- Untuk mode Worker lokal: `wrangler` (terpasang sebagai devDependency lewat `npm install`).
- Fitur AI di Worker lokal: binding Workers AI memerlukan akun Cloudflare dan login `npx wrangler login` (perilaku persis pada `wrangler dev` _TBD_; verifikasi).

## Opsi A - Mode mock (tanpa backend)

Paling cepat untuk pengerjaan UI. Data di `localStorage`, AI disimulasikan.

```bash
npm install
VITE_USE_MOCK=true npm run dev
```

Buka `http://localhost:5173`. Alternatif pada mode dev: jalankan `localStorage.setItem('satualur_use_mock','1')` di konsol peramban lalu muat ulang.

## Opsi B - Worker + D1 lokal (mendekati produksi)

```bash
npm install
npm run db:migrate:local   # buat tabel di D1 lokal
npm run cf:dev             # vite build lalu wrangler dev
```

Buka alamat yang dicetak wrangler (bawaan `http://localhost:8787`). Worker melayani `dist/` dan `/api/*` dari satu origin. Setiap perubahan kode klien memerlukan build ulang (jalankan ulang `cf:dev`).

Login: karena `DEMO_OTP="true"` di `wrangler.toml`, kode OTP ditampilkan di aplikasi setelah meminta kode (lihat [21_BACKEND.md](21_BACKEND.md)).

## Opsi C - Vite dev server + Worker (hot reload klien)

Dua terminal:

```bash
npm run cf:dev        # terminal 1: Worker di :8787 (juga membangun dist/)
npm run dev           # terminal 2: Vite di :5173, /api diproksikan ke :8787
```

Buka `http://localhost:5173`.

## Memeriksa Data Lokal

```bash
npx wrangler d1 execute satu-alur-db --local --command "SELECT id, email FROM users"
```

Data lokal tersimpan di direktori `.wrangler/` (tidak untuk di-commit; periksa `.gitignore`).

## Struktur Kode

| Path | Isi |
|------|-----|
| `worker/index.js` | Worker: auth, `/api/db`, LLM |
| `migrations/` | Migrasi D1 |
| `wrangler.toml` | Konfigurasi Worker/D1/AI/assets |
| `src/http-cloud.js` | Klien `/api/*` |
| `src/mock/mock-cloud.js` | Backend mock |
| `src/cloud.js` | Pemilih mock/HTTP |
| `src/stages/`, `src/domain/`, `src/ai/`, `src/auth/`, `src/ui/` | Aplikasi |

## Masalah Umum

| Gejala | Penyebab/solusi |
|--------|-----------------|
| `no such table` | Migrasi lokal belum dijalankan: `npm run db:migrate:local` |
| `/api/*` 404 di `npm run dev` | Worker belum berjalan di :8787 (Opsi C) |
| Halaman lama tampil di `cf:dev` | `dist/` belum dibangun ulang |
| 401 setelah restart | Sesi tersimpan di D1 lokal; login ulang bila database lokal dihapus |
| Simpan permintaan gagal "Kolom tidak dikenal: phone" | Temuan R-015 di [10_RISK_REGISTER.md](10_RISK_REGISTER.md) |

Standar kode dan kontribusi: [standards/00_STANDARD_INDEX.md](standards/00_STANDARD_INDEX.md).
