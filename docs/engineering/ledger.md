# Change ledger

**What this is.** A record of every change: what was done, why, how it is proven, and which docs
moved with it. `CLAUDE.md` rule 6 makes an entry part of "done". Newest first.

**How to add an entry.** Copy the template, fill every field, and add it at the top of §2 in the same
change as the work. If a test was changed after it failed, also add a row to §1. Then update the
weekly plan (`docs/product/weekly-delivery-plan.md`) and, only if a product decision changed, the
product definition.

```markdown
### YYYY-MM-DD · <short title>
- **What and why:** <one or two sentences; link the brief or finding ids>
- **Proven by:** feature `<file>` (seen failing first) · unit `<file>` · E2E `<file>` · sabotage check: <yes/no>
- **Files:** <main files or folders>
- **Findings closed:** <ids or "none">
- **Tests changed after a failure:** <"none", or ids of rows in §1>
- **Docs updated:** <technical guide / architecture / register / CLAUDE.md / weekly plan / product definition>
- **Commit:** <hash, or "uncommitted">
```

---

## 1. Test changes after a failure

`CLAUDE.md` rule 1: a failing test is fixed in the code. A test may change only when the test itself is
shown to be wrong, and every such change is listed here with its evidence, so it can be challenged.

| Id | Date | Test | What failed | Evidence the test (not the code) was wrong | What changed |
|---|---|---|---|---|---|
| TC1 | 2026-11-17 | `tools/geo/test/hydro-and-lakes.test.ts` (carveChannel) | Midpoint height was 74.48, test expected 75 ± 0.5 | The requirement is "water level falls from 90 to 60 along the river". Carving lowers a band about 3 cells wide, so the sampled midpoint averages neighbouring carved cells. The test assumed a 1-cell channel, which no requirement states | Tolerance ± 1.5, with the reason in a comment |
| TC2 | 2026-11-17 | `tests/e2e/geo/generator-cli.e2e.test.ts` | Sources listed GLO-90 only; the test expects GLO-30 too | The test asserts that HD patches use 30 m data, but its own parameters (128 px patches) never reached the 30 m threshold, so it was not testing what it claimed | Patch texture size raised to 1024 so the 30 m path is really exercised |
| TC3 | 2026-11-16 | `tests/e2e/web/bundle-budget.e2e.test.ts` | First load measured 205.6 kB | Under Vitest `NODE_ENV=test`, so the build bundled React's development mode. That is not what ships (the shipped build measured 143.9 kB) | Build forced to production mode |
| TC4 | 2026-11-19 | `tests/e2e/web/see-in-3d.e2e.test.ts` | Type error found by the new test type-check (T4) | The skip check passed file *contents* to `isLfsPointer`, which takes a *path*; a real pointer read as "not a pointer" (findings register T3) | Path passed. Before: a committed pointer returned `false`; after: `true` |
| TC5 | 2026-11-19 | `tests/e2e/web/bundle-budget`, `camera-device-check`, `see-in-3d`, `tier-c-two-day-mastery` | Production builds offered no lessons after the S1 fix | The product rule changed by decision (S1: draft packs never ship in production). These tests play the draft Kenya lessons, so they now build as a labelled rehearsal (`VITE_ALLOW_DRAFT_CONTENT=true`). The rule itself is tested in `tests/e2e/web/approved-content.e2e.test.ts` | Override added, with a comment naming S1 |
| TC6 | 2026-11-19 | `tests/e2e/web/session-boundary.e2e.test.ts` | Expected 1 `GET /v1/profiles` on load, saw 2 | The build was React development mode (StrictMode runs effects twice), and request counting also met the cross-origin preflight. Neither is product behaviour. The leak test still fails with the fix removed (sabotage check) | Production build; family A's request identified by its token, not by counting |
| TC7 | 2026-11-19 | `tests/features/api/sign-in-is-rate-limited.feature.test.ts` (school network) | Timed out at Vitest's 5 s default | The scenario performs about 50 real password hashes (scrypt), which take about 8 s. The behaviour was correct; the harness time limit was too short | Scenario timeout 60 s |
| TC8 | 2026-11-19 | `tests/features/web/progress-is-kept-and-synced.feature.test.ts` | Type error found by `typecheck:tests` | The test declared its own partial type for the sync result instead of the real `SyncOutcome` | Uses `SyncOutcome` |
| TC9 | 2026-11-17 | `tests/features/geo/kenya-3d-assets.feature.test.ts` (Tana length) | Not a failure: the brief's 850-1,150 km band was lowered to 550-1,150 km **before the first run**, with no evidence | Found in the re-audit. The brief's band came from the quoted ~1,000 km for the whole river in full detail; the surveyed Natural Earth line, our actual reference, is about 760 km for the whole river. Both bands were guesses | Replaced by a comparison with the surveyed line over the same stretch (within 15%), from a committed public-domain fixture |

### Re-audit of TC1-TC9 (19-21 November 2026)

Every row above was re-examined under the rule "fix the code, not the test". Outcome per row:

| Id | Verdict | What was done |
|---|---|---|
| TC1 | **The change had weakened the test.** "± 1.5 m" would have passed with the water buried 1 m under the land | Replaced with the requirement at every cell the river crosses: the bed is never above the water, and at most two cells' drop below it. Sabotage (bed + 1 m, bed - 5 m) fails both ways. The code was already right |
| TC2 | Justified, but left a gap | Added: the real Kenya HD patches must be made from the 30 m data (brief section 4.2) |
| TC3 | Justified, but left a gap | Added: the bundle test proves it measured a production build (no React developer warnings); sabotage with a development build fails |
| TC4 | Stands | The test type-check (T4) now guards it |
| TC5 | Stands | Product rule change (S1); the rule itself has its own E2E test |
| TC6 | Justified, but the test had been loosened from "one request" to "at least one" | Added: the production app fetches the children list exactly once (paid data). Sabotage that fetches twice fails |
| TC7 | Stands | A time limit for 50 real password hashes, not a behaviour |
| TC8 | Stands | A type mistake in the test |
| TC9 | **Unsupported band, both before and after** | Grounded in the surveyed river (`tests/features/fixtures/natural-earth-tana.geojson`); traced 751 km against about 704 km surveyed over the same stretch |

Not in this table, because they were made before the code existed or only made tests stricter: new
tests written red-first, the password-never-printed assertion added to the fail-closed test (T7), and
positive controls added to existing scenarios.

---

## 2. Entries

### 2026-11-22 · First CodeRabbit review round: all 89 findings given a status
- **What and why:** The first full-code review (CodeRabbit on the review mirror, revision `63c681a`, saved
  locally as `docs/reviews`, never committed) was worked through completely before any new feature, at the
  founder's request ("building bug free from the beginning is better than fighting bugs forever"). All 89
  comments are in the findings register §8 with an id (CR1-CR89): **74 fixed** (59 in code, 15 in tests or
  docs), **2 already fixed** earlier (CR9, CR23), **6 deferred** with cost and trigger (CR22, CR82-CR84, and
  new T9), **7 need a founder decision** (CR1, CR3 as D8; CR5 in D3; CR16 in D7; CR25 as D9; CR86 as D10).
  Each code fix started with a test that failed for the right reason; most were then sabotaged (fix removed,
  test red, restored, `git diff` clean). The Kenya 3D assets were regenerated with the fixed generator (from the
  cache, 0 network requests): 26 files changed; the Tana traces 758.9 km (was 751).
- **Proven by:**
  - feature: `tests/features/content/{pack-rules,unity-gets-approved-content,explanation-feedback}.feature.test.ts`,
    `tests/features/web/{new-country-map,session-boundary,shared-device-progress,progress-is-kept-and-synced,camera-device-check,see-in-3d,approved-content-only}.feature.test.ts`,
    `tests/features/api/{ai-explanation-check,new-grade-is-a-content-drop,consent-and-profiles}.feature.test.ts`,
    `tests/features/mastery/mastery-rules.feature.test.ts`, `tests/features/mission/play-a-mission.feature.test.ts`,
    `tests/features/geo/new-region-gets-3d-without-code.feature.test.ts`;
  - unit: `packages/{mastery,mission,content}/test`, `packages/mastery/fixtures/conformance.json` (C# passes),
    `apps/api/test/{attempt-limiter,content-registry}.test.ts`, `apps/web/test/*` (incl. new `map-home`,
    `basemap-filter`, `listening-port`), `tools/geo/test/*` (incl. new `remote-sources.test.ts`);
  - E2E: `tests/e2e/web/{approved-content,session-boundary,camera-device-check,tier-c-two-day-mastery,see-in-3d}.e2e.test.ts`,
    `tests/e2e/geo/generator-cli.e2e.test.ts`, new `tests/e2e/tooling/e2e-harness.e2e.test.ts`.
- **Files:** the code named in the register rows; `content-assets/ke.g5.sst.kenya-explorer/3d` (regenerated, never
  hand-edited); `packages/content/packs/kenya-explorer.json` and the Grade 6 fixture (`countryIsoNumeric`);
  `apps/web/src/assets/basemap.json` regenerated byte-identical; `scripts/validate-content.mjs` (moved from
  `packages/content/src/cli`); new `docs/manual-tests/00-walkthrough.md`.
- **Findings closed:** CR2, CR4, CR6-CR8, CR10-CR15, CR17-CR21, CR24, CR26-CR89 except those deferred or awaiting
  decisions above; also P9 (via CR36) and E5 (via CR85). New finding: T9 (a timing flake in the 3D E2E), deferred.
- **Tests changed after a failure:** none of the code-facing kind. Three NEW tests were corrected before they
  had ever passed, because the test itself was wrong (recorded for honesty, not as TC rows): a mission test used
  an answer that meets no criterion (so it correctly got the follow-up, not a hint); a grid test's regex did not
  match the message's grammar; a lake test put its anchor on a cell boundary and drew a one-cell-wide lake with
  no flat cell at its near end. In each case the code was right and the test's setup was fixed.
- **Also learned:** a "9 skipped" E2E run with `E2E_REQUIRE_DB=1` was a failing `beforeAll` (the API started while
  Postgres was still booting); Vitest marks the file failed and exits 1, so the gate held. Read "Test Files".
- **Docs updated:** findings register §8 and D8-D10, technical guide, architecture (diagram, privacy boundary,
  change log), ADR-0008/0010 cross-links, ADR-0009 (Tana length), README, CLAUDE.md, manual tests, weekly plan.
- **Commit:** uncommitted (commit only when asked).

### 2026-11-21 · Re-audit of every test changed after a failure
- **What and why:** Under the new rule, every past test change (TC1-TC8) was re-examined, and one unrecorded
  weakening was found (TC9). Two changes had genuinely weakened tests (TC1, TC9) and three had left gaps
  (TC2, TC3, TC6). All were strengthened against the real requirement. No product code needed to change:
  each stronger test passed against the existing code and failed when the code was sabotaged.
- **Proven by:** unit `tools/geo/test/hydro-and-lakes.test.ts` (channel, two sabotages) · feature
  `tests/features/geo/kenya-3d-assets.feature.test.ts` (30 m patches; length against the surveyed Tana) ·
  E2E `tests/e2e/web/bundle-budget.e2e.test.ts` (production build, sabotaged) and
  `tests/e2e/web/session-boundary.e2e.test.ts` (one request, sabotaged).
- **Files:** those tests, `tests/features/fixtures/natural-earth-tana.geojson` (public domain), this ledger,
  ADR-0009 (its "What Phase 1 built" section was referenced but missing; now written).
- **Findings closed:** none. **Tests changed after a failure:** TC1, TC2, TC3, TC6, TC9 strengthened (see re-audit).
- **Docs updated:** ledger, ADR-0009, brief (section 4.2). **Commit:** uncommitted.

### 2026-11-19 · Rule: tests are the specification; every change recorded
- **What and why:** Founder's rule. A failing test is fixed in the code, never by bending the test.
  Order: failing feature test, then failing unit test, then code, then E2E. Every test (feature, unit
  assertions, final E2E) is a committed file in its folder; a probe run only in an agent's session is
  never evidence. Every change gets a ledger entry and its docs; then the weekly plan, and the product
  definition if a decision changed.
- **Proven by:** process rule, no code. Backfilled §1 with every test changed after a failure so far.
- **Files:** `CLAUDE.md` (rules 1 and 6), `docs/engineering/testing-workflow.md`, this file.
- **Findings closed:** none. **Tests changed after a failure:** none.
- **Docs updated:** `CLAUDE.md` (rules 1 and 6), testing workflow (rule and definition of done), docs
  index, weekly plan (W1 progress), agent memory. **Commit:** uncommitted.

### 2026-11-19 · The API Docker image is tested, not just built (T5)
- **What and why:** CI built the API image but never ran it. All 44 E2E tests were run against the
  running production image (Postgres + container): all pass. CI's docker job now starts the image and
  runs the API E2E suite against it.
- **Proven by:** E2E `tests/e2e/**` with `E2E_API_URL=http://localhost:3000 E2E_REQUIRE_DB=1` (44/44).
- **Observed:** running the suite a second time against the *same* container within an hour fails
  sign-ups with 429. That is the production limit working (10 sign-ups per address per hour; the first
  run had used 6), not a bug. CI starts a fresh container each run. Locally, restart the API container
  between repeated runs (`docker compose --profile app restart api`).
- **Files:** `.github/workflows/ci.yml` (docker job).
- **Findings closed:** T5. **Tests changed after a failure:** none (the repeat-run failure was not
  "fixed" by changing a test or the limit).
- **Docs updated:** findings register, technical guide. **Commit:** uncommitted.

### 2026-11-19 · CodeRabbit review mirror
- **What and why:** A separate mirror (`review` remote, `merabadhiambo871-crypto/DuniaLab`) for a full
  CodeRabbit review. `main` holds the README and `.coderabbit.yaml`; `feat/dunialab-code-review` holds
  the whole code. `.coderabbit.yaml` skips generated `content-assets/` and binaries, which brings the
  review from 416 to 221 files (limit 300). LFS images were not uploaded (that account's LFS budget is
  used up); the mirror has pointer files.
- **Files:** `.coderabbit.yaml`. **Commit:** `438c38d`.

### 2026-11-19 · Review fixes: security, offline reliability, release controls
- **What and why:** Findings S1, S7, S8, S9, R1, R2, R3, R4, plus R7 and T8 found along the way, and T7.
  Details per finding in the findings register.
- **Proven by:** feature tests (red first) in `tests/features/web/` and `tests/features/api/`; unit tests
  in `apps/web/test/` and `apps/api/test/`; E2E in `tests/e2e/web/` and `tests/e2e/api/`; a sabotage
  check for each fix (the API ones with a rebuild).
- **Findings closed:** S1, S7, S8, S9, R1, R2, R3 (residual deferred), R4, R7, T7, T8.
- **Tests changed after a failure:** TC5, TC6, TC7, TC8.
- **Docs updated:** findings register, testing workflow, technical guide, architecture change log and
  sync flow, `CLAUDE.md`. **Commit:** `eadce9d`.

### 2026-11-19 · Foundations, product definition in Markdown, working practices
- **What and why:** Product definition converted to Markdown as the source of truth, with the roadmap
  after the MVP and the God's Eye View review. Findings register created. Practices adopted (brief before
  build, prove checks can fail, truthful screens, stage by name, main is stable, manual guides after
  review). Fixed E9, T1, T3, T4, P8.
- **Proven by:** `tests/e2e/tooling/fail-closed-database.e2e.test.ts` (both directions); the new test
  type-check failed on its first run on a real bug (T3).
- **Tests changed after a failure:** TC4. **Commit:** `ae35b84` (docs), fixes in `eadce9d`.

### Before this ledger (from the git history)
| Date | Commit | Work |
|---|---|---|
| 2026-11-17 | `ca2b8e3`, `14846aa`, `dd54291` | 3D Explorer Phase 2: scene planner, mesh builders, web terrain viewer (Phase 2 viewer by Copilot); handover brief |
| 2026-11-17 | `81bb31f` | 3D Explorer Phase 1: geodata generator and Kenya 3D assets (TC1, TC2) |
| 2026-11-16 | `dc2be49` | 3D Explorer Phase 0: decisions (ADR-0008, ADR-0009), data budgets, WebGL2 and elevation spikes (TC3) |
| 2026-11-16 | `26075d5` | 3D Explorer brief |
| 2026-11-08 | `8e0778d`, `03b5a8b` | Camera device check; never let blocked storage break startup or sign-out |
| 2026-11-07 | `caa7433`, `22bbbcc` | DuniaLab foundation monorepo; first CodeRabbit review fixes (PR #1) |
