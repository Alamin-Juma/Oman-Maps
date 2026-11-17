# Handover: 3D Explorer, Phase 2 (the 3D viewer)

**For:** an AI coding agent (GitHub Copilot) continuing the work in this repo.
**From:** the previous agent, 2026-11-17. The founder will review your result in the morning.
**Branch:** `feat/3d-explorer`. Do **not** push. Do **not** touch the PR #1 branch (`feat/dunialab-foundation`).

---

## 1. Read these first, in this order

1. `CLAUDE.md`: the repo rules. **All of them apply to you.** The important ones:
   - Test-driven order: feature test first (see it fail), then unit tests, then E2E.
   - Architecture docs are updated in the same change.
   - Never branch on a pack, feature or country id.
   - Child safety rules.
2. `docs/briefs/3d-explorer.md`: the full brief. **Phase 2 is your scope.** Read §3 (non-negotiables) and §4.3 (viewer behaviour).
3. `docs/adr/0008-3d-rendering-stack.md` and `docs/adr/0009-geodata-sources-and-3d-assets.md`. Both are accepted.
4. `docs/technical-guide.md`, section "3D Explorer": how the assets are made and what each file is.
5. `packages/content/src/assets3d.ts`: the manifest format (`Assets3dManifest`, `RiversFile`, `LakesFile`, `tilePath`, `TERRAIN_RGB`).

## 2. What the founder wants

> "Tapping on the web app or phone app pops up the mountains and shows full HD 3D."

In the web app:
- The child taps Mount Kenya on the 2D map. The fact card gets a **See in 3D** button.
- In 3D, the land rises out of the flat map ("pop-up") and the camera settles on a lit, textured mountain the child can orbit.
- Lakes show their water. The Tana shows on the country view.
- A header button opens **all of the map in 3D**.

The animated river flow ("Show river") is Phase 3. **Do not build it now.** Phase 2 draws rivers as static blue ribbons.

## 3. State at handover

### Committed
- `dc2be49`: Phase 0 (decisions, budgets, spikes).
- `81bb31f`: Phase 1, the generator (`tools/geo`) and the generated Kenya assets in `content-assets/ke.g5.sst.kenya-explorer/3d/` (images in Git LFS, about 20 MB). All verified: `npm run geo:verify` passes.

### Done but NOT committed yet (all tests green)

| File | What |
|---|---|
| `apps/web/package.json`, `package-lock.json` | Added `three@0.187.0`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9`, `@types/three@0.187.0` (exact pins) |
| `tests/features/web/see-in-3d.feature.test.ts` | **Feature test, 9 scenarios, passing.** Pins the scene planner against the real Kenya pack and manifest |
| `apps/web/src/three/geo.ts` | Tile maths and the local km frame (x east, z **south**, y up) |
| `apps/web/src/three/plan.ts` | **Scene planner** (pure): `planScene`, `plannedFiles`, `supports3d`, `chooseTier`, `has3d`, `tileBounds` |
| `apps/web/src/three/terrain.ts` | Pure mesh builders: `decodeHeights`, `buildGrid` (with skirt walls), `sampleGrid`, `buildRibbon`, `lakeShapePoints` |
| `apps/web/test/three.test.ts` | 18 unit tests, passing |

Commit these first, as your starting point:

```bash
git add apps/web/package.json package-lock.json apps/web/src/three apps/web/test/three.test.ts tests/features/web/see-in-3d.feature.test.ts
git commit --no-gpg-sign -m "feat(3d): Phase 2 scene planner and mesh builders (feature test green)"
```

Leave `docs/adr/0005-ai-guardrails.md` uncommitted. It's a whitespace-only change that belongs to the founder.

## 4. What is left for Phase 2 (do these in order)

### Step A. Serve the assets from our own origin (Vite plugin)

In `apps/web/vite.config.ts`, add a small plugin, `dunialab-content-assets`:

- **Dev (`configureServer`):** serve `GET /content-assets/<packId>/3d/<path>` from `<repo>/content-assets/`.
  - Serve only `manifest.json` and the files the manifest lists with a role other than `preview`.
  - Reject anything else with 404, including any `..`.
  - Set `Content-Type` from the extension (`.webp` is `image/webp`, `.json` is `application/json`).
- **Build (`writeBundle`):** copy the same files into `<outDir>/content-assets/...`.
  - Previews are never shipped to learners.
- Resolve the repo root with `fileURLToPath(new URL("../..", import.meta.url))`.
- This is a **new data flow**, so update the architecture docs (see Step F).

### Step B. Loader (`apps/web/src/three/load.ts`, browser code)

- `assetsBase(packId)` returns `${import.meta.env.BASE_URL}content-assets/${packId}/3d/`.
- Fetch and parse `manifest.json` with `Assets3dManifest.parse`, and `lakes.json` / `rivers.json` when the plan needs them.
- **Heights:** `fetch` → `blob` → `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })` → draw onto a canvas → `getImageData` → `decodeHeights`.
  - **These two options are essential.** Without them the browser can change the pixel bytes, which corrupts the heights.
- **Textures** (`albedo.webp`, `shade.webp`):
  - Load with `THREE.TextureLoader`, keeping `flipY` at its default of `true`. `buildGrid` uv `v` assumes north-up images.
  - Set `texture.colorSpace = THREE.NoColorSpace`.
  - Set `anisotropy` to `renderer.capabilities.getMaxAnisotropy()` (this gives a sharp look at low camera angles).
- Fetch at most 4 files at a time. On failure, raise an error the viewer can show ("3D is not available for this map yet").

### Step C. The viewer (`apps/web/src/three/Viewer3D.tsx`, default export, lazy-loaded)

**Props:**
`{ pack: ContentPack; featureId: string | null; locale: Locale; onClose(): void; onSelect(featureId: string | null): void }`

**Plan the scene:**
`planScene({ pack, manifest, lakes, rivers, featureId, tier: chooseTier(device), reducedMotion })`.
- Read reduced motion from `matchMedia("(prefers-reduced-motion: reduce)")`.

**Canvas:** `<Canvas flat linear ...>` from `@react-three/fiber`.
- `flat` = no tone mapping and `linear` = no colour conversion, so the baked colours appear exactly as generated.
- `dpr={[1, tier === "high" ? 2 : 1.5]}`, `gl={{ antialias: tier !== "low", alpha: true }}`.
- `camera={{ fov: 45, near: 0.1, far: 6000 }}`.
- Units are **kilometres**.

**Terrain meshes:**
- **Patch mode:** `buildGrid` over `plan.patch` with `withSkirt: true` and `lonLatAt = (u, v) => [w + u*(e-w), n - v*(n-s)]` from `plan.patch.bounds`.
- **Overview and region modes:** one `buildGrid` per tile in `plan.tiles` with `withSkirt: false` and `lonLatAt = (u, v) => [tileXToLon(x+u, z), tileYToLat(y+v, z)]`.
- Use `plan.meshStride`. Heights are 513 or 257 samples, so 512 and 256 divide by 1, 2 and 4.
- Build the geometry imperatively with `THREE.BufferGeometry` and these attributes:
  - `position` (y is always 0),
  - `aHeight` (km),
  - `aSkirt`,
  - `uv`,
  - an index.
- Dispose of geometries, materials and textures on unmount.

**One shared `ShaderMaterial` per mesh, with shared uniforms:**

```glsl
// vertex
attribute float aHeight; attribute float aSkirt;
uniform float uExag; uniform float uBase;
varying vec2 vUv; varying float vSkirt; varying float vDist;
void main() {
  vec3 p = position;
  p.y = mix(aHeight * uExag, uBase, aSkirt);
  vUv = uv; vSkirt = aSkirt;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
// fragment
uniform sampler2D uAlbedo; uniform sampler2D uShade;
uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
varying vec2 vUv; varying float vSkirt; varying float vDist;
void main() {
  vec3 c = texture2D(uAlbedo, vUv).rgb * texture2D(uShade, vUv).r * 1.18;
  c = mix(c, c * 0.45 + vec3(0.18, 0.13, 0.09), vSkirt);   // earth-coloured walls
  float f = smoothstep(uFogNear, uFogFar, vDist) * 0.55;   // distance haze
  gl_FragColor = vec4(mix(c, uFog, f), 1.0);
}
```

- **`uBase`** = (lowest height of the patch in km) × `uExag` − 0.6. The walls grow as the land rises.
- **Fog:**
  - colour `#cfe0ea`;
  - near = camera distance × 0.9;
  - far = camera distance × 3.5.
- **Sky:** use a CSS gradient behind a transparent canvas (`.viewer3d { background: linear-gradient(#9cc4e4, #e6eef2) }`).

**The rise ("pop-up"):** in `useFrame`, ease out from `plan.exaggeration.from` to `.to` over `.durationMs` (cubic ease-out).
- Set every material's `uExag`.
- Write the current value to the container as `data-exaggeration` (two decimals). The E2E test reads it.
- At the same time, fly the camera in. Start at distance × 1.8 and pitch + 20°, and end at `plan.camera` (`distanceKm`, `pitchDeg`, `headingDeg`).
- Heading 0 means the camera is **south** of the focus, looking north (+z is south).
- Keep the `OrbitControls` (drei, `makeDefault`) target at the focus height × `uExag`.
- Turn the controls off during the animation and back on afterwards. Set `maxPolarAngle` to about 80° so the camera never goes under the land.
- With reduced motion, `durationMs` is 0: no flight and no rise.

**Sea:** in overview and region modes, add a large flat plane at y = −0.005 with colour `rgb(52,104,152)`. Sea tiles are not stored, so this plane fills them in.

**Lakes:**
- Build `THREE.Shape(lakeShapePoints(outline, toLocal))` → `ShapeGeometry` → `rotateX(-Math.PI / 2)`.
- Set y = (surface + 4) / 1000 × `uExag`, updating it each frame.
- Use `MeshBasicMaterial` colour `#3d84c6`, opacity 0.85, transparent.

**Rivers (static in Phase 2):**
- `buildRibbon(points, toLocal, widthKm, 6)` with a small `ShaderMaterial` using the same `aHeight`/`uExag` approach, colour `#2f7fd0`.
- Width by mode: overview `2.5 + 4w` km, region `0.4 + 1.2w`, patch `0.15 + 0.5w`.

**Labels:**
- Use drei `<Html center>` for each item in `plan.labels`, with the text from `t(label.text, locale)`.
- Keep each label inside a `<group>`. Each frame, set its y = (height at the anchor in metres / 1000) × `uExag` + offset. The offsets are overview 15, region 3 and patch 0.8 km.
- Read the height from the loaded grids with `sampleGrid`. For tiles, work out which tile contains the anchor.
- Labels are buttons with large touch targets. Tapping one calls `onSelect(label.featureId)`.

**Information card (HTML overlay):**
- `t(plan.title)`.
- The facts in `plan.facts` (the pack's approved text, word for word; **never** a height computed from the data).
- `t(plan.exaggerationNote)`.
- Buttons:
  - **Back to map** (calls `onClose`).
  - **Whole map** (only when a feature is shown; calls `onSelect(null)`).
  - **Map data**, which toggles the list of `manifest.sources[].notices`. The licences **require** these notices (ADR-0009 §4).
- All text in en and sw. **No place names in code**: the feature test greps `apps/web/src/three/` for them. Use `pack.title`, never a literal country name.

**Container attributes for tests:**
- `data-scene-ready="true"` once all files are loaded and the first frame has been drawn.
- `data-exaggeration`.
- `data-mode` (`plan.mode`).

### Step D. Wire it into the app (`apps/web/src/App.tsx`)

- `const Viewer3D = lazy(() => import("./three/Viewer3D.js"));`. It **must** stay a lazy chunk. The bundle test fails if three.js lands in the first page load (limit: 150 kB gzip; today it is 143.9 kB).
- Add a small `apps/web/src/lib/device3d.ts` that runs once and remembers the result:
  - Check WebGL2 with `canvas.getContext("webgl2")`, then free the context with `getExtension("WEBGL_lose_context")?.loseContext()`.
  - Read `navigator.deviceMemory` (it may be undefined).
- Add state `view3d: { featureId: string | null } | null`.
- In `.map-wrap`: when `view3d` is set, render `<Suspense fallback={<p>Loading 3D…</p>}><Viewer3D key={view3d.featureId ?? "all"} …/></Suspense>`. Otherwise render the 2D `KenyaMap` and the fact card.
- **See in 3D** button in the fact card. Show it only when `supports3d(device)`, `has3d(selected)` and there is **no mission running**.
- Header chip **3D**, which opens the whole map. Show it only when `supports3d` is true and no mission is running.
- Missions never depend on 3D. If WebGL2 is missing, the 3D buttons simply do not appear.

### Step E. Tests (keep the TDD order: write each test before the code it covers)

1. **Unit tests** in `apps/web/test/`, for `load.ts` pure parts (URL building, failure messages) and `device3d.ts` (inject a fake canvas).
2. **E2E: `tests/e2e/web/see-in-3d.e2e.test.ts`.** Copy the setup from `tests/e2e/web/camera-device-check.e2e.test.ts`:
   - Production build into a temp dir. **Set `process.env.NODE_ENV = "production"` around `build()`**, as `bundle-budget.e2e.test.ts` does, or React's development build is bundled.
   - Then `preview()`.
   - Launch Chromium with `launchWebglChromium()` from `tests/e2e/support/browser.ts` (software WebGL2, the same as CI).
   - **Skip the suite when the image files are Git LFS pointers** (CI does not download them). Use `isLfsPointer` from `tools/geo/src/images.ts` on `content-assets/<packId>/3d/patches/mount-kenya/h.webp`.
   - **Scenarios:**
     - **Mount Kenya:** tap it on the 2D map (role `button`, name "Mount Kenya"), click **See in 3D**, and wait for `[data-scene-ready="true"]`. Allow up to 60 s, because software rendering is slow. Then wait for `data-exaggeration` to reach `1.50`. Take a screenshot of the canvas with `screenshotPixels()` + `pixelStats()`: expect `distinctColors > 500` and a high variance (not blank). The card shows text containing "5,199". The exaggeration note is visible.
     - **Back to map** brings back the SVG map.
     - **Header 3D:** `data-mode="overview"`, the canvas is not blank, and `lakes.json` and `rivers.json` were requested.
     - **Privacy and budget:** every request goes to the page's own origin.
     - **Reduced motion** (`browser.newContext({ reducedMotion: "reduce" })`): `data-exaggeration` is already at its target when the scene is ready.
     - **No WebGL2:** use `context.addInitScript` to make `HTMLCanvasElement.prototype.getContext` return `null` for `"webgl2"`. Then no **See in 3D** button appears and the 2D map still works.
   - **Important:** three.js canvases read back **blank** from page script. Always use `screenshotPixels()`. `tests/e2e/web/webgl2-harness.e2e.test.ts` explains why.
3. **Extend `tests/e2e/web/bundle-budget.e2e.test.ts`:**
   - The first page load still passes.
   - New test: the gzip size of the lazy JS chunks plus the bytes of the overview plan (`plannedFiles` of the whole-map plan, from the manifest) must be within `DELIVERY_BUDGET.first3dOpenBytes` (3 MB).
4. **CI:** in `.github/workflows/content-assets.yml`, after the feature step, add `npx playwright install --with-deps chromium` and run `node scripts/vitest.mjs run --project e2e tests/e2e/web/see-in-3d.e2e.test.ts`. That workflow has the real LFS images.

### Step F. Documentation (same commit as the code, per CLAUDE.md rule 2)

- **`docs/architecture/README.md`:**
  - Components diagram: turn the planned `viewer3d` node into the real one (lazy chunk; planner; loader; `content-assets` served same-origin by the Vite plugin).
  - Add a change-log line dated today.
- **`docs/architecture/flows.md`:** add "6. Opening a place in 3D" (tap → plan → fetch same-origin files → rise → orbit; no WebGL2 → stay 2D).
- **`docs/technical-guide.md`:** add "How to see the 3D" (run `npm run dev:web`, tap Mount Kenya, **See in 3D**; or the header **3D**) and update the status.
- **`docs/briefs/3d-explorer.md`:** mark Phase 2 done, with any deviations.
- **`CLAUDE.md`:** repo map line for `apps/web/src/three`.

## 5. Commands

Run everything from `C:\dev\personal\Oman-Maps`.

```bash
npm run build                    # all workspaces
npm run typecheck
npm test                         # feature + unit tests
npm run db:up                    # Docker Desktop must be running
npm run test:e2e                 # E2E (includes the 3D ones)
npm run vitest -- run --project features tests/features/web/see-in-3d.feature.test.ts
npm run vitest -- run --project e2e tests/e2e/web/see-in-3d.e2e.test.ts
npm run geo:verify               # the 3D assets still match their manifest
npm run dev:web                  # try it: http://localhost:5173
```

**Do not run `npx vitest` directly.** Use `npm run vitest -- …` or the npm test scripts. On Windows, a terminal in `c:\...` (lower-case drive letter, VS Code's default) breaks a directly started Vitest. `scripts/vitest.mjs` fixes that.

## 6. Traps already found (save yourself the time)

| Trap | What to do |
|---|---|
| three.js canvas reads back blank from page script | Screenshots only (`screenshotPixels`) |
| Vitest sets `NODE_ENV=test`, so a Vite build includes React's development build (+60 kB) | Force `production` around `build()` in tests that measure size |
| Image decode changes the bytes of height images | `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })` |
| Baked colours look washed out or too contrasty | `<Canvas flat linear>`, textures `NoColorSpace` |
| `sharp` keeps files open on Windows | Already handled in `tools/geo`; do not change it |
| Never edit `content-assets/` by hand | Change the pack or the generator, then `npm run geo:build` (downloads are cached in `.cache/geo`) |
| Place names in `apps/web/src/three/` | Forbidden; a feature test fails. Use the pack's data |
| `@react-three/fiber` 9.8.2 caps React below 19.4 | Do not upgrade React |

## 7. Rules for committing

- Commit with `--no-gpg-sign`. End each message with a `Co-Authored-By:` line naming the assistant that wrote it.
- **Do not push.** Do not touch PR #1.
- Every commit leaves `npm test`, `npm run typecheck` and `npm run build` green.
- If a data budget cannot be met, or something here turns out wrong, **stop and write it down** in the report rather than quietly changing a number in `DELIVERY_BUDGET`.

## 8. Definition of done for Phase 2

- [ ] **See in 3D** works for Mount Kenya, Kilimanjaro, Mount Elgon and the Rift Valley (patches), the two lakes (regional) and the Tana (overview). The header **3D** opens the whole map.
- [ ] The land visibly rises. Orbit and zoom work with touch and mouse. Labels can be tapped.
- [ ] The facts shown are the pack's text. The exaggeration note is shown. The map-data notices are reachable.
- [ ] The first page load is still within 150 kB gzip. The first 3D open is within 3 MB.
- [ ] Feature, unit and E2E tests pass, including the new 3D E2E.
- [ ] Docs updated (architecture diagram, flow 6, change log, technical guide, brief, CLAUDE.md).
- [ ] A short **report for the founder** in plain words, at the end of the brief or in your final message:
  - how to see it (`npm run dev:web`, then what to tap);
  - what you measured (chunk size, first-open MB, how long the scene took to become ready in the E2E);
  - anything left or any decision needed before Phase 3 ("Show river").
