# Admin: Konten situs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu Alur staff edit the public site's content from Kantor Satu Alur: the landing hero and FAQ, a Tentang Kami page, and three legal pages (Kebijakan Privasi, Syarat & Ketentuan, Kebijakan Cookie). The footer links that are dead today point to real pages.

**Context:** The owner asked for a full admin back office, built in this order: (1) Konten situs, (2) Bisnis (paket langganan, payment gateway), (3) Pelanggan (mitra/pelanggan, user, Contact Us, pengaduan CS), and (4) Agensi influencer (the existing Influencer + Permintaan tabs). This plan is project 1. It also builds the grouped section navigation that projects 2–4 will plug into. The owner opted out of design questions, so every product decision below is the controller's call.

**Architecture:**
- **Storage:** one D1 key/value table, `site_content`, holding a JSON value per page key.
- **Public reads:** `GET /api/site/:key` needs no auth and is cache-friendly.
- **Staff writes:** `PUT /api/office/admin/site/:key`, behind the existing staff-session gate (`requireAdmin` in `worker/office.js`).
- **Landing:** reads its content at render time and falls back to the hard-coded copy in `src/landing/content.js` when the row is missing or the fetch fails. The landing must never be blank or slow because of the API.
- **New public routes:** `#/tentang`, `#/privasi`, `#/syarat`, `#/cookie`. All four render through one document page.
- **Mock mode:** a localStorage branch, the same way `src/social/api.js` works.

**Tech Stack:** Cloudflare Worker + D1, vanilla JS + Vite, `node --test`, the Playwright e2e runner.

## Global Constraints

- **Page keys (exact):** `landing`, `about`, `privacy`, `terms`, `cookies`. Any other key returns 404.
- **Value shapes:**
  - `landing`: `{ hero: { badge, title, subtitle, points: string[] }, faqs: [{ q, a }] }`
  - every other key: `{ title, body }`
- **Limits:**
  - `badge` ≤ 80 characters, `title` ≤ 120, `subtitle` ≤ 300.
  - `points`: 0–4 items, each ≤ 60.
  - `faqs`: 0–20 items, `q` ≤ 160, `a` ≤ 1200.
  - Document `title` ≤ 120, `body` ≤ 50 000.
  - The whole JSON value is ≤ 64 KB.
- **Formatting:** the body format is plain text with a tiny markup:
  - a line starting `## ` is a heading;
  - a line starting `- ` is a list item;
  - a blank line separates paragraphs.
  - It is rendered with text nodes only, **never innerHTML**. No links or HTML are allowed in stored content.
- **Hero title emphasis:** one word wrapped in `*asterisks*` renders as `<em>` (the serif italic style the landing uses), built with DOM nodes, not HTML strings.
- **Who can write:** only staff sessions (`isAdminUser`). Every write stores `updated_at` and `updated_by` (the staff username).
- **Fallbacks:**
  - The landing falls back to `src/landing/content.js` for any missing field.
  - A document with no row shows its title plus "Dokumen ini sedang disiapkan." and a link back to the landing.
- **Copy:** all Indonesian. Labels sit above controls (design system 5a: `C.field`/`C.textarea`/`C.modal`).
- **Kantor Satu Alur section navigation:** on desktop, a vertical list on the left, grouped under the headings **Konten situs**, **Bisnis**, **Pelanggan** and **Agensi influencer**. On ≤ 768px it becomes a `<select>` above the content.
  - Sections in this plan: Landing page, Tentang kami, Legal (Konten situs), plus Influencer and Permintaan (moved into Agensi influencer).
  - Bisnis and Pelanggan appear as headings with a muted "Segera" item each, so the structure is visible now.

## Review Focus

1. **Stored content containing `<script>` or HTML** must render as literal text on the public pages and in the admin preview. Test: Task 2 e2e.
2. **API down or returning garbage:** the landing renders the built-in copy without errors, and a document page shows the "sedang disiapkan" fallback. Test: Task 2 e2e with `page.route` failing `/api/site/*`.
3. **A non-staff session calling `PUT /api/office/admin/site/landing`** gets 403. An unknown key gets 404. An oversize or invalid body gets 400 with an Indonesian message. Test: Task 1 unit (validator) and a local wrangler check.
4. **Two staff editing:** last write wins, and the editor shows "Terakhir diubah <time> oleh <user>" after saving and on load. Test: Task 3 e2e.
5. **Deep link** `#/privasi` opened directly, signed in or not, renders the page, and the browser back button returns to the landing. Test: Task 2 e2e.

---

### Task 1: Storage, validation, API

**Files:**
- Create: `src/site/content-rules.js`, `worker/site.js`, `tests/site-rules.test.mjs`
- Modify: `migrations/0007_social_meta.sql` (unreleased, edit in place): add `site_content(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)`. Never add it to `TABLES`.
- Modify: `worker/index.js` ROUTES: `'GET /api/site/:key'` (public) and `'PUT /api/office/admin/site/:key'` (staff only, reusing `requireAdmin`; export it from `worker/office.js` if needed).

**Interfaces:**
- Produces:
  - `SITE_KEYS = ['landing','about','privacy','terms','cookies']`
  - `validateSiteContent(key, value) -> cleanValue | throws Error{validation:true}` (trims strings, drops unknown fields, enforces the limits)
  - `parseDoc(body) -> [{ type: 'h' | 'p' | 'ul', text?: string, items?: string[] }]`, which the public page and the admin preview both use
- GET returns `{ key, value, updated_at, updated_by }`, or `{ key, value: null }` if there is no row. Set `Cache-Control: public, max-age=60`.
- PUT body `{ value }` → upsert, then return the same shape. `updated_by` = the staff user's `name`.

- [ ] Step 1: Write the failing tests:
  - valid landing and valid doc pass;
  - a 5th hero point → "Maksimal 4 poin.";
  - a 21st FAQ → "Maksimal 20 FAQ.";
  - an unknown key throws;
  - `<b>x</b>` is kept as literal text (no stripping needed, since rendering is text-only);
  - `parseDoc` turns `## A\n\nteks\n- satu\n- dua` into h/p/ul blocks.
- [ ] Step 2: Run `node --test tests/site-rules.test.mjs` → FAIL.
- [ ] Step 3: Implement the rules, the migration, `worker/site.js` and the routes.
- [ ] Step 4: Run `npm run test:unit` → PASS. On local wrangler (scratch config without `[ai]`, under `.superpowers/`):
  - GET with no row → `value: null`;
  - PUT with a non-staff session → 403;
  - PUT with a staff session (create one via `npm run staff -- add`, then `POST /api/auth/staff-login`) → 200, and GET returns it;
  - PUT with key `x` → 404.
- [ ] Step 5: Commit `feat(site): store editable site content (landing, about, legal)`

### Task 2: Public pages and landing wiring

**Files:**
- Create: `src/site/api.js` (client: `getSite(key)`, `saveSite(key, value)`, with a mock branch in localStorage `satualur_site_demo_v1` when `isUsingMockCloud()`), `src/site/doc-page.js` (`renderDocPage(root, ctx, key)`)
- Modify:
  - `src/ui/app.js` ROUTES: `#/tentang` → about, `#/privasi` → privacy, `#/syarat` → terms, `#/cookie` → cookies.
  - `src/landing/landing.js`:
    - the hero badge, title, subtitle and points, and the FAQ list, come from `getSite('landing')` merged over `content.js`;
    - render the defaults first, then swap in fetched content without layout jump;
    - footer links: Tentang kami → `#/tentang`, Kebijakan privasi → `#/privasi`, Syarat & ketentuan → `#/syarat`, plus a new Kebijakan cookie → `#/cookie`;
    - "Kontak" stays a placeholder until the Pelanggan project.
- Test: `tests/e2e/site.spec.cjs`

- [ ] Step 1: Write the failing e2e:
  - footer links open the four pages;
  - with no saved content each shows "Dokumen ini sedang disiapkan.";
  - after seeding the mock store with an `about` doc containing `## Visi`, a list and `<script>alert(1)</script>`, the page shows the heading and list, and the script text is visible as literal text;
  - with `/api/site/*` routed to a 500 (real mode is not used in e2e, so make the mock client throw through a test hook, or route the fetch), the landing still shows the default hero;
  - opening `#/privasi` directly works and the back button returns to the landing.
- [ ] Step 2: Run `node tests/e2e/run.cjs site` → FAIL.
- [ ] Step 3: Implement. The doc page reuses the landing header and footer look (logo, theme toggle, link back to "Beranda"), with a readable column of about 70ch.
- [ ] Step 4: Run e2e `site` + `landing` → PASS, then `npm run build`.
- [ ] Step 5: Commit `feat(site): public about and legal pages; landing reads editable content`

### Task 3: Kantor Satu Alur section navigation + content editors

**Files:**
- Restructure: `src/stages/office.js` into `src/stages/office/index.js` (the shell with grouped section nav), `src/stages/office/influencers.js`, `src/stages/office/requests.js` (moved, behaviour unchanged), `src/stages/office/site-landing.js`, `src/stages/office/site-doc.js`. Keep the stage key `office` and update the import in `src/ui/shell.js`.
- Test: extend `tests/e2e/office.spec.cjs`.

**Behaviour:**
- **Section nav:** grouped as in Global Constraints. The selected section is remembered in sessionStorage `satualur_office_section`, and the default is `landing`.
- **Landing page editor:**
  - fields: Badge, Judul (hint "Apit satu kata dengan *bintang* untuk huruf miring"), Subjudul, and up to 4 Poin (add/remove);
  - FAQ list with add, remove, move up/down, and Pertanyaan/Jawaban per item;
  - a live preview of the hero, rendered with the same function as the landing;
  - **Simpan** shows a busy state, a toast and "Terakhir diubah …";
  - "Kembalikan ke bawaan" (with confirm) fills the form with the `content.js` defaults without saving.
- **Tentang kami** and **Legal** (Legal has a sub-select for Privasi / Syarat / Cookie):
  - Judul and Isi (a large textarea with a hint about `##` and `-`);
  - a live preview using `parseDoc`;
  - Simpan, "Terakhir diubah …", and a "Lihat halaman ↗" link to the public route;
  - leaving with unsaved changes shows a `confirm()`.
- Validation errors are shown inline from `validateSiteContent` before saving.

- [ ] Step 1: Write the failing e2e (staff login as in the existing spec):
  - the nav shows the four group headings;
  - Influencer and Permintaan still work (the existing checks keep passing);
  - edit the landing title to `Uji *judul* baru` and save, then open the landing: the hero shows "Uji judul baru" with "judul" in `<em>`;
  - edit Privasi with `## Data\n- email` and save, then `#/privasi` shows the heading and list;
  - after saving, the "Terakhir diubah" text contains the staff username;
  - a 5th point is impossible (the add button is disabled at 4).
- [ ] Step 2: Run `node tests/e2e/run.cjs office` → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run e2e `office` + `site` + `landing`, `npm run test:unit` and `npm run build` → PASS.
- [ ] Step 5: Commit `feat(office): grouped admin sections; edit landing, about and legal content`
