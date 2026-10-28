# Manajemen Petugas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker (petugas) CRUD stored in Cloudflare D1, and team assignments that pick one or more workers from that list with automatic recommendations.

**Architecture:**
- **Database:** a new migration adds `workers`, a join table `assignment_workers` and `requests.requested_at`.
- **API:** the generic `/api/db` Worker API exposes the new tables through its `TABLES` whitelist.
- **Pure logic** (skill inference, scoring, status, delete rules) lives in `src/domain/workers.js` and is unit-tested with plain Node.
- **Data access** (load/save/deactivate, two-step team save with rollback) lives in `src/stages/workers-repo.js` and is tested against the mock cloud through Vite SSR, following the existing pattern.
- **UI:** `src/stages/assign.js` (already rewritten but uncommitted) is rewired onto these modules.

**Tech Stack:** vanilla ES modules, Vite 5, Cloudflare Worker + D1 (`wrangler`), `node:test`.

**Spec:** `docs/specs/2026-10-28-petugas-management-design.md`

## Global Constraints

- `workers.status` is only `'active'` or `'inactive'`. The other statuses (Tersedia, Dalam tugas, Nonaktif) are derived and never stored.
- Without coordinates on **both** the worker and the job, distance is excluded from the score and no "km" is shown. Never use default/fake coordinates.
- `assignments.worker_name` is always written as the selected workers' names joined with `', '`.
- A worker linked to any `assignment_workers` row is never deleted, only set `inactive`.
- "Same day" and "today" use the device's local time zone.
- `geocode(address)` returns `{ lat, lng, zone }` or `null` and never throws. In this plan it always returns `null`.
- UI copy is Indonesian and follows existing labels and house components (`C.*` from `src/ui/components.js`). No new dependencies.
- Migration `0003` must be applied before deploying the Worker.

## Review Focus

1. **Browser already seeded before this change** (`_seeded` true, no `workers` key). Workers and links must still appear after reload. → test in Task 3.
2. **Team-link insert fails after the assignment insert.** No assignment may remain without workers. → test in Task 3.
3. **Double-click on "Tugaskan".** Exactly one assignment must be created. → submit button disabled while saving, Task 6 smoke step.
4. **Service type that matches no skill keyword** (e.g. "Ducting & Exhaust Cleaning"). Workers must not all be scored as a full match. → test in Task 2.
5. **Worker deactivated after being assigned.** Old assignments still show their names, and the worker is hidden from new-assignment choices. → test in Task 2 (`activeWorkers`) and Task 6 smoke step.

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/0003_workers.sql` (create) | Schema: `workers`, `assignment_workers`, `requests.requested_at` |
| `worker/index.js` (modify `TABLES`, ~line 38) | Whitelist the new tables/columns and FKs |
| `src/domain/workers.js` (create) | Pure logic: skills, scoring, status, delete rule, name join |
| `src/geo.js` (create) | `geocode` integration seam (stub) |
| `src/stages/workers-repo.js` (create) | Cloud reads/writes for workers and team assignments |
| `src/mock/mock-cloud.js` (modify seed ~line 700–775) | Seed workers/links matching the schema; top-up when empty |
| `src/stages/request.js` (modify) | "Jadwal yang diminta klien" field → `requested_at` |
| `src/stages/assign.js` (modify, uncommitted version) | Tim tab CRUD, Tugaskan multi-select, minimal Peta/Performa fixes |
| `docs/DEMO_SCRIPT.md` (modify) | Penugasan step uses checked team members |
| `tests/workers-domain.test.mjs`, `tests/workers-repo.test.mjs` (create) | Tests |

---

### Task 1: Schema and API whitelist

**Files:**
- Create: `migrations/0003_workers.sql`
- Modify: `worker/index.js` (`TABLES`)

**Interfaces:**
- Produces: tables `workers(id, owner_id, name, phone, address, skills JSON, lat, lng, zone, status, created_at)`, `assignment_workers(id, owner_id, assignment_id, worker_id, created_at)` with `UNIQUE(assignment_id, worker_id)`, and the column `requests.requested_at`.

- [ ] **Step 1: Write the migration.** Copy the SQL block from the spec's "Migrasi `0003_workers.sql`" section verbatim.

- [ ] **Step 2: Update `TABLES`:**
  - Add `workers`: `columns: ['id','owner_id','name','phone','address','skills','lat','lng','zone','status','created_at']` and `json: ['skills']`.
  - Add `assignment_workers`: `columns: ['id','owner_id','assignment_id','worker_id','created_at']` and `fks: { assignment_id: 'assignments', worker_id: 'workers' }`.
  - Add `'requested_at'` to `requests.columns`.

- [ ] **Step 3: Apply locally.**
  Run: `npm run db:migrate:local`
  Expected: `0003_workers.sql` listed as applied, no errors.

- [ ] **Step 4: Verify the schema.**
  Run: `npx wrangler d1 execute satu-alur-db --local --command "SELECT name FROM sqlite_master WHERE name IN ('workers','assignment_workers')"`
  Expected: both names returned.

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_workers.sql worker/index.js
git commit -m "feat(db): Add workers and assignment_workers tables"
```

---

### Task 2: Pure worker logic

**Files:**
- Create: `src/domain/workers.js`
- Test: `tests/workers-domain.test.mjs` (import the module directly with a relative path; it must have no imports itself)

**Interfaces:**
- Produces:
  - `SKILL_LABELS` — move the existing object out of `assign.js` unchanged.
  - `inferSkill(serviceType: string) => string | null` — `null` when no keyword matches. Keep the existing keyword map and drop the `'cleaning'` fallback.
  - `sameLocalDay(a: string|Date, b: string|Date) => boolean`
  - `activeWorkers(workers) => worker[]` — `status === 'active'`.
  - `workerState(worker, assignments, links, now = new Date()) => 'inactive' | 'on_job' | 'available'`
  - `completedCount(workerId, links, completions) => number`
  - `hasHistory(workerId, links) => boolean`
  - `joinWorkerNames(workers) => string` — names joined by `', '`.
  - `scoreWorkers({ workers, job: { skill, lat, lng, scheduledAt }, assignments, links, excludeAssignmentId? }) => Array<{ worker, skillMatch: 'full'|'partial'|'none'|'unknown', clash: boolean, distanceKm: number|null, score: number, reasons: string[] }>`, sorted by `score` desc. Only active workers. `distanceKm` is `null` unless both the worker and the job have lat/lng.
  - `pickRecommended(scored, n) => worker[]` — the first `n` with `!clash` and `skillMatch` in `full`/`partial`. If fewer exist, take the best remaining non-clashing workers. Never returns clashing workers.
  - `haversine(lat1, lng1, lat2, lng2) => number` — move it out of `assign.js` unchanged.
  - **Assignments** are rows with `{ id, scheduled_at, status }`. **Links** are `assignment_workers` rows. **Completions** are rows with `assignment_id`.

- [ ] **Step 1: Write the failing tests**

```js
test('inferSkill returns null for unmatched service', () => {
  assert.equal(inferSkill('Ducting & Exhaust Cleaning'), null)
  assert.equal(inferSkill('Service AC split'), 'ac')
})
test('scoreWorkers: no coordinates → no distance', () => {
  const [s] = scoreWorkers({ workers: [W({ id: 1, skills: ['ac'] })], job: { skill: 'ac', scheduledAt: DAY }, assignments: [], links: [] })
  assert.equal(s.distanceKm, null)
  assert.ok(!s.reasons.some((r) => /km/.test(r)))
})
test('scoreWorkers: same-day assigned job marks clash and ranks lower', () => {
  const workers = [W({ id: 1, skills: ['ac'] }), W({ id: 2, skills: ['ac'] })]
  const assignments = [{ id: 9, scheduled_at: DAY, status: 'assigned' }]
  const links = [{ assignment_id: 9, worker_id: 1 }]
  const out = scoreWorkers({ workers, job: { skill: 'ac', scheduledAt: DAY }, assignments, links })
  assert.deepEqual(out.map((s) => s.worker.id), [2, 1])
  assert.equal(out[1].clash, true)
})
test('scoreWorkers: unknown skill is not a full match', () => {
  const [s] = scoreWorkers({ workers: [W({ id: 1, skills: ['ac'] })], job: { skill: null, scheduledAt: DAY }, assignments: [], links: [] })
  assert.equal(s.skillMatch, 'unknown')
})
test('scoreWorkers excludes inactive workers', () => {
  const out = scoreWorkers({ workers: [W({ id: 1, status: 'inactive' })], job: { skill: 'ac', scheduledAt: DAY }, assignments: [], links: [] })
  assert.equal(out.length, 0)
})
test('pickRecommended skips clashing workers', () => { /* 3 workers, best one clashing; n=2 → the other two */ })
test('hasHistory and joinWorkerNames', () => {
  assert.equal(hasHistory(1, [{ assignment_id: 9, worker_id: 1 }]), true)
  assert.equal(hasHistory(2, [{ assignment_id: 9, worker_id: 1 }]), false)
  assert.equal(joinWorkerNames([{ name: 'Ahmad' }, { name: 'Budi' }]), 'Ahmad, Budi')
})
test('workerState: inactive, on_job today, available', () => { /* one assertion per state */ })
```

`W(overrides)` builds `{ id, name: 'X', skills: [], status: 'active', lat: null, lng: null, ...overrides }`. `DAY` is a fixed ISO string for 08:00 local time.

- [ ] **Step 2: Run the tests to confirm they fail**
  Run: `node --test tests/workers-domain.test.mjs`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/domain/workers.js`.** Score priority is skill > clash > distance. The weights are yours to choose. When `distanceKm` is `null`, the distance weight is redistributed to the other components. `reasons` are short Indonesian phrases, e.g. `'Keahlian cocok'`, `'Bentrok: ada tugas di hari yang sama'`, `'3,2 km'`.

- [ ] **Step 4: Run the tests to confirm they pass**
  Run: `node --test tests/workers-domain.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/workers.js tests/workers-domain.test.mjs
git commit -m "feat(domain): Add worker scoring, status and delete rules"
```

---

### Task 3: Geocode seam, repository, mock seed

**Files:**
- Create: `src/geo.js`
- Create: `src/stages/workers-repo.js`
- Modify: `src/mock/mock-cloud.js` (seed)
- Test: `tests/workers-repo.test.mjs` (same Vite SSR + mock setup as `tests/ai-integration.test.mjs`)

**Interfaces:**
- Consumes: `hasHistory`, `joinWorkerNames` (Task 2).
- Produces:
  - `geocode(address: string) => Promise<{lat, lng, zone} | null>` in `src/geo.js` — returns `null` always for now. Comment: the teammate's MapsEncoder integration goes here.
  - In `src/stages/workers-repo.js`:
    - `loadWorkers() => Promise<worker[]>`
    - `loadLinks() => Promise<link[]>`
    - `saveWorker(fields: { id?, name, phone, address, skills, status? }, previous?: worker) => Promise<void>` — insert when there is no `id`, otherwise update. When `address` differs from `previous?.address`, call `geocode`: write its `lat`/`lng`/`zone`, or `null` for all three.
    - `removeWorker(worker, links) => Promise<'deleted' | 'deactivated'>` — DELETE if `!hasHistory`, otherwise set `status: 'inactive'`.
    - `createTeamAssignment({ offerId, scheduledAt, workers }) => Promise<assignmentRow>` — insert the assignment (`status: 'assigned'`, `worker_name: joinWorkerNames(workers)`), then insert all links in one call. If the link insert errors, delete that assignment and throw.
    - Every function throws `Error(message)` on a cloud `error`.

- [ ] **Step 1: Write the failing tests**

```js
test('saveWorker insert then update persists', ...)            // load → find by name → update phone → reload → new phone
test('removeWorker deletes when no history, deactivates otherwise', ...)
test('createTeamAssignment writes assignment + one link per worker', ...) // 3 workers → 3 links, worker_name 'A, B, C'
test('createTeamAssignment rolls back assignment when link insert fails', ...)
  // stub cloud.database.from('assignment_workers').insert to resolve { error: { message: 'x' } };
  // expect throw; assert no assignment with that offer_id remains
test('seed tops up workers for already-seeded state', ...)
  // localStorage satualur_mock_v1 = existing state with _seeded: true and no workers → getCloud() → loadWorkers().length === 6
```

- [ ] **Step 2: Run the tests to confirm they fail**
  Run: `node --test tests/workers-repo.test.mjs`
  Expected: FAIL.

- [ ] **Step 3: Implement `src/geo.js` and `src/stages/workers-repo.js`.**

- [ ] **Step 4: Update the mock seed.**
  - Rewrite `state.workers` to the schema:
    - integer ids `6001`–`6006`;
    - `skills` as an array;
    - a single `zone`;
    - `status: 'active'`, except one `'inactive'`;
    - keep the names, phones and addresses;
    - drop `email`, `rating`, `completed`, `onTime`, `maxJobs` and `zones`.
  - Add `state.assignment_workers` linking each seeded assignment (`3001`–`3006`) to at least one worker. Assignment `3001` gets 2 workers.
  - Change those assignments' `worker_name` to `joinWorkerNames` of their linked workers.
  - Add `requested_at` to two seeded requests.
  - Top-up: in the seeding entry point, if `state._seeded` is set but `state.workers` is missing or empty, add the seed workers and links and persist.

- [ ] **Step 5: Run all tests to confirm they pass**
  Run: `npm test`
  Expected: all pass, including `ai-integration`.

- [ ] **Step 6: Commit**

```bash
git add src/geo.js src/stages/workers-repo.js src/mock/mock-cloud.js tests/workers-repo.test.mjs
git commit -m "feat: Add workers repository, geocode seam and demo seed"
```

---

### Task 4: Requested schedule on Permintaan

**Files:**
- Modify: `src/stages/request.js`

**Interfaces:**
- Produces: `requests.requested_at` (ISO string or omitted).

- [ ] **Step 1: Add the field.**
  - Add `C.field({ label: 'Jadwal yang diminta klien', name: 'requested_at', type: 'datetime-local', hint: 'Opsional. Dipakai sebagai jadwal awal di tahap Penugasan.' })` after Lokasi.
  - On submit, convert a non-empty value with `new Date(value).toISOString()`. Reject an invalid date with the existing `msg.show('danger', …)` pattern.
  - Show the schedule (`C.formatDateTime`) in the request list's customer cell when present.

- [ ] **Step 2: Smoke check in the browser (mock mode).**
  Save a request with a schedule, reload, and confirm the schedule shows in the list.

- [ ] **Step 3: Commit**

```bash
git add src/stages/request.js
git commit -m "feat(request): Capture client's requested schedule"
```

---

### Task 5: Tim tab CRUD

**Files:**
- Modify: `src/stages/assign.js` (`renderTeam` and the top-level `render` loader)

**Interfaces:**
- Consumes:
  - from Task 3: `loadWorkers`, `loadLinks`, `saveWorker`, `removeWorker`;
  - from Task 2: `workerState`, `completedCount`, `SKILL_LABELS`.

- [ ] **Step 1: Load real data in `render`.** Load workers and links through the repo, and remove the `.sort((a,b) => b.completed - a.completed)` on a field that no longer exists. Re-run this load after every CRUD action, then call `notifyDataChanged()`.

- [ ] **Step 2: Rebuild the worker form.**
  - Fields: Nama (required), No. HP, Alamat, Keahlian (checkboxes from `SKILL_LABELS`) and Status (edit only: Aktif/Nonaktif).
  - Remove Email, Lat, Lng, Rating, Max Job/Hari and the old status select.
  - Submit calls `saveWorker` with a busy state (`C.setBusy`).
  - Use house components and a `<dialog>` or the existing modal with no inline colors.

- [ ] **Step 3: Rebuild the list.**
  - Each worker shows: name, phone, skill tags, zone (if any), derived state tag (`Tersedia` ok / `Dalam tugas` warn / `Nonaktif` neutral) and "N job selesai".
  - Inactive workers sit under a separate "Nonaktif" section.
  - The row action is "Hapus" when `!hasHistory`, otherwise "Nonaktifkan"; inactive workers get "Aktifkan".
  - Confirm before delete or deactivate.

- [ ] **Step 4: Delete the "import JSON" modal and the SQL textarea code paths entirely.**

- [ ] **Step 5: Browser smoke check (mock mode).**
  - Add a worker, reload: still there.
  - Edit their phone, reload: changed.
  - Delete the new worker: gone.
  - On a seeded worker with history, the action reads "Nonaktifkan"; using it moves them to Nonaktif, and reload keeps them there.

- [ ] **Step 6: Commit**

```bash
git add src/stages/assign.js
git commit -m "feat(assign): Persist worker CRUD in the Tim tab"
```

---

### Task 6: Tugaskan with team selection

**Files:**
- Modify: `src/stages/assign.js` (`renderAssign`)

**Interfaces:**
- Consumes:
  - from Task 2: `scoreWorkers`, `pickRecommended`, `inferSkill`;
  - from Task 3: `createTeamAssignment`, `geocode`;
  - from Task 4: `request.requested_at`.

- [ ] **Step 1: Prefill the schedule.** When an offer is selected, set the schedule input from its request's `requested_at` (via `toLocalInput`) when present, otherwise keep `defaultSchedule()`. Recompute scores when the schedule changes.

- [ ] **Step 2: Replace the worker `<select>` with a checkbox list.**
  - One row per scored active worker: name, skill tags, a "Bentrok" warn tag when `clash`, distance only when `distanceKm !== null`, and `reasons`.
  - The job's coordinates come from `await geocode(request.location)`. Remove the `-6.2088/106.8456` fallbacks.
  - Next to the list: a small number input (default `1`, min `1`) and a "Pilih rekomendasi" button that checks `pickRecommended(scored, n)`.

- [ ] **Step 3: Add a team summary above submit.**
  - Show the selected names, the combined skills, and a warning when any selected worker clashes or none has the required skill.
  - Validation: at least one worker (`'Pilih minimal satu petugas.'`).

- [ ] **Step 4: Submit via `createTeamAssignment`.**
  - Disable the submit button while saving, using `C.setBusy` (Review Focus #3).
  - On success, keep the existing success message, toast and "Tandai selesai nanti" action.
  - Empty state when there are no active workers: `C.emptyState` with a button that switches to the Tim tab.

- [ ] **Step 5: List names.** The assignment history table shows `worker_name`. Old rows have no links, so `worker_name` is the source.

- [ ] **Step 6: Browser smoke check (mock mode).**
  - Pick the offer whose request has `requested_at`: the schedule is prefilled.
  - "Pilih rekomendasi" with n=3 checks three non-clashing workers.
  - Double-click submit: exactly one new assignment.
  - Completion page lists the new assignment as "A, B, C".
  - A deactivated worker is not in the list, but old assignments still show their name.

- [ ] **Step 7: Commit**

```bash
git add src/stages/assign.js
git commit -m "feat(assign): Assign teams with recommendations"
```

---

### Task 7: Peta & Performa fixes, demo script, final verification

**Files:**
- Modify: `src/stages/assign.js` (`renderMap`, `renderPerformance`, `kpiCard`)
- Modify: `docs/DEMO_SCRIPT.md` (BAGIAN 3, STEP 3)

- [ ] **Step 1: Fix Performa.**
  - KPIs: active workers, total completed jobs (`completedCount` summed), and workers on a job today.
  - Remove the rating and on-time KPIs and columns.
  - The ranking is by completed jobs.
  - No `NaN` with zero workers.

- [ ] **Step 2: Fix Peta.**
  - Plot only workers with `lat`/`lng`; pin colour comes from `workerState`.
  - With none, show `C.emptyState({ title: 'Belum ada lokasi petugas', body: 'Lokasi muncul setelah integrasi peta aktif.' })`.

- [ ] **Step 3: Update the demo script.** STEP 3 now picks the approved offer, then checks the workers that make up Tim Alpha using "Pilih rekomendasi" (n=3) or manual checks. The schedule is prefilled from the request (STEP 1 adds `Jadwal yang diminta klien`: tomorrow 08:00).

- [ ] **Step 4: Full verification**
  - Run: `npm test && npx vite build`. Expected: all tests pass, build succeeds.
  - Browser, mock mode: walk Permintaan → Penawaran → Penugasan (team of 3) → Penyelesaian → Pembukuan with no page errors; Peta and Performa render without `NaN`.

- [ ] **Step 5: Commit**

```bash
git add src/stages/assign.js docs/DEMO_SCRIPT.md
git commit -m "fix(assign): Align map and performance tabs with worker model; update demo script"
```

- [ ] **Step 6: Production rollout (only with the user's go-ahead).** Run `npm run db:migrate:remote`, then `npm run deploy`, in that order.
