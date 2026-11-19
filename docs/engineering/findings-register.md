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
| T5 | Medium | **CI builds the API image but never runs it.** | `.github/workflows/ci.yml` (docker job builds only) | Start the image against Postgres in production mode: health, migrations, approved-content refusal, one sync | Open |
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
| P9 | **A new country still needs code.** The 2D map highlights the home country from a hard-coded table of three countries. | `apps/web/src/components/KenyaMap.tsx:21` (`NUMERIC`) | Move the country code into the pack (schema + validator), keeping "a new country is a content drop" true | Open |

### 5. How we work (practices adopted from our own earlier project)

| Id | Practice | Status |
|---|---|---|
| E1 | **A reviewed feature brief before any agent builds.** The template covers: what older documents are now wrong, contracts touched, an edge-case table, prohibited changes, acceptance evidence, rollback, exact git commands, and the summary required back. Reviewing prose is far cheaper than reviewing merged code. | Adopted (19 Nov 2026): `docs/briefs/_template.md`; rule in `CLAUDE.md` §5 |
| E2 | **Every review finding gets a status** (this register), and declines are answered on the review thread itself. | Adopted with this file |
| E3 | **Prove each new check can fail.** Break it on purpose, watch the test fail, restore it, then `git diff`. Every "X is hidden" test first asserts X is visible to someone allowed to see it. | Adopted as a rule (`CLAUDE.md` §5, testing workflow); applied to T1 and T4 |
| E4 | **Every screen tells the truth.** Loading, failed, refused, empty, partial, truncated and "not saved" must not look alike, each with a component test. | Rule adopted (`CLAUDE.md` §5, testing workflow); component tests per state still Open, with S8 and R1 |
| E5 | **Manual test guides, written after review,** plus one standing whole-product walkthrough that extends the existing automated journey. | In progress: `docs/manual-tests/README.md` and `_template.md` done; `00-walkthrough.md` to be written from the running app |
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
| D3 | **AI privacy for the child pilot** | **External AI stays off for the child pilot** until the privacy boundary and the provider's data terms are approved in writing. The offline checker answers meanwhile. Removing the child's own nickname is an extra precaution only; it does not remove another child's name, a school or an address. **Consequence, recorded honestly:** a pilot without the external AI does not test the "AI agrees with teachers at least 85%" gate. That evaluation (P5) stays outstanding. | S3, P5 | Awaiting founder |
| D4 | **Sessions** | A **server-side session record** checked on every protected request. Required: <ul><li>sign out on this device;</li><li>sign out everywhere;</li><li>a defined expiry;</li><li>revocation after account-security changes (for example a password change).</li></ul> If session validation is unavailable, online requests fail safely, while offline missions keep working. | S4 | Awaiting founder |
| D5 | **Picture PIN on a shared phone** | A boundary between siblings, checked on the phone so it works offline. Ask for it when switching to a different child **and** when the app reopens or unlocks. Store a verifier (a hash), never the pictures in plain form. After 3 wrong tries, a short wait. **Offline parent reset** needs a design that does not store the parent's password on the phone. State plainly that an offline PIN cannot protect against someone who controls the device. | S6 | Awaiting founder |
| D6 | **Interrupted missions** | **Resume unfinished work** while the saved session is still compatible with the same child and the same content version, not "same day only". Restart when the content changed, or when the parent or child chooses to. Depends on R1: until silent storage loss is fixed, saved progress cannot be promised. | R6 | Awaiting founder |
| D7 | **Schools and teachers** | The teacher creates a class and gets a code; the parent enters it. The parent sees the school and class clearly before confirming. Codes expire and can be revoked, with abuse protection. The parent can remove their child from a class. A teacher's access is revoked when they leave. The teacher sees nicknames and per-skill mastery for their own class only. The school's and DuniaLab's data-controller responsibilities are defined, not just "a signed agreement". | P6 | Awaiting founder |

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
6. **Deliver the learning promise:** P1, P3, P5, P9, P6 (D7), the device tiers after the D2 spike, and T5, T6, E8 before the pilot.
