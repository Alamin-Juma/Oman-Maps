# Rule: Feature → Unit → E2E (test-driven delivery)

**Status:** mandatory for every feature, bug fix and rule change. Adopted 2026-11-07.

Every piece of behaviour in DuniaLab is built in this order. No step is skipped,
and a pull request that adds behaviour without all three layers is not done.

```
 1. FEATURE test  (tests/features/)    "what must be true"     -> written FIRST, fails (red)
 2. UNIT tests    (packages/*/test,     "how the code does it"  -> drive the code (red -> green -> refactor)
                   apps/*/test)
 3. E2E test      (tests/e2e/)          "it works for real"     -> proves the slice through the running system
```

## 1. Feature test: write it first

- **Where:** `tests/features/<area>/<feature>.feature.test.ts`
- **What:** an acceptance spec in the product's own language, written as
  `Feature / Scenario / Given / When / Then`. One file per feature.
- **Source of truth:** the product definition (`docs/product/`). If you cannot
  point to the sentence in the product doc or an ADR that a scenario protects,
  the scenario (or the feature) needs discussing first.
- **Scope:** calls the **public API** of a package or service (what other code
  would import or call), never private helpers.
- **Must fail first.** Run it and see it fail for the right reason before writing code.
  Commit message or PR description says so: `feature test red: ...`.

```ts
// tests/features/mastery/mastery-rules.feature.test.ts
feature("Mastery is decided by fixed rules, never by the AI", () => {
  scenario("one good day is not mastery", () => {
    given("a child answered correctly and explained well on Monday");
    when("we compute their skill state");
    then("the skill is Practising, not Mastered");
  });
});
```

## 2. Unit tests: drive the code

- **Where:** next to the code: `packages/<pkg>/test/`, `apps/<app>/test/`.
- **What:** small, fast, isolated tests of functions/classes, including the edge
  cases the feature test does not spell out (time zones, duplicates, bad input).
- **Loop:** red → green → refactor. Write the smallest code that passes, then clean up.
- **Shared rules use shared fixtures.** Logic implemented in more than one
  language (mastery rules in TypeScript and C#) is specified by JSON fixtures in
  `packages/*/fixtures/`. Add the fixture case first; both implementations must pass it.

## 3. E2E test: prove the slice works

- **Where:** `tests/e2e/<area>/<flow>.e2e.test.ts`
- **What:** exercises the real running system end to end: real HTTP against
  the API, a real Postgres (docker compose), real content packs. No mocks except
  third-party services we pay for (the AI model is replaced by its offline
  fallback or a recorded stub).
- **Later:** browser flows (Tier C web) with Playwright; Unity flows with the
  Unity Test Framework in PlayMode.
- E2E tests are skipped automatically, with a clear message, when their
  infrastructure (e.g. `DATABASE_URL`) is not available, and always run in CI.

## Definition of done (checklist for every PR)

- [ ] Feature test written first and seen failing (red)
- [ ] Unit tests cover the code paths and edge cases
- [ ] E2E test covers the user-visible slice
- [ ] `npm test` (features + unit) and `npm run test:e2e` pass
- [ ] Docs updated if behaviour or a decision changed (`docs/technical-guide.md`, ADRs)

## Commands

| Command | Runs |
|---|---|
| `npm run test:features` | acceptance specs in `tests/features/` |
| `npm run test:unit` | unit tests in every workspace |
| `npm test` | features + unit |
| `npm run test:e2e` | end-to-end tests (needs `npm run db:up` and a built API) |

## Why this order

- **Feature first** keeps us building what the product needs, not what is fun to
  code. The pilot has hard go/no-go gates; feature tests are those promises in code.
- **Unit tests** keep the engines (mastery, rubric checker, sync) correct in the
  edge cases that hurt children's trust: a wrong "Mastered", a lost result.
- **E2E last** proves the pieces actually connect: phone → sync → database → report.
  It is slow, so there are few E2E tests and they cover whole flows.

## Tests that cannot fail are worse than none (adopted 2026-11-19)

A test that cannot fail reads as coverage while proving nothing. Four habits prevent it:

1. **Break the fix, watch the test fail, restore, `git diff`.** Do this for every new guard or check,
   and say in the summary that you did. A new control should make something that used to pass start
   failing; if nothing goes red, suspect it is not connected to anything. Example: the root-test
   type-check (`npm run typecheck:tests`) failed immediately on the first run, on a real bug (findings
   register T3), which is how we know it works.
2. **Positive controls.** Before asserting "a stranger cannot see this report", assert that the
   parent *can*. Otherwise the test also passes when nobody can see it, when a field is renamed, or
   when the fixture has no data.
3. **Fail closed.** Database-backed E2E suites skip locally when Postgres is down (and say so on
   stderr), but `E2E_REQUIRE_DB=1`, which CI sets, turns a missing database into a failure. A skipped
   run never satisfies the definition of done. Proven by `tests/e2e/tooling/fail-closed-database.e2e.test.ts`.
4. **Type-check the tests.** Vitest runs TypeScript without checking it. `npm run typecheck` includes
   `typecheck:tests` (`tsconfig.tests.json`) for `tests/features` and `tests/e2e`.

**Break the code the test actually runs.** Feature tests load the *built* API (`@dunialab/api`
from `dist/`), so sabotaging only the source proves nothing: rebuild after breaking it and after
restoring it. This was learned the hard way (findings register R7): a first sabotage check passed
while the fix was removed, because the test was still running the old build.

**Test builds of the web app build what ships.** Under Vitest `NODE_ENV` is `test`, which makes a
Vite build bundle React's development mode (bigger, and StrictMode runs effects twice). Browser E2E
tests set `NODE_ENV=production` around `build()`; tests that play the (still draft) Kenya pack also
set `VITE_ALLOW_DRAFT_CONTENT=true`, and `tests/e2e/web/approved-content` checks the real rule.

**Budgets assert a ceiling, never an exact value** (`<= N`): the budget is what we protect, not
today's number.

**Truthful screens.** Every screen distinguishes loading, failed, refused, empty, partial, truncated
and "not saved on this phone". Each state gets a component test that renders it and asserts the
user-visible text. Check failed **before** empty: `items.length === 0` after a failed load reads as
"your progress is gone".

## Manual guides and the walkthrough

Automated tests prove the pieces; a person proves the product. After code review (not before), each
feature gets a guide in `docs/manual-tests/` from the template there. One standing walkthrough
(`docs/manual-tests/00-walkthrough.md`) carries one child from guest play to the parent's report and
the 3D view; run it before every release and every demo.

## Exceptions

- Pure refactors with no behaviour change: existing tests must stay green; no new feature test needed.
- Spikes/prototypes live on a `spike/*` branch and are never merged; the real
  implementation starts again at step 1.
- Code that existed before this rule (2026-11-07) got backfilled feature tests;
  see `tests/features/`.
