# Admin: Agensi influencer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu Alur runs influencer collaborations as an agency.

- Staff keep full influencer profiles: handles, private contact, rate card and notes.
- Staff turn a business's collaboration request into a **campaign**: assigned influencers, deliverables with due dates and statuses, the client fee and the influencer payout.
- The business follows its campaign's progress from Media Sosial › Kolaborasi › Permintaan saya. It never sees influencer contact details, rates or payouts.

**Context:** This is project 4, the last of the admin back office. Projects 1 (Konten situs), 2 (Bisnis) and 3 (Pelanggan) are done. The owner opted out of design questions, so the product decisions below are the controller's calls.

Existing pieces:
- The influencer catalogue (`influencers` table, `worker/office.js`, `src/stages/office/influencers.js`).
- Collaboration and ads requests (`service_requests`, `src/stages/office/requests.js`, and the business-side `src/stages/social-media/collab.js` / `requests.js`).

Out of scope:
- Payments to influencers or invoices to clients. Money amounts are recorded only.
- Influencer self-service logins.

**Architecture:**
- Extend `influencers` with staff-only columns, and add `campaigns`, `campaign_influencers` and `campaign_deliverables` (migration 0007, unreleased, edited in place). None of them is ever in `TABLES`.
- Staff routes live under `/api/office/admin/…` (`requireAdmin`).
- The business read route `GET /api/office/requests/:id/campaign` is owner-scoped and returns a **public projection** with no staff-only fields.
- The admin UI moves into the Agensi influencer group: **Influencer** (richer editor), **Permintaan** (existing; gains "Buat kampanye"), and a new **Kampanye** section.

## Global Constraints

- **Staff-only influencer fields:**
  - `handle_ig`, `handle_tiktok`, `handle_youtube` (≤ 60 each, stored without a leading `@`);
  - `contact_phone` (≤ 30), `contact_email` (≤ 120, valid format);
  - `rates` (0–8 rows of `{ deliverable ≤ 40, price_idr integer 0–1 000 000 000 }`);
  - `internal_notes` (≤ 2000).
  - The public `GET /api/office/influencers` keeps returning exactly the fields it returns today. Add a unit test that pins the public projection's key list.
- **Campaign:**
  - `id`;
  - `request_id` (unique: one campaign per request), `owner_id` (copied from the request);
  - `title` ≤ 120, `brief` ≤ 3000;
  - `status`: `draft | active | completed | cancelled`;
  - `start_date` / `end_date` (`YYYY-MM-DD`, real dates, end ≥ start);
  - `client_fee_idr` (integer ≥ 0, nullable);
  - `updated_at`, `updated_by`.
- **Campaign influencer:** `campaign_id`, `influencer_id`, `payout_idr` (integer ≥ 0, nullable). Unique on (campaign, influencer).
- **Deliverable:**
  - `id`, `campaign_id`, `influencer_id`;
  - `kind` (`feed | reel | story | tiktok | youtube | lainnya`);
  - `due_date`;
  - `status` (`planned | briefed | in_progress | submitted | approved | published`);
  - `link` (≤ 300; `https://` only; set when published), `note` (≤ 500).
- **Business projection** (`GET /api/office/requests/:id/campaign`, owner-scoped; a foreign or missing id gives 404 "Kampanye tidak ditemukan."):
  - It returns `{ title, status, start_date, end_date, influencers: [{ name, niche, city, photo_key }], deliverables: [{ influencer_name, kind, due_date, status, link }] }`.
  - It never includes contact details, rates, payout, `client_fee_idr`, `internal_notes` or a deliverable `note`.
- **Creating a campaign** from a collab request sets that request's status to `in_progress` in the same batch. Completing a campaign does not auto-close the request; staff close it separately.
- **Status labels:**
  - Campaign: draft "Draf", active "Berjalan", completed "Selesai", cancelled "Dibatalkan".
  - Deliverable: planned "Direncanakan", briefed "Brief terkirim", in_progress "Dikerjakan", submitted "Menunggu persetujuan", approved "Disetujui", published "Tayang".
- **Money** displays via the existing Rupiah formatter (`formatPrice` / `C.rupiah`).
- **Rendering:** text-only for every stored string. A deliverable `link` renders as an anchor only when it starts with `https://`, with `rel="noopener noreferrer"` and `target="_blank"`.
- Copy is Indonesian, labels sit above controls, editors follow the office patterns (per-section box, dirty guard, error and "Coba lagi"), and there is no horizontal scroll at 360px.

## Review Focus

1. **Projection leak:** the business campaign route and the public influencer route must never include staff-only fields, including through the mock. Test: unit tests that pin key lists, plus a wrangler check.
2. **Owner scoping:** business B gets 404 for business A's request or campaign id. Test: Task 2 wrangler check and e2e.
3. **One campaign per request.** A double-click on "Buat kampanye" must not create two. Enforce it with a UNIQUE constraint and a clear 400 "Permintaan ini sudah punya kampanye.". Test: Task 2.
4. **Removing an influencer from a campaign** that still has deliverables gives 400 "Hapus atau pindahkan konten influencer ini terlebih dahulu.", not silent orphaning. Test: Task 2 unit and wrangler.
5. **Hiding an influencer** (`visible = 0`) keeps them on existing campaigns, but they cannot be newly assigned. Test: Task 2.

---

### Task 1: Rich influencer profiles (staff-only fields)

**Files:**
- Modify:
  - `migrations/0007_social_meta.sql` (new columns on `influencers`; `rates_json`);
  - `src/office/rules.js` (`validateInfluencer` gains the new fields; add `publicInfluencer(row)`);
  - `worker/office.js` (the admin GET, POST and PATCH handle the new fields; the public GET uses `publicInfluencer`);
  - `src/social/api.js` (the mock admin functions and the public list use the projection);
  - `src/stages/office/influencers.js` (editor sections: Profil, Media sosial, Kontak pribadi (marked "Hanya terlihat oleh tim Satu Alur"), Tarif (rows), Catatan internal; the list shows handles and a rate summary).
- Move the Influencer and Permintaan nav items under the **Agensi influencer** group, if they aren't there already.
- [ ] Step 1: Write failing tests:
  - unit: the validator limits (bad email, a 9th rate row, a negative price, `@` stripped from handles);
  - unit: `publicInfluencer` returns exactly today's public keys;
  - e2e: staff edits an influencer's phone and rate, saves and reopens, and sees the values; the business Kolaborasi card and its DOM (`page.content()`) contain neither the phone nor the rate.
- [ ] Step 2: Run them → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run unit, the e2e for `office` and `social-media`, and build → PASS. Wrangler: public GET has no staff-only fields; admin GET has them.
- [ ] Step 5: Commit `feat(agency): staff-only influencer profiles with contacts and rate card`

### Task 2: Campaigns from collaboration requests

**Files:**
- Create: `src/agency/rules.js` (validators, `campaignProjection(campaign, influencers, deliverables)`, labels), `worker/agency.js`, `src/agency/api.js` (client with a mock branch in `satualur_agency_demo_v1`), `src/stages/office/campaigns.js`.
- Modify:
  - migration 0007 (the three campaign tables);
  - `worker/index.js` (routes);
  - `src/stages/office/requests.js` ("Buat kampanye" on collab requests without one; "Lihat kampanye" when one exists);
  - `src/stages/office/index.js` (a **Kampanye** item in Agensi influencer);
  - `src/stages/social-media/requests.js` (a collab request with a campaign shows a "Lihat progres" toggle that renders the projection: status, dates, influencer names, and a deliverable checklist with statuses and published links).
- **Staff routes:**
  - `POST /api/office/admin/campaigns { request_id, title, brief?, start_date?, end_date?, client_fee_idr? }`
  - `GET /api/office/admin/campaigns?status=&page=`
  - `GET /api/office/admin/campaigns/:id` (full detail)
  - `PATCH /api/office/admin/campaigns/:id`
  - `POST /api/office/admin/campaigns/:id/influencers { influencer_id, payout_idr? }`
  - `DELETE /api/office/admin/campaigns/:id/influencers/:influencerId`
  - `POST /api/office/admin/campaigns/:id/deliverables`
  - `PATCH /api/office/admin/deliverables/:id`
  - `DELETE /api/office/admin/deliverables/:id`
- **Business route:** `GET /api/office/requests/:id/campaign` (owner-scoped projection).
- **Campaign editor:**
  - header fields (Judul, Brief, Status, Tanggal mulai/selesai, Biaya klien);
  - the influencer list (add from the catalogue, visible only, with Bayaran);
  - deliverables grouped by influencer (add/edit inline: Jenis, Tenggat, Status, Tautan, Catatan);
  - a summary line: total client fee, total payout, margin.
- [ ] Step 1: Write failing tests:
  - unit: validators (end < start, a bad link, unknown kind);
  - unit: `campaignProjection` key pinning;
  - e2e: business sends a collab request → staff "Buat kampanye" → adds the influencer, two deliverables, sets one to Tayang with an https link → business opens Kolaborasi › Permintaan saya › "Lihat progres" and sees the title, the deliverable statuses and the link, and its DOM has no payout or client-fee numbers;
  - e2e: a double-click on "Buat kampanye" creates exactly one campaign;
  - e2e: a second business cannot see the first business's campaign.
- [ ] Step 2: Run them → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run unit, full e2e and build → PASS. Wrangler:
  - B → A's campaign gives 404;
  - a second POST for the same request gives 400;
  - removing an influencer that has deliverables gives 400;
  - assigning a hidden influencer gives 400;
  - the business projection JSON has no staff-only keys.
- [ ] Step 5: Commit `feat(agency): run collaboration requests as campaigns with deliverables`
