# DuniaLab Technical Guide

> The document we come back to, to learn and to remember what we are building and why.
> Keep it current: if behaviour changes, this guide changes in the same PR.
> Last updated: 2026-11-07.

**Contents**
1. [What we are building](#1-what-we-are-building)
2. [How the pieces fit](#2-how-the-pieces-fit)
3. [Repository map](#3-repository-map)
4. [Getting started](#4-getting-started)
5. [How we work (rules)](#5-how-we-work-rules)
6. [Concepts explained](#6-concepts-explained)
7. [Common tasks (how-to)](#7-common-tasks-how-to)
8. [Status and roadmap](#8-status-and-roadmap)
9. [Open questions](#9-open-questions)
10. [Glossary](#10-glossary)

---

## 1. What we are building

**DuniaLab**: printed, curriculum-mapped learning maps that come alive on any Android phone. Each mission ends
with the child **explaining** what they learned, and a **mastery report** a parent or teacher can trust.
*AR is the hook. The learning loop is the product.*

- **First product:** *Kenya Explorer*, Kenya **Grade 5 Social Studies**, Strand 1.0 (Natural and Built Environments),
  sub-strands **1.1 Elements of a map** and **1.3 Main physical features in Kenya**, **6 missions**.
- **Origin:** Oman Maps (2019, Unity + Vuforia) proved the moment of delight. It did not prove learning,
  return use or payment. Those three are what DuniaLab must prove in the pilot.
- **Pilot gates** (from the product definition): ≥ 80% of phones run Tier B or better; ≥ 70% complete 3+ missions;
  ≥ 50% return in week 3; ≥ +10 pts on a delayed test; ≥ 85% AI-teacher agreement; parents and schools pay.
- **Source of truth:** [`docs/product/DuniaLab — Product Definition & Validation.docx`](product/).

**The session loop:** scan → explore → mission (3-5 tasks) → explain → feedback → spaced review → report.

## 2. How the pieces fit

Read [`docs/architecture/`](architecture/README.md) for the diagrams. In one paragraph:

The **content pack** (JSON) describes a curriculum unit. Three **pure packages** give everyone the same behaviour:
`content` (schema, validation, offline rubric checker), `mastery` (rules, review, weekly summary) and `mission`
(the session state machine). The **learner app** (Unity: Tiers A/B) and the **web app** (Tier C + parent area)
run missions **offline**, append **events** to a local queue and **sync** later. The **API** (NestJS + Postgres)
stores events idempotently, recomputes mastery with the same engine, serves reports, and runs the guarded
**AI explanation check**, which always has an offline fallback.

## 3. Repository map

| Path | What | Tests |
|---|---|---|
| `packages/content` | Pack schema (zod), validator + CLI, offline rubric checker, `packs/kenya-explorer.json` | `test/` |
| `packages/mastery` | Mastery rules, Leitner review + interleaving, weekly summary, `fixtures/conformance.json` | `test/` |
| `packages/mission` | Mission session: task order, one hint then follow-up, one event per task | `test/` |
| `apps/api` | NestJS 12 API: auth, consent, profiles, sync, report, catalog, explanation check | `test/` |
| `apps/web` | React + Vite: Tier C 2D map, missions, offline queue, parent area | `test/` |
| `apps/unity` | Unity 6 LTS learner app. `Assets/DuniaLab/Core` is plain C# | `Core.Tests/` (dotnet) |
| `tests/features` | Acceptance specs (Given/When/Then), written first | |
| `tests/e2e` | Real API + Postgres (+ Chromium for web) | |
| `docs/` | product, architecture, adr, engineering, this guide | |
| `docker/`, `docker-compose.yml` | API image, Postgres, `app` profile | |
| `legacy/oman-maps-2019` | The 2019 project, reference only | |

## 4. Getting started

**Prerequisites:** Node 22 (`.nvmrc`), Docker Desktop, .NET 10 SDK (for C# core tests), Unity 6 LTS (only for the learner app).

```bash
npm install
npm run build                     # all packages + apps
npm test                          # feature + unit tests
npm run db:up                     # Postgres 17 on localhost:5433
npm run test:e2e                  # API + Postgres + Chromium end-to-end
npx playwright install chromium   # first time only, for the browser E2E

# Run it
npm run dev:api                   # API on http://localhost:3000 (in-memory store unless DATABASE_URL is set)
npm run dev:web                   # Web on http://localhost:5173
```

API environment (`apps/api/.env`, never committed):

```ini
DATABASE_URL=postgres://dunialab:dunialab@localhost:5433/dunialab
JWT_SECRET=<32+ random chars>
ANTHROPIC_API_KEY=            # optional; without it the offline rubric checker answers
AI_MODEL=claude-opus-5-5      # default
AI_CONFIDENCE_THRESHOLD=0.75
```

Docker (the same image we deploy):

```bash
docker compose --profile app up -d --build        # Postgres + API on :3000
E2E_API_URL=http://localhost:3000 npm run test:e2e
```

C# core (no Unity needed): `cd apps/unity/Core.Tests && dotnet test`.

## 5. How we work (rules)

All four are mandatory. Details in [`CLAUDE.md`](../CLAUDE.md).

1. **Feature → Unit → E2E.** A feature test in `tests/features/` comes first and fails; unit tests drive the code;
   an E2E test proves the slice. See [engineering/testing-workflow.md](engineering/testing-workflow.md).
2. **Architecture docs move with the code.** Any architectural change updates the Mermaid diagrams and the
   change log in `docs/architecture/`, plus an ADR when a trade-off was made.
3. **Modular from day one.** New grades/subjects/countries are **content packs**, never code edits. No code
   branches on a pack, grade or country. All progress is scoped by `packId`.
4. **Child safety by design.** Minimal data, strict request schemas, AI returns ids only, no child identity to the AI,
   offline fallback for every online step, only approved packs in production.

## 6. Concepts explained

### Experience tiers (A / B / C)
Many budget Android phones in Kenya are **not ARCore-certified**, so one AR-only app would exclude many children.
- **A, Full AR:** ARCore phones. Terrain anchored to the paper (AR Foundation image tracking).
- **B, Scan and pop:** any ~3 GB phone with a camera. Recognise the printed map on the device, then show a 3D model to rotate and tap.
- **C, 2D map:** low-end phones, laptops, the web (`apps/web`).
All tiers share the **same mission and mastery layer**, so results are comparable. Selection: `TierSelector` in `apps/unity/Assets/DuniaLab/Core/Device`.

### Offline-first and event sourcing
The phone never waits for the network during a mission. Every answer becomes an **AttemptEvent** in a local queue.
Sync sends batches; each event has a **client UUID**, so the server stores it once (`ON CONFLICT DO NOTHING`)
no matter how many times a flaky connection resends it. On a shared family phone the queue is **per learner**: a child's
events never move to a sibling; play before a parent signs in is a **guest** session adopted once by the first linked child (storage writes are best-effort: a full or blocked browser storage never stops the app or the guest-id rotation on sign-out). **Mastery is never stored.** It is recomputed by replaying
the events, so phone and server always agree, and a rule change applies retroactively.

### Mastery rules
- **Mastered** = correct on **2 separate days** (Kenyan local days, UTC+3), including **1 accepted explanation**.
- Mastery is **sticky**: a later mistake tightens the review schedule; it never takes "Mastered" away from a child.
- Children see **Practising / Mastered**, never percentages.
- Rules live in `packages/mastery` and are pinned by `fixtures/conformance.json`, which TypeScript **and** C# must pass.

### Spaced review and interleaving
Each skill sits in a **Leitner box** with review intervals of 1, 3, 7, 14 and 30 days. A correct review moves it up one box
(once per day); a wrong one sends it back to box 0. Review sessions **interleave** sub-strands (map skills,
then a physical-feature skill, and so on), which feels harder but improves long-term retention.

### The explanation step and the AI guardrails
The explanation is what separates DuniaLab from AR toys, and it matches the competency-based assessment.
1. The child writes 1-2 sentences (or taps words from a **word bank**).
2. **Online** (only for parents who consented to the current policy; the client gives up after 6 s): the API redacts phone numbers, emails and links, then sends the **task, rubric, approved hints, exemplar, locale and answer** (never who the child is)
   to Claude, constrained by **structured outputs** to `{verdict, criteriaMet, hintId, confidence, unsafe}`.
3. `decideFeedback` turns that into exactly one of **accepted / one hint / multiple-choice follow-up**:
   low confidence, off-topic or unsafe never gets "accepted"; unknown ids are discarded; unsafe raises a teacher flag.
4. **Offline / failure:** the deterministic **rubric checker** on the device (teacher-written phrase evidence in English and Kiswahili) returns the same three outcomes.
The AI never writes text a child reads, and never decides mastery. Model: `claude-opus-5-5`, effort `low`, configurable.

### Content packs (the extension point)
A pack is a JSON file: country, grade, subject, strand, sub-strands, skills (with curriculum outcome and parent label),
map features (coordinates, facts, narration keys), missions and tasks (choice, locate, explain), rubrics, hints,
follow-ups, print target and **review status**. `npm run validate:content` checks the schema and cross-references,
for example that every mission ends in an explanation and every skill can be mastered.

### Data protection (Kenya)
We store only: parent email + password hash, consent records, child **nickname + grade + picture-PIN hash**, and learning events.
No real names, birth dates, photos, location, voice or camera images. Consent to the **current policy version**
comes before any child profile. Before the pilot: ODPC registration, a DPIA, and a Kenyan data protection lawyer's review.

## 7. Common tasks (how-to)

**Add a mission to Kenya Explorer**
1. Feature test first if it introduces new behaviour (usually it does not; content does not need code).
2. Edit `packages/content/packs/kenya-explorer.json` (every mission must end with an `explain` task).
3. `npm run build -w @dunialab/content && npm run validate:content && npm test`.
4. Have the teacher-designer review the wording, rubric evidence and Kiswahili.

**Add a new grade or country**
1. Create `packages/content/packs/<id>.json` (copy the shape of `kenya-explorer.json`).
2. Validate. Run `npm run basemap -w @dunialab/web` if the region changed. Run `npm run sync:unity-content`.
3. Nothing else: the API catalog, sync, reports and the web app pick it up automatically.

**Change a mastery rule**
1. Add or adjust a case in `packages/mastery/fixtures/conformance.json` (it fails in TS and C#).
2. Update `packages/mastery/src/engine.ts` **and** `apps/unity/Assets/DuniaLab/Core/Mastery/MasteryEngine.cs`.
3. `npm test` and `dotnet test apps/unity/Core.Tests`. Write an ADR if it changes product behaviour.

**Change the database schema**
1. Edit `apps/api/src/db/schema.ts`, then `npm run db:generate -w @dunialab/api` (creates SQL in `apps/api/drizzle/`).
2. Update `docs/architecture/data-model.md`. Migrations run automatically at API start.

**Test the camera on a real phone (Tier B precursor)**
1. `npm run dev:phone` — serves HTTPS on the LAN and prints the URL to type on the phone.
   The camera API exists only in a *secure context*: `localhost` qualifies, a LAN IP over plain
   HTTP does not, which is why this script exists.
2. On the phone (same Wi-Fi), open the printed `https://<lan-ip>:5173/?check=camera` URL.
   Accept the self-signed certificate warning once ("Advanced" then "Proceed").
3. Tap **Start camera**, then **Take picture**. The 📷 chip in the header toggles the same panel.
4. On this computer, `npm run dev:web` then <http://localhost:5173/?check=camera> works with no
   certificate, because loopback is a secure context.

Nothing is uploaded: the stream and the captured JPEG stay in the page. The E2E test
`tests/e2e/web/camera-device-check.e2e.test.ts` runs Chromium with a synthetic camera and asserts
both that a frame is really decoded and that no request carries image data.
*Full AR on the printed map (Tier A) is a separate step: it needs Unity 6 LTS installed, the ARCore
packages (`DuniaLab > Install required packages`), an Android build and the printed A2 sheet.*

**Use the real AI locally:** put `ANTHROPIC_API_KEY` in `apps/api/.env`, restart `npm run dev:api`, sign in on the web app, and the explanation check goes through Claude.

## 8. Status and roadmap

Done on 2026-11-07 (foundation):

| Area | State |
|---|---|
| Monorepo, legacy archived, CI | Done |
| Content schema, validator, Kenya Explorer pack (draft, 6 missions, EN/SW) | Done (**needs teacher review**) |
| Mastery engine (TS) + conformance fixtures; C# port passing them | Done |
| Mission session package | Done |
| API: auth, consent, profiles, sync, report, catalog, AI check with guardrails | Done |
| Postgres schema + migrations, Docker image | Done |
| Web Tier C: 2D map, missions, offline queue, parent area | Done (MVP quality) |
| Unity: project skeleton, package bootstrap, Tier A anchor scaffold | Scaffold (not yet opened in an editor) |

Next, mapped to the product definition's 11-week build (mid-Nov 2026 to end of Jan 2027):

1. **Week 1:** Test the 20 most common pilot-family phones (ARCore support, Tier B performance) and use the results to set the tier split.
2. **Week 1-2:** Tier B spike: on-device recognition of the A2 map (OpenCV-based vs licensed SDK). This is the pitch demo.
3. Unity: mission runner (port of `@dunialab/mission`), offline queue + sync client, 3D Kenya terrain, Addressables pack.
4. **AI eval harness:** 50+ real, teacher-marked explanations per rubric; measure AI-teacher agreement (≥ 85%) and cost per check.
5. Recorded English/Kiswahili narration; Localization tables.
6. Teacher class view (basic class mastery table); parent report link by SMS/WhatsApp.
7. Before any child uses it: DPIA, ODPC registration, lawyer review, account deletion + retention job, rate limiting.
8. Pilot: usability (2 schools, 3 weeks), then outcomes (4 schools, 6 weeks), Term 1 2027.

## 9. Open questions

- Share of Grade 4-6 learners in private schools (KNBS / Ministry statistics).
- Hosting region and cross-border transfer safeguards for children's data (lawyer).
- Confirmed Term 1 2027 dates.
- Tier B recognition approach and its licence cost.
- Real AI cost per explanation check; whether a smaller model holds ≥ 85% agreement (founder's decision, with eval data).

## 10. Glossary

| Term | Meaning |
|---|---|
| **CBC** | Kenya's Competency-Based Curriculum: assessment asks learners to apply and explain |
| **KICD** | Kenya Institute of Curriculum Development: approves curriculum content |
| **KNEC** | Kenya National Examinations Council: school-based assessments |
| **ODPC** | Office of the Data Protection Commissioner (Kenya) |
| **DPIA** | Data protection impact assessment |
| **Strand / sub-strand** | Curriculum units. Strand 1.0 has sub-strands 1.1-1.4 |
| **Skill** | A learning outcome we track mastery for; belongs to a sub-strand |
| **Content pack** | JSON describing one curriculum unit; the unit of growth |
| **AttemptEvent** | One recorded answer; the only thing synced |
| **Leitner box** | Spaced-repetition bucket that sets the next review interval |
| **Interleaving** | Mixing topics in review instead of repeating one |
| **Tier A/B/C** | Full AR / scan-and-pop 3D / flat 2D map |
| **Port / adapter** | An interface (port) the core depends on, and a swappable implementation (adapter) |
| **Exemplar** | A model answer written by the teacher |
| **Follow-up** | The multiple-choice question used when an explanation cannot be accepted |
