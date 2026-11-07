# DuniaLab learner app (Unity)

Unity 6 LTS, Android first. Implements experience **Tier A** (full AR on ARCore-certified phones) and
**Tier B** (scan-and-pop 3D viewer on any ~3 GB phone with a camera). Tier C (flat 2D map) lives in `apps/web`.
Why Unity and not React Native: [ADR-0002](../../docs/adr/0002-unity-for-learner-app-not-react-native.md).

## Layout

```
Assets/DuniaLab/
  Core/      plain C# 9, NO UnityEngine refs (DuniaLab.Core.asmdef, noEngineReferences)
    Mastery/   C# port of @dunialab/mastery, verified against the shared fixtures
    Device/    experience-tier selection (A / B / C)
  AR/        Tier A, compiles only when AR Foundation >= 6 is installed
  Editor/    "DuniaLab > Install required packages"
Core.Tests/  dotnet test project: runs Core against packages/mastery/fixtures (no Unity needed)
```

## First-time setup (needs the Unity editor)

1. Install **Unity Hub** and the current **Unity 6 LTS** editor (6000.3 LTS at the time of writing; check
   [unity.com/releases](https://unity.com/releases/editor/qa/lts-releases)) with **Android Build Support**.
2. Unity Hub → **Add → Add project from disk** → select `apps/unity`. Pick the Unity 6 LTS editor when asked.
   Unity creates `ProjectSettings/` and `Packages/` on first open.
3. Menu **DuniaLab → Install required packages** (AR Foundation, ARCore, Addressables, URP, Input System,
   Localization, Newtonsoft JSON, Test Framework at the versions verified for your editor).
4. Commit `Packages/manifest.json`, `Packages/packages-lock.json` and `ProjectSettings/` (that pins versions for the team).
5. Project Settings → XR Plug-in Management → Android → enable **Google ARCore**.
   Player → Android: minimum API level per the AR Foundation docs; IL2CPP; ARM64.

## Tests

```bash
# Unity-free core (runs anywhere, in CI):
cd apps/unity/Core.Tests && dotnet test
```
PlayMode/EditMode tests for scenes use the Unity Test Framework and run in CI via GameCI once scenes exist.

## Content

Content packs are the same JSON the API and web use (`packages/content/packs`). `npm run sync:unity-content`
copies them into `Assets/DuniaLab/Content/Packs/`, which becomes an Addressables group.
**Never edit pack JSON inside Unity**: edit it in `packages/content` and re-sync.

## Status

| Piece | State |
|---|---|
| C# mastery engine | Done, passing all shared fixtures |
| Tier selection | Done, unit tested |
| Tier A image anchoring (`MapAnchor`) | Scaffold, **not yet run in an editor** |
| Tier B on-device map recognition | Not started: week-1 spike (OpenCV-based matching vs licensed SDK) |
| Mission runner UI, offline event queue, sync client | Not started |
