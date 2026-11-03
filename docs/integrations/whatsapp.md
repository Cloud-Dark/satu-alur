# WhatsApp (WAPilot dan WAConsole)

> Status: Draft
> Terakhir diperbarui: 2026-11-03

Setiap usaha mengirim WhatsApp dari **akunnya sendiri**: WAPilot atau WAConsole. Kunci diisi oleh pemilik usaha di **Pengaturan › Konektor**, disimpan terenkripsi di D1, dan tidak pernah dikirim balik ke browser.

## Alur pengguna

1. **Pengaturan › Konektor › WhatsApp**: isi kunci WAPilot (token API) dan/atau WAConsole (App key, Auth key, ID perangkat opsional), lalu **Hubungkan**.
   - Kunci diperiksa dulu dengan panggilan baca-saja: WAPilot `GET /me`; WAConsole `POST /api/device/session/status` bila ID perangkat diisi. Tanpa ID perangkat, kunci WAConsole disimpan tanpa diperiksa.
   - Setelah tersimpan, kartu hanya menampilkan "Terhubung • …abcd" dengan tombol **Ganti** dan **Hapus**.
2. Bila dua akun terhubung, pilih **Kirim lewat** (WAPilot atau WAConsole). Pilihan disimpan per usaha di `business_settings.wa_provider`.
3. **Kirim pesan uji** ke nomor yang diketik.
4. Di **Permintaan** (pesan tindak lanjut) dan **Penawaran** (ringkasan penawaran yang disetujui), tombol **WhatsApp** membuka dialog. Dialog menampilkan nomor tujuan dan isi pesan; keduanya bisa diubah sebelum dikirim.

Tempat mendapatkan kunci:

- WAPilot: dasbor wapilot.id › Remote › API Docs › token.
- WAConsole: dasbor waconsole.apipedia.id › App key dan Auth key.

## Aturan pengiriman

- Tujuan: nomor pelanggan dari permintaan milik usaha itu, atau nomor yang diketik di dialog. Nomor dinormalkan ke `628…`.
- Batas 200 pesan per usaha per hari (zona waktu Jakarta) sebagai pengaman, dihitung di `usage_counters` (`feature = 'wa_send'`).
- Akun demo bersama (`DEMO_EMAILS`) tidak bisa menyimpan kunci; pesannya selalu **disimulasikan** dan tidak pernah sampai ke penyedia.
- Setiap percobaan dicatat di `wa_messages` (penyedia, jenis, status, nomor yang disamarkan). Nomor asli dan kunci tidak pernah disimpan di log.
- Selama `DEMO_OTP="true"`, integrasi mati kecuali `INTEGRATIONS_ALLOW_DEMO_OTP="true"`, karena siapa pun bisa masuk sebagai email usaha lain dan memakai kuncinya.
- Kunci WhatsApp milik platform (`WAPILOT_TOKEN`, `WACONSOLE_APP_KEY`, `WACONSOLE_AUTH_KEY`) hanya dipakai bila `WA_PLATFORM_FALLBACK="true"`. Bawaannya mati.

## Rute

| Rute | Isi |
|------|-----|
| `GET /api/integrations` | Daftar integrasi usaha: terhubung atau tidak, 4 karakter terakhir kunci, pengaturan non-rahasia. |
| `PUT /api/integrations/:provider` | Simpan kunci (`wapilot`, `waconsole`, `repliz`) setelah diperiksa. |
| `DELETE /api/integrations/:provider` | Hapus kunci. |
| `GET /api/wa/status` | Penyedia aktif, status perangkat, masa aktif lisensi (WAPilot), terpakai hari ini. |
| `PUT /api/wa/provider` | `{ provider }` memilih penyedia (harus sudah terhubung). |
| `POST /api/wa/send` | `{ request_id?, phone?, text, kind? }` → `{ status: 'sent' \| 'simulated', to, provider }`. |

## Kode

- `worker/wa/index.js`: abstraksi penyedia, yaitu `sendText({ provider, to, text }, cfg)`, `status(provider, cfg)`, `verify()`, dan `platformConfig()`.
- `worker/wa/wapilot.js`, `worker/wa/waconsole.js`: klien HTTP per penyedia.
- `worker/integrations.js`: penyimpanan kunci terenkripsi (`integration_credentials`, AES-GCM dengan `TOKEN_KEY`).
- `worker/whatsapp.js`: rute dan aturan pengiriman.
- `src/wa/`, `src/integrations/`, `src/ui/wa-dialog.js`, `src/ui/integration-card.js`: klien dan UI.

## Saat deploy

1. Terapkan migrasi `0013_integrations.sql`.
2. Pastikan secret `TOKEN_KEY` terpasang (32 byte, base64): `npx wrangler secret put TOKEN_KEY`.
3. Selama `DEMO_OTP="true"`, putuskan dulu apakah `INTEGRATIONS_ALLOW_DEMO_OTP` boleh `"true"`.
