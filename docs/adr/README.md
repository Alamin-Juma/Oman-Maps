# Architecture Decision Records

One file per significant decision: context, decision, consequences. Never edit an
accepted ADR's decision. Supersede it with a new one and link both ways.

| # | Decision | Status |
|---|---|---|
| [0001](0001-rebuild-as-monorepo.md) | Rebuild (not revive) the 2019 project as a TypeScript + Unity monorepo | Accepted |
| [0002](0002-unity-for-learner-app-not-react-native.md) | Unity for the learner app; React only for web; no React Native | Accepted |
| [0003](0003-event-sourced-mastery.md) | Mastery is derived from an event log by fixed rules, shared via fixtures | Accepted |
| [0004](0004-content-packs-are-the-extension-point.md) | Content packs are the extension point for grades, subjects and countries | Accepted |
| [0005](0005-ai-guardrails.md) | AI may only choose among teacher-approved outcomes, behind a port, with offline fallback | Accepted |
| [0006](0006-test-driven-feature-unit-e2e.md) | Feature → unit → E2E test-driven workflow | Accepted |
| [0007](0007-backend-stack.md) | Backend: NestJS 12, Drizzle, PostgreSQL 17, zod; ESM throughout | Accepted |
| [0008](0008-3d-rendering-stack.md) | 3D Explorer: three.js in the web app, baked assets, Unity reuses the assets | Proposed |
| [0009](0009-geodata-sources-and-3d-assets.md) | Geodata sources and licences; generated 3D assets committed with a manifest | Proposed |

Template: copy [`_template.md`](_template.md).
