# DuniaLab: rules for working in this repo

DuniaLab turns printed, curriculum-mapped maps into guided learning missions on any Android phone.
MVP: Kenya Grade 5 Social Studies, Strand 1 (sub-strands 1.1 and 1.3), six missions.
**Source of truth:** `docs/product/DuniaLab — Product Definition & Validation.docx`.
**Start here:** `docs/technical-guide.md`, then `docs/architecture/`.

## Non-negotiable rules

### 1. Test-driven: Feature → Unit → E2E
Full rule: `docs/engineering/testing-workflow.md`.
1. Write the **feature test first** in `tests/features/<area>/*.feature.test.ts` (Given/When/Then, public API only). Run it and see it fail.
2. Write **unit tests** next to the code (`packages/*/test`, `apps/*/test`) and implement until green.
3. Add/extend an **E2E test** in `tests/e2e/` against the real system (`npm run db:up`, built API or Docker image).
A feature is not done without all three. Logic implemented in two languages (mastery rules: TS + C#) is specified by shared JSON fixtures; change the fixture first.

### 2. Architecture docs are updated with every architectural change
Any new/removed component, data store, external service, cross-component call, data flow or extension point
must, **in the same change**:
- update the affected Mermaid diagram(s) in `docs/architecture/` (`README.md`, `flows.md`, `data-model.md`),
- add a line to the **Architecture change log** in `docs/architecture/README.md`,
- add an ADR in `docs/adr/` if a decision with trade-offs was made.
Schema changes always update `docs/architecture/data-model.md`.

### 3. Modular from day one: new grades/subjects/countries are content drops
- Curriculum-specific data lives only in **content packs** (`packages/content/packs/*.json`), validated by `npm run validate:content`.
- **Never** branch code on a pack id, grade, subject or country. All progress is scoped by `packId`.
- The API depends on ports (`Store`, `AiGrader`), not concrete adapters. Apps never import each other.
- `packages/*` stay pure (no I/O, no framework).
- If growth would require editing POC code, stop and add an extension point instead (and update the "Extension points" table).

### 4. Child safety and data protection (product definition)
- Collect only: parent account, child nickname + grade + picture PIN, learning events. Request schemas are `.strict()`.
- No free AI conversation. The AI only returns ids (criteria, approved hint) + verdict/confidence; `decideFeedback` decides.
- Nothing identifying a child is ever sent to the AI. No camera image leaves the device.
- Every online step has an offline fallback; a mission never waits on the network.
- Only `review.status = "approved"` packs ship to children in production.

## Repo map
```
packages/content   pack schema, validator, offline rubric checker, packs/*.json
packages/mastery   mastery rules, spaced review, weekly summary, fixtures/conformance.json
packages/mission   tier-agnostic mission session (tasks, one hint, follow-up, events)
apps/api           NestJS 12 + Drizzle + Postgres; ports: Store, AiGrader; ContentRegistry
apps/web           React + Vite: Tier C 2D map + parent report
apps/unity         Unity 6 LTS learner app (Tier A AR, Tier B scan-and-pop);
                   Assets/DuniaLab/Core is plain C# tested by Core.Tests (`dotnet test`)
tests/features     acceptance specs (written first)
tests/e2e          end-to-end against the real system
docs/              product, architecture (diagrams), adr, engineering, technical-guide
legacy/            2019 Oman Maps (reference only, never built)
```

## Commands
```
npm install
npm run build                 # all workspaces
npm test                      # feature + unit tests
npm run db:up                 # Postgres on :5433 (docker compose)
npm run test:e2e              # E2E (spawns built API against Postgres)
npm run validate:content      # validate content packs
npm run dev:api               # API on :3000
npm run dev:web               # web on :5173
docker compose --profile app up -d --build   # API image + Postgres; then E2E_API_URL=http://localhost:3000 npm run test:e2e
```

## Conventions
- TypeScript 7, ESM, `strict` + `noUncheckedIndexedAccess`. Relative imports end in `.js`.
- Nest DI uses explicit `@Inject(TOKEN)`. Validate all input with zod (`common/zod.ts#parse`).
- Claude API: default model `claude-opus-5-5`, configurable via `AI_MODEL`; structured outputs; never send child identity.
- Commit only when asked. Keep `docs/technical-guide.md` current when behaviour changes.
