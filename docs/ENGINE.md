# Engine internals

How a world draws. A page writes against [SDK.md](SDK.md) and reads what follows through the `world`
families (`metric.frame(world)`, `world.diagnostic.mode`, `capability.lighting(world)`, …). Two
functions below are public, for a standalone host that drives pages or diagnostics itself:
`createGpuPageCache` and `createDiagnosticChannel`, exported by `trillion3d`. Every other internal
name — `openMeasuredWorld`, backend ids, session options — is reachable only through the measurement
entry point (`packages/sdk-browser/src/measurement/measurement.ts`), for the bench, the proofs and the
comparison views ([SDK.md, "Entry points"](SDK.md#entry-points)).

## The internal session

A world opens one internal session on itself (`openMeasuredWorld`, `createMeasuredWorldJob`). Its
options beyond `WorldOptions` — `maxResidentPages`, `pageFetchWorkers`, `replicaCount`, `backends`,
`preload`, `comparisonLayout`, `comparisonPair`, `gpu`, `temporalAntialiasing`, `bounce`,
`bounceBudgetMs`, `shadowBudgetMs`, `shadowPageInvalidation`, `importedLights`, `textureSource`,
`textureCompression`, `mathPath` — stay on it; a published world always runs the defaults. The
comparison layouts (`single`, `side-by-side`, `wipe`, `toggle`, `difference`) render two backends to
detached targets with the same camera: a bench and proof tool, never a performance verdict.
`replicateInstances` instances the source 1, 4 or 9 times while sharing geometry and materials, for
the bench.

`RenderBackend.pendingFrame?()` waits for submitted work without image readback and returns whether
interactive rendering should continue; the session owns every interactive listener and pending
callback and releases them on disposal.

## Which backend renders

With no `backends` option, a session renders through the engine's own path. The choice is made once,
before the scene is read, from what the machine offers, and is reported by the `backend-choice`
diagnostic: `origin` (`default` or `host`), `renderer` (the backend id that draws), `autonomous`
(true when the session reads the cache's prepared scene rather than `source.gltf`), the `reason`
that decided it and the `textureSource` it settled on.

| Machine                             | Backend that renders                                                         | Scene file read            |
| ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| A WebGPU device was granted         | `webgpu-page-raster`                                                         | `source.gltf`              |
| WebGL2, cache with a prepared scene | `autonomous-pages-webgl`                                                     | `metadata.autonomousScene` |
| WebGL2, cache without one           | `autonomous-pages-webgl`                                                     | `source.gltf`              |
| Neither WebGPU nor WebGL2           | none — `NO_ENGINE_BACKEND` (`NO_WEBGL2` from the capability probe before it) | —                          |

`autonomous-pages-webgl` decodes the cache's geometry pages itself, draws every page the cut selects
— `submittedTriangles` equals `selectedTriangles` — and lights the scene from the cache's light
table. The compiler writes a prepared scene only when every primitive is `exact-clusters`; otherwise
the same path takes its materials and placements from `source.gltf` (`autonomous: false`), an image
rather than a refusal. A forced renderer the machine lacks is refused by name, never swapped.
`chooseBackends(options, metadata, gpuDevice, webgl2)` exposes the decision to a bench before a
session opens, and `autonomousCacheReady(metadata)` answers whether a cache carries the prepared
scene. The comparison backends (the witnesses) are opt-in through `backends` and described in
[bench/runner/README.md](../bench/runner/README.md#the-witnesses); the engine never mounts one on its
own.

## Scene and camera

The host subtree is mirrored once into one engine transform tree when the scene index is built; each
later pass enters only the pose numbers the host moved — compared bit for bit against what the tree
holds — and updates only the subtrees that moved, so a node moved out of two thousand costs the chain
under it, not the scene. The pose a page record, a cluster root or a transparent copy carries is a
sixteen-number view on that tree's world buffer: rewritten in place, never copied, never stale. The
local pose of drawn nodes and lights is hooked, so a write increments the scene revision and a frame
compares one integer; visibility, parent and a light's numbers are compared per frame.

What the engine computes — matrices, vectors, colours, its camera, the side of a material — it
builds on `sdk-core`. A resource crosses the host boundary as the shapes of
`packages/sdk-browser/src/host/resources.ts` (`HostMaterial`, `HostTexture`, `HostAttributes`,
`HostMesh`, `HostNode`, `HostScene`) and is read in one place,
`packages/sdk-browser/src/host/surfaceImport.ts`, into the engine's own `Material` and `Texture`
(`packages/sdk-core/src/contracts/material.ts`, `packages/sdk-core/src/texture/contract.ts`). Every
pass, page row, tile pool and transparent item computes on those records alone; a page carries
`PageSurface` (`packages/sdk-browser/src/page/surface.ts`). The material is re-read at every call; a
texture is read once and refilled when the host bumps `texture.version` — and a host that changes
anything a sampler declares (wrap, filter, anisotropy, colour space, UV transform) bumps it too. The
side is re-read at every look; `alphaTest`, `opacity` and the blend flags where they are read;
everything else follows `material.version`. `tests/integration/engine-without-three.test.ts` holds
the closed list of files allowed to reach back into the host object.

The engine does not read the host's clip-depth convention. It composes its own projection from the
declared optics — field, aspect, near plane, zoom — in **reversed depth with an infinite far plane**
(`engineCamera.ts`, `depthConvention.ts`), and that single convention serves the frustum planes, the
view-projection the GPU consumes, the Hi-Z bounds and the CPU visibility raster alike.

## WebGPU page raster

`createGpuPageCache(device, pageSource, { pageBytes, slots })` is a bounded WebGPU buffer and queue
adapter: a live `resize(slots)` that keeps what fits, pins, serialized loads, a reusable staging
buffer and eviction without a device-wide queue fence. `dispose()` aborts in-flight reads and waits
for submitted work. It reports allocation accounting, bytes read and uploaded and evictions; it does
not measure physical VRAM.

`webgpuPagesBackend` (`webgpu-page-raster`) consumes that cache. For opaque pages, a compute pass
selects the camera's drawable resident cut — frustum, `lodScore` and conservative backface cones —
keeping complete coarse coverage until every required child is resident. Draw compaction counts
pages in parallel groups of 64, computes group prefixes and scatters each page while preserving bin
order; the visibility shader vertex-pulls indices from resident slots into a visibility buffer of
packed page and triangle ids. The visibility path issues at most six geometry `drawIndirect`
commands (cull mode × Hi-Z pass). Selection and submission counters stay `null` until the matching
GPU result is read back; asynchronous readback serves streaming and diagnostics and never blocks the
current camera's selection. `capabilities.gpuDriven` denotes this opaque selection-to-draw path, not
a completely GPU-autonomous engine.

**Occlusion** is two-phase Hi-Z. Pass 1 draws the rows the previous frame drew that the previous
frame's pyramid does not hide; a pyramid is built from that depth (background at the far plane, min
reduction in reverse-Z); pass 2 retests the withdrawn and previously rejected rows against it. The
previous pyramid only chooses pass 1; the current one is the only judge of what is rejected, and it
is conservative to the ulp (`tests/browser/renders/conservative-gpu-partition.browser.ts`). A test
reads the first mip whose outward-rounded footprint fits 16×16 samples; a bound outside the target
or crossing the near plane is kept. A row kept while the view stands still stays in pass 1 until the
view or a world moves, so a still image converges under the jitter and is held.
`selectVisiblePages` and `applyTemporalHiz` remain the CPU A/A oracles and the fallbacks when compute
is missing or a readback is not yet current. If the visibility pipeline cannot be created, the
untextured page raster remains and Hi-Z stays off.

## Material surfaces

The opaque and masked path writes visibility, then reconstructs material properties into three
`rgba16float` textures and one `r32uint` texture (28 logical bytes per pixel): base colour and
metalness, world normal and roughness, emission and AO, surface flags. Depth is `depth32float`.
Lighting consumes these surfaces and reconstructs world position from depth. Transparency is shaded
separately into the HDR target; a transmissive material (`KHR_materials_transmission` with IOR and
volume) is composed after it by one fullscreen pass on a frozen copy of the lit image, bounded by the
opaque depth. ACES and sRGB conversion happen at final composition, which writes the display value
to the capture target and the canvas in one pass.

The reconstruction runs one pass per **material class**, the published visibility-buffer design,
instead of one program that tests every feature per pixel. A class is the set of features the
resolve would branch on — UV, base map, alpha cut-out, roughness, metalness, occlusion, emissive and
normal maps, vertex normals, double-sidedness, tangents — an eleven-bit word carried by every page
row. Pipelines are compiled at preparation, never on the frame that first draws a class. Each frame
the `Trillion3D material depth` pass writes every pixel's class as an exact depth value, then one full-screen
triangle per present class runs under `depthCompare: 'equal'`, so the hardware keeps that class's
pixels and its fragment stage reads only the maps it has. The `material-classes-ready` diagnostic
lists the classes; the `materials` view colours each pixel by its class. Not done: screen tiles per
class, so a class present anywhere costs one full-screen triangle.

## Temporal antialiasing

The visibility buffer cannot be multisampled; edges are recovered temporally. Each image is
projected with a sub-pixel jitter (Halton (2,3), eight positions, a clip-space translation of the
render matrix only) and resolved by `Trillion3D temporal antialiasing` between the transparent pass and
composition: the image is refiltered on its 3×3 neighbours with a one-pixel Blackman-Harris window,
the history is read where the unjittered centre was in the previous image, clamped to the YCoCg box
of the neighbours and blended in, each side weighted by its inverse luminance. Two `rgba16float`
histories ping-pong (16 bytes per pixel, counted in the frame allocation).

Motion vectors are derived, not rasterised: the visibility buffer names each pixel's page row, the
row names its placement, and the pixel is reprojected through that placement's `previous ·
current⁻¹`, then the previous unjittered view-projection, both anchored on the eye so large
coordinates keep single precision. The background reprojects as a direction.

Two regimes. While something moves — camera, scene, resources, work in flight — the current image
weighs one eighth. When an image is **quiet**, the history is dropped, the jitter restarts at phase
zero and the k-th quiet image weighs 1/k: after sixteen, the held image is the uniform average of
sixteen images of the final state only, so two executions render it bit-identically (`0 px` A/A).
Declared cost: when everything stops, edges stiffen for an image or two before reconverging. The
jitter never reaches the cut: selection, frustum and screen error read the unjittered camera. A
surface capture and a diagnostic view render unjittered and unaccumulated. The pass's own timestamp
means nothing on tile-based GPUs; its cost is read as an envelope difference with
`temporalAntialiasing: false`.

## Direct lighting

**A moving image shades a drawn subset of each pixel's lights.** A moving image weighs every light
of its tile without its shadow (the cheap part) and shades in full, shadow included, four of them. A
light worth a sample's share of the pixel's weight is shaded exactly and leaves the pool; the
remaining samples are drawn along the cumulative weight from a per-pixel offset that advances by the
golden ratio every image, each divided by its probability. The estimate is unbiased, so the history
averages it toward the full sum. A **still** image — the quiet ones, a capture, a diagnostic view —
shades every light of the tile, so the held image is the exact sum, `0 px` A/A.
`metric.frame(world).lightsSampled` says which mode ran. Declared cost: a faint grain on lit surfaces
where lights of different colours overlap, while the camera moves
(`tests/browser/renders/sampled-lighting.browser.ts`). What remains: a spatial denoise before the
history.

**Shadow maps are invalidated page by page, under a millisecond budget.** The atlas is cut into
128-texel pages. A light that moves invalidates its whole map; an object that moves invalidates only
the pages its projected box covers on each face, and only those are redrawn — with the face's own
frame and a scissor, so a page carries exactly the depth a full redraw would write.
`diagnostic.shadowAtlas(world)` returns the raw depth hash to check it. What a frame redraws is
bounded by `shadowBudgetMs` (1.0 ms), measured on the shadow pass's timestamps; refused pages wait,
ordered by the light's screen coverage and their age, and are never dropped (`shadowPagesDrawn`,
`shadowPagesTotal`, `shadowPagesPending`, `shadowWaitMs`). Without GPU timestamps there is no budget,
only the region ceiling.

**The sun** has four cascades following the camera, stored like a point light's faces. A cascade's
extent is a whole number of pages on the light plane, addressed modulo the face — a ring — so a
camera moving less than a page changes nothing and one moving by whole pages redraws only the strip
that entered. Each region rejects, before drawing, the clusters outside its box; alpha-masked
materials keep their real cut-out. Cascades cover a fifth of the far plane, split in a geometric
series of ratio 4. Beyond the last cascade, the sun's shadow is one ray per pixel against the
resident proxy (`proxy.bin`), traced by the same bounded traversal the bounce uses, deterministic and
unaccumulated; the `sun-far-shadow` diagnostic publishes its bounds. Without a proxy, far surfaces
stay lit: the last cascade is never stretched.

When a colour tile arrives, the shadow pages of the masked surfaces that read its texture are
invalidated, and those alone. A masked cut-out is read at the mip level the reading texel's
footprint selects, in the visibility raster and in the shadow pass alike, and the material
resolution requests the tiles each sun cascade will read. Known limit: a caster the camera never sees
has no one to request its tiles; the shadow pass then reads the finest tile resident.

`setLightingView(view)` selects what the opaque path outputs: `'lit'` (a world's view), `'unlit'`
(base colour as authored, for geometry benches that compare pixels), `'auto'` (unlit while no light
is declared) and `'bounce'` below.

## Light that bounces

An opaque surface can also receive the light that bounced off other surfaces: dynamic, no baked
lighting, independent of the camera. It rests on a **resident proxy** the compiler writes as
`proxy.bin`: the coarse cut of the DAG whose certified error stays under 5 cm, raised per primitive
until the scene fits 300 000 triangles, plus a BVH and one linear diffuse albedo per triangle. The
threshold reached is published as `proxy.errorMetres`. A cache without a proxy declares the bounce
unavailable.

**Cascades of probes.** Irradiance lives in up to four nested cubes of 16 probes per axis, each
level's spacing doubling, the last fixed in the world and covering the proxy, the finer ones
following the camera. Probes sit on a global lattice and are stored modulo the cube side, so sliding
by one cell invalidates only the entering slab. An occupancy map built from the proxy skips empty sky
and solid cores; a probe buried in a surface or lost in the sky sleeps until a light changes.

**A budget in milliseconds, not in rays.** `bounceBudgetMs` (0.8 ms) is the GPU time the stage
should take; the engine reads the stage's timestamp and corrects the fraction of its ceilings (49 152
probe rays, 16 384 cache cells) the next frame encodes. Convergence stretches; the frame rate never
gives. A probe traces 64 rays against the proxy, reads the outgoing radiance the surface cache holds
where each lands, and accumulates order-2 spherical harmonics with adaptive hysteresis from a frozen
snapshot, so the steady image does not depend on thread order. After sixteen sweeps with nothing
changing, neither pass is encoded: a still scene pays nothing.

The deferred resolve adds the interpolated irradiance of the eight surrounding probes, weighted by
the cell, the surface's facing and each probe's measured mean distances, which close leaks through a
wall; where no level reaches, the term is zero. Against the compiler's path tracer
(`trillion3d-oracle`) on a control room, the mean error is 18.6 %, above the 10 % target. The
bounce is **off by default**: its stage costs about 1.1 ms, above the one-millisecond bar. Emission,
transparency and specular are not bounced. `setLightingView('bounce')` outputs the indirect
irradiance alone, the quantity `bench/runner/oracle.ts` compares.

## Transparent surfaces

WebGPU filters transparent meshes against the camera frustum before uploading their uniforms or
issuing their draws; bounds cover the whole transformed geometry, and `frustumCulled: false` or a
non-finite bound keeps a mesh. `FrameMetrics` exposes `transparentMeshes`,
`transparentFrustumRejected`, `transparentDrawCalls` and `transparentSubmittedTriangles`. There is
no transparent LOD, occlusion culling or sorting. The transparent path is still lit from the source
graph's lights and a fixed ambient (at most 256 visible lights), not by the declared-light store —
the next step of the no-implicit-light rule. A blend surface over the display background is composed
in display space.

## Presentation

A direct WebGPU session configures the host canvas with its own `GPUCanvasContext`; no WebGL context
is created. A mixed session (measurement only) composes on a WebGL2 surface: the engine presents
into a canvas of its own, publishes it as `presentedSurface`, and the host copies it with the
engine's own full-screen program (`createBackendPresenter`). `presentedSurface` is withdrawn, and the
canvas blanked, as soon as the device is lost; the loss is announced once by `gpu-device-lost`
(`reason`: the device's own, `uncaptured-error` or `residency`). Neither path reads the image back
for presentation.

For every WebGL2-hosted session, `createWebglSurface` creates and owns the context before anything
else: attributes, drawing-buffer size from logical size and DPR, loss and restoration, one release.
Targets, held frame, comparison compositor and presenter are engine objects on that context, and the
frame composer asks each backend to draw its whole image through `drawHostGeometry`.

## Memory

The geometry pool holds `floor(bytes / pageBytes)` slots, the root cover pinned for the backend's
lifetime; the texture pool is split between the colour and data atlases in layers. When a view asks
beyond the geometry pool, the cut's screen error climbs a ladder that doubles what the image was
drawn at (1 px at least on a first overflow, up to 4096) and comes back down rung by rung to 0.125
px once the requested cut fits under 70 % of the slots. The ladder moves only on a cut sampled at
the rung in force, and a rung that overflowed is not asked again until the view or the pool changes,
so a still camera settles instead of alternating between two cuts.

A pool resize (`explorer.setMemoryBudgets`) copies pages and tiles on the GPU into the new pool —
root cover first, then pinned pages, then the most recent — evicts only what no longer fits, and
rebuilds every bind group that named the old pool on the next image. The geometry pool can grow up to
`geometryPoolCeilingBytes`, because its per-row tables are sized once at that ceiling. Backends
without pools throw `UNSUPPORTED_MEMORY_BUDGETS`.

A region keeps a complete resident representation until every replacement page is uploaded; if old
and new detail cannot coexist, the renderer returns to the root cover before reclaiming slots.
Shared URLs occupy one slot across instances. Two counters say different things:

| Field            | Meaning                                                                                         | Reported by          |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------- |
| `pagesDetached`  | clusters that left the drawn cut since the backend was created: cut churn, not memory pressure  | the WebGL page paths |
| `cacheEvictions` | pages actually evicted from the cache that feeds the drawn geometry: the memory-pressure signal | every backend        |

`coverageReady`, `coverageBudgetLimited`, `budgetPixelError` and `streamingError` report coverage;
the `coverage-*` diagnostics trace bootstrap, budget, upload and streaming failures. A failed URL is
retried at most three times per session; an initial cover read failure rejects preparation.

## Virtual textures

Material textures are virtual: every texture is cut into 128×128 tiles (plus a 4-texel border) that
live in two fixed pools (sRGB colour, linear data); one page table per texture says which pool tile
serves each tile of each mip level, and only the tiles the image reads are resident. The texture
pool (512 MiB by default, split evenly, in layers of 30×30 tiles) is the session's texture memory
whatever the scene. Residency is driven by the rendered image: the material resolution counts, for
one pixel in sixteen (every pixel during `flush()`), the tile each map needs at the mip its
derivatives select; transparents write their requests into their own target, reduced by a compute
pass. The counters come back one frame late.

Uploads are bounded twice per frame: `maxTextureTransferBytesPerFrame` (16 MiB) and
`maxTextureUploadMsPerFrame` (1.0 ms), most-requested tiles first; the rest waits and shows its
coarser resident level, so a cold traversal streams at a fixed cadence instead of stalling the
frame. The first tile of a pass is always copied. `textureUploadPeakMs`, `textureUploadMs` and
`textureTilesDeferred` publish the work; a stutter is read on the peak and the p95, never on the
median. A full pool evicts the least recently read tile; a tile nothing can accommodate is counted in
`textureTilesRefused`. A missing tile is served by its finest resident ancestor, down to the
texture's tail (every level of 64 texels or less, pinned at `prepare()`): never a fill texel.
`flush()` renders the pose until nothing it reads is missing, drains the pending shadow pages, and
replays the temporal accumulation identically, so a flushed pose is deterministic (`pose-settle`
diagnostic).

**The engine reads the levels the compiler baked.** As soon as the cache declares texture chains,
each baked level is read on demand (decoded by the browser, held in a 192 MiB host cache) and tiles
are cut from it. A chain is generated at run time only for a texture the cache carries none for.
`textureSource` (`'cache'` by default) says whether the prepared scene reads the source images: under
`'cache'` an image whose chain the cache carries is never fetched; `'cache'` is honoured only where
every mounted backend reads the baked levels, and `backend-choice` publishes what was settled.

**Block-compressed lanes.** Each atlas is one pool per lane: `lossless` (RGBA8), `rgba` (BC7 or ASTC
4×4) and `two-channel` (BC5 or ASTC luminance-alpha — a normal map's X and Y, Z rebuilt).
`textureCompression` (`'auto'` by default, `'bc7'`, `'astc'`, `'none'`) names the family sampled:
`'auto'` takes the first family the device samples and the cache holds kept chains in, RGBA8 when
none. A texture takes the lane its chain was **kept** in by the compiler's quality gate
([FORMAT.md](FORMAT.md#textures)); a chain the gate left lossless, a partial chain or a host image
reads from the lossless lane, so the engine never trades a pixel for memory on its own. Every lane
with textures gets one layer, the rest of the budget by the bytes its tiles would take.
`texturePoolFormat`, `texturePoolLayers` and `texturePoolBytes` publish the result, and the
`material-textures-ready` diagnostic lists each pool.

## Diagnostics and timing

`diagnosticDetail: 'trace' | 'summary'` controls event detail; an `onDiagnostic` observer defaults to
trace, and omitting it disables collection. Debug frames are marked `measurementKind: 'diagnostic'`:
turn debug off before collecting performance evidence. Events carry a session id, a monotonic
sequence and a timestamp; delivery is queued outside the measured call, with a 65 536-event pending
limit and an explicit `diagnostic-loss` record on overflow (`createDiagnosticChannel`: `flush()`,
`flushSync()`, `pending()`, `dropped()`). Every SDK build records the SHA-256 of its distributed
modules in its configuration event; a direct source import has `hash: null`.

Phases carry `pipelineVersion: 1`: `gpu-presentation`, `frame-allocation`, `material-textures`,
`material-textures-ready`, `material-classes-ready`, `material-surfaces-ready`, `scene-lighting`,
`render-capabilities`, `render-progress` (selected and resident pages, triangles, pending pages,
transparent counters), surface-capture phases, `gpu-device-lost`. Observer exceptions cannot
interrupt a backend. These durations are not frame-performance measurements.

**GPU timing.** `timestamp-query` is requested when the adapter advertises it (`gpu-timing-status`).
Summary mode instruments at most one submission in 60, trace mode every one, with one outstanding
readback and at most 64 pass pairs; `flush()` publishes `gpu-timing` events outside the beauty loop.
`sumPassMs` sums pass intervals; it is not end-to-end GPU latency, and invalid or truncated passes
make it `null`. A per-pass duration says where, never how much: on tile-based GPUs passes overlap.

**CPU timing.** `cpu-timing` reports render duration, light updates, selection, residency and target
management, encoding and submission; `transparentEncodeMs` is a subset of `encodeSubmitMs`, never
added to it. CPU and GPU times are never added together.

**Surface capture for global illumination.** `explorer.captureSurfaceView(pose, { width, height,
signal })` returns an owned `SurfaceCapture` version 1 — the four material textures, depth, inverse
view-projection, camera position and selected triangle count — for future lighting work. It reuses
the page cache, selects for the requested camera, restores the main view afterwards and must be
serialized with ordinary rendering; translucency is excluded.

## Proofs

`pnpm run test:gpu` runs every hardware proof (`tests/browser/probes/`, `tests/browser/renders/`)
with the repository's own Playwright and esbuild, the machine's Chrome and its WebGPU device, and the
assets under `.mesure/assets/` ([TESTS.md](TESTS.md)). The material proof
(`tests/browser/renders/witness-materials.browser.ts`) renders twelve fixtures against the WebGL2
witness within one level per channel, except blending over an opaque surface, where the engine
blends in linear radiance and the witness in display space: the fixture declares that 45-level gap
and holds the engine inside it. A successful proof run is not a full-scene parity verdict, and it
measures no performance. The CPU shading oracle encodes linear lighting to sRGB without ACES; it does
not replace the displayed-image comparisons. Node tests validate orchestration with GPU doubles and
do not execute WGSL.

## Lighting: the target and the stages

The end goal of this engine, and the order it is reached in. The geometry, the temporal
antialiasing and the memory budgets are the foundation; this is what they are for. Each stage is
measured before the next is started, and a stage out of order is not out of scope.

Nothing here is copied from any engine: what follows comes from public material — SIGGRAPH talks
of 2021 and 2022, published documentation — and from what this engine already has.

End goal: the reference's lighting — dynamic global illumination, reflections, shadows — at its
performance, on the web.

What the reference is made of, and our counterpart:

| Reference piece                                   | Role                                                         | What we have today                                           | What is missing |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | --------------- |
| Temporal antialiasing                             | denoises everything stochastic                               | shipped, 0 px A/A                                            | —               |
| Screen traces                                     | first shot of every ray: image depth and normal, almost free | nothing                                                      | L1              |
| Distance fields (per mesh, then global)           | off-screen rays without hardware ray tracing                 | certified-error resident proxy, walked triangle by triangle  | L4              |
| Surface cache                                     | radiance of off-screen surfaces, updated under budget        | one radiance per triangle and proxy face, swept under budget | L4              |
| Screen probes (16 px grid) + world radiance cache | final gather, temporally filtered                            | cascaded SH2 world probes; no screen probe                   | L5              |
| Reflections                                       | screen traces, then distance fields reading the cache        | none                                                         | L1, L6          |
| Virtual shadow maps                               | 16k shadow pages, only the views, cached                     | 4096 atlas, page-cached sliding cascades, 1 ms budget        | L3              |
| Stochastic direct lighting                        | few samples per pixel, denoised                              | tiled culling; four draws per moving pixel, exact at rest    | L2 (denoise)    |

What the web imposes, and the answer:

- **No hardware ray tracing**: the reference's software path — screen traces first, distance
  fields next — is the one taken; the distance field is baked by the compiler, like textures, at a
  resolution fixed by the budget.
- **Bounded, unreadable memory**: what streams enters a host-set byte reservoir, never read off
  the machine ([memory budgets](SDK.md#memory-budgets), adjustable in session), and displays coarser if it does not fit, never refused; image targets
  follow resolution with no ceiling.
- **One browser frame**: each piece has a millisecond budget and a reading by envelope difference;
  lot order follows what the measurement says costs, not preference.
- **No persistent threads, eight storage buffers per stage**: worked around as for the DAG cut
  and the compute raster.

Stages, each with its proof (0 px A/A at rest, budget held, before/after published):

- **L0** — done (campaign of 18 Sept. 2026, Emerald 2496×1404): the sun is 4.7 ms of
  envelope on the ground view and 5.8 ms on the street view (`mobile` − `sans-lumiere`); lighting
  without maps ≤ 0.96 ms (`lampes-4-sans-ombres` − `sans-lumiere`); still camera: 0 page redrawn,
  envelope no lower. What remained, the sampling, is L2 below — not a cascade ring.
- **L1** — screen traces: reflections and short bounce from the already-rendered HDR, depth and
  normal; the cheapest piece of the reference, and the first.
- **L2** — sampling done (#36, 20 Sept. 2026, Emerald 2496×1404, ground view, 32 shadowed
  lights reaching one pixel): a moving pixel weighs every light of its tile without its shadow,
  shades the four it draws — exactly those worth a sample's share, stratified for the rest —
  and the history averages the draws; a still image shades every light and converges to the
  exact sum, 0 px A/A. Envelope 39.9 → 17.9 ms GPU on a moving camera; the grain left in motion
  is declared in [Direct lighting](#direct-lighting). What remains of L2: a spatial denoise before the history,
  where the reference has one.
- **L3** — shadows in virtual pages from the hardware raster: only the pages seen,
  cached. The compute raster stays off; measurement kept it off.
- **L4** — baked global distance field, walked in compute, reading the proxy's surface cache.
- **L5** — screen probes gathering L1 and L4, filtered by temporal history; world probes
  for the far field; bounce on by default when its budget holds.
- **L6** — rough reflections and materials.

Exit criterion: on the same scene and the same machine as the reference, same image
to the eye, same byte budgets, same millisecond envelope.
