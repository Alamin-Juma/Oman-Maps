# Key runtime flows

Update the matching diagram whenever one of these flows changes. See the rule in [README.md](README.md).

## 1. One mission session (about 15 minutes)

Scan → explore → mission → explain → feedback → (later) review → report.

```mermaid
sequenceDiagram
  autonumber
  actor Child
  participant App as Learner app (Unity / web)
  participant Q as Local event queue
  participant API as DuniaLab API
  participant AI as Claude (via AiGrader)

  Child->>App: Point phone at printed map
  App->>App: Recognise map on device (Tier A AR / Tier B image match / Tier C none)
  Child->>App: Explore, then do 3-5 tasks
  App->>Q: Append AttemptEvent per task (offline, instant)
  Child->>App: Write explanation
  alt online
    App->>API: POST /v1/explanations/check {packId, taskId, answer, locale, attempt} (client timeout 6 s)
    API->>API: parent consented to current policy? (else offline checker, nothing leaves)
    API->>API: redactIdentifiers(answer): phones, emails, links
    API->>AI: task + rubric + hint ids + redacted answer (no child identity)
    AI-->>API: {verdict, criteriaMet, hintId, confidence, unsafe}
    API->>API: decideFeedback(): threshold, approved ids only, unsafe => flag
    API-->>App: accepted | hint(id) | choice-follow-up
  else offline, timeout or AI failure
    App->>App: checkExplanationLocally() (same three outcomes)
  end
  App->>Q: Append explain / follow-up event
  App-->>Child: Practising / Mastered per skill (never a percentage)
```

## 2. Offline-first sync

```mermaid
sequenceDiagram
  autonumber
  participant Q as Local event queue (phone)
  participant API as API /v1/sync
  participant DB as Postgres learning_events
  participant M as @dunialab/mastery

  Note over Q: Events carry a client UUID (eventId)
  Q->>API: {profileId, packId, events[<=500]}
  API->>API: parent owns profile? (else 404)<br/>skills exist in pack? (else 400, whole batch)
  API->>DB: INSERT ... ON CONFLICT (event_id) DO NOTHING
  DB-->>API: rows inserted
  API->>DB: SELECT all events for (profile, pack)
  API->>M: computeSkillStates(events, rules)
  API-->>Q: {accepted, duplicates, skills[]}
  Q->>Q: Drop acknowledged events; adopt server skill states
```

Retries are safe: re-sent events become `duplicates`, never double counted.

**Ownership on a shared phone.** The device queue is per learner. An event's `profileId` never changes once it
belongs to a child; sync sends only the selected child's events. Events played before a parent links the device
carry a per-session **guest id** and are adopted once by the first child linked. Sign-out issues a new guest id, so
the next family can never adopt this family's guest play.

## 3. Weekly parent report

```mermaid
sequenceDiagram
  actor Parent
  participant Web as Web report page
  participant API as API
  participant M as @dunialab/mastery
  Parent->>Web: Open link (SMS / WhatsApp, planned)
  Web->>API: GET /v1/profiles/:id/report?packId&week&locale
  API->>M: weeklySummary(events, week)
  API-->>Web: mastered this week, needs support, labels in parent's language
```

## 4. Adding a new grade (content drop)

For 3D terrain, rivers and lakes of the new pack, also run flow 5.

```mermaid
flowchart LR
  A[Teacher-designer writes pack JSON] --> B[npm run validate:content]
  B -->|fails| A
  B -->|ok| C[Teacher sign-off: review.status = approved]
  C --> D[Drop into packs folder]
  D --> E[API ContentRegistry loads it at start]
  E --> F[/v1/catalog lists it]
  D --> G[sync-unity-content -> Addressables bundle]
```

## 5. Generating a pack's 3D assets (build time, on a developer machine)

`npm run geo:build` (ADR-0009). Learners' devices are not involved: they later fetch only the
committed files, from our own origin.

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant Gen as tools/geo generator
  participant Cache as .cache/geo (gitignored)
  participant Open as Open geodata (Copernicus DEM, WorldCover, Natural Earth)
  participant Out as content-assets/<packId>/3d
  actor Teacher

  Dev->>Gen: npm run geo:build
  Gen->>Gen: read every pack: map bounds + features (kind, anchor, rough river line)
  Gen->>Open: range requests for the levels and windows needed (retries on dropped connections)
  Open-->>Cache: raw rasters, cached; a second run needs no network
  Gen->>Gen: trace each river downhill to the sea or a lake, inside a corridor around the surveyed line
  Gen->>Gen: find each lake's flat surface and outline
  Gen->>Gen: bake heights, surface colour and relief light: overview tiles, regional tiles, HD patches (by feature kind)
  Gen->>Out: tiles, patches, rivers.json, lakes.json, previews, manifest.json (SHA-256 + size per file, sources, licences, review flags)
  Gen->>Gen: verify files against the manifest and the data budgets (exit 1 on any problem)
  Dev->>Teacher: previews/*.jpg for review
  Teacher-->>Dev: approve, or correct the pack (anchor, rough line) and regenerate
  Dev->>Out: commit (images through Git LFS)
  Note over Out: CI verifies sizes, fingerprints and budgets from the LFS pointers on every run,<br/>and the real pixels only when assets, generator or packs change
```

## 6. Opening a place in 3D

```mermaid
sequenceDiagram
  actor Child
  participant Map as Web 2D map
  participant Viewer as Lazy 3D viewer
  participant Plan as Pure scene planner
  participant Assets as Same-origin content-assets (Vite / static host)
  Child->>Map: Tap a place, then See in 3D (or header 3D)
  alt no WebGL2 or memory at most 1 GB
    Map-->>Child: Keep working 2D map; no 3D buttons
  else capable device, no mission running
    Map->>Viewer: Load lazy chunk
    Viewer->>Assets: Fetch and validate manifest.json
    Viewer->>Plan: Pack + manifest + feature + tier + reduced motion
    Plan-->>Viewer: Patch / region / overview, camera, approved facts
    Viewer->>Assets: Fetch planned JSON and WebP (at most four concurrent files)
    Note over Assets: Only manifest-listed learner files are served/copied; never previews
    Viewer->>Viewer: Decode exact height bytes, build meshes, draw first frame
    Viewer-->>Child: Land rises and camera flies in; then orbit / zoom / tap labels
    Note over Viewer: Reduced motion cuts directly to final height and camera.<br/>Facts come from the pack; Map data exposes licence notices.
    alt missing assets, chunk failure or lost graphics context
      Viewer-->>Child: Explain 3D is unavailable; Back to map remains usable
    end
    Child->>Map: Back to map (or start a mission)
    Map->>Viewer: Unmount, cancel loads, dispose graphics resources
  end
```

No geodata provider is contacted by the browser. Offline asset caching and adaptive frame-time
quality tuning remain Phase 4; missions never wait for the viewer.
