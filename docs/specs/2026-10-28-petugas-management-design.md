# Manajemen Petugas — Design

**Tanggal:** 2026-10-28
**Status:** Draft, menunggu persetujuan

## Intent

Pemilik usaha jasa punya daftar petugas tetap. Saat ini tahap 03 Penugasan menyimpan petugas sebagai teks bebas (`assignments.worker_name`), sehingga tidak ada daftar petugas, tidak ada riwayat per petugas, dan rekomendasi petugas tidak bisa dihitung dari data sungguhan.

Fitur ini menambahkan **CRUD petugas yang tersimpan di Cloudflare D1 produksi**, lalu membuat Penugasan **memilih satu atau banyak petugas dari daftar itu** dengan **rekomendasi otomatis** berdasarkan keahlian, ketersediaan dan (nanti) jarak.

Dua fakta dari pemilik bisnis yang membentuk rancangan ini:
- **Satu pekerjaan sering diturunkan ke banyak petugas sekaligus.** Tim adalah kasus normal, bukan pengecualian.
- **Jadwal melekat pada pekerjaan, bukan pada petugas.** Satu permintaan klien = satu tugas dengan satu waktu mulai, dicatat sejak tahap Permintaan.

## Goals

1. Petugas bisa ditambah, dilihat, diubah dan dinonaktifkan/dihapus, dan tersimpan di D1 (dan di mock untuk mode demo).
2. Form Permintaan punya isian **jadwal yang diminta klien**, yang otomatis terisi di form Penugasan.
3. Form Penugasan memilih **satu atau lebih** petugas dari daftar, dibantu rekomendasi. Setiap petugas yang dipilih tercatat terhubung ke penugasan itu.
4. Disediakan satu titik sambung `geocode(alamat)` untuk integrasi peta yang dikerjakan teammate.

## Non-goals

- **Integrasi MapsEncoder (Apipedia)**, termasuk konektor di Pengaturan, penyimpanan API key, dan isi fungsi `geocode`. Ini dikerjakan teammate.
- Fitur baru untuk tab **Peta** dan **Performa** di `assign.js`. Keduanya hanya diperbaiki seminimal mungkin agar tetap benar dengan model data baru.
- Login atau akun terpisah untuk petugas. Petugas adalah data, bukan pengguna.
- Durasi pekerjaan dan penjadwalan per jam.
- Peran dalam tim (ketua/anggota) dan jumlah petugas minimum per jenis pekerjaan.
- Impor massal petugas.

## Anti-goals (gagal walau "jalan")

- Data petugas hilang setelah reload. Perilaku tab Tim saat ini, yang hanya mengubah array di memori, harus hilang.
- Menghapus petugas merusak riwayat penugasan, penyelesaian atau pembukuan lama.
- Rekomendasi menampilkan **jarak palsu**. Kode saat ini memakai koordinat default Jakarta bila data kosong; ini tidak boleh. Tanpa koordinat, jarak tidak ditampilkan dan tidak ikut dihitung.
- Petugas satu akun terlihat atau bisa dipakai akun lain. Isolasi `owner_id` wajib.
- Penugasan tersimpan tanpa satu pun petugas terhubung (setengah tersimpan).

## Konteks kode saat ini

- `worker/index.js`: API generik `/api/db` di atas daftar `TABLES` (whitelist kolom, kolom `json`, cek kepemilikan FK lewat `fks`, isolasi `owner_id` otomatis, insert banyak baris dalam satu batch). Menambah tabel = menambah entri `TABLES` + migrasi.
- `migrations/`: `0001_init.sql`, `0002_requests_phone.sql`. Dijalankan dengan `npm run db:migrate:remote` (manual; tidak ditemukan CI).
- `src/mock/mock-cloud.js`: mendukung tabel apa pun lewat `from(table)`. Seed yang belum di-commit sudah punya `state.workers` (6 petugas, id string `'w1'…`).
- `src/stages/assign.js`: versi yang belum di-commit sudah punya tab Tugaskan/Tim/Peta/Performa, form petugas dalam modal, dan skoring (`haversine`, `inferSkill`). **Rancangan ini melanjutkan versi tersebut**, bukan mulai dari nol.
- `src/stages/request.js`: form Permintaan; insert ke `requests`.

## Model data

### Migrasi `0003_workers.sql`

```sql
CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  skills TEXT,            -- JSON array of skill keys, e.g. ["ac","cleaning"]
  lat REAL,               -- diisi oleh geocode(); boleh NULL
  lng REAL,
  zone TEXT,              -- diisi oleh geocode(); boleh NULL
  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'inactive'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_workers_owner_id ON workers(owner_id);

-- Satu penugasan, banyak petugas.
CREATE TABLE IF NOT EXISTS assignment_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (assignment_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_workers_owner_id ON assignment_workers(owner_id);
CREATE INDEX IF NOT EXISTS idx_assignment_workers_assignment_id ON assignment_workers(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_workers_worker_id ON assignment_workers(worker_id);

ALTER TABLE requests ADD COLUMN requested_at TEXT;   -- jadwal yang diminta klien (ISO)
```

- `assignments` **tidak** mendapat kolom `worker_id`. Keterkaitan petugas hanya lewat `assignment_workers`.
- `assignments.worker_name` **tetap ada** dan tetap diisi, berisi nama-nama petugas yang dipilih, dipisah koma (misalnya "Ahmad, Budi, Candra"). Ini menjaga data lama dan semua tampilan yang sudah membaca `worker_name` (Penyelesaian, Dashboard, Laporan) tanpa perlu diubah.
- Penugasan lama (tanpa baris `assignment_workers`) tetap tampil dengan `worker_name`-nya.

### `worker/index.js` → `TABLES`

- Tambah `workers`: kolom sesuai migrasi, `json: ['skills']`.
- Tambah `assignment_workers`: kolom sesuai migrasi, `fks: { assignment_id: 'assignments', worker_id: 'workers' }`.
- `requests`: tambah `requested_at` ke `columns`.

### Menyimpan penugasan tim

API tidak punya transaksi lintas tabel, jadi penyimpanan dua langkah:
1. Insert `assignments` (dengan `worker_name` gabungan).
2. Insert semua baris `assignment_workers` dalam **satu panggilan** (satu batch D1).

Bila langkah 2 gagal, hapus baris `assignments` dari langkah 1 lalu tampilkan error. Penugasan tanpa petugas tidak boleh tertinggal (lihat anti-goals).

### Mock

- Seed `state.workers` diselaraskan dengan skema baru: id integer, `skills` array, `zone` string tunggal, `status` `active`/`inactive`.
- Field yang tidak ada di skema (`email`, `rating`, `completed`, `onTime`, `maxJobs`, `zones`, status `on_job`/`off_duty`/`sick`) dihapus dari seed. Nilai turunan dihitung, bukan disimpan.
- Seed `state.assignment_workers` menghubungkan penugasan demo yang ada dengan petugas seed, termasuk minimal satu penugasan tim (≥2 petugas). Nama seed petugas dan `worker_name` penugasan demo diselaraskan agar konsisten.
- Browser yang sudah pernah di-seed (flag `_seeded`) tidak akan mendapat data baru. Seed `workers` dan `assignment_workers` harus ditambahkan juga bila tabelnya kosong, terlepas dari flag itu.

## Status & nilai turunan (tidak disimpan)

- **Status tampilan petugas:** `inactive` → "Nonaktif"; terhubung ke penugasan berstatus `assigned` yang `scheduled_at`-nya hari ini → "Dalam tugas"; selain itu → "Tersedia".
- **Job selesai** per petugas = jumlah penugasannya (lewat `assignment_workers`) yang punya completion.
- Rating dan on-time rate **dihapus** dari UI karena belum ada sumber datanya.

## Alur 1 — Tab Tim (CRUD)

- **Daftar:** kartu/baris petugas dengan nama, HP, keahlian, zona (bila ada), status turunan, dan jumlah job selesai. Petugas nonaktif tetap terlihat (lewat filter atau bagian terpisah), tidak hilang.
- **Tambah / Ubah** (modal yang sudah ada, dirapikan): isian **nama (wajib), no. HP, alamat, keahlian** (pilih banyak dari `SKILL_LABELS`) dan **status aktif/nonaktif** (hanya saat ubah).
  - Isian lat, lng, rating, max job dan email **dihapus** dari form.
  - Saat simpan: bila alamat berubah, panggil `geocode`. Ada hasil → simpan `lat`/`lng`/`zone`. `null` atau gagal → kosongkan `lat`/`lng`/`zone` (koordinat lama tidak lagi sesuai) dan tetap simpan petugas.
- **Hapus:**
  - Petugas **tanpa** baris `assignment_workers` → `DELETE` permanen, dengan konfirmasi.
  - Petugas **dengan** riwayat → tombol menjadi "Nonaktifkan" (`status = 'inactive'`). D1 akan menolak DELETE seperti itu karena FK, jadi UI harus mencegahnya lebih dulu.
  - Petugas nonaktif bisa diaktifkan kembali.
- Semua operasi lewat `getCloud().database.from('workers')`, lalu daftar dimuat ulang dari database (bukan array lokal), lalu `notifyDataChanged()`.
- **Dihapus dari tab Tim:** textarea "perintah SQL custom" (API tidak menjalankan SQL bebas) dan modal "import JSON" (hanya mengubah memori, menulis field di luar skema, dan mengisi koordinat palsu).

## Alur 2 — Permintaan

- Form Permintaan mendapat isian **"Jadwal yang diminta klien"** (`datetime-local`, opsional), disimpan ke `requests.requested_at`.
- Daftar permintaan menampilkan jadwal itu bila ada.

## Alur 3 — Tab Tugaskan

- Setelah penawaran dipilih, **jadwal pelaksanaan** otomatis terisi dari `requested_at` permintaannya (bila ada). Bila tidak ada, pakai default yang sekarang. Tetap bisa diubah.
- **Pemilihan petugas: banyak pilihan.** Daftar petugas `active` dengan kotak centang, diurutkan menurut skor rekomendasi. Minimal satu petugas harus dipilih; tidak ada batas atas.
- **Skor per petugas** (individu, bukan per tim):
  - **Keahlian:** cocok penuh / sebagian / tidak dengan jenis pekerjaan (`inferSkill(service_type)`). `inferSkill` harus bisa mengembalikan "tidak diketahui", bukan selalu jatuh ke `'cleaning'` seperti sekarang.
  - **Bentrok jadwal:** sudah terhubung ke penugasan `assigned` lain di **hari yang sama** → ditandai "Bentrok" dan skornya diturunkan, tapi tetap bisa dicentang.
  - **Jarak:** hanya bila petugas **dan** lokasi pekerjaan punya koordinat. Bila salah satu kosong, komponen jarak dikeluarkan dari skor dan bobotnya dibagi ulang; label tidak menampilkan "km".
  - Urutan prioritas: keahlian > bentrok > jarak. Bobot persis diserahkan ke builder.
- **Saran tim:** tombol "Pilih rekomendasi" mencentang petugas teratas yang tidak bentrok dan keahliannya cocok. Jumlahnya default 1, bisa diubah lewat isian angka kecil di sebelahnya. Pengguna tetap bisa mencentang atau melepas manual.
- **Ringkasan tim** di atas tombol simpan: nama-nama terpilih, keahlian gabungan, dan peringatan bila ada yang bentrok atau tak satu pun memiliki keahlian yang dibutuhkan.
- Panel rekomendasi menjelaskan alasan tiap 3 teratas dengan kalimat singkat dari komponen skor. Penjelasan via model AI **opsional**, bukan syarat.
- Simpan sesuai "Menyimpan penugasan tim" di atas.
- Bila belum ada petugas aktif: tampilkan empty state dengan tombol ke tab Tim.
- **Daftar penugasan** (tabel di halaman yang sama) menampilkan semua nama petugas per penugasan.

## Tab Peta & Performa (perbaikan minimal)

- **Performa:** pakai nilai turunan saja (jumlah petugas aktif, job selesai per petugas, status turunan). KPI rating dan on-time rate dihapus; tidak boleh ada `NaN`.
- **Peta:** hanya menampilkan petugas yang punya koordinat; warna pin dari status turunan. Bila tidak ada petugas berkoordinat, tampilkan empty state yang menjelaskan bahwa lokasi muncul setelah integrasi peta aktif.

## Titik sambung geocoding (untuk teammate)

Satu modul baru, misalnya `src/geo.js`:

```js
/** Returns { lat, lng, zone } for an address, or null when unknown/unavailable. Never throws. */
export async function geocode(address) { return null }
```

- Dipanggil saat menyimpan petugas (alamat petugas) dan saat menghitung rekomendasi (lokasi pekerjaan: `requests.location`).
- Koordinat lokasi pekerjaan **tidak** disimpan dalam lingkup ini. Bila teammate ingin cache, itu keputusan mereka.
- Selama `geocode` mengembalikan `null`, seluruh fitur harus berfungsi penuh tanpa jarak.

## Detail yang diputuskan

- "Hari yang sama" dan "hari ini" memakai zona waktu lokal perangkat, sama seperti hint form jadwal saat ini.
- Migrasi `0003` dijalankan **sebelum** Worker baru di-deploy.
- `docs/DEMO_SCRIPT.md` langkah Penugasan diperbarui: mencentang beberapa petugas (Tim Alpha) dari daftar, bukan mengetik nama.

## Pengujian

- Unit test (pola `tests/*.test.mjs`) untuk fungsi skoring: keahlian, bentrok hari yang sama, **tanpa koordinat = tanpa komponen jarak**, dan "Pilih rekomendasi" melewati yang bentrok.
- Unit test aturan hapus vs nonaktifkan, dan penggabungan `worker_name`.
- Smoke test di browser (mock mode): tambah petugas → reload → masih ada; ubah; nonaktifkan petugas berriwayat; hapus petugas baru; tugaskan **tiga** petugas dengan jadwal dari permintaan → tiga baris `assignment_workers`, `worker_name` berisi ketiganya, Penyelesaian menampilkan nama tim.
- Migrasi dijalankan lokal (`npm run db:migrate:local`) dan dicoba lewat `wrangler dev` sebelum `db:migrate:remote`, termasuk jalur gagal langkah 2 (penugasan ikut terhapus).

## Diserahkan ke builder

- Tata letak kartu/tabel di tab Tim, tata letak daftar centang, dan bobot skor persis.
- Apakah petugas nonaktif disembunyikan lewat filter atau dipisah ke bagian sendiri.
- Perapian kode `assign.js` yang belum di-commit (inline style → komponen rumah), selama perilakunya sesuai dokumen ini.

## Keputusan yang diambil Claude (mohon dicek)

- Tim disimpan lewat tabel penghubung `assignment_workers`; tidak ada ketua tim.
- `worker_name` tetap diisi sebagai gabungan nama, supaya tampilan lain tidak perlu diubah.
- Hapus permanen hanya untuk petugas tanpa riwayat; selain itu nonaktifkan.
- "Bentrok" = penugasan aktif di hari yang sama (belum ada data durasi).
- "Pilih rekomendasi" default mencentang 1 petugas; jumlahnya bisa diubah.
- Rating, on-time rate, max job dan email petugas dihapus karena belum ada sumber datanya.
- Textarea SQL custom dan modal import JSON di tab Tim dihapus.
- Tidak ada isian teks bebas untuk petugas di luar daftar; pengguna baru diarahkan ke tab Tim dulu.
