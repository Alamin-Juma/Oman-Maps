# Findings register

**What this is.** Every finding from a review (a code-review bot, a person, or an agent) gets a row
here. Each row ends with a status:
- **Fixed:** the fix is in, with a test that fails without it.
- **Declined:** with the reason, grounded in this codebase.
- **Deferred:** with what it costs to leave it and what would make it urgent.

Silence is not a status. A finding nobody answered is one everybody assumes somebody else handled.

**How to use it.** Add new findings at the bottom of their section with the next id. When you fix one,
change its status and name the commit and the test. Keep the decisions table (§6) current: rows waiting
on the founder are the work's real blockers.

| Status | Meaning |
|---|---|
| Open | Confirmed, not yet worked on |
| In progress | Being fixed now |
| Fixed | Fix in, with a test that fails without it; commit named |
| Declined | Not a defect here; reason given |
| Deferred | Accepted for now; cost and trigger written down |
| Needs decision | Cannot be fixed until the founder decides (see §6) |

---

## Review of 19 November 2026

**Sources:**
- An engineering review against our adapted starter-kit practices.
- An independent security review.
- The founder's own review.

Every row below was then re-checked against the code; "verified" means the file and line were read, or
the failure was reproduced.

- **Overall:** no critical vulnerability was confirmed. The work is mostly about completing and proving
  what the product definition promises, not about hidden exploits.
- **Not assessed:** a production penetration test, gateway or WAF configuration, and backup restore on
  a real deployment.

### 1. Security and privacy

| Id | Severity | Finding | Evidence | Direction | Status |
|---|---|---|---|---|---|
| S1 | High | **The production web app ships draft content.** The API refuses unapproved packs in production, but the web app bundles every valid pack and only shows a "draft" banner. | `apps/web/src/lib/packs.ts` (glob of all packs); product rule "only approved packs ship to children" | Filter bundled packs by `review.status` in production builds, with an explicit, logged development override | Fixed (19 Nov 2026): production builds offer approved packs only, and copy only their 3D files; `VITE_ALLOW_DRAFT_CONTENT=true` for rehearsals shows the draft banner; truthful "waiting for teacher approval" screen. Tests: `tests/features/web/approved-content-only`, `tests/e2e/web/approved-content` (with positive control) |
| S2 | High | **A parent cannot delete their data, and nothing enforces retention.** The product promises "deletion when a parent asks and on a fixed retention schedule". The database cascades, but no endpoint or job uses them. | No delete endpoint in `apps/api/src`; `store.ts` has no delete; product definition, child safety table | Delete-my-data endpoint, plus a retention job; tested over HTTP on real Postgres | Needs decision (D1) |
| S3 | Medium | **AI redaction is not anonymisation.** Phones, emails and links are removed, but a child can still type a name or a school. The AI provider's retention terms were not verified. | `apps/api/src/explanations/redact.ts`; ADR-0005 amendment already names this limit | Decide the boundary: provider zero-retention terms, name heuristics, or send only rubric-matched fragments | Needs decision (D3) |
| S4 | Medium | **Signing out cannot revoke a session.** Tokens last 30 days and the server never checks session state, so a copied token keeps working. | `apps/api/src/app.factory.ts:37` (`expiresIn: "30d"`); `auth.guard.ts` verifies only the signature | A revocable session design that works for both the web and Unity clients (for example a session row or token version) | Needs decision (D4) |
| S5 | Medium | **Consent cannot be renewed or withdrawn.** Consent is only given inside "add a child", so an existing family cannot accept a new policy version, and there is no withdrawal at all. | `apps/web/src/components/FamilyPanel.tsx:74–104` | Consent screen: view, renew, withdraw (withdrawal triggers S2 handling) | Needs decision (D1) |
| S6 | Medium | **The picture PIN is never asked for.** It is chosen at creation, but selecting a child on the shared phone does not check it. | `FamilyPanel.tsx` (PIN only in the create form) | Ask for the PIN on selection; decide where it is verified and how many tries (decision D5) | Needs decision (D5) |
| S7 | Medium | **Answers that arrive after sign-out can bring back the previous family's data on screen.** Requests are neither cancelled nor tagged with a session generation. The server's ownership checks still hold. | `FamilyPanel.tsx:47–50, 128, 158–166` | Session generation counter or abort controller; drop any response from an earlier session | Fixed (19 Nov 2026): `SessionScope` (`apps/web/src/lib/session.ts`); the family panel is rebuilt per session and late answers are dropped. Test: `tests/e2e/web/session-boundary` (next parent never sees the previous family's child; fails with the fix removed) |
| S8 | Low | **An expired session shows a raw "401" and stays "signed in".** | `apps/web/src/lib/api.ts:60`; `FamilyPanel.tsx:43` | One session boundary in the client: on 401, clear state and return to sign-in; keep failed, refused and empty visibly different | Fixed (19 Nov 2026): a 401 on a protected call ends the session cleanly with a message; a 401 at sign-in stays a wrong password; 403 never signs out. Tests: `tests/features/web/session-boundary`, `tests/e2e/web/session-boundary` |
| S9 | Medium | **Sign-up and sign-in have no rate limiting** in the application. Gateway protection was not assessed. | Nothing in `apps/api/src` | Limit per account, then per IP, so a whole school behind one IP address is not locked out; never limit ordinary reads | Fixed (19 Nov 2026): 5 failures per account and 30 attempts per address per 15 min; 10 sign-ups per address per hour; reads never limited; `Retry-After`; `TRUST_PROXY` for a reverse proxy. Tests: `tests/features/api/sign-in-is-rate-limited`, `tests/e2e/api/sign-in-rate-limit`. Deferred: a shared store if the API ever runs as several instances |

### 2. Reliability of offline learning (the product's normal environment)

| Id | Severity | Finding | Evidence | Direction | Status |
|---|---|---|---|---|---|
| R1 | High | **Progress can vanish silently when storage fails.** `safeStorage` swallows failed writes by design (an earlier fix kept the app running). The child is never told, and the session's events are lost. Reproduced. | `apps/web/src/lib/queue.ts` (`safeStorage`, `EventQueue.add`) | Keep the session's events in memory and show a clear "not saved on this phone" notice | Fixed (19 Nov 2026): the queue stays in memory when a save fails, the app shows "not saved on this phone", and everything is saved once storage works. Tests: `tests/features/web/progress-is-kept-and-synced`, `tests/e2e/web/progress-not-saved` |
| R2 | Medium | **Corrupt stored data crashes the progress panel.** Valid JSON of the wrong shape (for example `{}`) passes the `try` and then `.filter` fails. Reproduced. | `queue.ts` `read()` casts without validating | Validate the stored shape; move bad data aside and recover, rather than treating it as empty | Fixed (19 Nov 2026): stored entries are validated; damaged data is set aside under `dunialab.events.v1.damaged`, never thrown away, and the app says so |
| R3 | Medium | **Two tabs can overwrite each other's events.** Read-modify-write on one key, with no concurrency control. Reproduced with a deterministic interleaving. | `queue.ts` | A real concurrency strategy: IndexedDB transactions, or one key per event, or merge-on-write | Fixed for the reproduced case (19 Nov 2026): merge-on-write re-reads before saving. Deferred: the instant between that re-read and the save; full fix is IndexedDB transactions (trigger: any report of a lost answer, or the web app becoming a primary learner app) |
| R4 | High | **More than 500 waiting events can never sync.** The client sends the whole backlog; the API rejects more than 500 per request. | `FamilyPanel.tsx:119–120`; `progress.controller.ts:20, 40` | Send in batches of up to 500; keep and retry what was not sent | Fixed (19 Nov 2026): `syncInBatches` sends at most `SYNC_MAX_EVENTS` (shared with the API via `@dunialab/mastery`) per request and keeps what was not sent. Test: `tests/e2e/api/large-backlog-sync` (1,200 events against the real API) |
| R5 | Medium | **A new device shows no progress.** Sync results are ignored, and the progress panel computes mastery only from events on this device, so a fresh phone disagrees with the parent's report. | `FamilyPanel.tsx`; `ProgressPanel.tsx` | Define server-to-device recovery and reconcile, not upload only | Open |
| R6 | Low | **An interrupted mission does not resume.** The session lives in memory; finished task events are saved, but the position in the mission is not. | `apps/web/src/components/MissionPlayer.tsx` | Decide the expected behaviour after a reload or app kill, then test it | Needs decision (D6) |

Not substantiated: "all events marked synced despite partial counts". A successful response accounts for every accepted or duplicate event, and an invalid batch fails before anything is marked. **Declined.**

### 3. Tests and release controls

| Id | Severity | Finding | Evidence | Direction | Status |
|---|---|---|---|---|---|
| T1 | High | **Database E2E tests skip, not fail, when Postgres is missing, even in CI.** A warning is logged, but a skipped run reads as a pass. | `tests/e2e/support/server.ts` (`databaseReachable`); `describe.skipIf(!reachable)`; no flag in `.github/workflows/ci.yml` | `E2E_REQUIRE_DB=1` in CI turns "no database" into a failure; local skips stay, and say so | Fixed (19 Nov 2026): `E2E_REQUIRE_DB=1` in CI; local skips now print to stderr; proven by `tests/e2e/tooling/fail-closed-database.e2e.test.ts` (both directions) |
| T2 | Medium | **The "offline" journey never goes offline.** It plays without calling the API, but it never cuts the network, reloads, or reconnects. | `tests/e2e/web/tier-c-two-day-mastery.e2e.test.ts` (no `setOffline`) | Add a real offline E2E: network off, play, reload, reconnect, sync, retry | Open |
| T3 | High | **The 3D E2E skip check is wrong.** It passes the file's *contents* to `isLfsPointer`, which expects a *path*, so a real LFS pointer is read as "not a pointer". On a checkout without the images (CI), the test runs against pointer files instead of skipping. | `tests/e2e/web/see-in-3d.e2e.test.ts:14`; `tools/geo/src/images.ts` (`isLfsPointer(file: string)`) | Pass the path; add a unit test proving a committed pointer is detected | Fixed (19 Nov 2026): path passed; caught by the new test type-check; on a real committed pointer the old call returned `false`, the fixed one `true` |
| T4 | Medium | **Root feature and E2E tests are not type-checked.** Vitest runs them without checking types. T3 is exactly the kind of mistake this would have caught. | Root `package.json` `typecheck` covers workspaces only; no root `tsconfig` for `tests/` | Add `tsconfig.tests.json` and include it in `npm run typecheck` and CI | Fixed (19 Nov 2026): `tsconfig.tests.json`, `npm run typecheck:tests` in `typecheck` and CI; it failed on first run, on T3 plus an untyped `this` |
| T5 | Medium | **CI builds the API image but never runs it.** | `.github/workflows/ci.yml` (docker job builds only) | Start the image against Postgres in production mode: health, migrations, approved-content refusal, one sync | Fixed (19 Nov 2026): all 44 E2E tests pass against the running production image; CI's docker job now starts the image with Postgres and runs `tests/e2e/api` against it. Note: repeat runs against the same container within an hour hit the sign-up limit (429) by design; CI uses a fresh container |
| T6 | Medium | **No evidence yet from devices or operations.** Frame rate, memory, touch and heat on a pilot phone; backup restore; rollback. | ADR-0008 (phone checkpoint open); no restore rehearsal recorded | Release gates: a phone checkpoint per 3D phase; one rehearsed restore and rollback before the pilot | Open |

### 4. Product promises not yet delivered

These are unfinished, not defects. Several are already acknowledged in our docs.

| Id | Finding | Evidence | Direction | Status |
|---|---|---|---|---|
| P1 | **Spaced review is built but children never receive it.** `buildReviewQueue` is not called anywhere in the learner flow. | Only `packages/mastery` uses it | Wire review into the mission list (due items first), with a feature test from the child's side | Open |
| P2 | **The web app does not open offline.** There is no service worker or pack caching. "A mission survives a dropped connection" is not "download once, reopen offline". | No `serviceWorker` or `caches` usage in `apps/web` | Offline app shell and pack caching (3D Explorer Phase 4 covers the 3D files) | Open |
| P3 | **There is no narration playback,** though English and Kiswahili narration is in the MVP. | `MissionPlayer.tsx`; pack `narrationKey` unused | Audio delivery plus acceptance criteria for recorded files | Open |
| P4 | **The Unity tiers (A and B) are scaffolding only,** but they are in the fixed MVP scope. Unity is not installed on the build machine. | `apps/unity/README.md` | A plan to deliver them, or a founder decision to move them out of the MVP (D2) | Needs decision (D2) |
| P5 | **The AI marking has no evaluation harness yet** (pilot gate: at least 85% agreement with teachers). | `docs/technical-guide.md` roadmap; ADR-0005 | Teacher-marked set of at least 50 per rubric; agreement and cost per check measured | Open |
| P6 | **No school or class model exists,** though a basic teacher class report is in the MVP. | `apps/api/src/db/schema.ts` (parents and profiles only) | Decide school/class membership, parental authority and teacher access first (D7); not "tenant ids everywhere" | Needs decision (D7) |
| P7 | **Payments.** In-app payment is outside the MVP. Pilot payments are manual (invoice or M-Pesa request). | Product definition, MVP scope | Before any payment gateway: pending state, idempotency, verified callbacks, daily reconciliation. Now: a written manual reconciliation process | Deferred (trigger: a gateway integration is planned) |
| P8 | **Two documents disagreed about scope.** The fixed MVP includes Tiers A/B/C and a basic teacher report, but the proposed roadmap listed AR and the teacher view as "after the pilot". | `docs/product/product-definition.md` | Roadmap corrected to agree with the fixed MVP; whether the MVP itself changes is D2 | Fixed (19 Nov 2026, roadmap wording) |
| P9 | **A new country still needs code.** The 2D map highlights the home country from a hard-coded table of three countries. | `apps/web/src/components/KenyaMap.tsx:21` (`NUMERIC`) | Move the country code into the pack (schema + validator), keeping "a new country is a content drop" true | **Fixed** 22 Nov 2026 as CR36: the pack's `countryIsoNumeric`; no country table in the app |

### 5. How we work (practices adopted from our own earlier project)

| Id | Practice | Status |
|---|---|---|
| E1 | **A reviewed feature brief before any agent builds.** The template covers: what older documents are now wrong, contracts touched, an edge-case table, prohibited changes, acceptance evidence, rollback, exact git commands, and the summary required back. Reviewing prose is far cheaper than reviewing merged code. | Adopted (19 Nov 2026): `docs/briefs/_template.md`; rule in `CLAUDE.md` §5 |
| E2 | **Every review finding gets a status** (this register), and declines are answered on the review thread itself. | Adopted with this file |
| E3 | **Prove each new check can fail.** Break it on purpose, watch the test fail, restore it, then `git diff`. Every "X is hidden" test first asserts X is visible to someone allowed to see it. | Adopted as a rule (`CLAUDE.md` §5, testing workflow); applied to T1 and T4 |
| E4 | **Every screen tells the truth.** Loading, failed, refused, empty, partial, truncated and "not saved" must not look alike, each with a component test. | Rule adopted (`CLAUDE.md` §5, testing workflow); component tests per state still Open, with S8 and R1 |
| E5 | **Manual test guides, written after review,** plus one standing whole-product walkthrough that extends the existing automated journey. | **Fixed** 22 Nov 2026 as CR85: `docs/manual-tests/00-walkthrough.md` |
| E6 | **Git and release rules:** stage files by name (never `git add -A`); a human pushes after reviewing and running the code; "main is stable" (shipped behaviour changes only by product decision). | Adopted (19 Nov 2026): `CLAUDE.md` §5 |
| E7 | **Process hygiene:** stop only the processes a task started; leave no server running; suspect a stale process as one possible cause, not an automatic diagnosis. | Adopted (19 Nov 2026): `CLAUDE.md` §5 and `docs/manual-tests/README.md` |
| E8 | **Operational readiness evidence:** a rehearsed restore and rollback, a release check that only approved content ships, and diagnostics that are safe for children's privacy. | Open |
| E9 | **The imported starter kit stays out of the repository.** It contains another product's architecture and domain material. Take its general practices in our own words; never commit the kit. | Fixed (19 Nov 2026): `docs/STARTER_KIT/` in `.gitignore` |

Not adopted, on purpose: MediatR, EF Core, GraphQL, a universal outbox, or enterprise multi-tenancy
just to resemble the earlier project. The kit's value here is its discipline, not its architecture.

---

## 6. Decisions needed from the founder

Each row shows the recommendation after two reviews: the first proposal, then a second reviewer's
corrections, all accepted (see §6a). **Nothing here is decided until the founder confirms it.**
Building waits on the confirmation for each row.

| Id | Decision | Recommendation after review | Blocks | Status |
|---|---|---|---|---|
| D1 | **Deletion, retention and consent withdrawal** | **Deletion on request:** remove from the live system promptly after the parent confirms. Backups expire on their own schedule, and restoring a backup must never bring back a deleted account. **Retention:** propose deleting accounts after 12 months without activity, with "activity" defined precisely (for example a sign-in or a sync). A 30-day reminder needs a real delivery channel, not just a policy sentence. Counsel confirms the period; it is a proposed policy, not a known legal requirement. **Withdrawing consent:** stop the affected cloud processing immediately; withdrawing optional AI consent does not delete the whole family account. Whether local progress stays on the phone is the parent's explicit choice, with a clear "delete from this phone" option. | S2, S5 | Awaiting founder |
| D2 | **Device tiers for the pilot** | Do not decide yet. First run a short, time-boxed **Tier B feasibility spike** on representative pilot phones. Then decide explicitly. If the pilot goes web-first: <ul><li>measure mission completion and device compatibility separately from the optional 3D view;</li><li>record that it tests learning and demand for the web experience, **not** the value of scanning the printed map;</li><li>do not let a parallel pitch demo take time the pilot needs.</li></ul> "Works on every phone" is not established until offline reopening (P2) and real-phone 3D performance (T6) are done. | P4, P8 | Awaiting founder (after the spike) |
| D3 | **AI privacy for the child pilot** | **External AI stays off for the child pilot** until the privacy boundary and the provider's data terms are approved in writing. The offline checker answers meanwhile. Removing the child's own nickname is an extra precaution only; it does not remove another child's name, a school or an address. **Consequence, recorded honestly:** a pilot without the external AI does not test the "AI agrees with teachers at least 85%" gate. That evaluation (P5) stays outstanding. | S3, P5, CR5 | Awaiting founder |
| D4 | **Sessions** | A **server-side session record** checked on every protected request. Required: <ul><li>sign out on this device;</li><li>sign out everywhere;</li><li>a defined expiry;</li><li>revocation after account-security changes (for example a password change).</li></ul> If session validation is unavailable, online requests fail safely, while offline missions keep working. | S4 | Awaiting founder |
| D5 | **Picture PIN on a shared phone** | A boundary between siblings, checked on the phone so it works offline. Ask for it when switching to a different child **and** when the app reopens or unlocks. Store a verifier (a hash), never the pictures in plain form. After 3 wrong tries, a short wait. **Offline parent reset** needs a design that does not store the parent's password on the phone. State plainly that an offline PIN cannot protect against someone who controls the device. | S6 | Awaiting founder |
| D6 | **Interrupted missions** | **Resume unfinished work** while the saved session is still compatible with the same child and the same content version, not "same day only". Restart when the content changed, or when the parent or child chooses to. Depends on R1: until silent storage loss is fixed, saved progress cannot be promised. | R6 | Awaiting founder |
| D7 | **Schools and teachers** | The teacher creates a class and gets a code; the parent enters it. The parent sees the school and class clearly before confirming. Codes expire and can be revoked, with abuse protection. The parent can remove their child from a class. A teacher's access is revoked when they leave. The teacher sees nicknames and per-skill mastery for their own class only. The school's and DuniaLab's data-controller responsibilities are defined, not just "a signed agreement". | P6, CR16 (the product definition's optional school field) | Awaiting founder |
| D8 | **Draft content with an explicit override in production** | Today `ALLOW_DRAFT_CONTENT=true` (API) and `VITE_ALLOW_DRAFT_CONTENT=true` (web) serve labelled drafts even in a production build; rehearsals and the Docker-image E2E use it. **Recommendation:** keep the override for rehearsals, but refuse it when the deployment is marked as serving children (a separate setting), so a mistyped variable cannot put drafts in front of a child. A plain production build already bundles no draft content (CR2). | CR1, CR3 | Awaiting founder |
| D9 | **How long an explanation check may wait online** | Offline it answers at once; connected but slow it waits up to 6 s. **Recommendation:** about 3 s with a visible "checking" state; never replace feedback already shown. | CR25 | Awaiting founder |
| D10 | **Complete the learning-result bands** (product definition, metrics table) | +0 to +2 points, fractions between +9 and +10, and losses fit no band. **Proposed:** Go at least +10; Fix +3 to under +10; Stop under +3, including no difference or a loss. | CR86 | Awaiting founder |

### 6a. Second review of the recommendations (19 November 2026): outcomes

| Point raised | Outcome |
|---|---|
| D1: 12 months is a proposal, define "activity", backups must not resurrect deleted accounts, withdrawal is not deletion, local data is the parent's choice, reminders need a channel | Accepted, in D1 |
| D2: "works on every phone" not established; web 3D is not Tier B; spike first; measure missions and 3D separately; the pilot is in Term 1 after a build to the end of January, not "January" | Accepted, in D2. The earlier "pilot starts January 2027" wording was wrong |
| D3: nickname removal is not a privacy boundary; keep external AI off; a local-only pilot does not test the AI agreement gate | Accepted, in D3 |
| D4: add sign out everywhere, expiry, revocation after security changes, safe failure | Accepted, in D4 |
| D5: lock on reopen, store a verifier, offline parent reset, be honest about device control | Accepted, in D5 |
| D6: resume while compatible, not "same day"; "no credit lost" too strong while R1 is open | Accepted, in D6 |
| D7: show school and class, expiring codes, removal, staff-leaver revocation, controller roles | Accepted, in D7 |
| Bring R1 (silent progress loss) into the first group of fixes | Accepted, in §7 |
| `tests/e2e/support/server.ts` printed the full database address, password included | Accepted: fixed as T7 |
| No real child data until the remaining privacy prerequisites are resolved | Accepted, in §7 |

### 6b. Found during review (belongs with §3, tests and release controls)

| Id | Severity | Finding | Evidence | Direction | Status |
|---|---|---|---|---|---|
| T7 | Medium | **The new "database not reachable" message printed the database address with its password.** It was introduced with the T1 fix in this round. | `tests/e2e/support/server.ts` (`databaseReachable`) | Print the address with the password removed; a test asserts the password never appears | Fixed (19 Nov 2026): the password is replaced; the fail-closed test asserts it never appears |
| R7 | High | **Even a correct 500-event batch failed: the API's request body limit (100 kB, the Express default) was smaller than 500 events.** The real limit had silently been about 430. Found only by the new end-to-end test against the real API. | `apps/api/src/app.factory.ts` | Body limit derived from `SYNC_MAX_EVENTS` | Fixed (19 Nov 2026): `JSON_BODY_LIMIT_BYTES`; feature test sends 500 of the largest allowed events (200) and 501 (400, not 413) |
| T8 | Medium | **The first page load crossed its 150 kB budget (150.4 kB)** after Phase 2 and this round's code. The cause was that the browser re-validated the content packs, which shipped the whole validation library (29% of the first-load source). | `apps/web/src/lib/packs.ts`; `@dunialab/content` `assets3d.ts` mixed schemas with plain helpers | Validate packs at build time; keep schema code out of the first load | Fixed (19 Nov 2026): first load **121.7 kB** (was 150.4). An invalid pack now fails the build with its reasons instead of vanishing; test in `tests/e2e/web/approved-content` |

## 7. Recommended order of work

**No real child data** goes into the system until D1, D3, D4 and D5 are decided and built.

1. **Foundations** (done): E9, T1, T3, T4, P8, T7, and the E1–E7 rules.
2. **Stop the worst risks** (done, 19 Nov 2026): S1, R1, R4, and R7 found on the way.
3. **Sessions on the client** (done): S9, S7, S8.
4. **Storage you can trust** (done): R2, R3 (residual window deferred). Also T8 (first-load budget).
5. **After the founder's decisions:** S2, S5 (D1); S4 (D4); S6 (D5); S3 (D3); then genuine offline reopening (P2), device recovery (R5), the real offline test (T2) and R6 (D6).
6. **Deliver the learning promise:** P1, P3, P5, P6 (D7), the device tiers after the D2 spike, and T6, E8 before the pilot. (P9 and E5 were done in the first CodeRabbit round, §8; T5 on 19 November.)

## 8. First CodeRabbit review of the whole codebase (PR on the review mirror, revision `63c681a`)

Source: the review saved locally as `docs/reviews` (never committed: it contains a token-like link).
Every comment is listed here with an id, and every row gets a status before the round is closed.
Each finding is checked against the current code first: the review saw `63c681a`, and some
comments were already fixed in `eadce9d`.
Statuses: **Fixed** (with the test that fails without the fix), **Declined** (with a reason),
**Deferred** (with cost and trigger), **Needs decision**.

### 8a. Security, privacy and approved content

| Id | Where | Finding | Status |
|---|---|---|---|
| CR1 | `apps/api/src/config.ts` | `ALLOW_DRAFT_CONTENT=true` serves draft packs even when `NODE_ENV=production` | **Needs decision (D8).** Deliberate, tested behaviour (`apps/api/test/password-and-config.test.ts`; the production Docker image E2E relies on it for the draft pack). Not changed without a product decision (CLAUDE.md §5) |
| CR2 | `apps/web/vite.config.ts` | A production build without the draft opt-in still bundles draft pack JSON (hidden only at run time) | **Fixed.** The build selects packs; a withheld pack ships as its id only. E2E `tests/e2e/web/approved-content.e2e.test.ts` (draft lesson text absent; present in the rehearsal build); red before the fix |
| CR3 | `apps/web/test/pack-selection.test.ts` | The unit test requires drafts to show in production when `allowDraft` is set (same question as CR1) | **Needs decision (D8)**, with CR1 |
| CR4 | `scripts/sync-unity-content.mjs` | Copies draft packs into the Unity Addressables folder | **Fixed.** Copies approved packs only; `--allow-drafts` for local development. Feature `tests/features/content/unity-gets-approved-content.feature.test.ts`; red before |
| CR5 | `apps/api/src/explanations/redact.ts` | Names and schools typed into an answer reach the AI (same as S3, decision D3) | **Needs decision (D3)**, same as S3. Documented honestly now (CR15); external AI stays off until D3 |
| CR6 | Summary (security) | Two overlapping sign-ins: after sign-out, the late one restores the previous family's token | **Fixed.** One sign-in at a time (the buttons lock), and App accepts a token only for the session that asked (`session.guard`). E2E `tests/e2e/web/session-boundary.e2e.test.ts` (one request for two presses); red before; sabotage fails it |
| CR7 | Summary (security) | Online grading has no per-parent allowance, concurrency limit or spending stop | **Fixed.** Per-parent allowance, per-parent concurrency, deployment-wide cap (`DEFAULT_RATE_LIMITS`), and the provider request is aborted on timeout. Feature `ai-explanation-check.feature.test.ts` (5 scenarios incl. a positive control); red before the fix |
| CR8 | `apps/web/src/lib/guest.ts` | A failed guest-id save at sign-out leaves the old id readable after reload, so the next family can adopt it | **Fixed.** A failed save removes the old id, so a reload cannot read it back. Feature `shared-device-progress.feature.test.ts`, unit `apps/web/test/guest-and-storage.test.ts`; red before. Residual: storage that allows reads but refuses both writes and removals (not a known browser behaviour) |
| CR9 | `apps/web/src/App.tsx` | Guest-id writes unguarded (initial render, sign-out) | **Already fixed** in `eadce9d`: both writes go through `safeStorage` in `lib/guest.ts`. Covered by the feature scenario "sign-out still issues a new guest id when the phone's storage is full or blocked" |
| CR10 | `apps/web/src/lib/api.ts:64` | A 401 for an old token ends the newer session | **Fixed.** The client reports the token of the failed request; App ends only that sign-in (`expiryApplies`). Feature `session-boundary.feature.test.ts` (2 scenarios), unit `queue-and-api.test.ts`; red before |
| CR11 | `apps/web/src/lib/api.ts:62` | A non-JSON 401 throws `SyntaxError` before the session-expired handler runs | **Fixed.** Lenient decoding; errors keep their status and a 401 ends the session whatever the body. Same tests; red before |
| CR12 | `apps/web/src/components/CameraCheck.tsx` | A camera stream that arrives after the panel closes is never stopped | **Fixed.** A stream that arrives after stop or close is switched off (`keepIfStillWanted`). E2E `camera-device-check.e2e.test.ts` (slow camera, closed while opening; plus a positive control), unit `camera.test.ts`, feature `camera-device-check.feature.test.ts`; the E2E was red before |
| CR13 | `tests/e2e/web/camera-device-check.e2e.test.ts` | The "no image leaves the device" check ignores request URLs | **Fixed (test).** The privacy check reads URLs and bodies, with a negative control that sends a picture in a query and is caught |
| CR14 | `tests/e2e/support/server.ts:43` | A password given as `?password=` in `DATABASE_URL` is printed | **Fixed.** `withoutPassword` also masks `?password=`. E2E `tests/e2e/tooling/e2e-harness.e2e.test.ts`; the old harness fails it |
| CR15 | `docs/architecture/README.md:61` | "Claude never sees who the child is" is stronger than the redaction delivers | **Fixed (docs).** The architecture page now says the answer text can contain a name or school, that redaction is minimisation, and that D3 is open |
| CR16 | `docs/product/product-definition.md:309` | Lists an optional school among child data, which the data rule does not allow | **Needs decision (D7).** The product definition allows an optional school; CLAUDE.md's data rule does not. Which wins belongs with the school/class decision D7. Not changed by an agent |
| CR17 | `apps/api/src/explanations/explanations.controller.ts` | A failing consent lookup breaks the endpoint instead of falling back to local feedback | **Fixed.** The consent lookup is inside the fallback boundary. Feature `ai-explanation-check.feature.test.ts`; red before the fix |
| CR18 | `apps/api/src/auth/attempt-limiter.ts` | The size sweep uses the caller's window, so a 15-minute rule can drop 60-minute registration history | **Fixed.** Each key keeps its own window; the sweep uses it. Unit `apps/api/test/attempt-limiter.test.ts`; red before the fix |
| CR19 | `apps/api/src/catalog/catalog.controller.ts` | Catalogue query schema is not `.strict()` | **Fixed.** `.strict()`. Feature `new-grade-is-a-content-drop.feature.test.ts` (known filters work, unknown is 400); red before the fix |

### 8b. Learning data and offline reliability

| Id | Where | Finding | Status |
|---|---|---|---|
| CR20 | `apps/web/src/lib/queue.ts:126` | A recovery write after a failed save skips the merge and overwrites another tab's events | **Fixed.** The recovery write merges with storage, carrying every id changed while saving failed. Feature `progress-is-kept-and-synced.feature.test.ts`, unit `queue-durability.test.ts`; red before |
| CR21 | `apps/web/src/lib/queue.ts:258` | The in-memory fallback storage reports writes as saved, hiding the "not saved" warning | **Fixed.** The memory stand-in reports writes as not saved, so the warning shows; real storage still clears it (positive control). Same tests; red before |
| CR22 | `tests/features/web/progress-is-kept-and-synced.feature.test.ts` | The concurrency test does not cover the window between the merge re-read and the save (R3 residual) | **Deferred**, with R3's residual window. Cost: an event saved by another tab in the instant between the merge re-read and the save can be overwritten (two tabs on one phone, rare). Trigger: weekly plan W4 ("two overlapping writers preserve both sets of events"), queue item 4: a transactional store. A test for that window would fail today, so it is written with the fix, not before |
| CR23 | `apps/web/src/components/MissionPlayer.tsx:26` | A profile change mid-mission loses events and can keep a stale tap handler | **Already fixed** in `eadce9d`: `MissionPlayer` is keyed by mission and child. Exercised by the CR24 E2E (switching child mid-mission keeps the first child's three answers) |
| CR24 | `apps/web/src/components/MissionPlayer.tsx:74` | A late explanation result is flushed after the mission scope changed | **Fixed.** Results that arrive after the mission's scope ended are dropped. E2E `session-boundary.e2e.test.ts` (late check after switching child; positive control: the earlier answers are kept); red before; sabotage fails it |
| CR25 | `docs/architecture/flows.md:24` | The explanation step waits up to 6 s on the network before feedback | **Needs decision (D9).** Offline, the check already answers at once (the request fails immediately; the walkthrough step 4 and CR50's offline E2E prove it). Connected but slow, the child waits up to 6 s, now bounded inside the mission too (CR27). Options: keep 6 s; cut to about 3 s; or show the device's verdict first and never change it. Recommendation: about 3 s with a visible "checking" state; never replace feedback already shown |
| CR26 | `packages/mission/src/session.ts:126` | Overlapping `answerExplain` calls record two events and skip a task | **Fixed.** An overlapping submission gets the in-flight result. Feature `play-a-mission.feature.test.ts`, unit `packages/mission/test/session.test.ts`; red before the fix |
| CR27 | `packages/mission/src/session.ts:134` | The checker wait has no bound in the mission contract | **Fixed.** `checkerTimeoutMs` (default 6 s) in the pure session, by a timer; a late verdict is never observed. Same tests; red before the fix |
| CR28 | `packages/mastery/src/report.ts:37` | Weekly totals count duplicated events | **Fixed.** De-duplicated before counting. Feature `mastery-rules.feature.test.ts`, unit `engine.test.ts`; red before the fix |
| CR29 | `packages/mastery/src/engine.ts:100` | A skill id such as `constructor` crashes the engine (prototype lookup) | **Fixed.** Shared fixture case first (C# already passed; TypeScript crashed), then Maps in the engine and `Object.hasOwn` in the review queue. Feature, unit and `fixtures/conformance.json` |
| CR30 | `packages/content/src/validate.ts:73` | Duplicate criterion ids inside one task pass validation and let the local checker over-count | **Fixed.** Feature `tests/features/content/pack-rules.feature.test.ts`, unit `packages/content/test/pack.test.ts`; red before the fix |
| CR31 | `packages/content/src/validate.ts:75` | Duplicate hint ids inside one task pass validation; the wrong hint is shown | **Fixed.** Same tests (also: the same hint id in two tasks stays valid) |
| CR32 | `apps/api/src/content/content-registry.ts:81` | A lower-case pack country never matches the catalogue filter | **Fixed** at the source: the schema requires `^[A-Z]{2}$`, so the catalogue comparison always matches. Same tests |

### 8c. Web screens

| Id | Where | Finding | Status |
|---|---|---|---|
| CR33 | `apps/web/src/components/FamilyPanel.tsx:49` | Loading and failed profile lists look like an empty family (offers "add child") | **Fixed.** Loading, failed (with Try again) and loaded-empty are distinct; only the last offers Add child. E2E `session-boundary.e2e.test.ts` plus an empty-family positive control; red before |
| CR34 | `apps/web/src/components/FamilyPanel.tsx:136` | A report stays visible, or a late one returns, after the child or pack changes | **Fixed.** A report is shown only for the child and pack it was asked for; a late answer for another is dropped. E2E `session-boundary.e2e.test.ts`; red before |
| CR35 | `apps/web/src/App.tsx:122` | The pack and child selectors have no accessible name | **Fixed.** Localised `aria-label`s on both selectors. E2E finds the child selector by its name; red before |
| CR36 | `apps/web/src/components/KenyaMap.tsx:21` | Home-country highlight from a hard-coded table (same as P9) | **Fixed (also P9).** The pack carries `countryIsoNumeric`; `isHomeBoundary` uses it; no country table in the app. Feature `tests/features/web/new-country-map.feature.test.ts` (a Rwanda pack; a grep that the map names no country), unit `map-home.test.ts`; red before. Pack format change: optional field, both packs updated |
| CR37 | `apps/web/scripts/build-basemap.mjs:25` | A country that contains the whole map area is dropped from the basemap | **Fixed.** Each polygon part's bounding box against the map's (containment and crossing edges kept; date-line parts ignored). Unit `apps/web/test/basemap-filter.test.ts`; the old rule fails it. Kenya's basemap regenerated byte-identical |
| CR38 | `apps/web/src/lib/projection.ts:25` | Scale bar width goes negative across the 180° meridian | **Fixed.** Width from `projection.scale()` and the angle. Unit `projection.test.ts` (near 180°, and Kenya unchanged); red before |
| CR39 | `apps/web/src/three/load.ts:82` | Regional view of a non-water feature never loads nearby lakes or rivers | **Fixed.** `waterFilesToLoad`: a regional view fetches the outline files before planning. Feature `see-in-3d.feature.test.ts` (Kisumu shows Lake Victoria, Nairobi the Tana; overview unchanged), unit `three.test.ts`; red before; the old rule fails it |
| CR40 | `apps/web/vite.config.ts:73` | One pack without `3d/manifest.json` breaks the dev server and the build | **Fixed.** A pack without `3d/manifest.json` ships without 3D, with a warning; the build goes on. E2E `approved-content.e2e.test.ts` (with the new test-only `DUNIALAB_ASSETS_DIR`); red before |
| CR41 | `apps/web/scripts/dev-phone.mjs:18` | Prints the configured port, not the one Vite actually chose | **Fixed.** `scripts/listening-port.mjs` reads the real address. Unit `listening-port.test.ts` |

### 8d. Tests that could pass while the behaviour is wrong

| Id | Where | Finding | Status |
|---|---|---|---|
| CR42 | `tests/features/content/explanation-feedback.feature.test.ts:63` | Requires the shipped pack to stay unapproved; approval would break the suite | **Fixed (test).** The scenario asserted the shipped pack stays a draft, which no rule requires. Now: a production API lists an approved fixture and never a draft one. Sabotage (registry ignores approval) fails it |
| CR43 | `apps/api/test/content-registry.test.ts:20` | Same, for the registry approval filter | **Fixed (test).** Own approved and draft fixtures. Same sabotage fails it |
| CR44 | `tests/features/web/approved-content-only.feature.test.ts:79` | Same, for the web | **Fixed (test).** The real pack's expectation follows its review status; the fixed rejection uses the draft fixture (first scenario) |
| CR45 | `tests/features/api/new-grade-is-a-content-drop.feature.test.ts:60` | "Progress is scoped by pack" is tested only by a missing `packId` | **Fixed (test).** Two packs share a skill id; each report holds only its own answer. Passed against the existing code; sabotage (store ignores `packId`) fails it |
| CR46 | `tests/features/api/new-grade-is-a-content-drop.feature.test.ts:62` | The second scenario depends on the first having started the API (also the 5 s timeout of 21 Nov) | **Fixed (test).** Packs and API set up in `beforeAll`; every scenario runs alone. The 21 November 5 s timeout was this scenario starting the whole API inside its own time limit |
| CR47 | `tests/features/api/consent-and-profiles.feature.test.ts:73` | Family isolation checked without first proving the owner sees the child | **Fixed (test).** Positive control: creation returns 201 and the owner sees the child before isolation is checked |
| CR48 | `tests/features/web/shared-device-progress.feature.test.ts:74` | Cross-family test uses literal guest ids instead of the real rotation | **Fixed (test).** Uses the real `readGuestId`/`rotateGuestId` on one storage; adoption moves only the new family's event and the old one keeps its owner |
| CR49 | `tests/e2e/web/session-boundary.e2e.test.ts:114` | Fixed delays; does not wait for family A's request to finish | **Fixed (test).** Waits for family A's answer to finish, then for family B's own list to show Loading, instead of two fixed 1 s waits |
| CR50 | `tests/e2e/web/tier-c-two-day-mastery.e2e.test.ts:66` | Missions are never played with the network cut (part of T2) | **Fixed (test).** Both days of play run with the browser offline, and no request is even attempted; reconnects before sign-up. Sabotage (a request on each answer) fails it. The rest of T2 (reload while offline) waits for P2 |
| CR51 | `tests/e2e/web/see-in-3d.e2e.test.ts:86` | Before/after frames captured differently (overlays) | **Fixed (test).** Before and after frames use the same overlay-free capture. While verifying, a timing flake in the same test was found: T9 |
| CR52 | `tests/e2e/web/see-in-3d.e2e.test.ts:29` | Leaks `VITE_ALLOW_DRAFT_CONTENT` into later builds | **Fixed (test).** Saves and restores `VITE_ALLOW_DRAFT_CONTENT`. The other browser E2E files set it the same way; each test file runs in its own isolated worker, so the value cannot reach another file |
| CR53 | `tests/e2e/support/server.ts:120` | `stop()` hangs when the API already died from a signal | **Fixed.** `stopChild` treats a signal-ended child as stopped. Same tooling test; the old harness hangs past the limit |
| CR54 | `tests/e2e/support/server.ts:73` | A stalled health request ignores the 20 s deadline | **Fixed.** Each health request has the remaining deadline as its own abort signal. Same tooling test |
| CR55 | `tests/e2e/geo/generator-cli.e2e.test.ts:152` | Later tests need assets created by an earlier one | **Fixed (test).** A memoised first build that every dependent test awaits; the dropped-connection assertions stay with it. The Unity test passes run alone |
| CR56 | `tests/features/geo/new-region-gets-3d-without-code.feature.test.ts:59` | The damage scenario depends on the first scenario's output | **Fixed (test).** Generated in `beforeAll`, removed in `afterAll`; the damage scenario tampers with its own copy (positive control: the copy verifies first). Passes run alone |
| CR57 | `tools/geo/test/hydro-and-lakes.test.ts:93` | "Cannot reach the outlet" is tested only with no outlet at all | **Fixed (test).** A sea exists but the corridor never reaches the start; asserts "does not drain". Changing that message in the code fails it |
| CR58 | `tools/geo/test/hydro-and-lakes.test.ts:33` | Heap test does not catch an id returned twice | **Fixed (test).** Each popped id must be new |
| T9 | `tests/e2e/web/see-in-3d.e2e.test.ts` | **Found while verifying CR51.** "Raises the mountain" failed once in 7 runs (`expected 1.5 to be less than 1.5`): with a warm browser the rise can finish before the test reads the starting height, and the before/after frames would then match too. Timing, not the product | **Deferred.** Cost: an occasional red run. Fix planned, not a loosened assertion: record every `data-exaggeration` value from page start (an init-script observer) and drive the animation with Playwright's clock. Trigger: before the W11 release-candidate run, or the next time it fails |

### 8e. Geodata generator (`tools/geo`)

| Id | Where | Finding | Status |
|---|---|---|---|
| CR59 | `hydro.ts:114` | An inland basin below sea level is taken as the sea outlet | **Fixed.** Sea outlets come from `oceanMask` (below sea level AND connected to the data's edge). Unit `hydro-and-lakes.test.ts`; red before; Kenya regenerated |
| CR60 | `hydro.ts:207` | Compacting a very short river drops its outlet point | **Fixed.** Short steps are measured from the last point kept; the outlet is always kept. Same test file; red before |
| CR61 | `hydro.ts:198` | The river mouth is lowered to an upstream hollow instead of the lake surface | **Fixed.** The water level is filled from the mouth upward: it meets the lake at its surface and never rises downstream. Same test file; red before. Kenya regenerated: the Tana now traces 758.9 km (was 751; surveyed about 704, within the 15% the feature test requires) |
| CR62 | `lakes.ts:40` | Lake search uses square rings, not distance in km | **Fixed.** Candidates ranked by distance in km within the radius. Same test file; red before |
| CR63 | `lakes.ts:182` | Lake search stops at the first (too small) flat region | **Fixed.** A region the caller refuses (too small, or at sea level) no longer ends the search. Same test file; red before |
| CR64 | `plan.ts:91` | Unbounded regional tile count from `--params` | **Fixed.** `tileCountForBounds` checks the count against `maxRegionalTiles` before any list is built. Unit `plan-verify-remote.test.ts`; red before |
| CR65 | `generate.ts:163` / `plan.ts` | `regionalZoomOffset` below 1 makes overview and regional tiles collide | **Fixed.** `checkParams` requires a whole-number offset of at least 1. Same test |
| CR66 | `cli.ts:43` | Invalid `heightSize` is found only after the old assets were deleted | **Fixed.** `heightSize` and `patchHeightSize` must be 2^n + 1, checked in `buildPlan`, which runs before the old assets are deleted. Same test |
| CR67 | `generate.ts:350` | Open sea detected by maximum elevation; below-sea-level land is dropped | **Fixed.** A tile is open sea only when every sample is sea by `oceanMask`; a dry depression keeps its tiles. Unit `plan-verify-remote.test.ts`; red before |
| CR68 | `grid.ts:73` | Halving an odd-sized grid drops the last row and column | **Fixed.** Odd sizes round up; edge blocks average only real cells. Unit `math-and-bake.test.ts`; red before; Kenya regenerated |
| CR69 | `grid.ts:112` | A crop outside the grid returns copied cells instead of nothing | **Fixed.** A crop outside the grid throws. Same test |
| CR70 | `remote.ts:93` | A 403 is cached as "no terrain here" | **Fixed.** 404 is remembered; 403 counts as empty for this run only, is not cached, and is reported. Unit `tools/geo/test/remote-sources.test.ts` (local server; positive control: 404 cached); red before |
| CR71 | `remote.ts:276` | Cache keys ignore the source URL | **Fixed.** `sourceScopedDir`: each source has its own cache; the existing cache is adopted by the default source, so nothing was downloaded again (the regeneration made 0 requests). Same test; red before |
| CR72 | `remote.ts:283` | A GLO-30 tile missing on land is left at sea level instead of using GLO-90 | **Fixed.** A missing GLO-30 tile falls back to GLO-90, credited in the sources. Same test (with a positive control); red before |
| CR73 | `remote.ts:402` | Downloaded guide data is cached before it is validated | **Fixed.** `parseGuideLines` checks structure and positions before caching; a damaged cache is downloaded again. Same test; red before |
| CR74 | `remote.ts:40` | A 5xx body is not released before the retry | **Fixed.** The body is cancelled before the retry. Same test; red before |
| CR75 | `images.ts:115` | A failed tile read stays cached forever | **Fixed.** A failed tile read is forgotten so the next call retries. Unit `plan-verify-remote.test.ts`; red before |
| CR76 | `images.ts:99` | Patch image size not checked (1×1 gives NaN coordinates) | **Fixed.** The patch image must be square, match `heightSize` and have at least 2 samples a side. Same test; red before |
| CR77 | `verify.ts:18` | Invalid JSON in a manifest throws instead of reporting | **Fixed.** Invalid JSON is a reported problem. Same test; red before |
| CR78 | `verify.ts:38` | Tiles named in the manifest's overview/regional lists are not checked to exist | **Fixed.** Every overview and regional tile's three files must be listed and present. Same test; red before. The real Kenya assets pass |
| CR79 | `verify.ts:54` | Recorded first-open and patch byte figures are not compared with measured ones | **Fixed.** First-open, total and per-patch figures (and the set of patches) are compared with the measured ones. Same test (2 cases); red before |

### 8f. Structure, Unity and documentation

| Id | Where | Finding | Status |
|---|---|---|---|
| CR80 | `packages/content/src/cli/validate.ts` | File-system CLI inside a pure package | **Fixed.** The validator moved to `scripts/validate-content.mjs`; `packages/content` has no command-line code. Feature `unity-gets-approved-content.feature.test.ts` |
| CR81 | `scripts/sync-unity-content.mjs:17` | Packs removed from the source stay in Unity | **Fixed.** After validation, Unity packs not in the source (or not approved) are removed; other files are left alone; an invalid pack changes nothing. Same feature test; red before |
| CR82 | `apps/unity/.../AR/MapAnchor.cs:27` | A target detected while the component was disabled is never placed | **Deferred.** Unity scaffolding that has never been opened in an editor: there is no way to compile or test a change. Cost: none until Tier A runs. Trigger: the W2 Tier B spike, which opens the project and pins the editor (the spike brief lists CR82-CR84) |
| CR83 | `apps/unity/.../AR/MapAnchor.cs:18` | A pack-specific print target id is the default | **Deferred**, with CR82 (the print target id should come from the selected pack's `printTarget.id`) |
| CR84 | `apps/unity/.../Editor/PackageBootstrap.cs:36` | A second click starts an overlapping package install | **Deferred**, with CR82 (an early return while `_request` is set) |
| CR85 | `docs/engineering/testing-workflow.md:127` | Requires `00-walkthrough.md`, which does not exist (E5) | **Fixed (docs, E5).** `docs/manual-tests/00-walkthrough.md` written from what the app does after this round; links updated |
| CR86 | `docs/product/product-definition.md:366` | Learning-result bands leave gaps (+2 points, a loss) | **Needs decision (D10).** The learning bands leave +0 to +2 points, fractions between +9 and +10, and losses unclassified. Proposed wording: Go "at least +10"; Fix "+3 to under +10"; Stop "under +3, including no difference or a loss". A kill criterion, so it is the founder's to change in the product definition |
| CR87 | `docs/technical-guide.md:75`, `README.md:22` | Chromium is installed after (or never before) the first E2E run | **Fixed (docs).** Chromium is installed before the first E2E run in the README and the technical guide |
| CR88 | `docs/adr/0008-3d-rendering-stack.md:38` | ADR-0008 and ADR-0010 do not link to each other | **Fixed (docs).** ADR-0008 and ADR-0010 link both ways |
| CR89 | `docs/architecture/README.md:32` | Diagram shows Unity Tiers A and B as working apps | **Fixed (docs).** The diagram labels the Unity learner app as planned scaffolding (P4) |

## 9. Second CodeRabbit review (PR #2 on the review mirror, revision `16a86f7`)

The re-review of the first round's fixes. Of the first round's inline comments, CodeRabbit marked 11 as
addressed. Four stay open by design (founder decisions: CR1, CR3 as D8; CR5 in D3; CR25 as D9); the others
(CR17, CR24, CR59, CR70, CR78) are fixed with tests, and two of them gained follow-up comments below
(CR91 for CR17, CR101 for CR59/CR67). New comments:

| Id | Where | Finding | Status |
|---|---|---|---|
| CR90 | `.github/workflows/ci.yml` | The health poll's `curl` has no per-request time limit | **Fixed.** `curl --max-time 2` in the health poll. A CI file: proven on the next CI run, not locally |
| CR91 | `explanations.controller.ts` | A consent lookup that hangs (database stall) holds the request; only a rejection falls back | **Fixed.** The consent lookup has the same time limit as the AI check; a timeout falls back locally before any provider call. Feature `ai-explanation-check.feature.test.ts` (a lookup that never answers); it hung before the fix |
| CR92 | `apps/web/src/lib/api.ts` | An empty 200 is accepted as success; sync then marks events synced with no acknowledgement | **Fixed.** An empty successful answer is an `ApiError` (every endpoint returns a body), and `syncInBatches` marks events only on a well-formed acknowledgement. Feature `progress-is-kept-and-synced.feature.test.ts` (2 scenarios), unit `queue-and-api.test.ts`; red before |
| CR93 | `apps/web/src/lib/map-home.ts` | A numeric boundary id 40 does not match the code "040" | **Fixed.** The boundary id is padded to three digits. Unit `map-home.test.ts`; red before |
| CR94 | `apps/web/src/three/plan.ts` | A patch view also finds nearby water from outlines, but they are not fetched for it | **Fixed.** Patch views fetch the outline files too. Unit `three.test.ts`; red before. My CR39 unit test had asserted the opposite: ledger TC10 |
| CR95 | `apps/web/vite.config.ts` | A readable but invalid `3d/manifest.json` still stops the build for every pack | **Fixed.** Reading, parsing and checking the manifest all sit inside the per-pack recovery. E2E `approved-content.e2e.test.ts` (a truncated manifest); the build failed before |
| CR96 | `explanations.controller.ts` (register CR5) | The "external AI stays off until D3" hold is not enforced in code: setting the key turns it on | **Fixed (the hold, not D3).** `EXTERNAL_AI_APPROVED` (default off): until it is "true", the controller never calls the provider, whatever the key or the consent. Feature `ai-explanation-check.feature.test.ts` (with a positive control), unit `password-and-config.test.ts`; red before. D3 itself stays the founder's decision |
| CR97 | Findings register | P9 still says Open and is still scheduled in §7, though CR36 fixed it | **Fixed (docs).** P9 and E5 marked fixed; §7 updated |
| CR98 | `tests/e2e/web/session-boundary.e2e.test.ts` | The late-report test does not check the late reply before asking for the next report | **Fixed (test).** Waits until Amani's request is held, observes its late reply, checks the report stays hidden, then asks for Baraka's. Sabotage (no scope check) fails it |
| CR99 | `tests/e2e/web/session-boundary.e2e.test.ts` | The late-explanation test waits a fixed 1.5 s instead of for the reply | **Fixed (test).** Waits for the held check's reply and two animation frames, not 1.5 s. Sabotage (no late-result guard) fails it |
| CR100 | `tests/features/api/ai-explanation-check.feature.test.ts` | The concurrency scenario depends on a 100 ms timer | **Fixed (test).** The first grader call is held open by a promise until the other three have answered |
| CR101 | `tools/geo/src/generate.ts` | Colours still treat any land at or below sea level as sea; a kept depression is painted as ocean | **Fixed.** Colours use the same whole-map ocean test as tile storage (`paintAsSea`), in the overview, regional tiles and HD patches. Unit `plan-verify-remote.test.ts` (a stored depression tile has no sea-coloured pixels; 256 before). Kenya regenerated: 8 coastal colour tiles changed |
| CR102 | `tools/geo/src/lakes.ts` | Lake distance is measured from the containing cell, not from the point | **Fixed.** Distance from the point to each candidate's cell centre, for filtering and sorting. Unit `hydro-and-lakes.test.ts` (the reviewer's example, with a positive control); red before |
| CR103 | `tools/geo/src/lakes.ts` | A rejected region also rules out seeds at other levels, whose regions differ | **Fixed.** A refused region rules out only seeds at its own level. Same test file (the reviewer's 6 x 5 example); red before |
| CR104 | `tools/geo/src/plan.ts` | A huge `regionalZoomOffset` makes the tile count NaN, which slips past the guard into an endless loop | **Fixed.** A non-finite tile count is refused. Unit `plan-verify-remote.test.ts` (offset 1024); it hung before the fix |
