# Engine internals

A map of how a world draws: the engine, the frame's stages in order, what each subsystem owns and
where its code lives, and the rules that hold across files. The code is the contract: each
module's head comment states its rule and its reasons; this page names the module once. Paths are
under `packages/sdk-browser/src/`; `sdk-core/` stands for `packages/sdk-core/src/`, and a path that
starts with `packages/` or `tests/` is from the repository root.

The page's API is [SDK.md](SDK.md); what stays in memory, [RESIDENCY.md](RESIDENCY.md); shadows,
[SHADOWS.md](SHADOWS.md); the cache files, [FORMAT.md](FORMAT.md); the body API,
[PHYSICS.md](PHYSICS.md); the maths, [MATHS.md](MATHS.md). Two internals are public, for a host
that drives pages or diagnostics itself: `createGpuPageCache` (`pages/pool/pages.ts`) and
`createDiagnosticChannel` (`diagnostic/channel.ts`). Every other internal name is reached through
the measurement entry point, `measurement/measurement.ts` ([SDK.md](sdk/entry-points.md#entry-points)).

Each section lives in its own file under [`engine/`](engine); read only the one you need.

## The internal session
[engine/the-internal-session.md](engine/the-internal-session.md)

## The engine
[engine/the-engine.md](engine/the-engine.md)

## The frame, in order
[engine/the-frame-in-order.md](engine/the-frame-in-order.md)

## Views
[engine/views.md](engine/views.md)

## Scene and camera
[engine/scene-and-camera.md](engine/scene-and-camera.md)

## A partitioned scene
[engine/a-partitioned-scene.md](engine/a-partitioned-scene.md)

## WebGPU page raster
[engine/webgpu-page-raster.md](engine/webgpu-page-raster.md): [The cut](engine/webgpu-page-raster/the-cut.md) · [Cut settings and draw distances](engine/webgpu-page-raster/cut-settings-and-draw-distances.md) · [Depth pyramid and light grid](engine/webgpu-page-raster/depth-pyramid-and-light-grid.md) · [Rasterizers and voxels](engine/webgpu-page-raster/rasterizers-and-voxels.md)

## Tessellation of displaced rows
[engine/tessellation-of-displaced-rows.md](engine/tessellation-of-displaced-rows.md): Motion of a displaced pixel · The clip switch · Masked casters in the shadow maps

## Material surfaces
[engine/material-surfaces.md](engine/material-surfaces.md)

## Material graph
[engine/material-graph.md](engine/material-graph.md) — parts: [outputs and compile](engine/material-graph/outputs-and-compile.md), [surface and rasters](engine/material-graph/surface-and-rasters.md), [transparent pass, volume, mask](engine/material-graph/transparent-volume-and-mask.md), [shading models](engine/material-graph/shading-models.md), [toon](engine/material-graph/toon-shading.md), [water](engine/material-graph/single-layer-water.md), [world position offset](engine/material-graph/world-position-offset.md)

## Temporal antialiasing
[engine/temporal-antialiasing.md](engine/temporal-antialiasing.md): Dynamic resolution

## Effect chain
[engine/effect-chain.md](engine/effect-chain.md)

## Exposure and the display curve
[engine/exposure-and-the-display-curve.md](engine/exposure-and-the-display-curve.md)

## The display finishing
[engine/the-display-finishing.md](engine/the-display-finishing.md)

## Direct lighting
[engine/direct-lighting.md](engine/direct-lighting.md)

## Light functions
[engine/light-functions.md](engine/light-functions.md)

## Light that bounces
[engine/light-that-bounces.md](engine/light-that-bounces.md)

## Subsurface scattering
[engine/subsurface-scattering.md](engine/subsurface-scattering.md)

## Ambient occlusion
[engine/ambient-occlusion.md](engine/ambient-occlusion.md)

## Distance fields
[engine/distance-fields.md](engine/distance-fields.md)

## Surface cache
[engine/surface-cache.md](engine/surface-cache.md)

## Sky module
[engine/sky-module.md](engine/sky-module.md)

## Fog
[engine/fog.md](engine/fog.md)

## Volumetric lightmap
[engine/volumetric-lightmap.md](engine/volumetric-lightmap.md)

## Atmosphere and sky light
[engine/atmosphere-and-sky-light.md](engine/atmosphere-and-sky-light.md) — parts: [air, lights and tables](engine/atmosphere-and-sky-light/air-lights-and-tables.md), [clouds and the air](engine/atmosphere-and-sky-light/clouds-and-the-air.md), [cloud drawing and orthographic](engine/atmosphere-and-sky-light/clouds-drawing-and-orthographic.md), [sky light](engine/atmosphere-and-sky-light/sky-light.md), [captured-scene sky light](engine/atmosphere-and-sky-light/sky-light-captured-scene.md)

## The custom depth and stencil
[engine/the-custom-depth-and-stencil.md](engine/the-custom-depth-and-stencil.md)

## Transparent surfaces
[engine/transparent-surfaces.md](engine/transparent-surfaces.md)

## Presentation
[engine/presentation.md](engine/presentation.md)

## Dynamic geometry
[engine/dynamic-geometry.md](engine/dynamic-geometry.md)

## Physics
[engine/physics.md](engine/physics.md)

## Particles
[engine/particles.md](engine/particles.md)

## GPU deformation
[engine/gpu-deformation.md](engine/gpu-deformation.md)

## Animation banks
[engine/animation-banks.md](engine/animation-banks.md)

## Diagnostics and timing
[engine/diagnostics-and-timing.md](engine/diagnostics-and-timing.md)

## Proofs
[engine/proofs.md](engine/proofs.md)

## Lighting: the target and the stages
[engine/lighting-the-target-and-the-stages.md](engine/lighting-the-target-and-the-stages.md)

## Rules across files
[engine/rules-across-files.md](engine/rules-across-files.md)
