# Product Requirements Document (PRD)

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

## 1. Latar Belakang

Perusahaan jasa/on-demand di Indonesia umumnya mengelola permintaan pelanggan, penawaran, penugasan, dan pembukuan lewat chat dan spreadsheet terpisah. Akibatnya data tercecer dan laporan keuangan terlambat. Satu Alur menyatukan seluruh proses dalam satu alur dan memakai AI untuk pekerjaan yang repetitif (menyusun penawaran, menjelaskan laporan).

## 2. Pengguna Sasaran

| Persona | Kebutuhan |
|---------|-----------|
| Pemilik/admin usaha jasa | Mencatat permintaan, menyetujui penawaran, melihat laba/rugi |
| Staf operasional | Menugaskan pekerja, menandai pekerjaan selesai, memposting jurnal |

Detail persona `_TBD_` (belum ada riset pengguna di repositori).

## 3. Alur Utama

```
Permintaan -> Penawaran (AI) -> Penugasan -> Penyelesaian -> Pembukuan -> Laporan (AI)
```

| Tahap | Hasil bagi pengguna |
|-------|---------------------|
| Permintaan | Daftar permintaan pelanggan tersimpan |
| Penawaran | Proposal (scope, harga, ketentuan) dari AI, divalidasi aturan domain |
| Penugasan | Pekerja dan jadwal untuk penawaran berstatus disetujui |
| Penyelesaian | Catatan hasil pekerjaan; penugasan menjadi selesai |
| Pembukuan | Jurnal pendapatan/biaya dan ringkasan laba/rugi |
| Laporan | Ringkasan keuangan dan penjelasan AI berformat HTML |

Pendukung: Dashboard, Pengaturan (konektor MCP, prompt agen, model), login email OTP.

## 4. Kebutuhan Produk

Kebutuhan terinci dan kriteria penerimaan ada di [03_FRD.md](03_FRD.md). Ringkasan:

- P1: Login email OTP dan isolasi data per pengguna.
- P1: Enam tahap alur berfungsi di mode cloud (Cloudflare) dan mode mock.
- P1: Penawaran dan penjelasan laporan lewat LLM dengan streaming dan tombol batal.
- P2: Pengaturan prompt agen, temperature, max tokens, preferensi model.
- P3: Konektor WhatsApp/Email berfungsi (di luar rilis saat ini).

## 5. Metrik Keberhasilan

_TBD_ (belum ada target kuantitatif yang disepakati). Usulan awal untuk didiskusikan: waktu dari permintaan hingga penawaran tersimpan, persentase penawaran AI yang lolos validasi domain.

## 6. Batasan Produk Saat Ini

- OTP berjalan dalam mode demo sampai provider email dipasang ([11_DECISIONS.md](11_DECISIONS.md), ADR-004).
- Belum ada layar untuk menyetujui/menolak penawaran. Tahap Penugasan hanya menampilkan penawaran berstatus `approved`, sehingga di lingkungan baru (tanpa data seed mock) daftar penawaran siap tugas kosong sampai status diubah. Lihat [10_RISK_REGISTER.md](10_RISK_REGISTER.md) (R-009).
- Laporan belum disimpan ke tabel `reports` oleh UI; tabel sudah tersedia di skema.

## 7. Dokumen Terkait

[Piagam](00_PROJECT_CHARTER.md) · [FRD](03_FRD.md) · [Roadmap](08_ROADMAP.md)
