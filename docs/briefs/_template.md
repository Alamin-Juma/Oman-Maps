# Brief: «feature name»

**For:** «who builds it: an agent, an engineer».
**Status:** draft → reviewed («date», by «who») → ready to build.
**Branch:** `«branch-name»`. It is already created and checked out. Do not create another, do not push.

> Copy this file to `docs/briefs/<feature>.md`. Fill every section, delete the guidance lines, and have
> the brief reviewed for *product* pass/fail before anyone builds. Write it for a reader with no
> context who cannot ask questions; that is what forces the ambiguity out.

---

## 0. Where older documents are now wrong

List every document, brief or comment this change makes stale. For each, say which one wins and what
following the old one would cause. Write "none" if none.

| Document | What it says | What is true now | Following the old one would cause |
|---|---|---|---|

## 1. What we are building, in one paragraph

Include its **shape**: does it change the database schema, a content-pack format, an API contract, a
data budget? Say "no schema change" when there is none; it prevents the biggest category of mistakes.

## 2. Read these first

The closest existing code to copy, and the single source of truth for anything derived. Exact paths,
checked against the tree.

## 3. Rules you will otherwise break

Six to ten, each one a real mistake. Always include the relevant `CLAUDE.md` rules (child safety,
content drops, main is stable).

## 4. What to build, in order

Numbered steps with exact paths. Mark which steps can ship on their own. Feature test first, then unit,
then E2E (`docs/engineering/testing-workflow.md`).

## 5. Edge cases: every row is a required behaviour

Decide the hard cases here, before they are discovered in review: empty, one, the maximum, offline,
refused, partially saved, two tabs or two devices at once, a shared phone switching child.

| Case | Required behaviour | Test that proves it |
|---|---|---|

## 6. Contracts touched

API request and response shapes, content-pack schema, asset manifest, event format. For each: what
changes, which clients read it (web, Unity, API), and how old data still works.

## 7. Definition of done

Checkable items, including:

- [ ] Feature test written first and seen failing; unit and E2E tests added
- [ ] Every new check broken on purpose and seen failing, then restored (`git diff` confirms)
- [ ] Positive controls on every "hidden from" or "refused" test
- [ ] Database E2E run with `E2E_REQUIRE_DB=1`, not skipped
- [ ] `npm run build`, `npm run typecheck` (includes the tests), `npm test`, `npm run test:e2e` all pass
- [ ] Every screen state renders truthfully (loading, failed, refused, empty, partial, truncated, not saved)
- [ ] Architecture docs, `docs/technical-guide.md` and `docs/product/product-definition.md` updated if affected
- [ ] Rollback: how to undo this safely (a flag, a revert, a data migration back)

## 8. Never do these

| Do not | Because |
|---|---|
| `git add -A` / `git add .` | It sweeps unrelated files into the commit; stage by name |
| Push, or create or switch branches | A human reviews and runs the code first |
| Weaken, skip or delete a failing test | It is the reason that bug has not come back |
| Widen a permission or remove a guard so a screen loads | The guard is usually right and the screen wrong |
| Name a specific pack, country or place in code | New grades and countries are content drops |
| Leave a server or browser running | A stale process imitates real bugs for the next person |

## 9. Git

The exact commands, already checked:

```bash
git status --short
git add <file> <file>          # by name
git diff --cached --stat
git commit --no-gpg-sign -m "<message>"
```

## 10. Your summary must contain

- What changed, and decisions you made (especially any you disagreed with).
- Tests added, and "I broke each new check and watched it fail".
- Evidence from running it: what you clicked, the request and response.
- Three ways this could break, each handled or accepted with a reason.
- Anything in this brief that turned out wrong. Say so; do not quietly work around it.
