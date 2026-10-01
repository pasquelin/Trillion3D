# Trillion3D public API reference

An index of the public `trillion3d` surface; each entry is documented once, in the
[SDK guide](SDK.md) or [PHYSICS.md](PHYSICS.md). The maths functions have their own pages in the
portal's [API reference](https://www.trillion3d.com/#/en/api).

| Surface | Where |
| --- | --- |
| Entry points, TypeScript setup, bundling | [Entry points](SDK.md#entry-points), [Installation](SDK.md#installation-and-environment-api) |
| `createWorld`, `scene.load`, `onProgress`, `awaitPages`, cache probes | [Create a world](SDK.md#create-a-world) |
| Families and their members | [Families](SDK.md#families) |
| Loop, renderer option, canvas, effects, controllers | [Loop](SDK.md#loop), [Canvas, camera and teardown](SDK.md#canvas-camera-and-teardown) |
| `world.addView`, `world.rect`, view controls and disposal | [Several views on one canvas](SDK.md#several-views-on-one-canvas) |
| `world.raycast`, `controls.transform`, `scene.toJSON` / `fromJSON` | [Picking, moving and saving](SDK.md#picking-moving-and-saving) |
| `geometry.usage = 'dynamic'` | [Geometry rewritten every frame](SDK.md#geometry-rewritten-every-frame) |
| `world.guides` | [Guides](SDK.md#guides-lines-points-and-helpers-over-the-image) |
| `SceneRoot`, `Object3D`, `BufferAttribute`, `Geometry` | [Scene hierarchy foundation](SDK.md#scene-hierarchy-foundation) |
| Batch and unit maths | [MATHS.md](MATHS.md) |
| `world.materials()` and the other material calls | [Page materials](SDK.md#page-materials), [runnable example](../site/examples/page-materials.html) |
| Lights, fog, shadows, imported lamps | [Lights](SDK.md#lights) |
| `world.budget` | [Memory budgets](SDK.md#memory-budgets) |
| `capture.surface`, `capture.buffer` | [Captures and image checks](SDK.md#captures-and-image-checks) |
| `world.physics`, `joint`, `vehicle`, soft bodies | [PHYSICS.md](PHYSICS.md) |
| `animation`, `model.animations`, `mesh.waves`, `metrics.gpuDeformationMs` | [GPU deformation](SDK.md#gpu-deformation) |
