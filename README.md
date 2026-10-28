# Satu Alur

<p align="center">
  <img src="public/assets/logo-satu-alur.png" alt="Satu Alur" width="400">
</p>

**Satu Alur** — Satu alur lengkap untuk otomasi operasi jasa dengan kecerdasan buatan. Dirancang untuk perusahaan layanan jasa/on-demand di Indonesia.

> Dari permintaan pelanggan sampai laporan keuangan, semua dalam satu alur yang terintegrasi.

## Fitur Utama

- **6 Tahap Alur Jasa Lengkap**: Permintaan → Penawaran → Penugasan → Penyelesaian → Pembukuan → Laporan
- **AI-Powered**: Penawaran otomatis dengan validasi domain, penjelasan laporan keuangan
- **Cloudflare Integration**: Worker tunggal, database D1, Workers AI (LLM streaming), dan login email OTP
- **AntiSlop UI Engine**: Design token enforcement, content quality gates, runtime validation
- **Mode Mock**: Berjalan penuh tanpa backend (data lokal di browser) untuk pengembangan lokal
- **MCP Connectors**: Siap integrasi WhatsApp (WAPilot) & Email (SMTP)
- **Agent Skill Editor**: User bisa mengubah prompt AI sesuai kebutuhan bisnis

## Tech Stack

- **Frontend**: Vite + Vanilla JavaScript (ES Modules) + AntiSlop Design System
- **Backend**: Cloudflare Worker tunggal (`worker/index.js`) yang melayani aset statis dan `/api/*`
- **Database**: Cloudflare D1 (SQLite), database `satu-alur-db`
- **AI**: Cloudflare Workers AI (streaming SSE)
- **Auth**: Email OTP + sesi bearer token (mode demo OTP, belum ada provider email)
- **Language**: Bahasa Indonesia

## Quick Start

### Prerequisites

- Node.js 18+ (disarankan 22+)
- npm atau yarn
- Akun Cloudflare (hanya untuk deploy atau menjalankan Worker dengan Workers AI)

### Instalasi

```bash
# Clone repository
git clone https://github.com/username/satu-alur.git
cd satu-alur

# Install dependencies
npm install

# Jalankan mode development
npm run dev
```

Aplikasi akan berjalan di `http://localhost:5173`

### Mode Mock (Tanpa Backend)

Untuk pengembangan lokal tanpa Worker, jalankan dengan `VITE_USE_MOCK=true`:

```bash
VITE_USE_MOCK=true npm run dev
```

- Semua fitur 6 tahap berfungsi penuh
- AI penawaran & laporan (simulasi streaming)
- Data tersimpan di localStorage browser
- Data tidak persisten antar perangkat/browser
- Hanya untuk pengembangan lokal, bukan untuk deploy

### Worker + D1 Lokal

```bash
npm run db:migrate:local   # buat tabel di D1 lokal
npm run cf:dev             # build lalu jalankan Worker (default http://localhost:8787)
```

Panduan lengkap: [docs/17_DEVELOPER_SETUP.md](docs/17_DEVELOPER_SETUP.md).

### Deploy ke Cloudflare

Ringkasan (langkah lengkap dan verifikasi di [docs/18_INSTALLATION.md](docs/18_INSTALLATION.md)):

1. Buat database: `npx wrangler d1 create satu-alur-db`
2. Isi `database_id` hasilnya di `wrangler.toml`
3. Terapkan migrasi: `npm run db:migrate:remote`
4. Deploy: `npm run deploy`

Catatan: `DEMO_OTP="true"` di `wrangler.toml` membuat kode OTP dikembalikan di respons API karena belum ada provider email. Mode ini hanya untuk uji; jangan dipakai untuk produksi. Lihat [docs/10_RISK_REGISTER.md](docs/10_RISK_REGISTER.md).

## Struktur Project

```
satu-alur/
├── public/
│   └── assets/          # Brand assets (logo, icon, hero)
│       ├── logo-satu-alur.png
│       ├── icon-satu-alur.png
│       └── hero-banner.png
├── src/
│   ├── ai/              # AI agent (penawaran & penjelasan laporan)
│   │   ├── agent.js
│   │   └── models.js
│   ├── auth/            # Authentication module (OTP)
│   │   └── auth.js
│   ├── cloud.js         # Pemilih backend: HTTP (Worker) atau mock
│   ├── http-cloud.js    # Klien untuk API Worker (/api/*)
│   ├── domain/          # Domain models & validation rules
│   │   ├── models.js
│   │   └── rules.js
│   ├── mock/            # Mock cloud for prototype mode
│   │   └── mock-cloud.js
│   ├── stages/          # 6 stage UI + settings
│   │   ├── request.js
│   │   ├── offer.js
│   │   ├── assign.js
│   │   ├── complete.js
│   │   ├── bookkeeping.js
│   │   ├── report.js
│   │   └── settings.js  # MCP + Agent + pengaturan cloud
│   ├── ui/              # UI components, animations, AntiSlop engine
│   │   ├── app.js
│   │   ├── animations.js
│   │   ├── antislop.js  # Design token & quality enforcement
│   │   └── components.js
│   ├── main.js          # Entry point
│   └── styles.css       # Global styles (dark theme, animations)
├── worker/
│   └── index.js         # Cloudflare Worker: auth, /api/db, LLM
├── migrations/          # Migrasi D1 (SQLite)
├── docs/                # Dokumentasi (mulai dari docs/README.md)
├── scripts/
│   └── setup.js         # Skrip lama (WorkBuddy), status relevansi TBD
├── wrangler.toml        # Konfigurasi Worker, D1, Workers AI, assets
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## Database Schema

Lihat [docs/20_DATABASE.md](docs/20_DATABASE.md) untuk skema D1 lengkap. Dokumen lama [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) (PostgreSQL) sudah digantikan.

## API Documentation

Lihat [docs/API.md](docs/API.md) untuk dokumentasi API. Indeks seluruh dokumentasi: [docs/README.md](docs/README.md).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run setup` | Skrip setup lama (WorkBuddy) |
| `npm run cf:dev` | Build lalu jalankan Worker lokal (`wrangler dev`) |
| `npm run deploy` | Build lalu deploy ke Cloudflare |
| `npm run db:migrate:local` | Terapkan migrasi D1 ke database lokal |
| `npm run db:migrate:remote` | Terapkan migrasi D1 ke database Cloudflare |

## Alur Penggunaan

### 1. Permintaan (Request)
- Input: Nama pelanggan, jenis layanan, lokasi, deskripsi
- Output: Daftar permintaan tersimpan

### 2. Penawaran (Offer) — AI Powered
- Pilih permintaan dari daftar
- AI menghasilkan proposal JSON (scope, harga, terms)
- Domain rules memvalidasi hasil
- Setuju → simpan ke database

### 3. Penugasan (Assignment)
- Pilih penawaran yang disetujui
- Input: Nama pekerja, jadwal
- Output: Daftar penugasan aktif

### 4. Penyelesaian (Completion)
- Pilih penugasan aktif
- Input: Catatan hasil pekerjaan
- Output: Status selesai

### 5. Pembukuan (Bookkeeping)
- Pilih pekerjaan selesai
- Input: Jumlah, kategori (pendapatan/biaya)
- Output: Jurnal + ringkasan laba/rugi

### 6. Laporan (Report) — AI Powered
- Ringkasan keuangan otomatis
- AI menjelaskan laporan dalam bahasa mudah dipahami

### 7. Pengaturan (Settings)
- **MCP Connectors**: Konfigurasi WhatsApp (WAPilot) & Email (SMTP)
- **Agent Skills**: Edit prompt AI, temperature, max tokens, model preference
- **Cloud**: Status mode (Cloudflare Worker + D1 atau mock lokal)

## Kontribusi

1. Fork repository
2. Buat branch feature (`git checkout -b feature/nama-fitur`)
3. Commit perubahan (`git commit -m 'Add: nama fitur'`)
4. Push ke branch (`git push origin feature/nama-fitur`)
5. Buat Pull Request

## License

MIT License

## Support

Untuk bantuan teknis atau pertanyaan, buat issue di GitHub repository.
