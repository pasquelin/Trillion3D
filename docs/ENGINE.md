# Engine internals

A map of how a world draws: which backend renders, the frame's stages in order, what each subsystem
owns and where its code lives, and the rules that hold across files. The code is the contract: each
module's head comment states its rule and its reasons; this page names the module once. Paths are
under `packages/sdk-browser/src/`; `sdk-core/` stands for `packages/sdk-core/src/`, and a path that
starts with `packages/` or `tests/` is from the repository root.

The page's API is [SDK.md](SDK.md); what stays in memory, [RESIDENCY.md](RESIDENCY.md); shadows,
[SHADOWS.md](SHADOWS.md); the cache files, [FORMAT.md](FORMAT.md); the body API,
[PHYSICS.md](PHYSICS.md); the maths, [MATHS.md](MATHS.md). Two internals are public, for a host
that drives pages or diagnostics itself: `createGpuPageCache` (`gpu/page/pages.ts`) and
`createDiagnosticChannel` (`diagnostic/channel.ts`). Every other internal name is reached through
the measurement entry point, `measurement/measurement.ts` ([SDK.md](SDK.md#entry-points)).

## The internal session

A world opens one session on itself (`openMeasuredWorld`, `world/session/explorer.ts`); options
beyond `WorldOptions` serve the bench and the proofs, and a published world runs the defaults. The
comparison layouts render two backends with one camera: a proof tool, never a performance verdict.

## Which backend renders

`chooseBackends` (`backend/defaultBackends.ts`) decides once, before the scene is read, and the
`backend-choice` diagnostic reports why.

| Machine | Backend that renders | Scene file read |
|---|---|---|
| A WebGPU device was granted | `webgpu-page-raster` | `source.gltf` |
| WebGL2, cache with a prepared scene | `autonomous-pages-webgl` | `metadata.autonomousScene` |
| WebGL2, cache without one | `autonomous-pages-webgl` | `source.gltf` |
| Neither | none: `NO_ENGINE_BACKEND` | — |

A forced renderer the machine lacks is refused by name, never swapped. The witnesses are opt-in
through `backends` ([bench/runner/README.md](../bench/runner/README.md#the-witnesses)); the engine
never mounts one.

## The frame, in order

One WebGPU image is one command buffer, encoded in this order:

| Stage | Code |
|---|---|
| Frame gate: camera copy, held-frame test, pipelines asked | `frame/gateCore.ts`, `webgpu/frame/hold.ts`, `webgpu/pages/render/render.ts` |
| World poses uploaded | `webgpu/pages/render/worldUpload.ts` |
| GPU deformation | `deformation/compute.ts` |
| Composed placements | `placement/gpuCompose.ts` |
| Cut: GPU selection, the CPU cut as fallback | `webgpu/pages/render/gpuCut.ts`, `webgpu/pages/render/cpu.ts` |
| Partition and draw compaction | `webgpu/visibility/partition.ts` |
| Visibility raster, two-phase Hi-Z | `webgpu/visibility/passes.ts` |
| Material surfaces, one pass per class | `webgpu/core/materialPasses.ts` |
| Impostor cards | `webgpu/impostor/` |
| Light buffer, bounce, light grid, virtual shadow maps | `webgpu/pages/render/encodeLights.ts` |
| Deferred resolve and reflections | `lighting/deferred/deferred.ts`, `reflections/frame.ts` |
| Transparents, water, particles | `webgpu/pages/render/encodeBlend.ts` |
| Temporal resolve | `taa/frame.ts` |
| Effect chain | `webgpu/pages/render/encodeEffects.ts` |
| Composition, presentation, submission | `lighting/deferred/deferred.ts`, `webgpu/pages/render/encoder.ts` |

`webgpu/pages/render/surfaceLighting.ts` encodes the stages from the impostor cards on. The WebGL2
image (`backend/autonomous/render.ts`) cuts by the same rule, draws the resident pages, lights them
forward and is composed by `world/render/compose.ts`.

## Scene and camera

Every node is a slot of one transform tree, walked once a frame over what changed
(`sdk-core/math/transform-tree/pass.ts`). A host resource crosses into the engine's own records in one place,
`host/surfaceImport.ts`. The engine composes its own projection, reversed depth with an infinite far
plane, one convention for every pass (`camera/depthConvention.ts`).

## WebGPU page raster

`webgpuPagesBackend` (`webgpu/pages/pages.ts`) draws from the bounded page cache of
`gpu/page/pages.ts`. A compute pass selects the camera's resident cut and draws it through indirect
commands into a visibility buffer (`webgpu/pages/render/gpuCut.ts`); occlusion is two-phase Hi-Z
(`webgpu/visibility/passes.ts`, CPU oracle `hiz/temporal.ts`). Which pages load and leave is
[RESIDENCY.md](RESIDENCY.md). WebGL2 cuts by the same rule and draws consecutive pages as one
multi-draw (`webgl/cluster/pageArenas.ts`, `webgl/cluster/runs.ts`).

## Material surfaces

The visibility buffer is resolved into the material surfaces one pass per material class, over the
screen tiles that class holds (`webgpu/core/materialPasses.ts`, `webgpu/core/materialTiles.ts`).
Lighting reads those surfaces and the depth; transparency and transmission are shaded apart.

## Temporal antialiasing

Edges are recovered temporally: a jittered image, motion derived from the visibility buffer, a
history clamped to its neighbours (`taa/`). A quiet image averages the final state alone, so a still
image is exact and repeatable. The render scale is fitted to the display's refresh
(`frame/scaleControl.ts`) and reconstructed by `taa/upscaleWgsl.ts`; WebGL2 resamples spatially
(`world/render/renderScale.ts`). The page's options are
[SDK.md](SDK.md#canvas-camera-and-teardown).

## Effect chain

`world.effects` (`sdk-core/world/effect/`; API in [SDK.md](SDK.md#canvas-camera-and-teardown)) runs
over linear radiance between the temporal resolve and tone mapping:
`webgpu/effects/webgpuEffects.ts` and `webgl/effects/webglEffects.ts`, one table of pass kinds
each. An empty chain adds no pass; bloom is `effects/bloomFilter.ts`.

## Direct lighting

Any number of lights: a light grid lists each cell's lights once per image (`lighting/tiles/`), and
each pixel walks its cell's list (`lighting/direct/lightLoopWgsl.ts`). A moving image samples the
shadowed lights, a still one sums them all (`lighting/direct/lightSamplingWgsl.ts`). A frame with no
shadowed or rectangular light runs a program built without that code
(`lighting/deferred/contractVariants.ts`). WebGL2 lists lights over a world grid
(`webgl/cluster/lightLists.ts`). Shadows are [SHADOWS.md](SHADOWS.md).

## Light that bounces

Dynamic, off by default: irradiance probes in nested cascades trace rays against the resident
proxy the compiler writes ([FORMAT.md](FORMAT.md)), under a budget in milliseconds (`bounce/`). The
probes, the environment and the WebGL2 light probe share one basis
(`sdk-core/scene/core/irradianceBasis.ts`). Mirrors and rough reflections trace the screen
(`reflections/`), falling back to the proxy and the probes when bounce is on.

## Fog

`scene.fog` is a term of the one lighting model, applied by every program that lights a surface:
the law is `sdk-core/scene/core/fog.ts`, its shader text `lighting/fogShader.ts`, its options
[SDK.md](SDK.md#scene-fog).

## Transparent surfaces

WebGPU culls transparent meshes through a box tree (`webgpu/blend/hierarchy.ts`), orders them
farthest first on the GPU (`webgpu/blend/order.ts`) and lights them with the opaque resolve's lists
(`webgpu/blend/lighting.ts`); a transmissive surface is composed after them on a frozen copy
(`webgpu/water/pass.ts`).

## Presentation

A WebGPU session presents through its own canvas context; a world keeps its device across sessions,
each creating through its own handle (`gpu/core/sessionHandle.ts`, `gpu/core/deviceOwners.ts`,
`gpu/core/errorScope.ts`). WebGL2 owns its context in `webgl/core/surface.ts`, and the composer
copies an engine's image with `world/render/composeSurface.ts`.

## Dynamic geometry

Geometry rewritten every frame ([SDK.md](SDK.md#geometry-rewritten-every-frame)) is cut into pages
once and its changed vertices written in place (`world/core/worldDynamic.ts`): on WebGPU into the
float vertex pool (`webgpu/core/geometryPrepare.ts`), on WebGL2 over the host geometry's lists
(`backend/autonomous/sourcedPages.ts`).

## Physics

The page's side is [PHYSICS.md](PHYSICS.md). Jolt Physics is built into one standalone module
behind a flat C API (`packages/physics-jolt-wasm/src/`), loaded by `physics/joltModule.ts` and
stepped by a worker (`physics/physicsWorker.ts`) on the frames' clock (`physics/stepClock.ts`); the
buffer layouts are `sdk-core/physics/layout.ts`. Everything the physics draws is drawn between two
steps by one mechanism (`physics/twoSteps.ts`).

## Particles

WebGPU steps the pools (`webgpu/particles/webgpuParticles.ts`) and draws them over the lit image
after the transparents (`webgpu/particles/webgpuParticleDraw.ts`); WebGL2 does the same in
`webgl/particles/`. A path that cannot draw them refuses the pools by name, never hard-edged.

## GPU deformation

The page's side is [SDK.md](SDK.md#gpu-deformation). One control record per deformed placement
(`deformation/session.ts`); one compute pass before the cut writes deformed positions and normals
that every later pass reads (`deformation/compute.ts`). WebGL2 deforms in the vertex shader
(`deformation/deformGlsl.ts`).

## Diagnostics and timing

Diagnostics leave through a queued channel outside the measured call (`diagnostic/channel.ts`). The
device asks for every optional feature its kernels can use, each with a plain fallback
(`world/session/gpuDevice.ts`). GPU passes are timed by timestamp queries (`gpu/timing/`), the
stages mapped in `stage/mapping.ts`; CPU and GPU times are never added.

## Proofs

`pnpm run test:gpu` runs every hardware proof (`tests/gpu/<area>/*.gpu.ts`) on Dawn in Node
([TESTS.md](TESTS.md)). The CPU shading oracle encodes linear lighting to sRGB without ACES.

## Lighting: the target and the stages

The target: dynamic global illumination, reflections and shadows at desktop-class cost, on the web,
in software, within the host's byte budgets ([SDK.md](SDK.md#memory-budgets)). One model lights
every surface: direct light, shadows, bounce and reflections are summed in linear radiance, fogged,
then tone-mapped and encoded to sRGB once, at composition.

| Stage | Where |
|---|---|
| Temporal antialiasing, exact at rest | [Temporal antialiasing](#temporal-antialiasing) |
| Stochastic direct light over a light grid | [Direct lighting](#direct-lighting) |
| Shadows | [SHADOWS.md](SHADOWS.md) |
| Probes, proxy rays, screen traces, rough reflections | [Light that bounces](#light-that-bounces) |

## Rules across files

- **One mechanism per concern**: one transform tree, one host boundary, one depth convention, one
  cut rule and one residency, one irradiance basis, one fog law, one two-step drawing of physics.
  A second one beside it is a defect.
- **Never per frame**: no pipeline compiled on the frame that first needs it (the frame is held,
  `webgpu/frame/framePipelines.ts`); no wait on a readback; no allocation in a steady frame; no work
  in a held frame, where nothing moved (`webgpu/frame/hold.ts`); no bounce pass once converged.
- **Exact at rest**: the jitter never reaches the cut, and every stochastic term is exact in the
  still image.
- **WebGL2 lacks** what `backend/autonomous/capabilities.ts` lists — GPU selection, occlusion
  culling, cast shadows, global illumination, temporal antialiasing and upscaling — and refuses
  surface capture; each refusal is named, never silent.
