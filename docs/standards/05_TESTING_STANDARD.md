# Standar Pengujian

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Saat ini belum ada uji otomatis (`npm test` placeholder). Dokumen ini menetapkan praktik minimum dan target.

## Praktik Minimum (berlaku sekarang)

1. `npm run build` harus sukses.
2. Uji manual alur yang diubah di mode mock (`VITE_USE_MOCK=true npm run dev`).
3. Untuk perubahan Worker/skema: `npm run db:migrate:local`, `npm run cf:dev`, lalu uji enam tahap dan login OTP demo ([17_DEVELOPER_SETUP.md](../17_DEVELOPER_SETUP.md)).
4. Sebelum rilis: smoke test curl ([18_INSTALLATION.md](../18_INSTALLATION.md)) dan UAT ([uat/2026-10-28_cloudflare-deploy-uat.md](../uat/2026-10-28_cloudflare-deploy-uat.md)).

## Target Uji Otomatis (belum ada; pilihan alat _TBD_)

| Lapisan | Yang diuji | Prioritas |
|---------|-----------|-----------|
| Unit domain | `validateOffer`, `canTransition`, kalkulasi laba/rugi | Tinggi |
| Worker (di runtime Workers, mis. Miniflare/`wrangler dev`) | Auth OTP (kedaluwarsa, batas percobaan, sekali pakai), `/api/db` (whitelist, filter, `single`, `count`), LLM validasi input | Tinggi |
| Isolasi tenant | Pengguna B tidak dapat select/update/delete/menautkan baris pengguna A | Tertinggi |
| Klien | Builder `http-cloud.js` menghasilkan body `/api/db` yang benar; parser SSE | Sedang |
| E2E | Enam tahap lewat UI | Rendah |

## Kasus Wajib untuk `/api/db`

- Tanpa token: 401.
- Tabel `users`/`sessions`/`otp_codes`: 400.
- Kolom/operator tak dikenal: 400.
- `owner_id` pada insert diabaikan; pada update ditolak.
- Update/delete tanpa filter: 400.
- FK ke baris pengguna lain: 400.
- Select oleh pengguna B tidak mengembalikan baris pengguna A, bahkan dengan filter `id` yang benar.

## Data Uji

- Gunakan email uji (mis. `uji+a@example.com`, `uji+b@example.com`) dan hapus datanya setelah UAT bila di lingkungan bersama.
- Jangan memakai data pelanggan nyata.
- Mode demo OTP hanya di lingkungan uji.

## Pelaporan

Hasil UAT dicatat di berkas `docs/uat/<tanggal>_<nama>.md` dengan status per skenario; temuan ditambahkan ke [10_RISK_REGISTER.md](../10_RISK_REGISTER.md) bila bersifat risiko berulang.
