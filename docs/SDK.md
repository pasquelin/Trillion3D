# Trillion3D SDK

The public guide: what a page and a Node host write against. Drawing: [ENGINE.md](ENGINE.md);
memory: [RESIDENCY.md](RESIDENCY.md); compiler: [COMPILER.md](COMPILER.md); cache:
[FORMAT.md](FORMAT.md); physics in a worker, every body an ordinary mesh with `physics` set:
[PHYSICS.md](PHYSICS.md); batch and unit maths for hosts: [MATHS.md](MATHS.md). Installation,
licence and limits: [README](../README.md#current-limits).

Every public import uses `trillion3d`; conditional exports select the common, browser or Node API
([Entry points](sdk/entry-points.md#entry-points)). `SDK_VERSION` and `FORMAT_VERSION` are
independent.

Each section lives in its own file under [`sdk/`](sdk); read only the one you need.

## Terms
[sdk/terms.md](sdk/terms.md)

## Principles
[sdk/principles.md](sdk/principles.md)

## Entry points
[sdk/entry-points.md](sdk/entry-points.md)

## Create a world
[sdk/create-a-world.md](sdk/create-a-world.md): Files over HTTP

## API rule
[sdk/api-rule.md](sdk/api-rule.md)

## Naming rule
[sdk/naming-rule.md](sdk/naming-rule.md)

## Families
[sdk/families.md](sdk/families.md)

## Loop
[sdk/loop.md](sdk/loop.md)

## What draws
[sdk/what-draws.md](sdk/what-draws.md)

## Canvas, camera and teardown
[sdk/canvas-camera-and-teardown.md](sdk/canvas-camera-and-teardown.md): Temporal anti-aliasing settings · Raster and cut settings · Depth pyramid and occlusion settings · Tessellation settings · Volumetric lightmap setting · Global distance field settings · Distance field occlusion settings · Surface cache settings · Ambient occlusion · Ambient cubemap, reflection captures and planar reflections · Material pass shading settings · Exposure settings · Render scale, dynamic resolution and frame rate · Effect chain, bloom and film effects · Colour grading · Extra views and disposal · Texture filtering settings · Camera controllers · Picking, moving and saving · Live material values · Geometry rewritten every frame · …

## Installation and environment API
[sdk/installation-and-environment-api.md](sdk/installation-and-environment-api.md)

## Compiling from Node
[sdk/compiling-from-node.md](sdk/compiling-from-node.md)

## Scene hierarchy foundation
[sdk/scene-hierarchy-foundation.md](sdk/scene-hierarchy-foundation.md)

## Page materials
[sdk/page-materials.md](sdk/page-materials.md)

## Material graph
[sdk/material-graph.md](sdk/material-graph.md): [making-a-graph](sdk/material-graph/making-a-graph.md) · [outputs-and-types](sdk/material-graph/outputs-and-types.md) · [nodes](sdk/material-graph/nodes.md) · [surface](sdk/material-graph/surface.md) · [opacity-mask](sdk/material-graph/opacity-mask.md) · [world-position-offset](sdk/material-graph/world-position-offset.md) · [shading-model](sdk/material-graph/shading-model.md) · [depth-and-displacement](sdk/material-graph/depth-and-displacement.md) · [thin-translucent](sdk/material-graph/thin-translucent.md) · [volume-and-light-function](sdk/material-graph/volume-and-light-function.md) · [refusals](sdk/material-graph/refusals.md)

## Lights
[sdk/lights.md](sdk/lights.md): Sky module · Height fog part · Atmosphere part · Clouds part · Declared lights · Simple lights · Rectangle lights' pictures · Light functions · …

## Ray-traced sky light
[sdk/ray-traced-sky-light.md](sdk/ray-traced-sky-light.md): the sky light's diffuse found by rays, its settings, its denoiser, its shading models and the strands' voxels

## Memory budgets
[sdk/memory-budgets.md](sdk/memory-budgets.md): Out of memory is absorbed

## Captures and image checks
[sdk/captures-and-image-checks.md](sdk/captures-and-image-checks.md)

## Migration from Three.js
[sdk/migration-from-threejs.md](sdk/migration-from-threejs.md)

## GPU deformation
[sdk/gpu-deformation.md](sdk/gpu-deformation.md)

## Sampled lighting: guide filter
[sdk/sampled-lighting-guide-filter.md](sdk/sampled-lighting-guide-filter.md)

## Hair strands: coverage mapping
[sdk/hair-strands-coverage-mapping.md](sdk/hair-strands-coverage-mapping.md)

## Path tracer and its denoiser
[sdk/path-tracer-and-its-denoiser.md](sdk/path-tracer-and-its-denoiser.md)

## Heterogeneous volumes: preshading and level of detail
[sdk/heterogeneous-volumes-preshading-and-level-of-detail.md](sdk/heterogeneous-volumes-preshading-and-level-of-detail.md)

## Hair strands: compute raster
[sdk/hair-strands-compute-raster.md](sdk/hair-strands-compute-raster.md)

## Hair strands: velocity
[sdk/hair-strands-velocity.md](sdk/hair-strands-velocity.md)

## Custom depth and stencil
[sdk/custom-depth-and-stencil.md](sdk/custom-depth-and-stencil.md)

## Post-process materials
[sdk/post-process-materials.md](sdk/post-process-materials.md)

## Hair strands: custom depth
[sdk/hair-strands-custom-depth.md](sdk/hair-strands-custom-depth.md)

## Hair strands: curve raster
[sdk/hair-strands-curve-raster.md](sdk/hair-strands-curve-raster.md)

## Hair strands: forward raster
[sdk/hair-strands-forward-raster.md](sdk/hair-strands-forward-raster.md)

## Hair strands: G-buffer write
[sdk/hair-strands-g-buffer-write.md](sdk/hair-strands-g-buffer-write.md)

## Surface cache: debug views
[sdk/surface-cache-debug-views.md](sdk/surface-cache-debug-views.md): Reflections that read the radiance cache · Translucent surfaces that reflect the scene · Short-range occlusion through the scene's triangles

## Reservoir gather of the indirect light
[sdk/reservoir-gather-of-the-indirect-light.md](sdk/reservoir-gather-of-the-indirect-light.md)

## Light shapes
[sdk/light-shapes.md](sdk/light-shapes.md)

## Sorted translucency
[sdk/sorted-translucency.md](sdk/sorted-translucency.md)

## Resolution of the translucent layers
[sdk/resolution-of-the-translucent-layers.md](sdk/resolution-of-the-translucent-layers.md)

## Sampled lighting: debug views
[sdk/sampled-lighting-debug-views.md](sdk/sampled-lighting-debug-views.md)

## Hair strands: debug views
[sdk/hair-strands-debug-views.md](sdk/hair-strands-debug-views.md)
