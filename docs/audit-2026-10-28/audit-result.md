# Audit Result — Satu Alur

**Audit date:** 2026-10-28
**Scope:** whole repository (`/workspace/tencent/satu-alur`)
**Test run:** 12 files, 174 tests, 174 passed
**Load assumed:** one owner, one browser, a small team, a few hundred rows per table, no concurrent writers. Cloud backend optional.

What this repo does: Satu Alur is a browser-only service-business app. It runs one flow: request → AI offer → assignment → completion → ledger → report, with a prototype backend in `localStorage` and an optional WorkBuddy cloud backend.

The 174-test suite passes, but it mostly tests helpers and the mock backend, not the business flow.

---

## Must fix

1. **Fresh clone does not start in prototype mode** (`src/cloud.config.example.js:8-16`, `src/cloud.js:10-20`, `scripts/setup.js:19-22`)
   - **What this is:** Setup copies the example config, and `isCloudConfigured()` only checks that endpoint and key are truthy.
   - **Problem:** The example values are `https://your-app.workbuddy.link` and `your-publishable-key-here`, so `isCloudConfigured()` returns `true` (verified). The app calls the real SDK and login fails; README says prototype is the default.
   - **Fix:** Make the example values empty strings, or reject values starting with `your-`. Keep the filled values only as comments.
   - **If we skip it:** Every fresh clone and demo starts broken.

2. **An offer can never be approved** (`src/stages/offer.js:135-154`, `src/stages/assign.js:16-28`, `src/domain/rules.js:34-38`)
   - **What this is:** Saved offers use `createOffer`, which always sets `status: 'draft'`. Assignment only lists offers with `status: 'approved'`.
   - **Problem:** No UI writes `approved` or `rejected`; `canTransition` and `OfferTransitions` are never used. New request → save offer → Penugasan says “Tidak ada penawaran yang disetujui” forever. Only seed data works.
   - **Fix:** Add a “Setujui” action in the offer list and write the status through `OfferTransitions`. One button and one update call.
   - **If we skip it:** The main six-stage flow is broken for real users.

3. **AI report HTML is inserted raw** (`src/stages/report.js:121-127`, `src/stages/settings.js:181-183`)
   - **What this is:** Streaming and final AI output go into `innerHTML`.
   - **Problem:** The model sees customer notes, so a customer can inject `<img src=x onerror="...">` and the model can echo it. The script can read `localStorage`, where the SMTP password and API key are stored.
   - **Fix:** Sanitize to `h3, p, ul, li, strong, br` with `DOMParser`, or render as plain text. No new dependency.
   - **If we skip it:** Stored XSS and credential theft.

4. **Journal can be posted twice and with bad amounts** (`src/stages/bookkeeping.js:97-115`)
   - **What this is:** A ledger row is inserted after only checking that fields are not empty.
   - **Problem:** `-1000000` and `0` are accepted. The same completion and category can be posted many times. Post Rp1.000.000 twice and revenue becomes Rp2.000.000 in the report.
   - **Fix:** Require `Number(amount) > 0`; check for an existing row for `completion_id` + `category` before insert, or add a unique index. Disable already-posted completions.
   - **If we skip it:** Reports are wrong and there is no audit trail.

5. **Boolean attributes are always true** (`src/ui/components.js:8-15`, `src/stages/settings.js:379-385`)
   - **What this is:** `el()` writes every attribute with `setAttribute`.
   - **Problem:** `checked: false` becomes `checked="false"`, which is still checked. `required: false` becomes required. Verified in jsdom. Settings toggles show ON while the saved value is `false`.
   - **Fix:** For `checked`, `selected`, `required`, `disabled`, `readOnly`, assign the DOM property when the value is boolean, and skip when false.
   - **If we skip it:** Settings show the wrong state and future forms block unexpectedly.

6. **Dashboard invents its deltas** (`src/stages/dashboard.js:42-46`)
   - **What this is:** KPI cards show “↑ 12% dari minggu lalu”, “↓ 5% efisiensi”, and “↑ Margin 32%”.
   - **Problem:** These strings are hardcoded. An empty account with Rp0 still shows +12% and 32% margin.
   - **Fix:** Remove the `delta` props, or compute them from current and previous-period totals.
   - **If we skip it:** Users trust trends that do not exist.

7. **Gross profit is labelled net profit** (`src/stages/report.js:52-55,76-78`)
   - **What this is:** “Laba Bersih” is revenue minus direct costs only; the ledger has no opex or tax categories.
   - **Problem:** The 37% gross margin is shown as net profit. Real net after opex and tax is lower.
   - **Fix:** Rename to “Laba Kotor” (one word change) or add opex and tax categories and subtract them.
   - **If we skip it:** Profit decisions use the wrong number.

---

## Should fix

8. **Report period is fake and totals are all-time** (`src/stages/report.js:28-37,65-66`)
   - **What this is:** The period is the hardcoded string “Oktober 2026”; the query selects every ledger row.
   - **Problem:** In 2027 the report still says October 2026, and totals include every year. Two years of entries become one giant “October 2026” report.
   - **Fix:** Derive the period from `posted_at` minimum and maximum, or add a month selector and filter both totals and the AI prompt.
   - **If we skip it:** The financial report cannot be used.

9. **Completion and assignment can disagree** (`src/stages/complete.js:91-100`)
   - **What this is:** It inserts a completion, then updates the assignment, and ignores the update error.
   - **Problem:** If the update fails, the completion exists while the assignment stays `assigned`. The user can complete it again and create duplicate work and ledger rows.
   - **Fix:** Check the update error. Use one RPC transaction if the cloud supports it; otherwise update the assignment first and revert it if the insert fails.
   - **If we skip it:** Duplicate completions and money entries.

10. **Every row triggers extra queries** (`src/stages/offer.js:208-210`, `src/stages/assign.js:34-37,122-127`, `src/stages/complete.js:29-35,127-131`, `src/stages/bookkeeping.js:29-36`)
    - **What this is:** Each list row fetches its related request or offer with a separate query.
    - **Problem:** 300 completions means about 900 sequential requests. At 50 ms each, that is about 45 seconds. Dashboard also loads whole tables on every visit.
    - **Fix:** Load the related tables once and join in memory with maps. Add a limit to the lists.
    - **If we skip it:** The app freezes as the business grows.

11. **Database errors look like zero data** (`src/stages/dashboard.js:11-15`, `src/stages/report.js:29-40`)
    - **What this is:** Dashboard ignores `error`; report logs and continues with zero totals.
    - **Problem:** A network or RLS failure shows Rp0 and empty lists instead of an error. The user may think data was lost.
    - **Fix:** Check `error` and show a message; do not render totals.
    - **If we skip it:** Silent wrong answers.

12. **Blank date crashes assignment** (`src/stages/assign.js:60-64`)
    - **What this is:** `new Date(dateInput.value).toISOString()` runs without checking the value.
    - **Problem:** An empty date gives `RangeError: Invalid time value`. The `required` attribute does nothing because the button is not a submit button.
    - **Fix:** Check `dateInput.value` and show “Pilih jadwal.”
    - **If we skip it:** Users see a confusing crash and cannot assign work.

13. **Settings promise controls that do nothing** (`src/stages/settings.js:302-350,283-291,433-438,446-448`; `src/cloud.js:8-22`; `src/ai/models.js:18-20`)
    - **What this is:** The Cloud tab saves endpoint and key; there is a model preference select; the MCP test button always says OK.
    - **Problem:** Nothing reads the saved cloud settings (grep finds only `settings.js`). `pickDefaultModel()` always returns the first model. The test button never tests anything. Fill in cloud config and the app still runs in prototype mode; choose GPT-4o Mini and the first model is used.
    - **Fix:** Delete the Cloud tab and model select, or wire them. Remove the fake test button or make it real.
    - **If we skip it:** Users trust settings that have no effect.

14. **Particle loop runs forever on a removed canvas** (`src/ui/app.js:33-35,53`, `src/ui/animations.js:8-65`)
    - **What this is:** `mountApp` adds a canvas, then `render()` clears the root. The cleanup function is returned but never called.
    - **Problem:** The canvas is detached, but the animation loop keeps drawing 30 particles every frame for the life of the tab. The resize listener also leaks.
    - **Fix:** Delete the particle feature (smallest), or keep the canvas outside the cleared root and call cleanup on unmount.
    - **If we skip it:** The idle app wastes CPU and battery.

15. **Mock database can wipe a table by accident** (`src/mock/mock-cloud.js:219-233`)
    - **What this is:** `update()` and `delete()` with no filter match every row.
    - **Problem:** Supabase rejects unfiltered updates and deletes; the mock silently wipes data. A future missing `.eq()` passes tests and destroys local data. `from('requests').delete()` clears all requests.
    - **Fix:** Throw when `filters.length === 0` for update and delete.
    - **If we skip it:** Silent local data loss.

16. **Money paths have no tests** (`tests/unit/stages-write-path.test.js:1-124`, `testing.md:120-125`)
    - **What this is:** Stage tests cover only request and offer writes.
    - **Problem:** Duplicate posting, negative amounts, the completion transaction, and report totals have no failing test. The suite is green while findings 4, 7, 8, and 9 exist.
    - **Fix:** Add one test each for bookkeeping (duplicate + negative), complete (failed update), and report (period and totals).
    - **If we skip it:** These bugs will come back unnoticed.

17. **Login adds an OTP listener on every render** (`src/ui/app.js:92-97`)
    - **What this is:** The `mock-otp-sent` listener is added inside `renderLogin`.
    - **Problem:** Every logout and login adds another listener. Old listeners keep detached inputs alive. Twenty cycles leave twenty listeners.
    - **Fix:** Add the listener once at module level, or remove it when the login form is discarded.
    - **If we skip it:** A small memory leak, with no visible break.

---

## Nice to have

18. **Dead helpers and exports** (`src/ui/animations.js:78-80,103-116`, `src/stages/settings.js:368-377`, `src/stages/offer.js:23`, `src/stages/report.js:18`, `src/mock/mock-cloud.js:240-242`)
    - **What this is:** `pulseEffect`, `typewriterEffect`, `createTextArea`, and two `models` variables are never used. `rpc`, storage, and the `reports` table are unused by the app.
    - **Problem:** Extra code to read and maintain. Readers assume photo storage and saved reports exist, but they do not.
    - **Fix:** Delete the unused helpers and imports. Either use storage for photos or remove it from the docs.
    - **If we skip it:** More code, more confusion.

19. **Two form component systems** (`src/stages/settings.js:343-431` vs `src/ui/components.js:53-110`)
    - **What this is:** Settings has its own `createField`, `createToggle`, `createSlider`, and `createSelect`; components has the shared field helpers.
    - **Problem:** They are near-copies. The label fix for `htmlFor` only landed in `el`, so future fixes must be made twice. About 90 lines duplicate.
    - **Fix:** Add slider and toggle to `components.js` and delete the settings helpers.
    - **If we skip it:** Fixes drift apart.

20. **Tests and dev container are not committed** (`git status`, `.gitignore:3-4`, `README.md:152`)
    - **What this is:** `tests/`, `vitest.config.js`, and `testing.md` are untracked; `.devcontainer` is ignored.
    - **Problem:** A clone has no test suite and no dev container, while README says `npm test` runs 174 tests and the dev container is available.
    - **Fix:** `git add tests vitest.config.js testing.md`; remove `.devcontainer` from `.gitignore` and commit it.
    - **If we skip it:** Users cannot run the tests or the documented dev setup.

---

Left out: 4 smaller findings (mock `like()` ignores prefix matches, mock OTP never expires, report explanation is not saved, mock data is not scoped per owner).

**Verdict:** Not healthy. Fix 1–5 first; without 1–2 the six-stage flow does not work, and 3–4 can leak credentials or corrupt money.

**Lean:** -300 lines, -0 dependencies possible.

**Not checked:** `src/styles.css` visual details, the full AntiSlop validation logic, the full `docs/API.md` and `docs/DATABASE_SCHEMA.md`, the built `dist` bundle, `package-lock.json` transitive packages, the real WorkBuddy SDK over the network, and browser E2E. I also did not run `npm run build`.
