# 0002. Unity for the learner app; React for web only; no React Native

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
The founder asked whether the mobile app should be React Native. Requirements from the product definition:
- **Tier A**: 3D terrain anchored to the printed paper via ARCore image tracking.
- **Tier B**: on-device recognition of the printed map on non-ARCore phones, then a rotatable, tappable 3D model.
- **Tier C**: a flat 2D map with the same missions, for low-end phones, laptops and the web.
- Offline after one 30-50 MB content-pack download; base app under 60 MB; budget Android phones.
- *"Unity (current long-term-support release), Android first. Reuses the founder's Unity experience; one codebase for all three tiers."*

## Options
| Option | AR / 3D | Offline content packs | Fit |
|---|---|---|---|
| **Unity 6 LTS + AR Foundation + Addressables** | First-class (AR Foundation, ARCore XR Plugin, URP) | Addressables built for this | Best |
| React Native + native ARCore bridge | Must write and maintain native AR modules; 3D via a separate engine | Hand-rolled | Poor |
| React Native embedding Unity | Two runtimes, two build systems, bigger APK | Split | Worst of both |
| Native Kotlin + SceneView | Good AR, weaker 3D tooling; no reuse of the founder's Unity skills | Hand-rolled | OK |

## Decision
- **Learner app = Unity 6 LTS**, Android first, implementing Tiers A and B (and a Tier C scene if needed on the phone).
- **React (Vite) = web**: Tier C in the browser plus the parent and teacher pages.
- **No React Native** for the MVP. A parent companion app is not needed: parents get reports by SMS/WhatsApp link to a web page on the phone they already use.

## Consequences
- Shared logic must be available to C#: mastery rules are pinned by JSON conformance fixtures (ADR-0003), and content packs are plain JSON (ADR-0004).
- Unity builds need a Unity licence in CI (GameCI); not wired until the Unity project has scenes.
