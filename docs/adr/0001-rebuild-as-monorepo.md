# 0001. Rebuild (not revive) as a TypeScript + Unity monorepo

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
The 2019 Oman Maps project (Unity 2018.3, Vuforia, the ARKit plugin, Mapbox SDK, GoogleARCore SDK 1.x) won 2nd place at
Oman's national inter-university expo and led to a Ministry of Education meeting. Inspection on 2026-11-07 confirmed the
product definition: the repository holds only Vuforia sample targets (`VuforiaMars_Images`) and an empty `SampleScene`.
Every SDK in it is obsolete, and 6,696 files of Unity's `Library/` cache had been committed.

The product definition: *"What carries forward: the interaction pattern (scan, reveal, tap to explore), the mode switching
and the founder's credibility story. What does not: the code. DuniaLab is a rebuild, not a revival."*

## Decision
- Move the old project to `legacy/oman-maps-2019/` (history preserved by `git mv`); stop tracking `Library/` and `Logs/`.
- Start a monorepo with npm workspaces:
  - `packages/content`, `packages/mastery`: pure, shared logic and data.
  - `apps/api`: backend. `apps/web`: Tier C + parent pages. `apps/unity`: learner app.
  - `tests/features`, `tests/e2e`: acceptance and end-to-end tests (ADR-0006).
  - `docs/`: product, architecture, ADRs, technical guide.

## Consequences
- One place, one CI, one version of shared rules.
- Unity is not an npm workspace; it consumes shared data via a sync script and shared fixtures.
- The legacy folder is reference only; nothing builds from it.
