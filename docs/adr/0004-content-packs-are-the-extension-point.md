# 0004. Content packs are the extension point

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
The founder asked, on day one, that *"future classes/grades can be added easily rather than modifying our POC."*
The product roadmap: remaining Grade 5 sub-strands → Grade 6 East Africa → Grade 7 Africa Explorer (smartboards) →
Science/agriculture kits → Tanzania and Uganda curriculum packs: *"The same engine, new content packs."*

## Decision
- A **content pack** (JSON, validated by `@dunialab/content`) holds everything curriculum-specific: country, grade,
  subject, strand, sub-strands, skills, map features, missions, tasks, rubrics, hints, translations, print target and review status.
- The API's **ContentRegistry** loads every pack in a folder at startup, validates it fully and refuses to start on an invalid pack.
- `GET /v1/catalog?country&grade&subject` lists packs. `GET /v1/packs/:id` serves one.
- **All progress is scoped by `packId`** (sync, report, explanation check), so packs can reuse ids without colliding.
- Only `review.status = "approved"` packs are served in production.
- No code anywhere may branch on a specific pack id, grade or country.

## Consequences
- A new grade = a new JSON file (plus print artwork and 3D assets for Unity). Guarded by the feature test
  `tests/features/api/new-grade-is-a-content-drop.feature.test.ts`.
- New *task types* still need code in the schema and each renderer. That is deliberate and visible.
- Architecture diagram "Extension points" lists what changes for each kind of growth.
