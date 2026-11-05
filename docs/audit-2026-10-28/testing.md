# Laporan Testing — Satu Alur

**Tanggal run:** 2026-10-28
**Runner:** Vitest 2.1.9 + jsdom 25 (Node 22.23.3)
**Hasil:** 12 file · **174 test** · **174 lulus** · 0 gagal · **87,6 detik** (69 detik di antaranya pemuatan jsdom)

> Semua test berjalan tanpa backend, tanpa kredensial WorkBuddy, dan tanpa jaringan.

---

## 1. Cara menjalankan

```bash
npm install        # sekali saja
npm test           # jalankan seluruh suite (sekali jalan)
npm run test:watch # mode watch saat mengembangkan fitur
```

Menjalankan satu file atau satu grup test:

```bash
npx vitest run tests/unit/mock-auth.test.js
npx vitest run -t "validateOffer"
```

---

## 2. Arsitektur test

| Berkas | Peran |
|---|---|
| `vitest.config.js` | environment `jsdom`, `globals: true`, `restoreMocks: true`, `testTimeout: 15000`, `pool: 'forks'` + `singleFork: true`. Berisi dua alias: `./cloud.config.js` → stub, dan `@tencent-ai/workbuddy-cloud-sdk` → stub. |
| `tests/setup.js` | Polyfill `crypto.randomUUID`, `btoa`, `requestAnimationFrame`. Setiap test: `localStorage.clear()`, reset `document.head`/`body`, dan senyapkan `console.*` (kode AntiSlop sengaja berisik). |
| `tests/stubs/cloud.config.js` | Pengganti `src/cloud.config.js` yang tidak ada di repo (gitignored). Default "tidak terkonfigurasi" → `getCloud()` memakai mock cloud. Bisa di-override lewat `globalThis.__TEST_CLOUD_CONFIG__`. |
| `tests/stubs/workbuddy-sdk.js` | `createWorkBuddyCloud` berupa `vi.fn()`, sehingga jalur "cloud asli" bisa diuji tanpa SDK maupun jaringan. |

**Isolasi state:** `src/mock/mock-cloud.js` menyimpan `_state` di level modul. Setiap test melakukan `vi.resetModules()` lalu `await import()` ulang, sehingga tiap test mulai dari state bersih.

---

## 3. Hasil per file

| # | File test | Test | Modul yang diuji |
|---|---|---:|---|
| 1 | `domain-rules.test.js` | 16 | `src/domain/rules.js` — `validateOffer`, `canTransition`, `OfferRules`, `OfferTransitions` |
| 2 | `domain-models.test.js` | 9 | `src/domain/models.js` — `createRequest` (termasuk `phone`), `createOffer`, enum `ServiceStatus` |
| 3 | `antislop.test.js` | 37 | `src/ui/antislop.js` — `TOKENS`, `solidColor`, `size`, `VALIDATOR`, `CONTENT_GATE`, `createSkeleton`, `ANTI_PATTERNS`, `injectAntiSlopStyles`, `enableDevAudit` |
| 4 | `components.test.js` | 16 | `src/ui/components.js` — `el`, `section`, `skeleton`, `btn`, `inputField`, `selectField`, `textareaField`, `solidText`, `badge`, `statCard` |
| 5 | `mock-auth.test.js` | 10 | `src/mock/mock-cloud.js` → auth: OTP, session, `onAuthStateChange`, `signOut`, OAuth stub |
| 6 | `mock-database.test.js` | 32 | query builder: `insert`, semua filter (`eq/neq/gt/gte/lt/lte/like/ilike/in/is/match/or`), `order`, `limit`, `range`, `single`, `maybeSingle`, `count`, `head`, `update`, `delete`, persistensi |
| 7 | `mock-storage-llm.test.js` | 9 | storage (`upload/list/createSignedUrl/userPath/sharedPath`) + LLM streaming + `seedDemoData` |
| 8 | `ai-models.test.js` | 6 | `src/ai/models.js` — `loadModels`, `getModels`, `pickDefaultModel` |
| 9 | `settings.test.js` | 8 | `src/stages/settings.js` — default prompt/params/MCP, override localStorage, JSON korup, render tab |
| 10 | `cloud.test.js` | 4 | `src/cloud.js` — mode prototype vs cloud, singleton, pemanggilan SDK |
| 11 | `economic-scenario.test.js` | 25 | Skenario ekonomi 12 bulan (pertumbuhan 5% nasional vs 8–10% daerah), margin, struktur biaya, harga kontrak |
| 12 | `stages-write-path.test.js` | 2 | Jalur tulis stage: `request.js` → `createRequest`, `offer.js` → `createOffer` |
| | **Total** | **174** | |

---

## 4. Bug yang ditemukan dan diperbaiki

### 4.1 Label tidak terhubung ke input (a11y)

- **Lokasi:** `src/ui/components.js:13`
- **Masalah:** `el('label', { htmlFor: id })` menulis atribut lewat `setAttribute('htmlFor', ...)`, sehingga yang dihasilkan adalah atribut `htmlfor` — bukan `for`. Akibatnya **semua label di aplikasi tidak terasosiasi** dengan input-nya, dan `VALIDATOR.noPlaceholderLabel` (yang mencari `label[for="..."]`) selalu gagal menemukan pasangan.
- **Perbaikan:** `else if (k === 'htmlFor') node.setAttribute('for', v)`
- **Dampak:** aksesibilitas form (screen reader, klik label) dan validasi AntiSlop berfungsi sebagaimana dirancang.

### 4.2 Data demo prototype tidak pernah tampil

- **Lokasi:** `src/mock/mock-cloud.js`
- **Masalah:** `seedDemoData()` melakukan `const state = loadState()` (objek baru hasil parse localStorage), lalu `saveState(state)`. Sementara seluruh operasi database membaca `_state` milik modul. Hasilnya data demo tersimpan di localStorage tetapi **tidak pernah masuk ke memori**, sehingga dashboard menampilkan 0 di semua KPI pada kunjungan pertama.
- **Perbaikan:** seed memutasi `_state` dan menutup dengan `persist()`.
- **Dampak:** 8 permintaan, 7 penawaran, 6 penugasan, 4 penyelesaian, 12 jurnal demo langsung terlihat.

### 4.3 Filter mock salah sasaran untuk operator selain `eq`

- **Lokasi:** `src/mock/mock-cloud.js`
- **Masalah:** tiga tempat mengevaluasi filter dengan cara berbeda. `select` punya rantai `if` sendiri, sedangkan `update` hanya memeriksa `eq` (operator lain dianggap selalu cocok) dan `delete` membandingkan `row[col] == val` tanpa melihat operator. Akibatnya `update().gt(...)` mengubah **semua** baris, dan `delete().gt(...)` menghapus baris yang salah.
- **Perbaikan:** satu predikat `matchFilter(row, filter)` + `rowMatchesAll(row, filters)` dipakai oleh `select`, `update`, dan `delete`.
- **Dampak:** hasil mock konsisten dengan Supabase untuk semua operator.

### 4.4 `or()` tidak berfungsi

- **Lokasi:** `src/mock/mock-cloud.js`
- **Masalah:** `if (f.op === 'or') return true` — filter diabaikan, semua baris lolos.
- **Perbaikan:** `parseOrExpr()` mem-parse ekspresi Supabase (`col.op.val`, dipisah koma, nilai `null`/numerik dikonversi) dan dievaluasi dengan logika OR.
- **Dampak:** `or('qty.eq.1,qty.eq.3')` mengembalikan tepat dua baris.

### 4.5 Stage menulis data mentah

- **Lokasi:** `src/stages/request.js`, `src/stages/offer.js`, `src/domain/models.js`, `docs/DATABASE_SCHEMA.md`
- **Masalah:** `request.js` meng-insert `Object.fromEntries(FormData)` mentah (tanpa trim, tanpa `status`, dan mengirim `phone` yang tidak ada di skema), sementara `createRequest`/`createOffer` tidak pernah dipakai. `offer.js` menduplikasi objek `createOffer` secara inline.
- **Perbaikan:** kedua stage memakai factory domain; `createRequest(input = {})` kini menerima `phone` dan tidak melempar saat dipanggil tanpa argumen; kolom `phone TEXT` ditambahkan ke dokumentasi skema.
- **Dampak:** data tersimpan konsisten (ter-trim, `status: 'draft'`, `owner_id` terisi) dan field nomor telepon tidak lagi hilang.

### 4.6 Dev audit membocorkan timer

- **Lokasi:** `src/ui/antislop.js`
- **Masalah:** `enableDevAudit()` memasang `setInterval` + `MutationObserver` tanpa cara menghentikan.
- **Perbaikan:** mengembalikan fungsi `stop()` yang `clearInterval`, `observer.disconnect()`, dan `clearTimeout` debounce; jalur early-return mengembalikan no-op.
- **Dampak:** audit bisa dimatikan (dipakai di test), tidak ada timer menggantung.

### 4.7 Build gagal di clone baru

- **Lokasi:** `package.json`, `README.md`
- **Masalah:** `src/cloud.config.js` gitignored dan tidak ada di repo, sehingga `npm run build`/`dev` gagal dengan "Could not resolve ./cloud.config.js".
- **Perbaikan:** hook `predev` dan `prebuild` menjalankan `node scripts/setup.js` (sudah idempoten).
- **Dampak:** clone baru langsung bisa `npm run dev`/`build` tanpa langkah manual. Diverifikasi dengan menghapus `src/cloud.config.js` lalu `npm run build` → sukses dan file dibuat ulang.

---

## 5. Status isu

Semua isu yang sebelumnya dikunci test sebagai "known issue" sudah diperbaiki dan test-nya diubah untuk mengunci perilaku yang benar. Tidak ada isu terbuka yang diketahui pada modul inti.

---

## 6. Di luar cakupan

- Render penuh setiap stage — hanya `settings.js` (smoke + interaksi tab) dan jalur tulis `request.js`/`offer.js` yang diuji.
- E2E browser (Playwright), termasuk login OTP dan streaming AI lewat UI.
- Integrasi WorkBuddy Cloud asli (butuh kredensial + jaringan).
- Uji beban/performansi.

---

## 7. Catatan lingkungan

Di container dev proyek ini, `import('jsdom')` butuh ~80 detik (bukan salah konfigurasi). Karena itu:

- `pool: 'forks'` + `singleFork: true` dipasang sebagai default agar jsdom dimuat **sekali** per run, bukan sekali per worker.
- Porsi terbesar durasi habis di fase `environment` (pemuatan jsdom ≈ 69 detik dari 88 detik total); eksekusi test sendiri hanya ≈ 5,8 detik.

Di mesin normal, `npm test` biasa sudah cukup dan biasanya selesai jauh lebih cepat.
