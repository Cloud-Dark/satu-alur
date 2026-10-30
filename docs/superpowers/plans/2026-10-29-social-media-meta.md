# Social Media Meta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each business connect its Facebook Page (and the Instagram account linked to it), post or schedule saved content to Facebook/Instagram with a live-or-failed report, and send influencer-collaboration and Meta-ads requests to an inbox that the Satu Alur office manages.

**Architecture:**
- Pure, node-testable logic goes in `src/social/`: rules, the Meta Graph client, and the publish runner. The worker imports these modules, the same way `worker/leads.js` imports `src/leads/osm.js`.
- New worker route modules `worker/social.js` and `worker/office.js` are registered in `ROUTES` in `worker/index.js`, and a `scheduled` cron handler is added.
- The browser talks to them through `src/social/api.js`. That client has a demo branch for the mock cloud, following the same pattern as `src/leads/api.js`.
- The UI is split out of `src/stages/social-media.js` into one file per tab, plus a new admin stage.

**Tech Stack:** Cloudflare Workers + D1 + R2 + Cron Triggers, Meta Graph API v21.0, vanilla JS + Vite, `node --test`, the Playwright e2e runner (`tests/e2e/run.cjs`).

**Spec:** `docs/superpowers/specs/2026-10-29-social-media-meta-design.md`

## Global Constraints

- Platforms are `facebook` and `instagram` only. Remove TikTok, LinkedIn and X from every platform choice in `social-media`.
- Meta tokens never leave the worker. `social_accounts` is never added to `TABLES` in `worker/index.js`. API responses only ever return `page_name`, `ig_username`, `needs_reconnect` and `configured`.
- Generic `/api/db` is read-only for `social_schedules` (a new `READ_ONLY_TABLES` set). Every write goes through `/api/social/*`.
- Schedule `scheduled_at` must be ≥ now + 1 min and ≤ now + 75 days. It is stored as an ISO UTC string.
- The cron runs `*/5 * * * *` and handles at most 25 rows per run. A row gets at most 3 attempts. A row stuck in `publishing` for more than 15 min becomes `failed` with "Status tidak pasti, periksa halaman Anda".
- Statuses:
  - Schedule: `scheduled | publishing | posted | failed | cancelled`.
  - Request: `new | in_progress | done`.
- Images: JPEG only, ≤ 8 MB, re-encoded in the browser. Instagram needs an image with aspect ratio (w/h) between 0.8 and 1.91. Instagram captions are ≤ 2200 chars and ≤ 30 hashtags.
- Admin = the user's email (lower-cased) is in `ADMIN_EMAILS` (comma-separated). In demo mode, the demo user is an admin.
- Page mismatch or disconnected at publish time → `failed` with "Akun Facebook berubah atau terputus, jadwalkan ulang".
- Copy is in Indonesian. Tab labels: `Akun`, `Konten`, `Jadwal`, `Brainstorm`, `Iklan`, `Kolaborasi`.
- Config:
  - Vars: `META_APP_ID`, `ADMIN_EMAILS`, `PUBLIC_BASE_URL`.
  - Secrets: `META_APP_SECRET`, `TOKEN_KEY` (32-byte base64).
  - Binding: R2 `MEDIA`.
- OAuth scopes: `pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management`.

## Review Focus

1. **Time zones:** a time picked in `datetime-local` on a WIB device must post at that WIB time. The client converts it with `new Date(value).toISOString()`, and Laporan displays it back in local time. Test: Task 1 `toUtcIso`.
2. **A Page with no linked Instagram:** the connection succeeds as Facebook only. The IG checkbox is hidden and the hint says "Hubungkan akun Instagram Bisnis ke Page ini". Test: Task 3 `parsePages` and Task 7 e2e.
3. **Revoked or expired token (Meta error code 190):** the row is `failed`, `needs_reconnect` is set to 1, and the Akun tab shows "Hubungkan ulang". Test: Task 2 `classifyMetaError` and Task 4 runner.
4. **User cancels the Facebook dialog, or the state has expired:** the callback redirects to `#/social-media?social_error=…` and the Akun tab shows a readable message, not a blank page or JSON. Test: Task 3 `verifyState` expiry and the callback-redirect test.
5. **Double click on "Bagikan sekarang", or a cron overlapping a manual publish:** only one Meta post is made. Test: Task 4 runner double-run test against the in-memory store.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/social/rules.js` | Pure rules: schedule window, UTC conversion, IG eligibility (image/aspect/caption), admin check, status labels |
| `src/social/meta.js` | Graph API calls (`fetch` injected): OAuth URL, token exchange, pages, FB post, IG two-step post, error classification |
| `src/social/runner.js` | Publish state machine over an injected `store`: claim → publish → posted/requeue/failed, stuck-row sweep |
| `src/social/crypto.js` | AES-GCM token encryption and HMAC-signed OAuth `state` (WebCrypto, works in both node and the worker) |
| `src/social/api.js` | Browser client for `/api/social/*` and `/api/office/*`, with a demo branch on top of localStorage `satualur_social_demo_v1` |
| `src/social/image.js` | Browser: re-encode the chosen file to JPEG (canvas) and return `{ blob, width, height }` |
| `worker/social.js` | Routes: account, OAuth, media, publish, schedule, cancel; `runCron(env)`; the D1 `store` adapter |
| `worker/office.js` | Routes: influencers, service requests, admin CRUD |
| `migrations/0007_social_meta.sql` | New tables and columns |
| `src/stages/social-media.js` | Tab shell only (the six tabs) |
| `src/stages/social-media/{account,content,schedule,ads,collab}.js` | One tab each, `export function render(host, ctx)` |
| `src/stages/office.js` | Admin stage: Influencer and Permintaan tabs |

---

### Task 1: Pure rules

**Files:**
- Create: `src/social/rules.js`
- Test: `tests/social-rules.test.mjs`

**Interfaces:**
- Produces:
  - `PLATFORMS = ['facebook','instagram']`
  - `validateScheduleAt(iso: string, now = Date.now()) -> string|null` (an error message or null)
  - `toUtcIso(localValue: string) -> string`
  - `igEligibility({ hasImage: boolean, width?, height?, caption: string }) -> { ok: boolean, reason?: string }`
  - `isAdmin(email: string, adminEmails: string|undefined) -> boolean`
  - `SCHEDULE_STATUS_LABEL` (an object mapping the 5 statuses to `Terjadwal, Memproses, Tayang, Gagal, Dibatalkan`)
  - `REQUEST_STATUS_LABEL` (`Baru, Diproses, Selesai`)

- [ ] **Step 1: Write the failing tests**

```js
test('schedule window', () => {
  const now = Date.parse('2026-11-01T00:00:00Z')
  assert.equal(validateScheduleAt('2026-11-01T00:00:30Z', now), 'Waktu tayang minimal 1 menit dari sekarang.')
  assert.equal(validateScheduleAt('2026-11-01T00:02:00Z', now), null)
  assert.equal(validateScheduleAt('2027-01-16T00:00:00Z', now), 'Waktu tayang maksimal 75 hari ke depan.')
  assert.equal(validateScheduleAt('bukan tanggal', now), 'Tanggal dan waktu tidak valid.')
})
test('toUtcIso keeps the local wall time', () => {
  assert.equal(toUtcIso('2026-11-01T09:00'), new Date('2026-11-01T09:00').toISOString())
})
test('instagram eligibility', () => {
  assert.equal(igEligibility({ hasImage: false, caption: 'x' }).reason, 'Instagram wajib memakai gambar.')
  assert.equal(igEligibility({ hasImage: true, width: 1000, height: 2000, caption: 'x' }).ok, false) // 0.5 < 0.8
  assert.equal(igEligibility({ hasImage: true, width: 1080, height: 1350, caption: 'x' }).ok, true)  // 0.8
  assert.equal(igEligibility({ hasImage: true, width: 1080, height: 1080, caption: 'a'.repeat(2201) }).ok, false)
  assert.equal(igEligibility({ hasImage: true, width: 1080, height: 1080, caption: Array(31).fill('#a').join(' ') }).ok, false)
})
test('isAdmin', () => {
  assert.equal(isAdmin('Ops@Satu-Alur.id', 'ops@satu-alur.id, x@y.z'), true)
  assert.equal(isAdmin('a@b.c', undefined), false)
  assert.equal(isAdmin('', ''), false)
})
```

- [ ] **Step 2: Run** `node --test tests/social-rules.test.mjs`. Expected: FAIL (the module is not found).
- [ ] **Step 3: Implement** `src/social/rules.js` with the signatures above. Use the reason strings from the tests. Caption too long → `'Caption Instagram maksimal 2.200 karakter.'`. Too many hashtags → `'Instagram maksimal 30 hashtag.'`. Bad ratio → `'Rasio gambar harus antara 4:5 dan 1,91:1 untuk Instagram.'`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(social): add publishing rules`

---

### Task 2: Meta Graph client

**Files:**
- Create: `src/social/meta.js`
- Test: `tests/social-meta.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (`GRAPH = 'https://graph.facebook.com/v21.0'`, and every function takes `fetchFn` as its last argument):
  - `oauthUrl({ appId, redirectUri, state }) -> string`
  - `exchangeCode({ appId, appSecret, redirectUri, code }, fetchFn) -> Promise<string>` (a long-lived user token: the code exchange, then `fb_exchange_token`)
  - `listPages(userToken, fetchFn) -> Promise<Page[]>`
  - `parsePages(json) -> Page[]`, where `Page = { id, name, token, igUserId|null, igUsername|null }`. It reads `data[].instagram_business_account{id,username}` from `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`.
  - `postFacebook({ pageId, pageToken, message, imageUrl? }, fetchFn) -> Promise<{ id, permalink }>`. It uses `/{pageId}/photos` with `url`+`caption` when there's an image, else `/{pageId}/feed`, and gets the permalink with `GET /{id}?fields=permalink_url`.
  - `postInstagram({ igUserId, pageToken, caption, imageUrl }, fetchFn) -> Promise<{ id, permalink }>`. The steps are `/{ig}/media`, then `/{ig}/media_publish` with `creation_id`, then `GET /{id}?fields=permalink`.
  - `class MetaError extends Error { code, subcode, kind }`
  - `classifyMetaError(status, body) -> 'token'|'transient'|'fatal'`. Code 190 or 102 → `token`. HTTP ≥ 500, or code 4/17/32/613, or `is_transient` → `transient`. Anything else → `fatal`.

- [ ] **Step 1: Write the failing tests.** Use a stub `fetchFn` that records calls and replies from a queue.
  - `postFacebook` text-only → one POST to `/PAGE/feed` with `message`, plus the permalink GET. The result is `{ id: 'PAGE_1', permalink: 'https://facebook.com/p/1' }`.
  - `postFacebook` with an image → POST to `/PAGE/photos` with `url`.
  - `postInstagram` → calls in order `/IG/media` (body has `image_url`, `caption`), then `/IG/media_publish` (`creation_id: 'C1'`), then the GET permalink.
  - A Graph `{error:{code:190}}` with status 400 → rejects with `MetaError`, `kind === 'token'`.
  - `classifyMetaError(500, {})==='transient'`, `classifyMetaError(400,{error:{code:4}})==='transient'`, `classifyMetaError(400,{error:{code:100}})==='fatal'`.
  - `parsePages({data:[{id:'1',name:'A',access_token:'t'}]})` → `[{ id:'1', name:'A', token:'t', igUserId:null, igUsername:null }]`.
  - `oauthUrl` contains `client_id=APP`, the encoded `redirect_uri`, `state=S`, and the exact scope string from Global Constraints.
- [ ] **Step 2: Run** `node --test tests/social-meta.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/social/meta.js`. Send tokens as an `access_token` form field or query parameter, never in a log line.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(social): add Meta Graph client`

---

### Task 3: Crypto, migration, account + OAuth + media routes

**Files:**
- Create: `src/social/crypto.js`, `worker/social.js`, `migrations/0007_social_meta.sql`
- Modify:
  - `worker/index.js`: import `handleSocial*`, add them to `ROUTES`, and add `GET /api/media/:key` prefix handling before the 404 in `handleApi`.
  - `handleSession`: return `{ user, is_admin }`.
  - Add the `READ_ONLY_TABLES = new Set(['social_schedules'])` check in `handleDb` for every non-select action.
- Modify: `wrangler.toml` (`[[r2_buckets]] binding="MEDIA" bucket_name="satu-alur-media"`, `[triggers] crons=["*/5 * * * *"]`, and the vars `META_APP_ID=""`, `ADMIN_EMAILS=""`, `PUBLIC_BASE_URL=""`)
- Modify: `docs/16_CONFIG_REFERENCE.md`. Add the vars, the secrets, and the Meta app setup: product "Facebook Login for Business", redirect URI `${PUBLIC_BASE_URL}/api/social/oauth/callback`, the scopes, and the note that app review is needed before non-tester businesses can connect.
- Test: `tests/social-crypto.test.mjs`

**Interfaces:**
- Produces (crypto):
  - `encryptToken(plain, keyB64) -> Promise<string>` (`iv.ciphertext` base64url)
  - `decryptToken(blob, keyB64) -> Promise<string>`
  - `signState({ ownerId, exp }, secret) -> Promise<string>`
  - `verifyState(state, secret, now = Date.now()) -> Promise<{ ownerId }|null>` (null on a bad signature or `exp < now`)
- Produces (routes, each `(request, env) -> Response`):
  - `GET /api/social/account` → `{ configured, account: { page_name, ig_username, needs_reconnect }|null }`
  - `POST /api/social/oauth/start` → `{ url }`. The state has a 10-minute expiry and is signed with `META_APP_SECRET`.
  - `GET /api/social/oauth/callback?code&state` (no Bearer token): verify the state, exchange the code, list the Pages. With one Page, store it and redirect `302 → ${PUBLIC_BASE_URL}/#/social-media?social=connected`. With more than one, keep `{ownerId, pages}` in the Cache API under a random `pick` id for 10 minutes and redirect `?social_pick=<id>`. If there's `error` or a bad state, redirect `?social_error=<message>`.
  - `GET /api/social/oauth/pages?pick=` → `[{id,name,ig_username}]` (owner must match). `POST /api/social/oauth/pick {pick, page_id}` → stores the chosen Page.
  - `DELETE /api/social/account`.
  - `POST /api/social/media` (body = raw JPEG, `Content-Type: image/jpeg`, ≤ 8 MB, magic bytes `FF D8 FF`) → `{ key }`, where key = 32 hex random. `GET /api/media/:key` → R2 object with `Cache-Control: public, max-age=31536000, immutable`, no auth.
- Migration `0007_social_meta.sql`:
  - `social_accounts(owner_id TEXT PRIMARY KEY, page_id, page_name, page_token_enc, ig_user_id, ig_username, needs_reconnect INTEGER DEFAULT 0, connected_at)`
  - `ALTER TABLE social_contents ADD COLUMN image_key TEXT`
  - `ALTER TABLE social_schedules ADD COLUMN content_id INTEGER / image_key TEXT / page_id TEXT / platform_post_id TEXT / permalink TEXT / error TEXT / attempts INTEGER NOT NULL DEFAULT 0 / published_at TEXT / claimed_at TEXT`
  - `CREATE INDEX idx_social_schedules_due ON social_schedules(status, scheduled_at)`
  - The `influencers` and `service_requests` tables as specified in the spec, plus an index on `service_requests(owner_id)`.
  - Add the new columns to `TABLES.social_contents` (`image_key`) and `TABLES.social_schedules` (the new columns) so listing returns them.

- [ ] **Step 1: Write the failing tests** for crypto: a round trip encrypts and decrypts to the same string; decrypting with another key rejects; `verifyState` returns `{ownerId:'u1'}` for a fresh state, `null` for a tampered state, and `null` when `now > exp`.
- [ ] **Step 2: Run** `node --test tests/social-crypto.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/social/crypto.js` (WebCrypto `AES-GCM` with a 12-byte IV, and `HMAC SHA-256`), then the migration, `worker/social.js` account/OAuth/media routes, the `worker/index.js` wiring, `wrangler.toml` and the docs. `configured` = `META_APP_ID && META_APP_SECRET && TOKEN_KEY && PUBLIC_BASE_URL`. Every route except the callback and the media GET calls `authenticate`.
- [ ] **Step 4: Run** `node --test tests/social-crypto.test.mjs && npm run test:unit`. Expected: all PASS.
- [ ] **Step 5: Verify locally:**
  - Run `npm run db:migrate:local && npm run cf:dev`.
  - Logged in, `curl -H "Authorization: Bearer $T" localhost:8787/api/social/account` → `{"data":{"configured":false,"account":null}}`.
  - `curl 'localhost:8787/api/social/oauth/callback?error=access_denied'` → 302 with `social_error`.
  - `POST /api/db` insert into `social_schedules` → 400.
- [ ] **Step 6: Commit** `feat(social): connect Facebook Page via OAuth; store tokens encrypted`

---

### Task 4: Publish runner, publish/schedule/cancel routes, cron

**Files:**
- Create: `src/social/runner.js`
- Modify: `worker/social.js` (D1 store adapter and routes), `worker/index.js` (`export default { fetch, scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)) } }`)
- Test: `tests/social-runner.test.mjs`

**Interfaces:**
- Consumes: Task 2 `postFacebook`, `postInstagram`, `MetaError`; Task 1 `validateScheduleAt`.
- Produces:
  - `publishRow(row, deps) -> Promise<'posted'|'requeued'|'failed'>`, where `deps = { store, getAccount(ownerId) -> {page_id, pageToken, ig_user_id}|null, mediaUrl(key) -> string, fetchFn, now }`
  - `runDue(deps, limit = 25) -> Promise<{ posted, failed, requeued }>`
  - `sweepStuck(deps) -> Promise<number>`
  - `store` interface (the D1 adapter in `worker/social.js` implements this with the SQL from the spec):
    - `listDue(nowIso, limit)`
    - `claim(id, nowIso) -> boolean` (`UPDATE … SET status='publishing', claimed_at=? WHERE id=? AND status='scheduled'`, true iff `meta.changes === 1`)
    - `markPosted(id, {platform_post_id, permalink, published_at})`
    - `requeue(id, error)` (status `scheduled`, `attempts+1`)
    - `markFailed(id, error)`
    - `flagReconnect(ownerId)`
    - `listStuck(beforeIso)`
- Routes:
  - `POST /api/social/publish {content_id, platforms[]}` → inserts one row per platform with `scheduled_at=now`, `page_id` = current account, `content`/`image_key` copied from the content. It awaits `publishRow` for each and returns the rows.
  - `POST /api/social/schedule {content_id, platforms[], scheduled_at}` → validates, then inserts the rows.
  - `DELETE /api/social/schedule/:id` → `UPDATE … SET status='cancelled' WHERE id=? AND owner_id=? AND status='scheduled'`. Returns 409 "Jadwal sudah diproses." if 0 rows changed.
  - Both publish and schedule reject with 400 if a platform isn't connected (IG with no `ig_user_id`), or if IG is chosen without an `image_key`.

- [ ] **Step 1: Write the failing tests** with an in-memory `store` and a stub `fetchFn`:
  - Happy FB → `'posted'`, with permalink saved.
  - The row's `page_id` ≠ the account's `page_id` → `'failed'` with "Akun Facebook berubah atau terputus, jadwalkan ulang", and no fetch call.
  - No account → same failure.
  - Transient with `attempts` 0 → `'requeued'`, attempts 1. Transient with `attempts` 2 → `'failed'`.
  - Code 190 → `'failed'` and `flagReconnect` called.
  - **Double run:** two concurrent `runDue` calls on the same due row → exactly one Meta POST (`claim` is false the second time).
  - `sweepStuck` turns a `publishing` row claimed 16 minutes ago into `failed` "Status tidak pasti, periksa halaman Anda", and leaves one claimed 5 minutes ago alone.
- [ ] **Step 2: Run** `node --test tests/social-runner.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/social/runner.js`, the D1 store, the routes and the `scheduled` export. `runCron` = `sweepStuck` then `runDue`. `mediaUrl = key => \`${PUBLIC_BASE_URL}/api/media/${key}\``.
- [ ] **Step 4: Run** `npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Verify locally:** run `npx wrangler dev --test-scheduled`, then `curl 'localhost:8787/__scheduled?cron=*/5+*+*+*+*'`. Expected: no errors in the log, and a due row with no account becomes `failed`.
- [ ] **Step 6: Commit** `feat(social): publish now and schedule to Facebook/Instagram with cron runner`

---

### Task 5: Office routes (influencers, requests, admin)

**Files:**
- Create: `worker/office.js`
- Modify: `worker/index.js` (`ROUTES`; `/api/office/admin/*` with an `:id` suffix through the same prefix matcher as media)
- Test: `tests/office.test.mjs` (pure validators only)

**Interfaces:**
- Consumes: Task 1 `isAdmin`; Task 3 media upload (influencer photos reuse `POST /api/social/media`).
- Produces:
  - `validateServiceRequest(body) -> { kind, influencer_id, payload } | throws`. For `collab`, `payload` fields are `campaign` (required, ≤ 2000), `budget_range` (required), `timing` (required). For `ads`, they are `service` (required), `location`, `daily_budget` (int 10 000–1 000 000 000), `duration_days` (int 1–90), `goal` (one of `awareness|traffic|leads|messages`), `notes` (≤ 2000).
  - `validateInfluencer(body) -> row | throws`. `name`, `niche` and `city` are required. Follower counts are ints ≥ 0. `visible` is 0/1.
  - Routes:
    - `GET /api/office/influencers` → visible rows `{id,name,photo_key,niche,city,ig_followers,tiktok_followers,bio}`.
    - `POST /api/office/requests` and `GET /api/office/requests` (the caller's own requests, newest first, with influencer name).
    - Admin only (403 "Khusus tim Satu Alur." otherwise): `GET|POST /api/office/admin/influencers`, `PATCH /api/office/admin/influencers/:id`, `GET /api/office/admin/requests` (joined with `users.name, users.email`), `PATCH /api/office/admin/requests/:id {status, admin_note}`.
- [ ] **Step 1: Write the failing tests:**
  - A valid `collab` and a valid `ads` request pass.
  - `ads` with `goal:'viral'` throws "Tujuan iklan tidak dikenal."
  - `collab` without `campaign` throws "Ceritakan kampanye Anda."
  - `validateInfluencer({name:'A'})` throws "Niche wajib diisi."
- [ ] **Step 2: Run** `node --test tests/office.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `worker/office.js` and the routes. A collab `influencer_id` must reference a visible influencer.
- [ ] **Step 4: Run** `npm run test:unit`. Expected: PASS. Then, in `cf:dev`, a non-admin `GET /api/office/admin/requests` → 403.
- [ ] **Step 5: Commit** `feat(office): influencer catalogue and service request inbox`

---

### Task 6: Browser client with demo mode

**Files:**
- Create: `src/social/api.js`, `src/social/image.js`
- Modify: `src/mock/mock-cloud.js`, so the demo session returns `is_admin: true`.
- Test: `tests/social-api.test.mjs` (demo branch, using `tests/helpers/setup.mjs` localStorage)

**Interfaces:**
- Consumes: the Task 3–5 routes; `isUsingMockCloud` from `src/cloud.js`.
- Produces (all async, all throw an `Error` with an Indonesian message):
  - `getAccount() -> { configured, account }`
  - `startConnect() -> void` (navigates to the URL)
  - `listPagesToPick(pick)`
  - `pickPage(pick, pageId)`
  - `disconnect()`
  - `uploadImage(blob) -> key`
  - `mediaUrl(key) -> string`
  - `listContents(kind?)`, `saveContent({ kind, body, title?, image_key? })`, `deleteContent(id)` (through the cloud `database` for `social_contents`, which stays writable)
  - `publishNow(contentId, platforms)`, `schedulePost(contentId, platforms, scheduledAtIso)`, `cancelSchedule(id)`, `listSchedules()`
  - `listInfluencers()`, `sendRequest(body)`, `listMyRequests()`
  - Admin: `adminListInfluencers()`, `adminSaveInfluencer(row)` (creates if there's no id), `adminListRequests()`, `adminUpdateRequest(id, patch)`
  - `toJpeg(file, maxSide = 2048) -> Promise<{ blob, width, height }>` in `image.js`
- Demo branch (mock cloud) stores everything in localStorage `satualur_social_demo_v1`:
  - `startConnect` sets the account to `{page_name:'Demo Page', ig_username:'demo'}` and redraws, with no navigation.
  - `configured` is always true.
  - `publishNow` resolves the rows `posted` with `permalink: 'https://facebook.com/demo/…'` after about 2 seconds, or `failed` "Meta menolak posting (simulasi)." if the content contains `#gagal`.
  - `listSchedules` flips `scheduled` rows whose `scheduled_at <= now` using the same rule.
  - It seeds 6 influencers on first read.
  - `uploadImage` stores an object URL in memory and returns a key.

- [ ] **Step 1: Write the failing tests** (demo branch, forced via `localStorage satualur_use_mock=1`):
  - After `startConnect`, `getAccount().account.page_name === 'Demo Page'`.
  - `schedulePost` then advancing time (pass `now` through an exported `__setNow` for tests) → `listSchedules` shows `posted`.
  - Content with `#gagal` → `failed`.
  - `listInfluencers().length === 6`.
  - `sendRequest({kind:'ads', …})` then `listMyRequests()[0].status === 'new'`.
- [ ] **Step 2: Run** `node --test tests/social-api.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** both files. The HTTP branch reuses the same `call()` shape as `src/leads/api.js`. `uploadImage` sends raw bytes with `Content-Type: image/jpeg`.
- [ ] **Step 4: Run** `npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(social): browser client with demo mode`

---

### Task 7: Tabs Akun + Konten

**Files:**
- Modify: `src/stages/social-media.js` → the tab shell only. The tabs are `account|content|schedule|brainstorm|ads|collab` with the labels from Global Constraints. The shell reads `social`, `social_error` and `social_pick` from the hash query on load, opens the Akun tab when any of them is present, and shows a status message.
- Create: `src/stages/social-media/account.js`, `src/stages/social-media/content.js` (the generator moved from the old `contentTab`, used for both Konten and Brainstorm)
- Test: extend `tests/e2e/social.spec.cjs`

**Interfaces:**
- Consumes: Task 6 client; Task 1 `igEligibility`, `PLATFORMS`.
- Produces: `render(host, ctx)` per tab, where `ctx = { status, signal, getModelId(), account }`. The shell fetches `getAccount()` once and passes it in, and re-fetches after connect or disconnect.
- Behaviour:
  - **Akun:**
    - When `configured` is false: "Integrasi Meta belum dikonfigurasi oleh admin." and a disabled button.
    - When not connected: **Hubungkan Facebook & Instagram**.
    - When connected: the Page name, `@ig` (or the hint "Hubungkan akun Instagram Bisnis ke Page ini" if there's none), and **Putuskan** (with `confirm()`).
    - When `needs_reconnect`: a warn message and **Hubungkan ulang**.
    - When `social_pick` is set: a list of Pages, each with **Pilih**.
    - The "Pindahkan ke akun" import shows once if `satualur_saved_content` or `satualur_schedules` exist in localStorage. Both import as `social_contents` (schedules as `kind:'content'`), then set `satualur_social_migrated=1`.
  - **Konten:**
    - After generating, and on each saved item: **Simpan**, an optional image (`<input type=file accept="image/*">` → `toJpeg` → `uploadImage`), FB/IG checkboxes for connected platforms only, and **Bagikan sekarang** (busy state while it posts; the result toast says Tayang or shows Meta's reason).
    - The IG checkbox is disabled with `igEligibility().reason` as its hint.
    - Not connected → instead of the checkboxes, the link "Hubungkan akun di tab Akun untuk membagikan."
- [ ] **Step 1: Write the failing e2e** (mock cloud): open Social Media → Akun → click Hubungkan → see "Demo Page". Then Konten → type text into a saved item → Simpan → Bagikan sekarang with FB checked → toast "Tayang". The IG checkbox without an image is disabled with "Instagram wajib memakai gambar."
- [ ] **Step 2: Run** `npm run test:e2e -- social`. Expected: FAIL.
- [ ] **Step 3: Implement** the two tabs and the shell.
- [ ] **Step 4: Run** `npm run test:e2e -- social && npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(social): Akun and Konten tabs with save and instant share`

---

### Task 8: Tab Jadwal (Daftar konten + Laporan tayang)

**Files:**
- Create: `src/stages/social-media/schedule.js` (replaces the old `scheduleTab`)
- Test: extend `tests/e2e/social.spec.cjs`

**Interfaces:**
- Consumes: Task 6 `listContents`, `schedulePost`, `listSchedules`, `cancelSchedule`; Task 1 `toUtcIso`, `validateScheduleAt`, `SCHEDULE_STATUS_LABEL`, `igEligibility`.
- Behaviour:
  - There are two segmented sub-tabs: `Daftar konten` and `Laporan tayang`.
  - **Daftar konten:** every content item, each with **Jadwalkan tayang**. That opens a native `<dialog>` with `datetime-local` (min = now + 1 min), FB/IG checkboxes (connected only, with the IG rule), and **Simpan jadwal**. On a validation error the dialog stays open with the message beside the field. The hint is "Tayang dalam ± 5 menit dari waktu yang dipilih."
  - **Laporan tayang:** rows newest first, each showing the platform, local time (`C.formatDateTime`) and a status tag. Tayang has a "Lihat posting ↗" link (`target=_blank rel=noopener`). Gagal shows the error text. Terjadwal has **Batalkan**. The tab refetches on open, and there's a **Muat ulang** button.
- [ ] **Step 1: Write the failing e2e:** Jadwal → Jadwalkan tayang on a saved item → set the time to now + 2 min → Simpan → Laporan shows "Terjadwal". Batalkan → "Dibatalkan". Then a share with `#gagal` content shows "Gagal" and "Meta menolak posting (simulasi)."
- [ ] **Step 2: Run** `npm run test:e2e -- social`. Expected: FAIL.
- [ ] **Step 3: Implement** `schedule.js`.
- [ ] **Step 4: Run** `npm run test:e2e -- social`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(social): schedule posts and live report`

---

### Task 9: Tabs Iklan + Kolaborasi

**Files:**
- Create: `src/stages/social-media/ads.js` (moves the existing `adsTab` helpers and adds the request form), `src/stages/social-media/collab.js` (replaces `partnershipTab`)
- Test: extend `tests/e2e/social.spec.cjs`

**Interfaces:**
- Consumes: Task 6 `listInfluencers`, `sendRequest`, `listMyRequests`, `mediaUrl`; Task 1 `REQUEST_STATUS_LABEL`.
- Behaviour:
  - **Iklan:** the existing audience estimate and hashtag panels stay. A new panel **Ajukan iklan ke tim Satu Alur** has fields matching the Task 5 `ads` payload (goal select labels: Dikenal lebih banyak orang / Kunjungan ke situs / Calon pelanggan / Pesan WhatsApp/Messenger). The button is **Ajukan iklan**, and the success toast is "Permintaan terkirim. Tim Satu Alur akan menghubungi Anda." Below that, "Permintaan saya" lists the `ads` requests with status tags and `admin_note`.
  - **Kolaborasi:** a card grid (photo via `mediaUrl(photo_key)`, or an initials placeholder; name, niche, city, follower counts formatted with `C.number`, and bio). Each card has **Ajukan kolaborasi**, which opens a `<dialog>` with campaign, budget range and timing, then submits a `collab` request. Below the grid, "Permintaan saya" lists the `collab` requests. There's no influencer contact info anywhere.
- [ ] **Step 1: Write the failing e2e:** Kolaborasi shows 6 cards → Ajukan kolaborasi on the first → fill and submit → "Permintaan saya" shows "Baru". Iklan → fill and submit → "Baru".
- [ ] **Step 2: Run** `npm run test:e2e -- social`. Expected: FAIL.
- [ ] **Step 3: Implement** both tabs, and delete the now-unused code in `social-media.js`.
- [ ] **Step 4: Run** `npm run test:e2e -- social`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(social): request Meta ads and influencer collaborations via Satu Alur`

---

### Task 10: Office admin stage

**Files:**
- Create: `src/stages/office.js`
- Modify: `src/ui/shell.js`. Add the stage `{ key: 'office', group: 'growth', label: 'Kantor Satu Alur', sub: 'Influencer & permintaan', icon: 'users', module: StageOffice, adminOnly: true }`, and filter out `adminOnly` stages unless `session.is_admin`. A direct `#/office` without admin falls back to the dashboard.
- Test: `tests/e2e/office.spec.cjs`

**Interfaces:**
- Consumes: Task 6 admin functions, `uploadImage`, `toJpeg`; Task 1 `REQUEST_STATUS_LABEL`.
- Behaviour:
  - **Influencer** tab: a table (name, niche, city, followers, visibility), **Tambah influencer**, and edit, both through a `<dialog>` form with photo upload. Hiding sets `visible=0`.
  - **Permintaan** tab: all requests newest first, filtered by status (default `new`). It shows the business name/email, kind, influencer, payload fields as a `C.defList`, a status select and a note textarea, with **Simpan**.
- [ ] **Step 1: Write the failing e2e** (mock, demo user = admin): the nav shows "Kantor Satu Alur" → add an influencer "Rina" → Social Media › Kolaborasi shows 7 cards. Office › Permintaan → set the first request to "Diproses" → the business's "Permintaan saya" shows "Diproses".
- [ ] **Step 2: Run** `npm run test:e2e -- office`. Expected: FAIL.
- [ ] **Step 3: Implement** the stage and the shell filter.
- [ ] **Step 4: Run** `npm test`. Expected: all unit and e2e PASS. Also run `npm run build`, which should succeed.
- [ ] **Step 5: Commit** `feat(office): admin screen for influencers and requests`

---

### Task 11: Docs

**Files:**
- Modify: `docs/DEMO_SCRIPT.md` (a Social Media walkthrough: connect, share, `#gagal`, schedule, Kolaborasi, Iklan, Kantor), `docs/API.md` (the new endpoints), `docs/DATABASE_SCHEMA.md` (the 0007 tables), `docs/31_CHANGELOG.md`
- [ ] **Step 1: Update** the four docs. Endpoint names and statuses are copied from Tasks 3–5.
- [ ] **Step 2: Run** `npm test`. Expected: PASS.
- [ ] **Step 3: Commit** `docs(social): document Meta publishing and office requests`
