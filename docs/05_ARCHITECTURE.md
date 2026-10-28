# Arsitektur

> Status: Draft
> Terakhir diperbarui: 2026-10-28
> Pemilik: _TBD_

Arsitektur setelah port ke Cloudflare. Keputusan dan alasannya di [11_DECISIONS.md](11_DECISIONS.md); detail rute di [21_BACKEND.md](21_BACKEND.md).

## 1. Gambaran Sistem

Satu Worker melayani dua hal: aset statis hasil build Vite dan API di `/api/*`. Data disimpan di D1, LLM lewat Workers AI.

```mermaid
flowchart LR
  B[Peramban<br/>Vite + Vanilla JS] -->|GET /, aset| W
  B -->|/api/*<br/>Bearer token| W
  subgraph CF[Cloudflare]
    W[Worker<br/>worker/index.js]
    A[(ASSETS<br/>dist/)]
    D[(D1<br/>satu-alur-db)]
    AI[Workers AI]
  end
  W -->|binding ASSETS| A
  W -->|SQL terparameter| D
  W -->|binding AI, stream| AI
```

Mode lokal tanpa backend (mock) melewati Worker sepenuhnya:

```mermaid
flowchart LR
  B[Peramban] --> M[src/mock/mock-cloud.js]
  M --> LS[(localStorage)]
```

## 2. Alur Permintaan

Rute non-API dilayani dari `ASSETS`. Rute API diperiksa autentikasinya, lalu diteruskan ke handler.

```mermaid
sequenceDiagram
  participant K as Klien
  participant W as Worker
  participant D as D1
  participant AI as Workers AI
  K->>W: POST /api/db {table, action, filters, ...}
  W->>D: cari sesi (hash token)
  D-->>W: user_id / tidak ada
  alt token tidak valid
    W-->>K: 401
  else valid
    W->>W: validasi tabel/kolom (whitelist)<br/>tambah owner_id = user_id
    W->>D: query terparameter
    D-->>W: baris
    W-->>K: JSON hasil
  end
  K->>W: POST /api/llm/chat {model, messages, stream}
  W->>AI: run(model, messages, stream)
  AI-->>W: token stream
  W-->>K: SSE (chunk gaya OpenAI)
```

## 3. Alur Autentikasi OTP

```mermaid
sequenceDiagram
  participant K as Klien
  participant W as Worker
  participant D as D1
  K->>W: POST /api/auth/send-otp {email}
  W->>D: simpan hash kode di otp_codes (TTL 10 menit)
  alt DEMO_OTP=true
    W-->>K: 200 {verificationId, isExistingUser, demoCode}
  else DEMO_OTP bukan true
    W-->>K: 200 {verificationId, isExistingUser}<br/>(pengiriman email: belum ada, _TBD_)
  end
  K->>W: POST /api/auth/verify-otp {email, verificationId, token}
  W->>D: cocokkan hash kode (maks 5 percobaan), hapus kode
  W->>D: buat/ambil user, simpan sesi (hash token, 30 hari)
  W-->>K: 200 {user, access_token}
  K->>W: GET /api/auth/session (Bearer)
  W-->>K: 200 {user} atau 401
  K->>W: POST /api/auth/signout (Bearer)
  W->>D: hapus sesi
  W-->>K: 200
```

Bentuk respons tepat ada di [API.md](API.md). Provider email belum ada (ADR-004).

## 4. Lapisan Klien

| Lapisan | Berkas | Peran |
|---------|--------|-------|
| UI | `src/ui/` | Komponen, animasi, mesin AntiSlop |
| Stage | `src/stages/` | Enam tahap, dashboard, pengaturan |
| Domain | `src/domain/` | Status/enum, aturan validasi penawaran |
| AI | `src/ai/` | Prompt dan pemanggilan LLM (streaming) |
| Auth | `src/auth/` | OTP dan sesi |
| Akses data | `src/cloud.js` | Pemilih backend: Worker atau mock |
| Mock | `src/mock/` | Backend `localStorage` untuk pengembangan |

Stage memanggil `getCloud()`; implementasi (klien `/api/*` atau mock) dipilih oleh `VITE_USE_MOCK`. Klien `/api/*` ada di `src/http-cloud.js` (`createHttpCloud`: auth, database builder, llm); mock tetap di `src/mock/mock-cloud.js`.

## 5. Model Data

Enam entitas domain membentuk rantai berikut; semua baris membawa `owner_id`.

```mermaid
erDiagram
  users ||--o{ sessions : memiliki
  users ||--o{ requests : memiliki
  requests ||--o{ offers : menghasilkan
  offers ||--o{ assignments : ditugaskan
  assignments ||--o{ completions : diselesaikan
  completions ||--o{ ledger_entries : dibukukan
  users ||--o{ reports : memiliki
```

`otp_codes` berdiri sendiri (kunci berdasarkan email). Kolom dan tipe di [20_DATABASE.md](20_DATABASE.md).

## 6. Keamanan Ringkas

- Isolasi data dilakukan di Worker (tanpa RLS): setiap query `/api/db` diberi `owner_id`.
- Whitelist tabel dan kolom, nilai lewat bind parameter.
- Token sesi disimpan sebagai hash.
- Mode demo OTP hanya untuk uji.

Rincian dan risiko: [21_BACKEND.md](21_BACKEND.md), [10_RISK_REGISTER.md](10_RISK_REGISTER.md).

## 7. Deployment

`npm run deploy` membangun `dist/` dan mendeploy Worker beserta aset. Langkah lengkap di [18_INSTALLATION.md](18_INSTALLATION.md).
