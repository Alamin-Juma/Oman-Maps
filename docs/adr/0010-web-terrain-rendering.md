# 0010. Phase 2 terrain grids and stable depth at map scale

- **Status:** Accepted for Phase 2 implementation within [ADR-0008](0008-3d-rendering-stack.md); replaces its
  adaptive RTIN meshing (and the `@mapbox/martini` dependency) with strided grids
- **Date:** 2026-11-17

## Context

The generated height rasters have 257 or 513 samples per side. Phase 2 needs a
predictable, low-cost mesh whose height can animate without rebuilding geometry.
The original brief proposed adaptive RTIN meshes. The inherited planner instead
selects uniform strides of 4, 2 or 1 for low, medium and high memory tiers.

## Decision

- Use the tested strided grid builders, with walls around HD patches. This avoids
  another dependency and keeps the rise in a shared shader uniform. Adaptive RTIN
  can replace this builder if real-phone measurements in Phase 4 justify it.
- Keep the required 0.1 to 6000 km camera range, but enable logarithmic depth in
  the renderer and custom terrain/river shaders. Browser inspection showed depth
  flicker between sea and terrain at overview distances with ordinary depth.
- Keep height images byte-exact and baked colour textures in `NoColorSpace`.
  Water and fog colours use explicit RGB components in the same linear pipeline.
- Give drei HTML labels a dedicated DOM portal. Its default event target changes
  during Canvas setup, which caused disappearing labels and a `removeChild` error
  when leaving a scene in the production browser test.

## Consequences

The mesh cost is predictable but not adaptive to terrain complexity. Device
memory selects the tier; dynamic frame-time probing, offline caching and advanced
label collision/terrain occlusion are Phase 4 work. The current viewer already
supports reduced motion, same-origin loading, static water and deterministic
resource cleanup. Phone frame rate still needs human measurement.
