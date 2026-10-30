# Admin: Pelanggan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu Alur staff can do four things from Kantor Satu Alur › Pelanggan:
- see and manage the businesses (mitra/pelanggan) that use the service, including their plan and subscription status;
- manage user accounts (suspend, restore, end sessions);
- read and handle messages from a public Contact Us form;
- handle after-sales complaints (pengaduan CS) that signed-in businesses raise from a new in-app "Bantuan" page.

**Context:** This is project 3 of the admin back office. Projects 1 (Konten situs) and 2 (Bisnis) are done; project 4 is Agensi influencer. The owner opted out of design questions, so the product decisions below are the controller's calls.

Out of scope:
- **Billing and checkout.** Plan assignment here is a manual record kept by staff.
- **Email notifications.** The app has no email provider for notifications yet. Staff see new items in the inbox counts.
- **Staff account management.** That stays in the terminal (`npm run staff`).

**Architecture:**
- **Database:** new D1 tables appended to migration 0007 (unreleased, edited in place). None of them is ever in `TABLES`.
- **Server:** routes in a new `worker/customers.js`. Staff routes use `requireAdmin`.
- **Clients:** `src/customers/api.js` mirrors the patterns in `src/site/api.js` and `src/business/api.js`:
  - admin reads throw and use `cache: 'no-store'`;
  - public calls return readable errors;
  - a mock branch stores data in localStorage `satualur_customers_demo_v1`, with fail and delay seams.
- **Admin editors** reuse the office section patterns: per-section box, error with "Coba lagi" and no form until loaded, dirty guard, and "Terakhir diubah … oleh …" where relevant.
- **Pelanggan nav group:** Pelanggan & mitra, Pengguna, Contact Us, Pengaduan CS. These replace the "Segera" placeholder. Contact Us and Pengaduan CS show a count badge for new items.

## Global Constraints

- **A customer is a business account, i.e. a `users` row.**
  - The admin list excludes staff users (emails ending `@staff.satualur.internal`).
  - The shared demo accounts (`DEMO_EMAILS`) are included but tagged "Demo".
- **`customer_accounts`:**
  - Columns: `owner_id` (PK = `users.id`), `plan_id` (nullable, references `subscription_plans.id`), `status` (`trial | active | past_due | cancelled`), `period_end` (date `YYYY-MM-DD`, nullable), `company`, `phone`, `notes` (≤ 2000), `updated_at`, `updated_by`.
  - A business with no row shows as "Belum diatur".
- **`user_flags`:** columns `user_id` (PK), `suspended` 0/1, `reason` (≤ 300), `updated_at`, `updated_by`.
  - A suspended user gets 403 "Akun Anda ditangguhkan. Hubungi tim Satu Alur." from `authenticate()` and from every login route (OTP verify, demo login).
  - Suspending also deletes that user's sessions.
  - Staff users cannot be suspended from here.
- **`contact_messages`:**
  - Columns: `id`, `name` (≤ 80), `email` (≤ 120, valid format), `phone` (≤ 30, optional), `subject` (≤ 120), `message` (≤ 3000), `status` (`new | read | replied | archived`), `staff_note` (≤ 2000), `ip_hash`, `created_at`, `updated_at`, `updated_by`.
  - Public `POST /api/contact`:
    - a honeypot field `website` must be empty; when it is filled, return 200 and store nothing;
    - at most 5 messages per `ip_hash` (SHA-256 of `CF-Connecting-IP` + `TOKEN_KEY`, or a fixed salt when unset) per hour, otherwise 429 "Terlalu banyak pesan. Coba lagi nanti.";
    - successful sends answer "Pesan terkirim. Tim Satu Alur akan membalas lewat email."
- **`support_tickets`:** columns `id`, `owner_id`, `category` (`teknis | tagihan | akun | lainnya`), `subject` (≤ 120), `status` (`open | in_progress | resolved | closed`), `created_at`, `updated_at`, `last_reply_by` (`customer | staff`).
- **`support_messages`:** columns `id`, `ticket_id`, `author` (`customer | staff`), `author_name`, `body` (≤ 3000), `created_at`.
- **Ticket rules:**
  - A business only ever sees its own tickets (owner-scoped in every query).
  - A customer can reply while the ticket is not `closed`. A customer reply on a `resolved` ticket reopens it to `open`.
  - Staff set any status and can reply in any status.
  - At most 20 open (non-closed) tickets per business, otherwise 400 "Terlalu banyak tiket terbuka."
- **Rendering:** text nodes only for every stored string, with line breaks preserved via CSS `white-space: pre-wrap`. No links are auto-detected.
- **Copy:** all Indonesian. Labels sit above controls (design-system 5a). No horizontal scroll at 360px.

## Review Focus

1. **Owner scoping on tickets:** business A must never read or reply to business B's ticket by guessing an id, which must return 404. Test: Task 4 worker check + e2e with two users.
2. **Suspension takes effect immediately:** a suspended user's existing token stops working, OTP and demo login are refused, and restoring lets them log in again. Test: Task 2 wrangler check + unit.
3. **Public contact endpoint abuse:** the honeypot, the per-IP rate limit and the body size cap all hold, and the stored message renders as text in the admin. Test: Task 3 unit + wrangler.
4. **Admin lists with many rows** stay usable: paginate (50 per page) with search. Do not load everything. Test: Tasks 1/2 via the existing pager component pattern.
5. **Concurrent staff edits on a customer** are last-write-wins, and the editor shows who changed what last. Test: Task 1 e2e.

---

### Task 1: Pelanggan & mitra (customer list, plan and status)

**Files:**
- Create: `src/customers/rules.js` (`validateCustomer`, `CUSTOMER_STATUS_LABEL`), `worker/customers.js`, `src/customers/api.js`, `src/stages/office/customers.js`, `tests/customers.test.mjs`
- Modify: migration 0007 (add `customer_accounts`), `worker/index.js` (add the routes), `src/stages/office/index.js` (add the Pelanggan nav item)

**Routes (all staff):**
- `GET /api/office/admin/customers?q=&page=` returns 50 per page, newest users first, joined with `customer_accounts` and the plan name. The search matches email, name or company.
- `GET /api/office/admin/customers/:userId` returns the detail.
- `PUT /api/office/admin/customers/:userId` upserts the customer row.

**UI:**
- A list with a search box (debounced) and a pager. Each row shows email, company, plan, a status tag, period end, and a "Demo" tag for demo accounts.
- Clicking a row opens a detail dialog (`C.modal`, wide) with: Perusahaan, Telepon, Paket (select of plans, including inactive ones, marked "(nonaktif)"), Status, Berlaku sampai (date), Catatan internal, and "Terakhir diubah …".

- [ ] Step 1: Write the failing tests:
  - unit tests for `validateCustomer` (bad status, `period_end` format, `notes` length);
  - e2e: as staff, open Pelanggan & mitra, find the demo user created by an earlier OTP login in the same spec, set the plan to UKM with status Aktif and a date, save, reopen, see the values and "Terakhir diubah … oleh staff".
- [ ] Step 2: Run them and see them fail.
- [ ] Step 3: Implement.
- [ ] Step 4: Run unit, e2e (`office`) and build until they pass. Do a wrangler check: list, search, a PUT from staff, and a 403 for a non-staff caller.
- [ ] Step 5: Commit `feat(customers): manage business customers, their plan and status`

### Task 2: Pengguna (suspend, restore, end sessions)

**Files:** `src/stages/office/users.js`; extend `worker/customers.js` and `src/customers/api.js`; migration 0007 (add `user_flags`); `worker/index.js` (`authenticate`, `handleVerifyOtp` and `handleDemoLogin` check suspension).

**Routes (staff):**
- `GET /api/office/admin/users?q=&page=` returns email, name, created, number of active sessions, suspended, and last session `created_at`.
- `POST /api/office/admin/users/:id/suspend { reason }` suspends and deletes the user's sessions.
- `POST /api/office/admin/users/:id/restore` restores.
- `POST /api/office/admin/users/:id/revoke-sessions` ends all sessions.
- Staff users (emails `@staff.satualur.internal`) get 400 "Akun staf dikelola lewat terminal."

**UI:** a list with search and a pager. Each row has the actions Tangguhkan (a `C.modal` asking for the reason), Pulihkan, and Akhiri sesi (with confirm).

- [ ] Step 1: Write the failing tests:
  - a unit test for a pure helper that decides whether a user is blocked;
  - e2e (mock): a staff member suspends `pemilik@usaha.id`, then that user's OTP login in a new page shows the suspended message; after restore, login works.
- [ ] Step 2: Run them and see them fail.
- [ ] Step 3: Implement. The mock needs the same checks in `mockAuth.verifyOtp`, `demoLogin` and `getSession`.
- [ ] Step 4: Run unit, e2e (`office`, `login`) and build until they pass. Do a wrangler check: an existing token returns 401 or 403 after suspend; OTP verify returns 403; restore lets the user log in.
- [ ] Step 5: Commit `feat(customers): suspend and restore users, end their sessions`

### Task 3: Contact Us (public form + staff inbox)

**Files:**
- Create: `src/contact/page.js` (public `#/kontak`), `src/stages/office/contact.js`
- Extend: `worker/customers.js`, `src/customers/api.js`
- Modify: migration 0007 (add `contact_messages`); `src/ui/app.js` (add the route); `src/landing/landing.js` (the footer "Kontak" link and the Enterprise plan's `contact` CTA both go to `#/kontak`); `src/business/plan-card.js` (the contact CTA href).

**Public page:** uses the same look as the doc pages. Fields: Nama, Email, Telepon (opsional), Subjek, Pesan, plus the hidden honeypot. It submits, shows a busy state, then shows a success state or an inline error.

**Staff routes:**
- `GET /api/office/admin/contact?status=&page=`
- `PATCH /api/office/admin/contact/:id { status?, staff_note? }`
- `GET /api/office/admin/contact/counts` returns `{ new: n }`.

**Staff UI:**
- A filter with the options Baru (default), Dibaca, Dibalas, Arsip, and Semua.
- Each item shows the sender, subject, time, and the message rendered as text with pre-wrap.
- A "Balas lewat email" link uses `mailto:` with the subject prefilled. The address is percent-encoded and must be checked against the email regex first.
- A status select, a staff note, and Simpan.
- Opening an item marks a `new` item as `read`.

- [ ] Step 1: Write the failing tests:
  - unit tests for the validator, the honeypot and the rate-limit decision (a pure function over a count);
  - e2e: from the landing footer, Kontak opens the form; submitting shows success; the staff inbox shows the message under Baru; opening it moves it to Dibaca; a message containing `<img src=x onerror=alert(1)>` renders as text.
- [ ] Step 2: Run them and see them fail.
- [ ] Step 3: Implement.
- [ ] Step 4: Run unit, e2e (`office`, `site`, `landing`) and build until they pass. Do a wrangler check: 6 posts in a row with the same IP get 429 on the 6th; a filled honeypot gets 200 and no row is stored.
- [ ] Step 5: Commit `feat(contact): public contact form and staff inbox`

### Task 4: Pengaduan CS (tickets)

**Files:**
- Create: `src/support/page.js` (an in-app "Bantuan" stage for businesses), `src/stages/office/support.js`
- Extend: `worker/customers.js` and `src/customers/api.js` (or a new `src/support/api.js` if clearer)
- Modify: migration 0007 (add `support_tickets` and `support_messages`); `src/ui/shell.js` (add a "Bantuan" stage, visible to every signed-in business, at the bottom of the nav near Pengaturan).

**Customer routes:**
- `GET /api/support/tickets` returns the business's own tickets.
- `POST /api/support/tickets { category, subject, body }` creates a ticket.
- `GET /api/support/tickets/:id` returns the ticket and its messages. This is owner-scoped: another owner's ticket gives 404.
- `POST /api/support/tickets/:id/messages { body }`.
- Shared demo accounts get 403 "Tidak tersedia di akun demo." on create and reply, matching the social-media rule. They can read.

**Staff routes:**
- `GET /api/office/admin/support?status=&page=` returns tickets joined with the user's email and company.
- `GET /api/office/admin/support/:id`.
- `POST /api/office/admin/support/:id/messages { body }` posts a reply as "Tim Satu Alur (<staff name>)".
- `PATCH /api/office/admin/support/:id { status }`.
- `GET /api/office/admin/support/counts` returns `{ open: n }`, counting open tickets whose `last_reply_by` is `customer`.

**Business UI:** a ticket list and "Buat tiket" (`C.modal`: Kategori, Subjek, Pesan). Each ticket shows a thread view with the messages in time order and a reply box. A closed ticket shows "Tiket ditutup" instead of the reply box.

**Staff UI:** an inbox filtered by status, a thread view, a reply box, and a status select.

- [ ] Step 1: Write the failing tests:
  - unit tests for the validators and the status transition rule (a customer reply on `resolved` becomes `open`; no reply on `closed`);
  - e2e: a business user creates a ticket; staff (a new page) replies and sets Diproses; the business sees the reply and status; staff closes it; the business sees no reply box;
  - a second business user opening `#/…` with the first user's ticket id gets "Tiket tidak ditemukan." (exercise the mock and API scoping).
- [ ] Step 2: Run them and see them fail.
- [ ] Step 3: Implement.
- [ ] Step 4: Run unit, the full e2e and build until they pass. Do a wrangler check: user B's GET of user A's ticket gets 404; a demo account's POST gets 403.
- [ ] Step 5: Commit `feat(support): customer support tickets with staff replies`
