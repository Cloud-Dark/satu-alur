# Trial quota, AI credit and vouchers

**Goal:** let every business try each AI feature for free, feel the impact, then pay or talk to us. Three tools:
- a monthly AI quota per feature, set per plan;
- AI credit (rupiah) that pays for calls once a quota runs out;
- vouchers that grant a plan, AI credit, or both.

**Team decisions:**
- Plans are Free / Lite / Pro, and buying a plan does **not** include AI credit.
- The trial quota is the Free plan's limits. It is 10 per feature except the advisor, which gets 5 because it costs the most (Zulfikar).
- Voucher types follow Syahdan: plan only, AI credit only, or bundle.
- Redemptions are recorded with the user's contact details, so staff collect potential customers. Larger amounts go through "Hubungi kami" (Margareta).

## Model

- **Numbers live in one place:** `src/quota/rules.js` holds feature keys, prices, the Free fallback and all validators. The Worker (`worker/quota.js`) and the demo-mode client (`src/quota/api.js`) share it.
- **Plan quota:** `subscription_plans.quota_json` (new column in migration 0008) maps feature to monthly limit.
  - `null` or `-1` means unlimited. A missing key falls back to `FREE_QUOTA`.
  - Staff edit it in Kantor › Paket langganan › "Kuota AI per bulan".
  - `limits_json` stays the display text on the pricing cards.
- **Which plan applies:** `customer_accounts` already stores each business's `plan_id`, `status` and `period_end`. No new table.
  - A `trial` or `active` account inside its period uses its plan.
  - `past_due`, `cancelled`, an expired period or no row at all falls back to the plan with slug `free`, or to the built-in `FREE_QUOTA`.
- **Usage:** `usage_counters (user_id, feature, period)`, where `period` is `YYYY-MM` in Jakarta time (WIB). Quotas reset at 00:00 WIB on the 1st. The table is WITHOUT ROWID, so there is no extra index.
- **Credit:**
  - `ai_credits` holds one balance row per user, with `CHECK (balance_idr >= 0)`.
  - `ai_credit_entries` is the audit trail: voucher +, staff +/−, spend − (reason = feature key), refund +.
- **Vouchers:**
  - `vouchers` columns: `code` UNIQUE, `type` plan|credit|bundle, `plan_id` + `plan_days`, `credit_idr` ≤ Rp500.000, `max_redemptions` (NULL = unlimited), `redeemed_count`, `expires_on` (last valid day, WIB), `active`, `note`.
  - `voucher_redemptions` has primary key `(voucher_id, user_id)`, which enforces one redemption per account.

| Feature key | Where | Price after quota |
|---|---|---:|
| `offer` | Penawaran AI, lead-offer draft, Superpowers offer agent | Rp1.000 |
| `report` | Laporan AI, Superpowers report agent | Rp1.000 |
| `leads` | Pencari prospek AI ranking (one call per search job) | Rp2.000 |
| `radar` | Radar peluang explanation | Rp500 |
| `advisor` | Penasihat AI messages, Superpowers general/analyst chats, Pertumbuhan | Rp300 |
| `social` | Media sosial AI content | Rp500 |

| Plan | offer | report | leads | radar | advisor | social |
|---|---:|---:|---:|---:|---:|---:|
| Free (trial) | 10 | 10 | 10 | 10 | 5 | 10 |
| Lite | 50 | 20 | 20 | 30 | 100 | 60 |
| Pro | ∞ | ∞ | 100 | ∞ | 500 | ∞ |

## Enforcement (`POST /api/llm/chat`)

1. **Feature key:** every call sends `X-Satualur-Feature` (the `feature` option of `llm.chat.completions.create`). Anything not in the list returns **400**. A unit test checks that every `completions.create` in `src/ai/` passes `feature`.
2. **Metering:** after the body is validated, `meter()` runs before the model.
   - **Under the limit:** a single UPSERT counts the call, guarded by `WHERE usage_counters.count < ?` with `RETURNING`. That is 1 row written.
   - **Over the limit:** a guarded `UPDATE ai_credits … WHERE balance_idr >= price RETURNING` plus one ledger row. That is 3 rows written in total.
   - **Neither left:** returns **402** with an Indonesian message naming the feature.
3. **Refund:** if the model never starts (AI.run throws), the call is given back (count −1, or credit + refund entry).
4. **Demo accounts** (`DEMO_EMAILS`) are never refused, for the competition demo, but their usage is still counted (1 write) and shown as "tanpa batas".
5. **Guest quota:** there is no unauthenticated AI path, so `GUEST_TRIES = 3` is defined but unused.
6. **Before migration 0008:** if `quota_json` or the tables are missing, `meter()` logs and lets the call through unmetered instead of breaking AI.

**Client side:**
- On a 402, `src/http-cloud.js` throws `QuotaError` and fires `satualur:quota`.
- The shell's upsell dialog (`src/quota/upsell.js`) offers Lihat paket / Tukar voucher / Hubungi kami.
- AI wrappers rethrow `QuotaError`; the advisor and Superpowers do not retry it.
- The mock cloud meters the same way (`mockMeter`), so e2e covers it.

## Endpoints

- `GET /api/me/plan`: plan, `period_end`, `lapsed`, period, `resets_on`, usage rows, `credit_idr`, `demo`.
- `POST /api/vouchers/redeem { code }`:
  - Codes are case/space-insensitive. Staff sessions get 403.
  - Reasons are checked first: unknown 404; already redeemed, inactive, expired or used up 400.
  - Then one D1 batch runs. The first statement is the guarded `redeemed_count + 1`. Every later write (redemption row, plan upsert into `customer_accounts`, credit upsert, ledger) is `… WHERE changes() = 1`, so a voucher that ran out mid-way applies nothing (409).
  - A plan voucher on the same, still-running plan extends from its end; otherwise it starts today.
- Staff only (`requireAdmin`):
  - `GET/POST /api/office/admin/vouchers`; a blank code generates `SATU-XXXX-XXXX`.
  - `PATCH /api/office/admin/vouchers/:id` changes `active`, `note`, `expires_on` and `max_redemptions`. Type and value are fixed once the code may be in people's hands.
  - `GET /api/office/admin/vouchers/redemptions[?voucher_id=]`
  - `GET /api/office/admin/customers/:userId/quota`
  - `POST /api/office/admin/customers/:userId/credit { amount_idr, note }`: top-up, or a correction that never goes below 0.

## UI

- **Business users:** "Paket & kuota" in the help group of the sidebar. It shows the plan and end date, usage bars per feature, AI credit, the redeem form, the plan cards (CTA goes to Hubungi kami) and a contact link.
- **Staff:**
  - Kantor › Bisnis › **Voucher** lists vouchers (code, type, value, used/max, expiry, status, toggle), with a create dialog and recent redemptions with email, business and phone.
  - Kantor › Pelanggan › a customer's dialog gains "Kuota & saldo AI": usage, balance, last entries and a credit top-up/correction.
  - Kantor › Paket langganan gains the quota inputs.

## Rollout (production D1 is on the free tier: 100k rows written/day)

1. Merge, then `npm run db:migrate:remote`. This applies `0003_workers.sql`, `0007_social_meta.sql` and `0008_quota_vouchers.sql`; production currently stops at 0006.
2. **Either** apply `seeds/office.sql` remotely (≈310 writes, sample customers included) **or** create the three plans in Kantor › Paket langganan and fill in "Kuota AI per bulan". Without a `free` plan row, everyone gets the built-in `FREE_QUOTA`.
3. `npm run staff -- add <username> --remote`, then create real vouchers in Kantor › Voucher.
4. Deploy. Until step 1 runs, AI keeps working unmetered (logged).
5. Decide the demo-account policy: keep it unlimited for the competition, or remove the bypass in `meter()` afterwards.

## Not done

- **Payment:** buying a plan or credit online is not built. The gateway settings exist, but there is no checkout; staff grant plans and credit manually or by voucher.
- **Per-call price:** prices are flat per call, not per token.
