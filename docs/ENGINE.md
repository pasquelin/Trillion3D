# Engine internals

A map of how a world draws: the engine, the frame's stages in order, what each subsystem owns and
where its code lives, and the rules that hold across files. The code is the contract: each
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
beyond `WorldOptions` serve the bench and the proofs, and a published world runs the defaults.

## The engine

A session draws with one engine, the WebGPU page raster, reading `source.gltf`: its renderer is a
family loaded beside the scene (`webgpuEngine`, `engine/factory.ts`). A bench page hands the
session the raster's factory itself (`engine`, a measurement seam no host reaches) and skips that
load.

A machine that grants no WebGPU device is refused by name, `WEBGPU_UNAVAILABLE`, on the session's
`fatal` event, before anything is read for the scene. The witnesses the bench compares against draw
in pages of their own ([bench/runner/README.md](../bench/runner/README.md#the-witnesses)); the
session never mounts one.

## The frame, in order

One WebGPU image is one command buffer, encoded in this order:

| Stage                                                     | Code                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Frame gate: camera copy, held-frame test, pipelines asked | `frame/gateCore.ts`, `webgpu/frame/hold.ts`, `webgpu/pages/render/render.ts` |
| World poses uploaded                                      | `webgpu/pages/render/worldUpload.ts`                                         |
| GPU deformation                                           | `deformation/compute.ts`                                                     |
| Composed placements                                       | `placement/gpuCompose.ts`                                                    |
| Cut: GPU selection, the engine's one cut                  | `webgpu/pages/render/gpuCut.ts`                                              |
| Partition and draw compaction                             | `webgpu/visibility/partition.ts`                                             |
| Visibility raster, two-phase Hi-Z                         | `webgpu/visibility/passes.ts`                                                |
| Material surfaces, one pass per class                     | `webgpu/core/materialPasses.ts`                                              |
| Light buffer, bounce, light grid, virtual shadow maps     | `webgpu/pages/render/encodeLights.ts`                                        |
| Deferred resolve                                          | `lighting/deferred/deferred.ts`                                              |
| Transparents, distortion, particles                       | `webgpu/pages/render/encodeBlend.ts`                                         |
| Temporal resolve                                          | `taa/frame.ts`                                                               |
| Effect chain                                              | `webgpu/pages/render/encodeEffects.ts`                                       |
| Composition, presentation, submission                     | `lighting/deferred/deferred.ts`, `webgpu/pages/render/encoder.ts`            |

`webgpu/pages/render/surfaceLighting.ts` encodes the stages from the light buffer on.

## Views

A world draws its own camera as the runtime's main view, then each view `world.addView` made
(`world/core/worldViews.ts`), in the same frame and loop (`world/render/draw.ts`). A view is a
record of what a camera owns (`webgpu/pages/state/view.ts`): its cut and what its image made of it,
motion, occlusion history and Hi-Z pyramid, frame targets, temporal history, effect chain,
presenter (a canvas of its own, or a rectangle of the main canvas), GPU timer and render scale
(`frame/viewScale.ts`, following the world's controller within its bounds). Drawing it trades
those members into the runtime groups and back (`webgpu/pages/state/viewSwitch.ts`); every other
member is the scene's and is shared: placements and their composition, the pages, their residency
— the union of every view's cut under the one budget —, the pools, materials, lights, physics and
pipelines. The virtual shadow maps share their pool, page tables and local lights' maps; a sun's
clipmap follows the eye, so each view keeps its own cache entry (`VsmCacheManager.view`), carried
unreferenced while other views draw and aged by its own view's frames; the pool is asked for every
view's pixels. The projection mask and the light grid keep the largest layout a view asked, so
views of other sizes drawn in turn lay nothing out again. The main view's GPU sample adds the views'
last GPU time, each over the main images between its draws, to the frame the `'auto'` scale fits.

## Scene and camera

Every node is a slot of one transform tree, walked once a frame over what changed
(`sdk-core/world/transform-tree/pass.ts`). A material is declared once into the one surface record its meshes wear,
`page/surfaceRecord.ts`. The engine composes its own projection, reversed depth with an infinite far
plane, one convention for every pass (`camera/depthConvention.ts`).

A node whose parent moves and whose pose only follows it is composed once, on the GPU: its link is
a node flag (`NODE_WORLD_LAZY`, `sdk-core/world/transform-tree/nodeFlags.ts`) that the tree's walk
leaves alone, and the placement's compose slot is the parent's. The roots pass writes, in exact
double arithmetic, the world, the stretch, the world box and the motion of each linked root; the
rows pass writes the page-table world words, the sphere, the Hi-Z corners and the world-dependent
levels of detail of its rows (`placement/gpuCompose.ts`); the members pass writes the leaf boxes the
placement tree is fitted over, and the one tree refit (`gpu/dag/treeRefit.ts`, a pass any caller
names its dirty groups to) fits them and every node above, bottom up. A CPU reader — transparent
depth, a winding — reads the composed world once a frame (`composedWorld`, a
product of the parent's and the local matrix kept by `state.version`), never a second multiply that
is written back. Models and partition rows link before their rows are written, so no matrix is
written for them. A link is never refused for what reads its row: waves, soft bodies and skeletons read the
composed world of their root; rows no root reads — a blended surface's, or a root a growth has not
built yet — are composed for their readers (`placement/composeReaders.ts`) and handed to the roots
pass once their root exists. Only the pose a session opens on is written by an owner, before any
engine exists (`partition/follow.ts`, `world/core/worldModels.ts`); every product of a parent's
world and a local matrix on the CPU is the one function `composeWorld` (`placement/composeWorld.ts`). The refit and the members pass bind the cut's
tables as the cut does, split tables in their parts (`gpu/dag/shader/bindings.ts`).

## WebGPU page raster

`webgpuPagesEngine` (`webgpu/pages/pages.ts`) draws from the bounded page cache of
`gpu/page/pages.ts`. A compute pass selects the camera's resident cut and draws it through indirect
commands into a visibility buffer (`webgpu/pages/render/gpuCut.ts`); occlusion is two-phase Hi-Z
(`webgpu/visibility/passes.ts`, CPU oracle `bench/oracles/browser/hizOcclusion.ts`). The render
passes whose commands repeat from frame to frame — the raster's slot draws, the material surfaces —
are render bundles, recorded once and replayed while the few identities and revisions they are
keyed by hold (`gpu/core/renderBundles.ts`); their passes keep the timestamps. Which pages load and leave is
[RESIDENCY.md](RESIDENCY.md).

A voxel page ([FORMAT.md](FORMAT.md#voxels)) — a voxelized mesh's far levels, a `voxel` HLOD cell —
is a page like any other: catalogued, streamed and chosen by the one cut at its voxels' error. Each
brick draws its box, the box of the cells its mask holds, by its back faces alone, so an eye inside
a box or a box across the near plane still draws; each pixel of the box casts the eye's ray through
the brick's cells (`visibility/shader/voxelWgsl.ts`, `voxelCellTrace`): it enters at the box, or at
the eye inside it, steps cell to cell by a 3D DDA, reads each cell's bit of the brick's 64-bit mask,
and stops at the first solid cell, at most 10 steps — the most cells a line crosses in a 4³ brick.
The ray and its clip depth are affine in the box point: the vertex stage computes them at the box's
corners and the pixel gets its own by interpolation, so a voxel fragment runs the DDA and one
division, reads no buffer, builds no matrix (`visibility/shader/voxelHitWgsl.ts`). Voxel rows have
slots and a shader module of their own (`visibility/shader/visVoxelWgsl.ts`), drawn after the opaque
and cutout ones, on layer 0, and only on a frame whose table holds a voxel row: the other slots
compile the text they compiled before voxels. WebGPU keeps no early depth test for a stage that
writes its depth, so a voxel fragment always runs its trace. The shadow pages draw voxel rows in
tiers of their own, sized by the page's bricks as the corner tiers are by its triangles, their
module apart (`vsm/renderVoxelWgsl.ts`), on the same sequence; the resolve of a voxel class, its
module apart too, traces the pixel again to read its voxel's colour, roughness, occlusion and
normal — its rank one read of its brick and a popcount —, its normal carried by the brick's joint,
and its shadow receiver is the hit and that normal. Every voxel module and pipeline is made the
first time the table holds a voxel row or a voxel class: a scene without voxels compiles what it
compiled before them. A skinned mesh's
bricks follow their joint rigidly and are traced at rest. Ray queries take the finer clusters a
voxel page stands for, never the page. The `voxels` view paints each voxel in its level's colour;
the metrics `voxelBricks`, `voxelStepsMean` and `voxelStepsMax` sample the bricks drawn and the DDA
steps a pixel took.

## Material surfaces

The visibility buffer is resolved into the material surfaces one pass per material class, over the
screen tiles that class holds (`webgpu/core/materialPasses.ts`, `webgpu/core/materialTiles.ts`).
Lighting reads those surfaces and the depth; transparency and transmission are shaded apart.

## Temporal antialiasing

A temporal upscaler (`taa/`): a jittered image, motion derived from the visibility buffer, a
history update with shading rejection, the spatial anti-aliaser before the resolve, one resolve for
every render scale. The pass runs on every frame drawn and its history is reset only on a camera
cut, the one change the reprojection cannot follow. A still view is drawn while its history fills
— whole cycles of the jitter's phases until every display pixel holds its most samples, 16 for a
history at the display's resolution (`taaConverged`, `historySampleLaws`) — then held on its
converged image like any still view (`taaConverging`, `webgpu/frame/hold.ts`); a change draws again
on the history it holds, and a session opened with `drawConverged` (the bench's cost series) keeps
drawing it. Its level (`off`, `low`, `medium`, `high`, `max`, `taa/levels.ts`) sets the
kernel, the flicker rejection and the spatial anti-aliaser; a level without either skips its
pass. The render
scale is a dynamic resolution (`frame/dynamicResolution.ts`): a history of the frame's GPU busy
times against the frame time budget, both directions, with or without the temporal upscaler
(spatial upscale in the composition where it is off). The loop draws every refresh, or under the
page's frame cap every few (`frame/cadence.ts`), whose interval is the budget. The page's options are
[SDK.md](SDK.md#canvas-camera-and-teardown).

## Effect chain

`world.effects` (`sdk-core/world/effect/`; API in [SDK.md](SDK.md#canvas-camera-and-teardown)) runs
over linear radiance between the temporal resolve and tone mapping:
`webgpu/effects/webgpuEffects.ts`, one table of pass kinds. An empty chain adds no pass; bloom is `webgpu/effects/bloomFilter.ts`.
The passes after tone mapping draw over the composed display image and the canvas
(`encodeOverlayEffects`); an idle pass (an outline of no object) is passed by. The outline
(`webgpu/effects/outlineWgsl.ts`) reads the visibility identifiers through the page table to each
pixel's root (`pages[row].placement`) and one bit per root its objects' subtrees draw, then an
exact separable distance in two passes scissored to the roots' projected boxes (`rootsRect.ts`).

## Direct lighting

Any number of lights: a light grid lists each cell's lights once per image (`lighting/tiles/`), and
each pixel walks its cell's whole list (`lighting/direct/lightLoopWgsl.ts`), moving or still: the
shadow rays are the projection's, paid once, so the resolve never draws a subset. A frame with no
shadowed or rectangular light runs a program built without that code
(`lighting/deferred/contractVariants.ts`). Shadows are [SHADOWS.md](SHADOWS.md).

## Light that bounces

Dynamic, off by default: irradiance probes in nested cascades trace rays against the resident
proxy the compiler writes ([FORMAT.md](FORMAT.md)), under a budget in milliseconds (`bounce/`). The
probes and the environment share one basis
(`sdk-core/scene/core/irradianceBasis.ts`). Its points are lit by the one light function and loop, in their irradiance
term, shadowed by proxy rays (`lighting/direct/lightLoopWgsl.ts`); each walks the lights of its cell
of a world light grid that the light grid pass lists over the last cascade level, in the view
grid's own buffer (`bounce/lightCellWgsl.ts`), again only when a light, that level or the buffer
changes — the probe rays and the reflections' proxy hits walk the same lists.

## Fog

`scene.fog` is a term of the one lighting model, applied by every program that lights a surface:
the law is `sdk-core/scene/core/fog.ts`, its shader text `lighting/fogShader.ts`, its options
[SDK.md](SDK.md#scene-fog).

## Transparent surfaces

The engine culls transparent meshes through a box tree (`webgpu/blend/hierarchy.ts`), orders them
farthest first on the GPU (`webgpu/blend/order.ts`) and lights them with the opaque resolve's lists
(`webgpu/blend/lighting.ts`). A transmissive surface is sorted and lit among them, composed as
a thin translucent layer (`webgpu/water/waterColorWgsl.ts`), and refracts the opaque scene through
one distortion pass drawn before every translucent layer (`webgpu/blend/distortion.ts`).

## Presentation

A session presents through its own canvas context; a world keeps its device across sessions,
each creating through its own handle (`gpu/core/sessionHandle.ts`, `gpu/core/deviceOwners.ts`,
`gpu/core/errorScope.ts`).

## Dynamic geometry

Geometry rewritten every frame ([SDK.md](SDK.md#geometry-rewritten-every-frame)) is cut into pages
once and its changed vertices written in place (`world/core/worldDynamic.ts`) into the float
vertex pool (`webgpu/core/geometryPrepare.ts`).

## Physics

The page's side is [PHYSICS.md](PHYSICS.md). Jolt Physics is built into one standalone module
behind a flat C API (`packages/physics-jolt-wasm/src/`), loaded by `physics/joltModule.ts` and
stepped by a worker (`physics/physicsWorker.ts`) on the frames' clock (`physics/stepClock.ts`); the
buffer layouts are `sdk-core/physics/layout.ts`. Everything the physics draws is drawn between two
steps by one mechanism (`physics/twoSteps.ts`).

## Particles

A compute pass steps the pools (`webgpu/particles/webgpuParticles.ts`) and one instanced draw a
pool puts them over the lit image after the transparents (`webgpu/particles/webgpuParticleDraw.ts`),
or over the display colour of an image drawn without the visibility buffer; both fade each disc
on the opaque depth, never hard-edged.

## GPU deformation

The page's side is [SDK.md](SDK.md#gpu-deformation). One control record per deformed placement
(`deformation/session.ts`); one compute pass before the cut writes deformed positions and normals
that every later pass reads (`deformation/compute.ts`).

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
every surface: direct light, shadows and bounce are summed in linear radiance, fogged,
then tone-mapped and encoded to sRGB once, at composition.

| Stage                                     | Where                                           |
| ----------------------------------------- | ----------------------------------------------- |
| Temporal antialiasing                     | [Temporal antialiasing](#temporal-antialiasing) |
| Stochastic direct light over a light grid | [Direct lighting](#direct-lighting)             |
| Shadows                                   | [SHADOWS.md](SHADOWS.md)                        |
| Probes and proxy rays                     | [Light that bounces](#light-that-bounces)       |

## Rules across files

- **The source contract**: a mesh, material, model, cell or world the scene gains joins the running
  session in place (`addPlacements`, `PlacementGrowth`, `placement/webgpuGrowth.ts`), a world-DAG
  model included (`world/core/worldModelJoin.ts`); one the device refuses is said once as
  `content-refused` (`noticeRefused`) and the running cut kept. A session opens again for a lost
  device and for an option, nothing else.

- **One mechanism per concern**: one transform tree, one host boundary, one depth convention, one
  cut rule and one residency, one irradiance basis, one fog law, one two-step drawing of physics.
  A second one beside it is a defect.
- **Never per frame**: no pipeline compiled on the frame that first needs it (the frame is held,
  `webgpu/frame/framePipelines.ts`); no wait on a readback; no allocation in a steady frame; no work
  in a held frame — a view without temporal accumulation where nothing moved
  (`webgpu/frame/hold.ts`); no bounce pass once converged.
- **The jitter stays in the image**: it never reaches the cut; the stochastic terms converge in the
  temporal history, which accumulates them over the jitter's phases.
