# Catatan Keputusan Arsitektur (ADR)

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Format: Konteks, Keputusan, Konsekuensi. Status semua ADR di bawah: Diterima (2026-10-28).

## ADR-001 Worker tunggal + D1 sebagai satu deployment

Konteks: Aplikasi sebelumnya bergantung pada WorkBuddy Cloud SDK dan PostgreSQL, dengan konfigurasi `cloud.config.js` yang spesifik pengguna dan proses aktivasi manual lewat asisten AI.

Keputusan: Satu Cloudflare Worker (`worker/index.js`) melayani aset statis `dist/` lewat binding `ASSETS` dan rute `/api/*`. Data di D1 (`satu-alur-db`).

Konsekuensi:
- Satu perintah deploy, satu origin (tanpa CORS dan tanpa URL backend di klien).
- Tidak ada server yang dikelola; biaya dan batas mengikuti paket Cloudflare (R-005).
- Terikat pada Cloudflare (R-014).
- D1 adalah SQLite: tipe dan fitur berbeda dari PostgreSQL (lihat [20_DATABASE.md](20_DATABASE.md)).

## ADR-002 Endpoint generik `/api/db` dengan whitelist kolom

Konteks: Kode stage dibangun di atas API gaya SDK (`from(table).select().eq()...`). Menulis satu endpoint REST per tabel dan aksi akan memperbanyak kode dan mengubah seluruh stage.

Keputusan: Satu endpoint `POST /api/db` menerima `table`, `action` (`select|insert|update|delete`), `filters`, `order`, `limit`, `range`, `single`, `maybeSingle`, `count`, `head`, `values`, `changes`. Worker memvalidasi tabel, kolom, dan operator terhadap whitelist, memakai bind parameter, dan memaksa `owner_id` pengguna sesi.

Konsekuensi:
- Perubahan di stage minimal; klien meniru antarmuka lama.
- Keamanan bergantung pada satu lapisan validasi di Worker; tanpa RLS (R-006, R-007), sehingga wajib diuji (UAT tenant isolation).
- Menambah tabel/kolom berarti memperbarui migrasi dan whitelist (lihat [21_BACKEND.md](21_BACKEND.md)).
- Whitelist membatasi tabel dan kolom; keempat aksi berlaku untuk semua tabel domain (tidak ada pembatasan aksi per tabel). Tabel `users`, `sessions`, `otp_codes` tidak dapat diakses lewat `/api/db`.
- Worker juga memeriksa bahwa kunci asing (mis. `request_id`) menunjuk baris milik pengguna yang sama.

Alternatif yang ditolak: REST per sumber daya (lebih banyak kode, perubahan besar di klien); membuka SQL langsung (tidak aman).

## ADR-003 Workers AI untuk LLM

Konteks: LLM sebelumnya lewat WorkBuddy LLM API tanpa kunci (keyless).

Keputusan: Gunakan Workers AI lewat binding dari Worker. Rute `/api/llm/models` dan `/api/llm/chat` (SSE, chunk gaya OpenAI) menjaga kompatibilitas dengan `src/ai/agent.js`.

Konsekuensi:
- Tidak ada kunci API di klien maupun repositori; satu platform dan satu tagihan.
- Pilihan model terbatas pada katalog Workers AI; ketersediaan dan kuota di luar kendali (R-003).
- Kepatuhan format JSON untuk penawaran bergantung pada model; klien tetap memvalidasi (R-004).
- Daftar model tetap di `worker/index.js`: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` dan `@cf/meta/llama-3.1-8b-instruct-fast`; klien memakai yang pertama sebagai bawaan.
- Mode JSON Workers AI tidak mendukung streaming, sehingga `response_format: json_object` diterjemahkan menjadi instruksi sistem ("hanya JSON") dan hasil tetap divalidasi klien.

## ADR-004 Mode demo OTP

Konteks: Autentikasi memakai email OTP, tetapi belum ada provider email yang dipilih.

Keputusan: Variabel `DEMO_OTP=true` membuat `send-otp` mengembalikan kode di respons agar login dapat diuji tanpa email. Pada nilai lain kode tidak dikembalikan.

Konsekuensi:
- Penguji dapat login tanpa infrastruktur email.
- Tidak aman untuk produksi: siapa pun dapat login sebagai email apa pun (R-001). Wajib dimatikan dan diganti provider email (R-002).
- Perilaku non-demo tanpa provider: OTP tidak terkirim; penanganannya `_TBD_`.

## ADR-005 Mode mock tetap ada untuk pengembangan lokal

Konteks: Prototype sebelumnya berjalan penuh dengan data lokal; ini berguna untuk pengerjaan UI.

Keputusan: Pertahankan mock berbasis `localStorage`, dipilih dengan `VITE_USE_MOCK`. Tidak dipakai untuk produksi.

Konsekuensi: Dua implementasi antarmuka data harus tetap sejalan; perubahan kontrak API perlu diikuti mock.

## ADR-006 Token sesi bearer dengan hash di server

Konteks: Tidak ada cookie/sesi bawaan platform.

Keputusan: Token acak dikirim sebagai `Authorization: Bearer`; D1 hanya menyimpan hash-nya.

Konsekuensi: Kebocoran basis data tidak langsung membocorkan token aktif. Token di sisi klien tetap rentan terhadap XSS (R-008, R-010).
