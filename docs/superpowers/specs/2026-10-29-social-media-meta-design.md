# Social Media: Meta connect, publishing, scheduling, office-brokered services

Date: 2026-10-29 · Status: draft for approval

## Why

The Social Media menu (`src/stages/social-media.js`) today only writes AI content and keeps notes in the browser's localStorage. Nothing reaches Facebook or Instagram. The owner wants businesses to connect their own Facebook/Instagram, post or schedule content straight from Satu Alur, and see whether each post went live. Influencer collaborations and Meta ads stay a paid Satu Alur office service: businesses can only request them, and the office handles everything else.

## Decided by the owner

- Only Facebook and Instagram. Remove TikTok, LinkedIn and X from the platform choices.
- The OAuth connection lives inside the Social Media menu. Content publishing is only available once a connection exists.
- **Konten:** each piece of content gets a **Simpan** button and a **Bagikan sekarang** button for Facebook and/or Instagram, limited to the providers that are connected.
- **Jadwal:** a list of all saved items. Each has a **Jadwalkan tayang** button that opens a date-and-time dialog and saves to the scheduler. A **Laporan tayang** tab shows whether each post went live or failed.
- **Kolaborasi:** the list of influencers Satu Alur provides. A business can only contact the Satu Alur office about them, never the influencer directly.
- **Iklan Meta:** request-only through the Satu Alur office. Fields plus a request button.
- The Satu Alur office manages the influencer list and the requests from an admin screen.
- The owner will supply the Meta developer app (App ID/secret, app review) later. The build must be real (not a demo) and work end to end once those details are configured.

## Calls made by Claude (owner may override)

- **Each business connects its own Facebook Page.** Data is already scoped by `owner_id`. The Instagram account is the IG Business/Creator account linked to that Page, which is how Meta's publishing API works.
- **Admin = email allow-list.** `ADMIN_EMAILS` (comma-separated) in the worker vars. There is no roles table.
- **Office notification = the in-app Permintaan inbox only.** No email or WhatsApp for now.
- **Instagram requires an image.** Facebook can post text only, or text with an image.
- **Image hosting:** an R2 bucket bound as `MEDIA`. The worker serves images at a public, unguessable URL (`/api/media/<random key>`) so Meta can fetch them.
- **Scheduler:** a Worker Cron Trigger every 5 minutes. A post can therefore go out up to about 5 minutes late. The UI says "± 5 menit".
- **Tab names** follow the owner's wording: Akun, Konten, Jadwal, Brainstorm (kept), Iklan, Kolaborasi.
- The existing rule-based audience estimate and hashtag maker stay in the Iklan tab as helpers, above the request form.

## Goals

1. A business connects its Facebook Page (plus the linked IG) in one OAuth round trip and can disconnect.
2. Saved content lives in D1 (`social_contents`), not localStorage.
3. Post now, or schedule to FB and/or IG. Each platform gets its own result row, with the live post link or Meta's error.
4. Influencer catalogue and request inbox, managed by the office. Businesses see the status of their own requests.
5. Mock cloud (dev/demo) runs the whole flow without Meta: a fake connect, and publishing that succeeds (or fails for a test caption) after a delay.

## Non-goals

- TikTok, LinkedIn, X, Threads, and IG Stories/Reels/carousels (single-image feed posts only).
- Creating or paying for Meta ads from the app.
- Analytics such as likes and reach.
- Editing or deleting posts on Meta after they are published.
- Email or WhatsApp alerts.
- Multiple Pages per business (one connection per business; reconnecting replaces it).

## Anti-goals (a failure even if it "works")

- Meta access tokens reaching the browser, appearing in logs, or being returned by the generic `/api` table endpoint.
- The same post going out twice (cron retry, double click).
- A business seeing influencer contact details or another business's requests.
- Silently dropping a failed post. Every failure shows in Laporan tayang with a reason.

## How it works

### Data (new migration `0007_social_meta.sql`)

- `social_accounts`: `owner_id` (unique), `page_id`, `page_name`, `page_token_enc`, `ig_user_id`, `ig_username`, `token_expires_at`, `connected_at`. The token is encrypted with AES-GCM using the `TOKEN_KEY` secret. **This table is not in the worker's `TABLES` whitelist.** Only dedicated endpoints read it, and they return just names and handles.
- `social_contents`: reuse. Add `image_key` (R2 key, nullable).
- `social_schedules`: reuse, extended. Add `content_id`, `image_key`, `platform_post_id`, `permalink`, `error`, `attempts`, `published_at`. The statuses become `scheduled | publishing | posted | failed | cancelled`. A "Bagikan sekarang" is a row with `scheduled_at = now` that is published immediately in the request (not by cron), so the report covers both.
- `influencers`: `id`, `name`, `photo_key`, `niche`, `city`, `ig_followers`, `tiktok_followers`, `bio`, `visible`, `created_at`. This is global, with no `owner_id`, and is admin-written only.
- `service_requests`: `id`, `owner_id`, `kind` (`collab|ads`), `influencer_id` (nullable), `payload_json`, `status` (`new|in_progress|done`), `admin_note`, `created_at`, `updated_at`.

### Worker endpoints (all under the existing session auth)

- `GET /api/social/account`: the connection summary, or null, plus `configured: bool` (whether the Meta app vars exist).
- `GET /api/social/oauth/start`: redirects to the Facebook Login dialog. The scopes are `pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management`. The `state` is signed and bound to the session.
- `GET /api/social/oauth/callback`: exchanges the code for a long-lived user token, then gets the Page token (Page tokens from long-lived user tokens don't expire), reads the linked IG account, stores it, and redirects back to the Social Media › Akun tab. If the user has several Pages, *my call:* show a picker step (the callback redirects with a short-lived selection token, and the UI lists the Pages).
- `DELETE /api/social/account`: disconnect.
- `POST /api/social/media`: upload an image (JPEG/PNG, ≤ 8 MB) to R2 and return its key. `GET /api/media/:key` serves it publicly.
- `POST /api/social/publish` `{content_id, platforms[]}`: creates one schedule row per platform and publishes now.
- `POST /api/social/schedule` `{content_id, platforms[], scheduled_at}`: creates the rows. `scheduled_at` must be in the future and no more than 75 days out (*my call*).
- `DELETE /api/social/schedule/:id`: cancel. Only allowed while the status is `scheduled`.
- `GET /api/influencers`: visible influencers, without admin-only fields.
- `POST /api/requests/service`: create a collab or ads request. `GET` lists the caller's own requests.
- Admin (rejected with 403 unless the email is in `ADMIN_EMAILS`): CRUD on `/api/admin/influencers`, `GET/PATCH /api/admin/requests`.

`social_schedules` and `social_contents` remain readable through the generic table API for listing. Writes that touch publishing state go only through the endpoints above.

### Publishing

- Facebook: `POST /{page_id}/feed` (text) or `/{page_id}/photos` (with an image URL).
- Instagram: `POST /{ig_user_id}/media` (image_url, caption), then `/{ig_user_id}/media_publish`, then fetch the `permalink`.
- **No double posts:** before calling Meta, the worker claims a row with `UPDATE … SET status='publishing' WHERE id=? AND status='scheduled'` and only proceeds if exactly one row changed.
- The cron (`scheduled` handler in `worker/index.js`, `[triggers] crons = ["*/5 * * * *"]`) picks rows with `status='scheduled' AND scheduled_at <= now`, at most 25 per run.
- Failure handling: a transient Meta error (5xx, rate limit) puts the row back to `scheduled` with `attempts+1`, up to 3 attempts. Anything else, or the last attempt, sets `failed` with Meta's message in `error`. A token error also marks the account as needing reconnection, and the Akun tab shows "Hubungkan ulang".
- A row stuck in `publishing` for more than 15 minutes is marked `failed` ("Status tidak pasti, periksa halaman Anda") rather than retried, because retrying could double-post.

### UI (`src/stages/social-media.js`, split into a file per tab if it grows past roughly 400 lines)

- **Akun:** the connect button, or "Belum dikonfigurasi" if Meta vars are missing. When connected, it shows the Page name, the @ig handle, a Putuskan button, and a Hubungkan ulang button when the token is invalid.
- **Konten:** the generator as today. The result and saved items each get Simpan, an optional image, and Bagikan sekarang with FB/IG checkboxes (only connected ones; IG is disabled without an image, with a hint). Without a connection, it shows a short link to the Akun tab instead of the share button.
- **Jadwal:** two sub-tabs.
  - *Daftar konten:* all saved items, each with Jadwalkan tayang. That opens a dialog with date and time inputs (device timezone, stored as ISO UTC) and platform checkboxes.
  - *Laporan tayang:* every schedule row, newest first, with a status tag (Terjadwal / Memproses / Tayang ↗ link / Gagal + reason / Dibatalkan) and a Batalkan action while Terjadwal. It refreshes when the tab opens, and there's a manual Muat ulang button.
- **Iklan:** the existing helpers, then a request form (layanan, lokasi, anggaran harian, durasi hari, tujuan iklan, catatan) and an **Ajukan iklan** button. Below that is "Permintaan saya" with statuses.
- **Kolaborasi:** an influencer card grid (photo, name, niche, city, follower counts, bio). There is no contact info or price. **Ajukan kolaborasi** opens a dialog (campaign description, budget range, timing) and submits a `collab` request. The list of own requests and their statuses is shown below the grid.
- **Admin screen:** a new route visible only to admins (*my call:* a "Kantor Satu Alur" item in the shell nav). It has an Influencer tab (add/edit/hide with photo upload to R2) and a Permintaan tab (all businesses' requests, with business name/email, status change, and note).
- Existing localStorage data (`satualur_saved_content`, `satualur_schedules`) is offered as a one-time "Pindahkan ke akun" import, then left alone. **Old schedules are imported as saved content only, never as `scheduled` rows**, so nothing posts by surprise. *My call.*

### Builder-check calls (Claude's, owner may override)

- **Page change and pending posts:** each schedule row stores the `page_id` it was made for. At publish time, the worker checks it against the current connection. If the business is disconnected or now connected to a different Page, the row is marked `failed` with "Akun Facebook berubah atau terputus, jadwalkan ulang". Reconnecting to the same Page keeps pending posts working. Putuskan does not delete rows.
- **Images:** the browser re-encodes every upload to JPEG before sending it. The upload endpoint accepts JPEG only. If the aspect ratio is outside Instagram's limits (4:5 to 1.91:1), the IG checkbox is disabled with a hint. Facebook is still allowed.
- **OAuth start:** auth is a Bearer token, not a cookie, so `POST /api/social/oauth/start` returns the Facebook URL as JSON, and the browser then navigates to it. The callback trusts only the signed, short-lived `state` (which carries `owner_id`).
- **Generic table API:** `social_schedules` becomes read-only there. All writes go through the `/api/social/*` endpoints.
- `social_accounts` gets a `needs_reconnect` column for the "Hubungkan ulang" state.
- The admin Permintaan list shows a business's name and email, since that's all `users` stores.
- **Meta Login for Business details** (`config_id`, advanced access) are confirmed when the owner supplies the app.

### Config

- Vars: `META_APP_ID`, `ADMIN_EMAILS`, `PUBLIC_BASE_URL` (for OAuth redirects and media URLs).
- Secrets: `META_APP_SECRET`, `TOKEN_KEY`.
- Bindings: the R2 bucket `MEDIA`, plus a cron trigger.
- Document all of these in `docs/16_CONFIG_REFERENCE.md`, along with Meta app setup steps: the redirect URI `${PUBLIC_BASE_URL}/api/social/oauth/callback`, the required permissions, and the note that app review is needed for businesses other than the app's testers.

### Mock cloud (`src/mock/mock-cloud.js`)

The mock implements the same calls:
- Connect fakes "Demo Page / @demo".
- Publish resolves to `posted` with a fake permalink after about 2 seconds. A caption containing `#gagal` fails, to demo the failure path.
- Scheduled rows flip when their time passes, checked when the Jadwal tab is opened.
- It seeds about 6 influencers. The admin screen is shown in mock mode for the demo user.

## Testing

- Unit: the publish-claim/retry state machine, schedule validation (past or too far ahead), and the admin guard.
- Worker tests with Meta `fetch` stubbed for FB text, FB photo, the IG two-step flow, a transient error then success, and a token error.
- A mock-cloud click-through of Akun → Konten share → Jadwal → Laporan, plus a request for each kind.

## Left to the builder

File and module layout, component reuse (`C.*`), exact copy, dialog implementation, polling details, and test file placement.
