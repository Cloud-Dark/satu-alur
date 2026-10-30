# Threads publishing in Media Sosial: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Businesses can connect a Threads account in Media Sosial › Akun and publish or schedule posts to Threads, exactly as they already can for Facebook and Instagram. Results show in Laporan tayang. The AI content generator can write in Threads style.

**Context:**
- The owner asked to bring Threads support from the upstream fork into the merged Media Sosial menu, with **real auto-posting**, and to add **Threads only**. The fork's other "Akun terhubung" platforms (TikTok, LinkedIn, WhatsApp, X) stay out.
- The fork's `src/stages/social-accounts.js` stored handles locally for "Salin & buka" and is unused since the menu merge. Remove it and its test once nothing references it.
- The fork's Threads style rule in `src/ai/social-agent.js` (500 characters, at most 1 topic tag, short and conversational) is the source for the AI prompt style.

**Architecture:**
- Threads is a separate OAuth connection from the Facebook Page, using the Threads API (`graph.threads.net`, v1.0).
- It reuses every existing safeguard:
  - signed OAuth state plus a one-time `__Host-` nonce cookie;
  - tokens encrypted with `TOKEN_KEY`;
  - `isConfigured`/`DEMO_OTP` gating and the demo-account 403;
  - suspension cancelling scheduled posts;
  - claim-before-publish so a post never goes out twice;
  - ambiguous final-publish failures marked "Status tidak pasti" and never retried.
- Threads publishes from a container: create the container, then publish it, then fetch the permalink, the same shape as Instagram.

## Global Constraints

- **Config:** var `THREADS_APP_ID`, secret `THREADS_APP_SECRET`. Threads is "configured" only when these, `TOKEN_KEY` and `PUBLIC_BASE_URL` are set **and** `DEMO_OTP !== 'true'`. It is independent of the Facebook config.
- **OAuth:**
  - authorize at `https://threads.net/oauth/authorize?client_id&redirect_uri&scope=threads_basic,threads_content_publish&response_type=code&state`;
  - redirect URI `${PUBLIC_BASE_URL}/api/social/threads/callback`;
  - exchange the code at `POST https://graph.threads.net/oauth/access_token` (`client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`), which returns a short-lived token and `user_id`;
  - get a long-lived token with `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret&access_token`, which returns `access_token` and `expires_in` (about 60 days);
  - read the profile with `GET https://graph.threads.net/v1.0/me?fields=id,username`.
- **Refresh:** `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token`.
  - The cron refreshes tokens expiring within 10 days, at most 20 per run, and stores the new expiry.
  - A refresh failure classified as `token` sets `threads_needs_reconnect = 1`.
- **Publish:**
  1. `POST https://graph.threads.net/v1.0/{threads_user_id}/threads` with `media_type=TEXT|IMAGE`, `text`, and `image_url` for IMAGE. This creates the container.
  2. If the container isn't ready, poll `GET /{container}?fields=status` up to 5 times about 1.5 s apart: `FINISHED` means publish, `ERROR` or `EXPIRED` is fatal ("Threads menolak konten ini."), and still not finished after polling is transient and not ambiguous.
  3. `POST /{threads_user_id}/threads_publish` with `creation_id`. This is the final publish call: an ambiguous failure here follows the same rules as Facebook/Instagram.
  4. `GET /{id}?fields=permalink`. A failure here never fails the post.
- **Error classes:** reuse `classifyMetaError` (code 190 means `token`; HTTP 5xx and rate-limit codes are `transient`; anything else is `fatal`). Never log or return tokens.
- **Content rules:** text is 1–500 characters with at most 1 hashtag. The image is optional, uses the existing JPEG pipeline, and has no aspect-ratio limit beyond the 10:1 the API allows. Add a `threadsEligibility({ caption, hasImage })` helper next to `igEligibility`. The messages are "Threads maksimal 500 karakter." and "Threads maksimal 1 tag topik."
- **Data** (migration 0007, unreleased, edit in place):
  - add `threads_user_id`, `threads_username`, `threads_token_enc`, `threads_expires_at`, `threads_needs_reconnect INTEGER NOT NULL DEFAULT 0` to `social_accounts`;
  - make `page_id` nullable, so a business can connect Threads without a Facebook Page. Check what this touches;
  - in `social_posts`, `page_id` stores the **target account id**: the Facebook Page id for `facebook`/`instagram`, and the `threads_user_id` for `threads`. The page-mismatch check compares against the matching account per platform;
  - `PLATFORMS` becomes `['facebook','instagram','threads']`.
- **API shape:** `GET /api/social/account` adds `threads_username`, `threads_connected`, `threads_needs_reconnect` and `threads_configured`. It never includes tokens.
- **Routes:**
  - `POST /api/social/threads/start` returns `{ url }` and sets the nonce cookie;
  - `GET /api/social/threads/callback` redirects with `social=threads_connected` or `social_error`, using the same known-message rule as today;
  - `DELETE /api/social/threads` disconnects;
  - publish and schedule accept `threads`.
- **UI:**
  - The Akun tab gets a Threads card (Hubungkan Threads / connected as @username / Putuskan / Hubungkan ulang / "belum dikonfigurasi").
  - Konten and Jadwal show a Threads checkbox only when Threads is connected, with the `threadsEligibility` reason as the hint.
  - Laporan tayang labels the platform "Threads".
  - The AI generator offers Threads as a target platform with the fork's style rule. All copy is Indonesian and every string is rendered as text only.
- **Mock:** connecting Threads fakes `@demo.threads`; publishing resolves to posted with permalink `https://www.threads.net/@demo.threads/post/demo<id>`, and `#gagal` fails it.

## Review Focus
1. **Tokens never leave the Worker:** check responses, logs and `/api/db`, including the refresh path.
2. **OAuth CSRF and login-CSRF on the Threads flow:** same nonce binding as Facebook. A Threads callback must not be able to complete a Facebook flow, or the other way round. Use a distinct state purpose.
3. **No double post:** the Threads final publish uses the existing claim and ambiguous-failure rules, covered by runner tests.
4. **Suspension and demo accounts:** suspended owners' Threads posts are cancelled, the cron skips them, and demo accounts can't connect Threads.
5. **A Facebook-only, Threads-only or both-connected business:** every combination renders correctly and publishes only to connected platforms. Disconnecting one doesn't touch the other.

---

### Task 1: Threads connection and publishing (server, client, UI)

**Files:**
- Modify:
  - `src/social/meta.js`: add Threads OAuth URL, code exchange, long-lived exchange, refresh, profile, `postThreads(...)`, and container polling with an injectable wait.
  - `src/social/rules.js`: `PLATFORMS`, `threadsEligibility`, labels.
  - `src/social/runner.js`: publish dispatch per platform, using the account for Threads.
  - `worker/social.js`: account read/write, start, callback, disconnect, publish/schedule validation, cron refresh, and the `listDue` account match.
  - `worker/index.js`: routes.
  - `migrations/0007_social_meta.sql`.
  - `src/social/api.js`: client and mock.
  - `src/stages/social-media/account.js`, `content.js`, `schedule.js`, `platforms.js`.
  - The AI content generator's platform list.
  - `docs/16_CONFIG_REFERENCE.md`: Threads app setup (redirect URI, scopes, vars).
- Remove `src/stages/social-accounts.js` and `tests/social-accounts.test.mjs` if nothing else imports them (verify with grep first).
- Tests:
  - unit (`tests/social-meta.test.mjs`, `tests/social-runner.test.mjs`, `tests/social-rules.test.mjs`): the Threads exchange URLs and bodies, publish call order, container polling outcomes, ambiguous final publish, permalink failure tolerated, refresh, `threadsEligibility` limits, and runner dispatch with the `page_id` mismatch for Threads;
  - e2e (`tests/e2e/social-media.spec.cjs`): connect Threads in demo, share text-only to Threads, see Tayang with a link, `#gagal` fails, a Threads-only business sees no FB/IG boxes, and disconnecting Threads leaves Facebook connected.
- [ ] Step 1: write the failing tests.
- [ ] Step 2: run them and confirm they FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run unit, the e2e for `social-media`, `office` and `support`, the build, and the full e2e (the known failures are 2 `[flow] assign` and the 1 leaflet failure in leads). Then on local wrangler:
  - start → returns a URL plus the cookie;
  - callback without the cookie → `social_error`;
  - a Threads-only account row → schedule a threads post, then cron with no Meta reachable → handled; a mismatched `threads_user_id` → "Akun … berubah";
  - the token never appears in `GET /api/social/account`.
- [ ] Step 5: commit `feat(social): publish and schedule to Threads`.
