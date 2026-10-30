# Admin: Bisnis (paket langganan + payment gateway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu Alur staff manage the subscription plans shown on the landing "Harga" section, and configure the payment gateway (Midtrans or Xendit), from Kantor Satu Alur › Bisnis.

**Context:** This is project 2 of the admin back office. The order is (1) Konten situs, which is done, then (2) Bisnis, (3) Pelanggan, and (4) Agensi influencer. The owner opted out of design questions, so the product decisions below are the controller's calls.
- **Out of scope:** checkout. Charging customers belongs with Pelanggan, once customers and their subscriptions exist. This project only stores and tests the gateway settings.
- **Why plans get their own table:** they live in `subscription_plans`, not `site_content`, because project 3 will link customers to a plan id.

**Architecture:**
- **Tables:** `subscription_plans` and a one-row `payment_settings` in D1 (migration 0007, unreleased, edited in place). Neither table is ever in `TABLES`.
- **Plans API:**
  - `GET /api/plans` is public and returns active plans ordered by `sort`.
  - Staff CRUD lives at `/api/office/admin/plans[/:id]`, behind `requireAdmin`.
- **Payment API:** `GET`/`PUT /api/office/admin/payment` (staff), plus `POST /api/office/admin/payment/test`.
- **Secrets:** the gateway server key (and the Xendit webhook token) are encrypted with the existing `encryptToken`/`decryptToken` (`src/social/crypto.js`, `TOKEN_KEY`) and never returned. The API only reports `server_key_set: true` and the last 4 characters.
- **Landing:** the "Harga" section renders from `GET /api/plans`, falling back to `src/landing/pricing.js` when the list is empty or the call fails, with the same text-only rule as Konten situs.
- **Mock mode:** a localStorage branch `satualur_business_demo_v1`. "Tes koneksi" in mock mode returns success after a short delay, unless the server key contains `salah`.

## Global Constraints

- **Plan fields:**
  - `slug` [a-z0-9-]{2,40}, unique
  - `name` ≤ 60, `tagline` ≤ 160
  - `price_idr` integer 0–1 000 000 000, or null (= "Kustom")
  - `period` one of `month | year | once | custom`; `period_label` ≤ 40 (optional override text, e.g. "Gratis 3 bulan")
  - `recommended` 0/1, `badge` ≤ 30
  - `limits`: 0–6 items of `{ label ≤ 30, value ≤ 60 }`
  - `features`: 0–12 strings ≤ 100
  - `cta_label` ≤ 30; `cta_kind` one of `signup` (goes to `#/masuk`) | `contact` (goes to the Contact Us placeholder until project 3)
  - `sort` integer; `active` 0/1
- **At most one plan is `recommended`.** Setting it on one plan clears it on the others, in a single statement batch.
- **Price display** uses `Intl.NumberFormat('id-ID')`:
  - 349000 → `Rp349.000`; null → `Kustom`; 0 → `Rp0`.
  - The period suffix by default: month "per bulan", year "per tahun", once "sekali bayar", custom "".
  - `period_label`, when present, replaces the suffix.
- **Payment settings:**
  - `provider` one of `none | midtrans | xendit`; `mode` one of `sandbox | production`
  - `client_key` ≤ 200 (public, stored plain)
  - `server_key` ≤ 200 (secret, encrypted)
  - `webhook_token` ≤ 200 (secret, encrypted; used by Xendit)
  - On PUT, a blank secret field keeps the stored one, and `clear_server_key: true` removes it.
  - If `TOKEN_KEY` is missing, saving a secret returns 400 "TOKEN_KEY belum diatur di server."
- **Tes koneksi** (`fetch` injected for tests; 10 s timeout):
  - Midtrans: `GET https://api.sandbox.midtrans.com/v2/satualur-ping/status` (sandbox) or `https://api.midtrans.com/...` (production), with HTTP Basic auth `server_key:`.
    - 401 means "Server key ditolak Midtrans."
    - Any other response from Midtrans, including 404 for the unknown order, means "Terhubung ke Midtrans (<mode>)."
  - Xendit: `GET https://api.xendit.co/balance` with Basic `server_key:`.
    - 200 → "Terhubung ke Xendit."
    - 401/403 → "Server key ditolak Xendit."
  - A network error or timeout gives "Tidak dapat menghubungi <provider>."
  - Never log or return the key.
- **Audit:** every write stores `updated_at` and `updated_by` (the staff username). The editors show "Terakhir diubah …".
- **Copy and UI:** all Indonesian; labels above controls (`C.field`, `C.select`, `C.choiceGroup`, `C.modal`); text-only rendering of stored strings.
- **Admin nav:** the Bisnis group gets **Paket langganan** and **Payment gateway**, replacing the "Segera" placeholder.

## Review Focus

1. **Secrets never leave the server:** check every GET and PUT response and every log line, and confirm `payment_settings` is not reachable through `/api/db`. Test: Task 2 worker check plus unit tests.
2. **Recommended flag:** marking plan B recommended un-marks plan A, even when two staff save at nearly the same time. Use a single batch: `UPDATE … SET recommended = 0` then set B. Test: Task 1.
3. **Landing with no plans, an API error, or every plan inactive** shows the built-in pricing.js cards, not an empty section. Test: Task 1 e2e.
4. **Deleting a plan:** use soft deactivation (`active = 0`) instead of hard delete, because customers will reference plans later. The admin can only "Nonaktifkan" or "Aktifkan". Test: Task 1 e2e.
5. **Tes koneksi with the wrong key, a timeout, or provider `none`** gives a clear Indonesian message with no stack trace. Test: Task 2 unit tests with a stubbed fetch.

---

### Task 1: Subscription plans (storage, API, landing, admin editor)

**Files:**
- Create: `src/business/plan-rules.js` (`validatePlan`, `formatPrice(plan) -> { price, period }`, `PERIODS`), `worker/business.js` (plans routes), `src/business/api.js` (client with a mock branch), `src/stages/office/plans.js`, `tests/business-plans.test.mjs`
- Modify:
  - `migrations/0007_social_meta.sql`: add `subscription_plans` with the columns above as `limits_json` and `features_json`, plus `updated_at` and `updated_by`.
  - `worker/index.js`: add the routes.
  - `src/landing/landing.js`: the Harga section renders from the API, falling back to pricing.js.
  - `src/stages/office/index.js`: add the nav item.
- **Seeding:** the first time the admin opens Paket langganan with zero plans, offer "Impor paket dari landing saat ini". It creates the three pricing.js tiers through the API. There is no automatic seed migration.
- **Admin UI:**
  - a list of plans in `sort` order, showing name, price, period, Rekomendasi tag and Nonaktif tag;
  - up/down buttons to reorder;
  - Tambah/Ubah opens a `C.modal` (wide) form with limits and features as add/remove rows, and a live card preview using the same renderer as the landing.
- [ ] Step 1: Write the failing tests:
  - `formatPrice` cases (349000/month, null, 0 with `period_label` "Gratis 3 bulan", year);
  - `validatePlan` limits (a 7th limit, a 13th feature, a bad slug);
  - e2e: import the defaults, edit UKM's price to 399000, then the landing Harga shows "Rp399.000"; mark Enterprise recommended, and UKM loses its badge; deactivate Sole Trader, and it disappears from the landing; with the mock fail seam the landing shows the pricing.js cards.
- [ ] Step 2: Run them → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run `npm run test:unit`, the e2e for `office`, `landing` and `site`, and `npm run build` → PASS. Run a local wrangler check: public GET; a staff POST, then a non-staff POST gets 403.
- [ ] Step 5: Commit `feat(business): manage subscription plans; landing pricing reads them`

### Task 2: Payment gateway settings

**Files:**
- Create: `src/business/payment.js` (`validatePaymentSettings`, `testGateway({ provider, mode, serverKey }, fetchFn) -> { ok, message }`), payment routes in `worker/business.js`, `src/stages/office/payment.js`, `tests/business-payment.test.mjs`
- Modify:
  - `migrations/0007_social_meta.sql`: add `payment_settings(id INTEGER PRIMARY KEY CHECK (id = 1), provider, mode, client_key, server_key_enc, webhook_token_enc, updated_at, updated_by)`.
  - `worker/index.js`: add the routes.
  - `src/business/api.js`: add the payment calls.
  - the admin nav.
- **Admin UI:**
  - Provider and Mode are choice groups (radio); Client key is a text field.
  - Server key and Webhook token are password fields. When a secret is already stored, the placeholder reads "Tersimpan (…abcd). Kosongkan untuk tetap memakai yang lama.", plus a "Hapus server key" checkbox.
  - **Simpan** shows "Terakhir diubah …".
  - **Tes koneksi** uses the *stored* settings, so the user has to save first. The result shows as an ok/danger note.
  - A warning note appears when Mode = production: "Mode produksi memproses pembayaran sungguhan."
- [ ] Step 1: Write the failing tests:
  - `testGateway` with a stubbed fetch: Midtrans sandbox URL + Basic header, 401 → rejected message, 404 → connected, Xendit 200/401, a network error, a timeout (inject a short timeout), and provider `none` → "Pilih penyedia pembayaran terlebih dahulu.";
  - `validatePaymentSettings` limits;
  - e2e: save Midtrans sandbox with a server key, reload the section, and see "Tersimpan (…" with the key never visible in the DOM; Tes koneksi shows success; save the key `salah-123` and Tes shows the rejected message.
- [ ] Step 2: Run them → FAIL.
- [ ] Step 3: Implement. The PUT response and the GET never include `server_key`, `webhook_token` or the encrypted columns.
- [ ] Step 4: Run the unit tests, the e2e for `office`, and the build → PASS. On local wrangler: a staff PUT with a key, then GET shows `server_key_set: true` and `server_key_last4`, and the raw D1 row holds ciphertext (not the key); a non-staff GET gets 403; `/api/db` select on `payment_settings` gets 400 "Tabel tidak dikenal."
- [ ] Step 5: Commit `feat(business): payment gateway settings with encrypted keys and connection test`
