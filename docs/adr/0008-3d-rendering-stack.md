# 0008. 3D Explorer rendering: three.js in the web app, baked assets, Unity reuses the assets

- **Status:** Proposed (awaiting founder approval at the Phase 0 checkpoint of `docs/briefs/3d-explorer.md`)
- **Date:** 2026-11-16

## Context
The founder asked for a simulator before AR: *"tapping on the web app or phone app pops up the mountains and shows
full HD 3D ... hitting Show river shows the 3D river flowing all the way from one point to the sea ... like Unreal
Engine games."*

Forces, from the product definition and our rules:
- Learners use **budget Android phones** (2-3 GB RAM) on **paid mobile data**, often **offline**.
- *"Every online step has an offline fallback; a mission never waits on the network."*
- No third-party services at runtime (privacy, cost, offline).
- The web app (Tier C) already runs on phones in the browser. The Unity learner app (ADR-0002) is not built yet and
  Unity is not installed on the development machine.
- New grades must stay content drops (ADR-0004).

## Options
| Option | Why not / why |
|---|---|
| **Unreal Engine** | No web export. Pixel Streaming needs a cloud GPU per learner (cost) and a fast connection (breaks offline). APKs of hundreds of MB. Rejected. |
| **Unity WebGL build** | Tens of MB of engine before the first frame: breaks the data budget. Unity stays the phone app, not the web renderer. Rejected for web. |
| **CesiumJS** | A whole-globe engine (heavy), and its good terrain lives on Cesium ion, a third-party runtime service. Rejected. |
| **Babylon.js** | Viable and capable. No decisive advantage; weaker fit with our React code. Kept as the fallback. |
| **three.js + React Three Fiber** | Small core, tree-shakeable, renders exactly what we give it, integrates with the existing React app, largest ecosystem. **Chosen.** |

## Decision
1. **Web renderer:** `three` with `@react-three/fiber` and `@react-three/drei`, in a **lazy chunk** under
   `apps/web/src/three/`. Versions are pinned exactly, each at least two weeks old when chosen, peers checked
   against our React 19.3.1:

   | Package | Version | Released | Licence | Peer requirement checked |
   |---|---|---|---|---|
   | `three` | 0.187.0 | 2026-10-30 | MIT | none |
   | `@react-three/fiber` | 9.8.2 | 2026-10-14 | MIT | `react >=19 <19.4`, `three >=0.156` |
   | `@react-three/drei` | 10.7.9 | 2026-09-25 | MIT | `react ^19`, `three >=0.159`, `@react-three/fiber ^9` |
   | `@mapbox/martini` | 0.2.0 | 2020-01-31 | ISC | none (adaptive terrain meshing, RTIN) |

   They are **installed in Phase 2**, not now, so Phase 0 changes nothing a learner downloads.
   Note for upgrades: `@react-three/fiber` 9.8.2 caps React below 19.4.

2. **"Unreal-like" is achieved by baking, not by real-time effects.** Lighting, ambient occlusion, detail normals and
   land-cover colour are computed offline by the generator (ADR-0009). The phone draws a modest mesh with rich
   textures. Real-time shadows and bloom are for the `high` quality tier only. The honest target is
   "documentary-map realism" at **30 fps or more on a 2-3 GB Android phone**, measured on a real phone.

3. **Behaviour comes from `feature.kind`, never from an id.** A pure, unit-tested *scene planner* turns
   `(feature, asset manifest, quality tier)` into camera poses, levels of detail, labels and an animation script.
   Rendering only executes the plan.

4. **3D is an enhancement.** No WebGL2, low memory, or assets still downloading means the 2D map keeps working.
   Missions never depend on 3D.

5. **Unity consumes the same generated assets** (16-bit RAW heightmaps, the same textures, river JSON). No Unity
   scene code is written until Unity 6 LTS is installed and the code can be run.

6. **Budgets are code** (`DELIVERY_BUDGET` in `@dunialab/content`), enforced by tests:
   first page load 150 kB gzip of JavaScript (measured today: 143.9 kB), first 3D open 3 MB, one HD patch 1.5 MB,
   one pack 25 MB.

## What the Phase 0 spike proved (kept as `tests/e2e/web/webgl2-harness.e2e.test.ts`)
Measured on 2026-11-16, Chromium 158 headless, Windows, launched by `tests/e2e/support/browser.ts`:

| Question | Answer |
|---|---|
| Does our E2E browser give WebGL2? | Yes, on **SwiftShader** (software), the same path CI uses. Flags are pinned so a laptop GPU cannot change results. |
| Capabilities | Max texture 8192 px, float textures (linear filtering and render targets), 32-bit mesh indices. |
| Can tests read pixels back? | Yes, exact colours. |
| The trap | A canvas with `preserveDrawingBuffer: false` (three.js's default) reads back **blank** from script after the frame. A **screenshot** still sees it. All 3D tests use `screenshotPixels()`. |
| Do animations run? | Yes: 31 frames in 500 ms. Playwright's clock drives `requestAnimationFrame` deterministically, so "river progress goes 0 to 1" is testable without waiting. |
| Is software rendering fast enough for tests? | A 131,000-triangle mesh at 800x600 takes about 59 ms per frame. Fine for tests; it says nothing about phones. |
| A second trap | Under Vitest, `NODE_ENV=test` makes a Vite build bundle React's development build (205.6 kB instead of 143.9 kB gzip). Size tests must force a production build. |

## Consequences
- The web app gains a WebGL dependency behind a lazy import. The bundle test (`tests/e2e/web/bundle-budget.e2e.test.ts`)
  fails if 3D code leaks into the first page load.
- Phone performance cannot be proven in CI. Each phase has a human checkpoint on the founder's phone (`npm run dev:phone`).
- Two renderers (three.js now, Unity later) share assets, not code. The scene planner is the candidate for shared
  fixtures if Unity needs the same behaviour (as mastery rules do, ADR-0003).
- **Open, decided in Phase 4:** how assets are cached for offline use (a small hand-written service worker or
  `vite-plugin-pwa`).
- Diagrams changed: components (planned 3D viewer, E2E WebGL harness) and change log in `docs/architecture/README.md`.
