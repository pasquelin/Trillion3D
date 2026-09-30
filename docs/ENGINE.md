# Engine internals

How a world draws. A page writes against [SDK.md](SDK.md) and reads what follows through the
`world` families (`metric.frame(world)`, `world.diagnostic.mode`, `capability.lighting(world)`, …).
Two functions below are public, for a standalone host that drives pages or diagnostics itself:
`createGpuPageCache` and `createDiagnosticChannel`, exported by `trillion3d`. Every other internal
name — `openMeasuredWorld`, backend ids, session options — is reachable only through the measurement
entry point (`packages/sdk-browser/src/measurement/measurement.ts`), for the bench, the proofs and
the comparison views, which reach the witnesses through `bench/witnesses/measurement.ts`
([SDK.md, "Entry points"](SDK.md#entry-points)). Shadows are [SHADOWS.md](SHADOWS.md); geometry and
texture residency is [RESIDENCY.md](RESIDENCY.md).

## The internal session

A world opens one internal session on itself (`openMeasuredWorld`, `createMeasuredWorldJob`). Its
options beyond `WorldOptions` — `maxResidentPages`, `pageFetchWorkers`, `replicaCount`, `backends`,
`preload`, `comparisonLayout`, `comparisonPair`, `gpu`, `temporalAntialiasing`, `bounce`,
`bounceBudgetMs`, `shadowPageInvalidation`, `importedLights`, `textureSource`,
`textureCompression`, `mathPath` — stay on it; a published world always runs the defaults. The
comparison layouts (`single`, `side-by-side`, `wipe`, `toggle`, `difference`) render two backends to
detached targets with the same camera: a bench and proof tool, never a performance verdict.
`replicateInstances` instances the source 1, 4 or 9 times, sharing geometry and materials, for the
bench. `RenderBackend.pendingFrame?()` waits for submitted work without image readback and returns
whether interactive rendering should continue; the session owns every interactive listener and
pending callback and releases them on disposal.

## Which backend renders

With no `backends` option, a session renders through the engine's own path, chosen once, before the
scene is read, from what the machine offers. The `backend-choice` diagnostic reports it: `origin`
(`default` or `host`), `renderer` (the backend id that draws), `autonomous` (true when the session
reads the cache's prepared scene rather than `source.gltf`), the `reason` and the `textureSource`
settled on.

| Machine | Backend that renders | Scene file read |
| --- | --- | --- |
| A WebGPU device was granted | `webgpu-page-raster` | `source.gltf` |
| WebGL2, cache with a prepared scene | `autonomous-pages-webgl` | `metadata.autonomousScene` |
| WebGL2, cache without one | `autonomous-pages-webgl` | `source.gltf` |
| Neither WebGPU nor WebGL2 | none — `NO_ENGINE_BACKEND` (`NO_WEBGL2` from the capability probe before it) | — |

`autonomous-pages-webgl` decodes the cache's geometry pages itself, draws every page the cut selects
— `submittedTriangles` equals `selectedTriangles` — and lights the scene from the cache's light
table. The compiler writes a prepared scene only when every primitive is `exact-clusters`;
otherwise the same path takes its materials and placements from `source.gltf` (`autonomous:
false`), an image rather than a refusal. A forced renderer the machine lacks is refused by name,
never swapped. `chooseBackends(options, metadata, gpuDevice, webgl2)` exposes the decision to a
bench before a session opens, and `autonomousCacheReady(metadata)` answers whether a cache carries
the prepared scene. The witnesses are opt-in through `backends`
([bench/runner/README.md](../bench/runner/README.md#the-witnesses)); the engine never mounts one.

## Scene and camera

The host subtree is mirrored once into one engine transform tree when the scene index is built;
each later pass enters only the pose numbers the host moved — compared bit for bit — and updates
only the moved subtrees, so a node moved out of two thousand costs the chain under it, not the
scene. The pose a page record, a cluster root or a transparent copy carries is a sixteen-number view
on that tree's world buffer: rewritten in place, never copied, never stale. The local pose of drawn
nodes and lights is hooked, so a write increments the scene revision and a frame compares one
integer; visibility, parent and a light's numbers are compared per frame.

What the engine computes — matrices, vectors, colours, its camera, the side of a material — it
builds on `sdk-core`. A resource crosses the host boundary as the shapes of
`packages/sdk-browser/src/host/resources.ts` (`HostMaterial`, `HostTexture`, `HostAttributes`,
`HostMesh`, `HostScene`; a node is the core's `Object3D`) and is read in one place,
`packages/sdk-browser/src/host/surfaceImport.ts`, into the engine's own `Material` and `Texture`
(`packages/sdk-core/src/contracts/material.ts`, `packages/sdk-core/src/texture/contract.ts`). Every
pass, page row, tile pool and transparent item computes on those records alone; a page carries
`PageSurface` (`packages/sdk-browser/src/page/surface.ts`). The material is re-read at every call; a
texture is read once and refilled when the host bumps `texture.version`, which a host changing
anything a sampler declares (wrap, filter, anisotropy, colour space, UV transform) also bumps. The
side is re-read at every look; `alphaTest`, `opacity` and the blend flags where they are read;
everything else follows `material.version`. `tests/integration/engine-without-three.test.ts` holds
the closed list of files allowed to reach back into the host object.

The engine does not read the host's clip-depth convention. It composes its own projection from the
declared optics — field, aspect, near plane, zoom — in **reversed depth with an infinite far plane**
(`engineCamera.ts`, `depthConvention.ts`), one convention for the frustum planes, the GPU's
view-projection, the Hi-Z bounds and the CPU visibility raster.

## WebGPU page raster

`createGpuPageCache(device, pageSource, { pageBytes, slots })` is a bounded WebGPU buffer and queue
adapter: a live `resize(slots)` that keeps what fits, pins, serialized loads, a reusable staging
buffer and eviction without a device-wide queue fence. `dispose()` aborts in-flight reads and waits
for submitted work. It reports allocation accounting, bytes read and uploaded and evictions, not
physical VRAM. `httpPageSource(baseUrl)` reads its pages by key over HTTP, one request per read: the
cache asks again as [the SDK guide](SDK.md#files-over-http) says, and its read diagnostics carry the
`details.status` of the `RESOURCE_HTTP_ERROR` refusing one.

`webgpuPagesBackend` (`webgpu-page-raster`) consumes that cache. For opaque pages, a compute pass
selects the camera's drawable resident cut — frustum, `lodScore` and conservative backface cones —
keeping complete coarse coverage until every required child is resident. Draw compaction counts
pages in parallel groups of 64, computes group prefixes and scatters each page in bin order; the
visibility shader vertex-pulls indices from resident slots into a visibility buffer of packed page
and triangle ids, in at most six geometry `drawIndirect` commands (cull mode × Hi-Z pass).
Selection and submission counters stay `null` until the matching GPU result is read back;
asynchronous readback serves streaming and diagnostics and never blocks the current camera's
selection. `capabilities.gpuDriven` denotes this opaque selection-to-draw path, not a completely
GPU-autonomous engine.

**Requests ahead of the camera.** A moving camera's cut also evaluates a view ahead
(`gpu/core/aheadView.ts`, `gpu/dag/shader/aheadWgsl.ts`): the eye moved by its velocity over
`PREFETCH_HORIZON_MS` (250 ms, the time to full detail after a stop), in a frustum holding the
current and the predicted one, each side opened by the angle the camera turns over the horizon. In
one descent, what the camera rejects is tried against the view ahead, never drawn, only requested,
in a lower tier ranked after every visible request, at most half the readback. The cut sorts its
requests on the GPU, visible tier first and the larger replacement error first within a tier
(`dagSortRequests`, `gpu/dag/shader/snapshotWgsl.ts`); the host reads them in that order and ranks
nothing. It serves them through the one residency queue as a lower tier after the camera's and the
light cuts' (`webgpu/residency/lowerTier.ts`): never pinned, never evicting a camera page, emptied
once the camera stops; a still camera sends no view ahead. Admission starts no page once it has held
the main thread for the published share `STREAMING_FRAME_MS` (1 ms): it yields a task and resumes at
once (`page/integration/frameBudget.ts`, the arrival queue's budget), so a due frame waits no longer
than the share and the page begun within it, and a hidden tab still loads. Fetching and decoding
stay in workers.

WebGL2 cuts by the same rule and holds pages by the same residency, without the GPU cut or its
readback (#490, #839). It draws the resident pages from one set of buffers per vertex layout
(`webgl/cluster/pageArenas.ts`): consecutive pages of one surface at one placement are one
submission of their index ranges (`WEBGL_multi_draw`), read once a frame and replayed by every pass
that draws them — the reflection capture's and the image's (`webgl/cluster/runs.ts`, #840). Which
pages load and leave — request admission, the eviction queue, the one cut rule — is
[RESIDENCY.md](RESIDENCY.md).

**Occlusion** is two-phase Hi-Z. Pass 1 draws the rows the previous frame drew that the previous
frame's pyramid does not hide; a pyramid is built from that depth (background at the far plane, min
reduction in reverse-Z); pass 2 retests the withdrawn and previously rejected rows against it. The
previous pyramid only chooses pass 1; the current one alone judges what is rejected, conservative to
the ulp (`tests/browser/renders/conservative-gpu-partition.browser.ts`). A test reads the first mip
whose outward-rounded footprint fits 16×16 samples; a bound outside the target or crossing the near
plane is kept. A row kept while the view stands still stays in pass 1 until the view or a world
moves, so a still image converges under the jitter and is held. `selectVisiblePages` and
`applyTemporalHiz` remain the CPU A/A oracles and the fallbacks when compute is missing or a
readback is not yet current. If the visibility pipeline cannot be created, the untextured page
raster remains and Hi-Z stays off.

## Material surfaces

The opaque and masked path writes visibility, then reconstructs material properties into three
`rgba16float` textures and one `r8uint` texture (25 logical bytes per pixel): base colour and
metalness, world normal and roughness, emission and AO, surface flags. Depth is `depth32float`.
Lighting consumes these surfaces and reconstructs world position from depth. Transparency is shaded
separately into the HDR target; a transmissive material (`KHR_materials_transmission` with IOR and
volume) is composed after it by one fullscreen pass on a frozen copy of the lit image, bounded by
the opaque depth; its rank and opacity borrow the display target, which only the final composition
writes after it, so temporal antialiasing and composition read the opaque surface flags at no extra
target. Those two read the flags only for the as-is share of a normal or depth surface: until a row
shows one, and outside a diagnostic view, they run flagless variants, compiled beside the others.
ACES and sRGB conversion happen at final composition, which writes the display value to the capture
target and the canvas in one pass.

The reconstruction runs one pass per **material class**, the published visibility-buffer design,
instead of one program that tests every feature per pixel. A class is the set of features the
resolve would branch on — UV, base map, alpha cut-out, roughness, metalness, occlusion, emissive and
normal maps, vertex normals, double-sidedness, tangents, filtered sampling, vertex colours — a
thirteen-bit word carried by every page row. A vertex-coloured class multiplies the base colour by
the page's `COLOR_0` when its material asks for vertex colours, as the transparent pass and the
WebGL2 path do; geometry read as floats carries its colours at the tail of its UV buffer, which
every page-geometry pass binds. A masked surface is cut at base map alpha times vertex alpha, as the
reference cuts. Pipelines are compiled at preparation, never on the frame that first draws a class.
Each frame the `Trillion3D material depth` pass writes every pixel's class as an exact depth value,
then one full-screen triangle per present class runs under `depthCompare: 'equal'`, so the hardware
keeps that class's pixels and its fragment stage reads only the maps it has. The
`material-classes-ready` diagnostic lists the classes; the `materials` view colours each pixel by
its class. Not done: screen tiles per class, so a class present anywhere costs one full-screen
triangle.

## Temporal antialiasing

The visibility buffer cannot be multisampled; edges are recovered temporally. Each image is
projected with a sub-pixel jitter (Halton (2,3), eight positions, a clip-space translation of the
render matrix only) and resolved by `Trillion3D temporal antialiasing` between the transparent pass
and composition: the image is refiltered on its 3×3 neighbours with a one-pixel Blackman-Harris
window, the history is read where the unjittered centre was in the previous image, clamped to the
YCoCg box of the neighbours and blended in, each side weighted by its inverse luminance. Two
`rgba16float` histories ping-pong (16 bytes per pixel, counted in the frame allocation).

Motion vectors are derived, not rasterised: the visibility buffer names each pixel's page row, the
row its placement, and the pixel is reprojected through that placement's `previous · current⁻¹`,
then the previous unjittered view-projection, both anchored on the eye so large coordinates keep
single precision. The background reprojects as a direction.

Two regimes. While something moves — camera, scene, resources, work in flight — the current image
weighs one eighth. When an image is **quiet**, the history is dropped, the jitter restarts at phase
zero and the k-th quiet image weighs 1/k: after sixteen, the held image is the uniform average of
sixteen images of the final state only, so two executions render it bit-identically (`0 px` A/A).
Every stochastic term (sampled lights, rough reflections) is exact in that still image. Declared
cost: when everything stops, edges stiffen for an image or two before reconverging. The jitter never
reaches the cut: selection, frustum and screen error read the unjittered camera. A surface capture
and a diagnostic view render unjittered and unaccumulated. The pass's own timestamp means nothing on
tile-based GPUs; its cost is read as an envelope difference with `temporalAntialiasing: false`.

**Render scale.** The options of `createWorld(canvas, { renderScale })` — a number, `'auto'` (the
default) or `{ min, max }` within [0.5, 1], read back by `world.renderScale` — are
[SDK.md](SDK.md#canvas-camera-and-teardown). Every pass up to the resolve may draw at `s × display`
per axis (axes rounded to multiples of eight) while the resolve reconstructs the display: per
display pixel, the 3×3 render texels around it, depth-dilated, Lanczos-2 resampled from each texel's
jittered sample, deringed and clamped to the YCoCg box, blended into the display-size history
(`taa/upscaleWgsl.ts`). The jitter runs `floor(8 · (W / w)²)` phases and texture reads add
`log2(w / W)` to their level, so detail stays the display's. The controller follows the reference's
dynamic resolution (`frame/scaleController.ts`): budget = the display's refresh interval, measured
on the rAF timestamps' vsync grid over the last second, from a period several intervals share,
a millisecond-rounded timer included (`frame/refreshClock.ts`), a steady cadence under 120 Hz
probed once for a faster display (`frame/cadenceProbe.ts`), target 90 % of it, `s' = s · √(target / t)` on the whole-frame GPU time `t` (timestamp queries, one
sample per image under `'auto'`), a step only past 5 % and 30 samples after the last, up only below
80 % of the target, at once on a frame over 1.25 budgets; samples of an image drawn at another scale
are discarded; without timestamp queries the frame interval is the cost. The render targets are made once at
the bounds' maximum and each image draws in their top-left `w × h` (viewports, the Hi-Z pyramid's
extent, the deferred and water passes, screen reflections, particles and guides read that size), so
a scale change reallocates nothing and keeps the history. A quiet image draws at the maximum — 1
unless the page lowered it —, so the held image is the native one. A capture, a diagnostic view or
GPU variant and the fallback draw stay at the display's size. The capability `temporal upscaling`
says whether the renderer has it.

WebGL2 runs the same controller, degraded, and `temporal upscaling` stays unsupported: with no
history, the image is resampled spatially (`webgl/core/resampleGlsl.ts`,
`world/render/renderScale.ts`) by the same Lanczos-2 kernel over the 3×3 render texels, deringed to
the 2×2 nearest, no jitter and no blend; material reads take the same `log2(w / W)` bias through
GLSL `texture(…, bias)`, lines keep their display width, and the controller reads the whole-frame
`EXT_disjoint_timer_query_webgl2` interval. Since a resample loses detail, its default minimum is 1.

## Effect chain

`world.effects` (`EffectChain`, `packages/sdk-core/src/world/effect/`; API in
[SDK.md](SDK.md#canvas-camera-and-teardown)) is one ordered list of passes drawn over the image
after the temporal resolve and before presentation. `before-tone-mapping` passes read the linear
radiance, in chain order; `after-tone-mapping` passes will read the display image (none ships yet).
The chain is one object for the world's life, shared by reference with every session; a change of
the chain or of a pass's setting counts one revision and asks for a frame.

- **WebGPU** (`webgpu/pages/render/encodeEffects.ts`, `effects/webgpuEffects.ts`): between
  `encodeTaaPass` and the composition, which tone-maps whatever view it is handed. Each pass writes
  a full-size `rgba16float` target, two in turn at most. The programs compile in the background on
  the first frame with a pass; until then the image is drawn without the chain, never held, and
  drawn again when they arrive, without restarting the temporal accumulation.
- **WebGL2** (`world/render/compose.ts`, `effects/webglEffects.ts`): with a pass, the composer asks
  the engine for linear radiance (`HostDrawOutput.linear`: no curve, no sRGB transfer, alpha as
  coverage over transparent black) into a half-float target with depth, runs the passes, then one
  output program applies the scene's curve and the sRGB transfer over the background, as the WebGPU
  composition does. That draw uses a variant of the cluster program (`CLUSTER_LINEAR_FRAGMENT`),
  compiled at the first frame with a pass, sharing the display program's vertex arrays and maps;
  without a chain, the program and uniforms are the ones drawn before the chain existed. Its second
  output marks, one byte a pixel, the coverage of surfaces whose material skips the curve
  (`toneMapped: false`), left as drawn; coverage past one is read as light
  (`effects/webglOutput.ts`). With a chain, a `none`-blended surface covers as an opaque one.
  Multiply and subtractive filter the background, which the linear target does not hold: before
  binding the target, the composer asks the engine (`BackendHostDraw.linearRefusal`), whose scene
  draw answers from the one walk of the graph per drawn image it already makes, never on a held
  frame (`webgl/cluster/sceneDraw.ts`, `linearRefusal.ts`). A frame that draws a transparent surface
  in either mode, transmissive or not, is drawn whole without the chain, never stopped mid-draw;
  `ComposedChain.refused` hears the mode on each such frame, and the world says
  `effects-refused-blending` once (`noticeEffectRefusal`). A context that cannot render half floats
  draws without the chain.
- **Kinds**: each renderer holds one table from pass kind to implementation (`WEBGPU_KINDS`,
  `WEBGL_KINDS`); a new built-in or the custom pass is one entry. The kinds of a chain share its two
  pass targets and hold their own resources besides — the WebGPU bloom gives every bloom pass its
  own uniform range, read at a dynamic offset. On WebGPU a chain that ends on a bloom leaves that
  bloom's last blend to the composition, once its bloom programs are compiled
  (`deferred/compositions.ts`, #963): the composition blends the first level into the image the
  bloom read, rounded to half precision as the pass target held it, one pass and one target fewer
  for the same image. WebGL2 still draws that blend into its pass target.

Parity rules, each held by a unit test: an empty chain adds no pass, no copy and no target — the
frame is composed call for call as without one; a held frame redisplays the image the chain drew
and runs no pass; a changed chain breaks the hold and leaves the temporal accumulation still, as
guides do; targets are made at the first frame with a pass, fixed at the image size, freed when the
chain empties, and counted in `gpuFrameTargetBytes` (on WebGL2, which counts no other target, the
chain's alone). The GPU total reserves them on the largest canvas the budget declares
(`world.budget.canvas`, 3840 × 2160 by default: two pass targets, the WebGL2 scene target and the
bloom levels, 250.5 MiB, `effectTargetReserve`), sized by the renderers' own rule
(`effects/targets.ts`); the default total grows by that reserve only, from 1 686 to 1 937 MiB, and
the geometry and texture pools keep 512 MiB each. A canvas past the declared one still renders
whole, at full resolution: the world's diagnostic channel says `effect targets over budget`
(`effect-targets-over-budget`) with the bytes past the reserve, each time that excess grows. A
diagnostic view and an off-screen capture show the engine's image without the chain.

**Bloom** (`effect.bloom`, `effects/bloomFilter.ts`) is the physically based one of Jimenez
(SIGGRAPH 2014): six half-size levels at most (a declared value, the publication's), filtered down
with the 13-tap filter, summed back up with a 3×3 tent of `radius` texels, then blended:
`image × (1 − intensity) + Σlevels / levels × intensity`. Every filter is normalised, so each level
carries the image's mean radiance: with no threshold, the total energy is conserved (CPU oracle,
`effects/bloom.fixture.ts`). The WGSL and GLSL programs are generated from one tap table and read
back against the oracle. Bytes: 8 per texel of each level, about a third of the image. Cost per
pass: measured on the frame envelope, not by its own timestamp.

## Direct lighting

**Any number of lights.** The light table grows with the scene — doubled when full, the GPU light
buffer with it, rebound by every pass —: `addLight` never refuses a light for its rank. The tile
pass tests the lights 256 at a time, one per thread of a 16 × 16 tile, and keeps in each of its two
lists those whose range reaches the tile's depth slice, in increasing rank, up to `tileLights` (64):
the lists' memory follows the view alone, 4.2 MB at 1920 × 1080 and 15.7 MB at 3456 × 2234. A tile
reached by more lights walks exactly those, written in order into a view-sized pool after the tile
records (#849): a quarter list per tile, grown to what a sampled frame asked, four lists at most. A
tile the pool has no room for walks every light, exactly, and the overflow is named
(`tileLightPoolOverflowed`, `tileLightPoolGrowths` of the frame metrics). A scene of one batch (256
lights or fewer) writes the pool from the masks its tiles still hold, never testing a light twice.
A scene of 64 lights or fewer runs a narrow tile pass (64-bit masks, a 64-light array, one batch
written straight at its ranks), holds no pool, and resolves with the narrow program too (each listed
light read with no branch), compiled on first use, its wide twin beside it. A shadow caster past the
64 shadow slices lights without a shadow and is counted (`shadowCastersUnsliced`, #818).

WebGL2 holds every light in a float texture grown with the count. A fragment evaluates only the
lights whose range reaches its cell of a world grid laid over the lamps (a cell is their median
range, at most 512 cells a lamp), plus the lights that reach every fragment. The grid is listed on
the CPU into one integer texture only when a lamp's position or range changes; a camera-only move
sends only the view-to-grid matrix (`webgl/cluster/lightLists.ts`, #835).

**One light costs what it lights.** A frame no light of which holds a shadow slot is resolved by a
program built without the shadow code (`declaredLightWgsl`, `lighting/direct/lightLoopWgsl.ts`,
#1249; chosen per frame, `contractVariants.ts`, its twin with shadow code compiled beside it): an
unshadowed light never runs that code, yet the registers it holds cost the light 40 % of its
evaluation. That program's one light loop (`sliceLightingWgsl`) also rejects a light on its sphere
alone, before its record is read in full, where the point lies past its range by a ten-thousandth
of its squared range — exactly where `declaredLight` would have given zero before any shading. The
sums are the same, bit for bit (`tests/browser/probes/narrow-resolve-gpu.ts`). The program with
shadow code keeps develop's loop: there the reject's test cost a light in range 13 % it never
repaid. Timed on the resolve (64 lamps, a million pixels, M2 Max), per light and pixel against
develop, no shadow slot: in range 42.3 → 27.8 ps, out of range 28.1 → 10.6 ps. A light grid over
the tiles (16 log-Z slices, a 64-bit mask each) was built and timed: at 3456 × 2234 it added 1.0 ms
to the tile pass and removed 3 % of the lights walked on a sponza-sized atrium — once lights past
their range are rejected on their sphere, a grid can only save that reject, never a light's shading.

**A moving image samples its shadowed lights.** It weighs every light of its tile without its
shadow (the cheap part) and shades four in full, shadow included. A light worth a sample's share of
the pixel's weight is shaded exactly and leaves the pool; the other samples are drawn along the
cumulative weight from a per-pixel offset that advances by the golden ratio every image, each
divided by its probability. The estimate is unbiased, so the history averages it toward the full
sum; a still image — the quiet ones, a capture, a diagnostic view — shades every light of the tile.
The tile pass records once per tile whether its opaque list holds a shadowed light
(`TILE_SHADOW_BASE`, `lighting/tiles/compactWgsl.ts`), read beside the list's count: only a list of 5
to 64 lights that holds one is sampled, as the per-pixel list walk it replaces decided; a list with
none is never sampled — with no
shadow to save, the three weight walks would cost three times the full sum — but summed in full as
the still one is, bit for bit, the resolve never walking the list a pixel at a time
(`tileShadowed`, `tests/browser/probes/sampled-resolve-gpu.ts`, #1249). 200 unshadowed lamps of
range 4 m in a sponza-sized atrium drop from 23.8 light evaluations per covered pixel to 7.4 at
3456 × 2234 (`bench/runner/lightTileSampledCount.ts`). `metric.frame(world).lightsSampled` says the
image ran at a sampled rank. Declared cost: a faint grain on lit surfaces where lights of different
colours overlap, while the camera moves (`tests/browser/renders/sampled-lighting.browser.ts`). What
remains: a spatial denoise before the history.

**Shadows are virtual shadow maps** ([SHADOWS.md](SHADOWS.md)): 128-texel pages, a sun as a
16-level clipmap, a lamp face as a mip chain, a pool sized from the screen, pages marked by the
pixels that read them and mapped and drawn on the GPU in that frame, a static layer so moving
objects redraw only their own casters, and a transmittance layer for blended casters. WebGL2 has
none ([SHADOWS.md](SHADOWS.md#webgl2-has-none)).

`setLightingView(view)` selects what the opaque path outputs: `'lit'` (a world's view), `'unlit'`
(base colour as authored, for geometry benches that compare pixels), `'auto'` (unlit while no light
is declared) and `'bounce'` below.

## Light that bounces

An opaque surface can also receive light bounced off other surfaces: dynamic, not baked, independent
of the camera. It rests on a **resident proxy** the compiler writes as `proxy.bin`: the coarse cut
of the DAG whose certified error stays under 5 cm, raised per primitive until the scene fits
300 000 triangles, plus a BVH and one linear diffuse albedo per triangle. The threshold reached is
published as `proxy.errorMetres`. A cache without a proxy declares the bounce unavailable.

**Cascades of probes.** Irradiance lives in up to four nested cubes of 16 probes per axis, each
level's spacing doubling, the last fixed in the world and covering the proxy, the finer ones
following the camera. Probes sit on a global lattice stored modulo the cube side, so sliding by one
cell invalidates only the entering slab. An occupancy map built from the proxy skips empty sky and
solid cores; a probe buried in a surface or lost in the sky sleeps until a light changes.

**A budget in milliseconds, not in rays.** `bounceBudgetMs` (0.8 ms) is the GPU time the stage
should take; the engine reads the stage's timestamp and corrects the fraction of its ceilings
(49 152 probe rays, 16 384 cache cells) the next frame encodes: convergence stretches, the frame
rate never gives. A probe traces 64 rays against the proxy, reads the outgoing radiance the surface
cache holds where each lands, and accumulates order-2 spherical harmonics with adaptive hysteresis
from a frozen snapshot, so the steady image does not depend on thread order. After sixteen sweeps
with nothing changing, neither pass is encoded: a still scene pays nothing.

**One basis.** The nine coefficients per colour a probe holds are the ones the scene environment and
the WebGL2 light probe hold: same band order (constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`,
`x² − y²`), same cosine-lobe factors (Ramamoorthi and Hanrahan 2001). `IRRADIANCE_TERMS`
(`packages/sdk-core/src/scene/core/irradianceBasis.ts`) writes the projection and the evaluation
once as shader text; CPU oracles run it against a constant sky (`πL` on every normal) and a single
direction (the Legendre band sum). The cascades at their largest — four levels of 16³ probes, 44
floats each, probes and snapshot: 5.5 MiB (`BOUNCE_PROBE_BYTES`) — are counted in the GPU total
after the shadow pool, before the geometry and texture pools (`splitMemoryBudget`).

The deferred resolve adds the interpolated irradiance of the eight surrounding probes, weighted by
the cell, the surface's facing and each probe's measured mean distances, which close leaks through
a wall; where no level reaches, the term is zero. Against the compiler's path tracer
(`trillion3d-oracle`) on a control room, the mean error is 18.6 %, above the 10 % target. The bounce
is **off by default**: its stage costs about 1.1 ms, above the one-millisecond bar. Emission and
transparency are not bounced. `setLightingView('bounce')` outputs the indirect irradiance alone,
the quantity `bench/runner/oracle.ts` compares.

**Mirrors.** WebGPU and WebGL2 trace the camera-visible opaque scene from mirror receivers,
transparent standard materials included, whatever the bounce setting, by one projected pixel-grid
traversal clipped against all six homogeneous frustum planes. Each crossed pixel tests its exact
ray-depth interval; work is bounded by viewport width plus height. A separate linear, unfogged,
unreflected source, regenerated with each changed image and owned by its camera view (captures and
resizing included), prevents render-target feedback, recursive reflections and fogging twice. A
screen hit replaces the proxy contribution in the one reflection model. On a miss, WebGPU with
bounce on keeps the resident-proxy ray and probe fallback; without bounce, and on WebGL2, a miss
contributes zero. Screen traces cannot reveal offscreen or occluded geometry; no screen-space result
is stretched over a viewport edge or carried from an older image. Reflected-camera planar views
remain #353. The original `miroir.gltf` cited in #31 is not in the reachable repository history;
the production proof uses generated geometric scenes with analytic reflected-point positions and
records that provenance.

On WebGL2 the mirror receivers alone are resolved once into a reduced-resolution image, at a pixel
budget derived from the screen unit rather than the display: a receiver that fits keeps its size, a
larger one resolves at the largest aspect-preserving size within it. The display pass samples that
image instead of tracing again, so reflection cost stops following the display and a transmissive
ocean's two mirror terms share one trace. It is a rendering technique under the fluids quality
exception (#1292): reflections blur at the resolve ratio, within the stated bound of the reference
image.

**Rough reflections.** The rough lobe uses the GGX directional-albedo table of rectangular lights;
mirrors at the roughness floor (0.0525) keep the exact ray path. Opaque WebGPU receivers take
deterministic GGX samples and accumulate a dedicated mean with bounded confidence: 32 bytes per
pixel for two RGBA16F mean/weight images and one previous depth, normal/roughness, and identity
image; calculations f32, mean storage f16. Each sample's cost is fixed (#33, #1342): one ray per 2 ×
2 block at half resolution, four successive frames reaching every pixel, walked over the depth
pyramid in at most 64 steps (a cell whose depth range the ray cannot cross is skipped whole), and a
miss reads the probes along the sampled ray at the first filtered roughness instead of a
resident-proxy ray per pixel; the reference mode (`reflectionTrace`) walks every pixel and keeps the
proxy fallback. Reprojection follows the placement motion while the temporal pass runs, and rejects
incompatible identity, depth, normal and roughness; a relit source (lights, materials) restarts the
history. A moved source is reprojected, its confidence capped at 16 samples while it moves; without
live motion, a placement change (moved or newly resident reflected content, shadow pages, probes)
caps it at 4 samples for 24 frames instead of restarting it from one, so a moving view does not
flicker and a stale reflection halves in three frames; a full window after that, no stale share is
left. A static image closes its filter window after 64 accepted frames; a changed jitter still
reprojects until the temporal image can be held — a bounded effective weight, not infinite Monte
Carlo convergence. Captures/replay add no duplicate samples; drawn extent changes discard the
history; shadow-page landings advance the source epoch before resolving the same image. Transparent
receivers use their own position and direction, with a deterministic cone footprint from travel
distance and GGX roughness: both shader languages filter the unfogged source's radiance mips, reject
incompatible near/far depth bounds and never reuse the opaque surface's history. The cone hierarchy
costs the sum of its mip dimensions (odd edges included), not another full-resolution history. A
screen miss keeps the proxy/probe fallback, whose low-order coefficients cannot recover fine
off-screen detail. Diffuse and toon materials have no specular lobe.

Reflection targets belong to their camera view, resize and dispose with it, and count in the
frame-target reservation; no extra user budget controls them. GPU arithmetic, shader compilation,
allocation/lifetime tests and deterministic replay checks are engineering diagnostics; image
fidelity and the 120 FPS (8.33 ms) full-frame target are the independent acceptance session's.

Thin two-sided transmission uses an independent color, optionally textured, through the existing
material, direct-light and bounce paths. Its WebGPU storage image costs 8 bytes per pixel only while
such a material is active (an 8-byte stand-in otherwise); it adds no G-buffer render target. The
model follows the public Epic Two Sided Foliage description. Shadow receiver correction uses
Boubekeur/Alexa's tangent-plane Phong projection, stored as three f32 offsets (12 bytes per pixel),
without changing visible vertices, raster depth or silhouettes; it is separate from the Chiang et
al. BRDF shadow-terminator correction.

## Fog

`scene.fog` is a term of the one lighting model, not a post effect; its options and validation are
[SDK.md](SDK.md#scene-fog). Every program that lights a surface hands its lit colour `L` through the
same law before the display chain — the opaque resolve (`lighting/deferred/shaders.ts`), the
blended surfaces (`webgpu/blend/shader.ts`), the water composite and the WebGL2 program. The pixel
reaches the eye as `mix(color, L, T)`, `color` the radiance the medium scatters toward the eye
(exposed and tone-mapped like a surface's), `T` the transmittance over the distance `d` from the
camera's position to the surface point:

- linear, `{ color, near, far }`: `T = clamp((far − d) / (far − near), 0, 1)`;
- exponential, `{ color, density }`: `T = exp(−density · d)`, a uniform medium (Beer-Lambert);
- height fog, `{ color, density, heightFalloff, baseHeight }`: the density
  `density · exp(−heightFalloff · (y − baseHeight))` integrated along the ray in closed form,
  `τ = density · d · (ρ(eye) − ρ(P)) / (heightFalloff · Δy)`, the two densities' mean where the
  ratio would lose its 32-bit precision (Wenzel, SIGGRAPH 2006; Quilez, "Better fog").

One text of the law serves both languages (`lighting/fogShader.ts`). The fog travels with the
environment (`SceneEnvironment.fog`, `packages/sdk-core/src/scene/core/fog.ts`): two `vec4`s behind
the irradiance in the contract light buffer on WebGPU, `fogColor` and `fogLaw` uniforms on WebGL2,
written only when the environment changes. The eye rides with the frame's view: `display.yzw` of
the deferred view, `eye` of the blend view, the view space origin on WebGL2. With no fog the block's
mode is zero and every program returns `L` untouched, one uniform branch per pixel. An unlit
material (basic, matcap) is fogged like a lit one, its colour standing for `L`, as in the reference;
a normal or depth material and the diagnostic views, the unlit view among them, are not. Fog is a
view-ray term, not light transport: a change of fog alone leaves the bounce probes converged (the
store's `transportEpoch`). A world writes the fog with the lights before the next frame, like
exposure. `lighting/fogShader.test.ts` evaluates both shader texts against a numerical integration.
Volumetric fog and light shafts belong to the lighting strategy below.

## Transparent surfaces

WebGPU filters transparent meshes against the camera frustum before uploading their uniforms or
issuing their draws; bounds cover the whole transformed geometry, and `frustumCulled: false` or a
non-finite bound keeps a mesh. `FrameMetrics` exposes `transparentMeshes`,
`transparentFrustumRejected`, `transparentDrawCalls` and `transparentSubmittedTriangles`. There is
no transparent LOD, occlusion culling or sorting. The transparent path is still lit from the source
graph's lights and a fixed ambient (at most 256 visible lights), not by the declared-light store —
the next step of the no-implicit-light rule. A blend surface over the display background is
composed in display space.

## Presentation

A direct WebGPU session configures the host canvas with its own `GPUCanvasContext`; no WebGL context
is created. A mixed session (measurement only) composes on a WebGL2 surface: the engine presents
into a canvas of its own, publishes it as `presentedSurface`, and the host copies it with the
engine's own full-screen program (`createBackendPresenter`). `presentedSurface` is withdrawn, and
the canvas blanked, as soon as the device is lost; the loss is announced once by `gpu-device-lost`
(`reason`: the device's own, `uncaptured-error`, `out-of-memory` or `residency`). Every frame's
metrics name it too (`gpuDeviceLost`, `reason: message`), with the device's own cause added, and
said on the console, when it comes after the error that abandoned the device. Neither path reads
the image back for presentation. Playwright's own headless shell loses the device of every
WebGPU canvas after its first frame: `launchChrome` always opens the system Chrome (#1364).

A world keeps its device across sessions, and each session creates through its own handle on it
(`gpu/core/sessionHandle.ts`, `gpu/core/deviceOwners.ts`), which tags every label. `dispose`
releases the handle first; a released handle is inert: its `create*` throw an `AbortError`, so a
preparation still running stops there (cancelled, torn down once after it stopped), and its queue
writes and submits nothing. From `dispose` on, the backend reads as lost: its audits and digests
answer `null`, and what its pending work throws — a program still compiling, the static shadow
layer, an upload — is its cancellation, said nowhere (`webgpu/pages/io/diagnostics.ts`); a failure
under a live session, a real device loss among them, is still said by name. The device's error
scopes are one stack every session shares: each creation path closes the scope it opened in every
case, an abort included (`gpu/core/errorScope.ts`), so none is left to swallow the next session's
errors. An error that names only closed sessions' objects is a console warning and a
`gpu-closed-session-error` diagnostic (`kind: 'warning'`, `message`) for the live session, or for
the next one to claim the device when none is live. An uncaptured error is otherwise a loss for the
live session whose objects it names, or, naming none, for every live session; running out of memory
is reported under `reason: 'out-of-memory'`.

For every WebGL2-hosted session, `createWebglSurface` creates and owns the context before anything
else: attributes, drawing-buffer size from logical size and DPR, loss and restoration, one release.
Targets, held frame, comparison compositor and presenter are engine objects on that context, and the
frame composer asks each backend to draw its whole image through `drawHostGeometry`.

## Dynamic geometry

A world's geometry written every frame (`usage: 'dynamic'`, or changed on two consecutive frames,
`world/core/worldDynamic.ts`) is cut into pages once, index pages alone, every page bounded by the
primitive's held box (`world/page/runtimePrimitive.ts`), and never again while its corners stay
(#573). Its vertices are read as floats by the path of a cache without geometry pages
(`pageGeometryWgsl.ts`): the same raster, Hi-Z, resolve, shadow depth and lighting. A frame reads
the geometry into lists the resource holds (`worldDynamicRead.ts`), compares them with what the
engine holds and hands it the range from the first changed vertex to the last (`updateVertices`),
within `DYNAMIC_UPLOAD_BUDGET_BYTES` weighed as sent (`vertexBytes`); a steady frame allocates
nothing.

- **WebGPU.** The float vertex pool (`webgpu/core/geometryPrepare.ts`) is sized once at open with
  room for as many vertices again as its dynamic geometry holds, none when it holds none; a rewrite
  is one `writeBuffer` per list (a normal with its tangent) into its block, plus the fallback draw's
  positions; a record mounted later takes a block of that room (`place`), and past it the session
  opens again. Each root drawing the geometry turns moving for the shadow pool, and the world box of
  the moved vertices stales the pages it covers (`movedGeometry.ts`, #489). Its rows carry
  `FLAG_DYNAMIC`: the temporal pass takes those pixels as reactive, another shape's history dropped.
- **WebGL2.** The manifest keeps a dynamic primitive's index pages (`sourcedPages.ts`), drawn over
  the host geometry's own lists, uploaded once per rewrite by their written ranges
  (`bufferSubData`).

Vertices that leave the held box serve the same pages again in a larger box: on WebGPU, which
mounts no resource in place yet (#483), that opens the session once. The box is the declared
`maxBounds`, else the first vertices' box widened by half its size on every side: a declared value,
not derived, for how far a shape rewritten every frame moves about where it started; a larger one
culls later, a smaller one serves the pages again sooner.

## Memory

How the engines hold geometry within a budget is [RESIDENCY.md](RESIDENCY.md): the geometry pool of
`floor(bytes / pageBytes)` slots, the minimum capacity (#1237) a budget is raised to by name
(`root-cover`), the pinned world top, the one cut rule (#486) that draws a missing page through its
nearest resident ancestor, admission and eviction, the WebGL2 pool and its declared gaps, and the
coverage counters. The page's side is [SDK.md, "Memory budgets"](SDK.md#memory-budgets).

## Virtual textures

Material textures are tiled, pooled and resident only where the image reads them:
[RESIDENCY.md](RESIDENCY.md#virtual-textures).

## Physics

Jolt Physics (MIT, pinned submodule `packages/physics-jolt-wasm/JoltPhysics`) is compiled with
emscripten and SIMD into one standalone module, `joltPhysics.wasm`, behind this repository's flat C
API (`packages/physics-jolt-wasm/src/`): one `jolt_step` call reads a command buffer and writes a
pose buffer and an event buffer. No emscripten glue is kept; the engine's loader
(`physics/joltModule.ts`) gives the module its memory, whose maximum is the memory budget.

- **Cooked shapes.** `RESTORE` carries a shape's Jolt binary state (`src/blob.h`, the stream the
  compiler's cook writes) under a handle, an `ADD` of kind `cooked` names the handle, and `RELEASE`
  drops it; the body keeps the shape. `physics/tiles.ts` streams a compiled model's tiles this way
  (around the moving bodies, then the eye; nearest first within the collision share, `LOADS` a
  frame, a resident tile kept half as far again); `physics/raycast.ts` asks `jolt_cast` (a batch of
  rays and shape sweeps, between two ticks) for `world.raycast(at, { exact: true })`.
- **Worker.** `physics/physicsWorker.ts` steps at a fixed 60 Hz, at most four catch-up steps a tick
  (beyond, time is dropped: slow motion, never a spiral). Two result buffers go back and forth as
  transferables, a tick writing straight into a free one (`tickResults.ts`), else into a staging
  copy. It steps only while one more step's events fit, so no event is cut, and stops ticking while
  every body sleeps and no command is queued.
- **Layouts.** `sdk-core/src/physics/layout.ts` (`PHYSICS_LAYOUT_VERSION`) holds the command, pose
  and event word layouts the module mirrors; page and worker check the protocol. A record names its
  body by engine id, slot and slot generation (moved on at each add and removal), so a late record
  of a body that left is never read as its successor's.
- **Contacts and failures.** Sub-shape contacts are counted per pair: `enter` on the first, `leave`
  on the last, only after an `enter`; a `leave` the event buffer cannot take waits a step, and a
  removed body's pairs close as it leaves. A shape Jolt cannot build fails its body alone (retired
  and named by the page); `PhysicsSystem::Update`'s errors (body pairs, contact constraints,
  manifold cache) are sent as `PHYSICS_BUDGET`, capacities `budget.physics.bodyPairs` and
  `contactConstraints`.
- **Page.** `physics/session.ts` reconciles bodies with the scene once per frame that changed it,
  sends the view, and posts the frame's commands in one message. Each moving body is drawn between
  its last drawn pose and the tick's (`poses.ts`), over the interval at which ticks arrive, not the
  time simulated; a late tick is extrapolated from its records' velocities, one interval at most:
  a slow worker shows slow motion, never a held frame. Receive and draw are typed-array loops: a
  body's position, quaternion and scale live in the placer's flat arrays
  (`ObservedComponents._share`), velocity and sleep are read from the session's arrays when asked
  (`ObjectPhysics._state`), the lerped pose is written into the transform tree, angles derived when
  read (`placer.ts`), and the world matrix composed straight into the body's instance-buffer row
  (`SceneLink.seat`); the world hears each buffer's written span once (`SceneLink.placed`), so no
  per-node world update runs. A body with no row, with children, or under a moved scene root goes
  through `SceneLink.posed` like any moved node. An unchanged pose asks for no frame, so a sleeping
  world draws nothing.
- **Distance and view.** The page sends its eye, facing, view cone and range (`camera.far`) only
  when they change. A dynamic body beyond the range is deactivated, velocities kept; a body out of
  the cone or hidden sends no pose until seen again.
- **Budgets.** Bodies, static collision bytes (tiles as cooked, a triangle mesh at `TRIANGLE_BYTES`
  a triangle, within half the module's memory: `collisionBytesOf`) and decorative bodies are
  counted on the page; memory is enforced by the module's maximum; body pairs, contact constraints
  and events size the module's own buffers.
- **Timing.** The `physics` stage of `WEBGPU_STAGES` / `WEBGL_STAGES` (host step `physicsMs`) is
  the page's share; the worker's per-step time, the module's step alone, is
  `world.physics.stats.stepMs`, the clock `scripts/bench-physics.ts` reads in Node. Its GPU column
  is the particle step ([Particles](#particles)).
- **Threads.** A cross-origin isolated page loads `joltPhysicsThreads.wasm` (atomics, bulk memory,
  shared memory), stepped by Jolt's own thread pool: each thread starts in C through
  `pthread_create`, which the loader (`physics/joltThreads.ts`) answers with a worker instantiating
  the same module on the same memory, setting its stack and thread-local storage, and running the
  entry point. `budget.physics.threads` fixes the count, capped at the logical cores minus the
  page's own; elsewhere the single-threaded module runs. `docs:serve` answers with COOP
  `same-origin` and COEP `credentialless`; the production server's headers are set outside this
  repository. `scripts/bench-physics.ts` steps the example's scene in Node on both modules and on
  the same C API compiled natively (`packages/physics-jolt-wasm/bench/`), with a per-phase profile
  from Jolt's own scopes in a profiled build.

### Particles

The particle step is `Trillion3D particles` (`particles/webgpuParticles.ts`); each pool is then one
instanced disc draw over the lit image after the transparents (`particles/webgpuParticleDraw.ts`),
unsorted: `additive` in any order, `premultiplied` far to near by origin, soft within `softness` of
the opaque depth. WebGL2 steps the same pools in a 32-bit float ping-pong pass
(`particles/webglParticles.ts`) and draws them alike (`particles/webglParticleDraw.ts`), soft on a
copy of the frame's depth in `DEPTH24_STENCIL8`, else `DEPTH_COMPONENT24`, as the blit allows. A
context without `EXT_color_buffer_float`, or a depth neither format copies, refuses the pools by
name (`PARTICLES_UNSUPPORTED`), never drawing them hard-edged: the world notice `particles-refused`,
once, and the session draws on without them. WebGPU without the visibility buffer refuses them on
the same notice.

## Diagnostics and timing

`diagnosticDetail: 'trace' | 'summary'` controls event detail; an `onDiagnostic` observer defaults
to trace, and omitting it disables collection. Debug frames are marked `measurementKind:
'diagnostic'`: turn debug off before collecting performance evidence. Events carry a session id, a
monotonic sequence and a timestamp; delivery is queued outside the measured call, with a
65 536-event pending limit and an explicit `diagnostic-loss` record on overflow
(`createDiagnosticChannel`: `flush()`, `flushSync()`, `pending()`, `dropped()`). Every SDK build
records the SHA-256 of its distributed modules in its configuration event; a direct source import
has `hash: null`.

Phases carry `pipelineVersion: 1`: `gpu-presentation`, `frame-allocation`, `material-textures`,
`material-textures-ready`, `material-texture-appended`, `material-classes-ready`,
`material-surfaces-ready`, `scene-lighting`, `render-capabilities`, `render-progress` (selected and
resident pages, triangles, pending pages, transparent counters), surface-capture phases,
`gpu-device-lost`, `gpu-closed-session-error` (`kind: 'warning'`: an error of a session already
closed on the same device, never a loss). Observer exceptions cannot interrupt a backend. These
durations are not frame-performance measurements.

**Optional device features.** The session asks for every optional feature a kernel can use that the
adapter offers — `indirect-first-instance`, `timestamp-query`, `subgroups`, `shader-f16` and the
block-compressed texture formats (`world/session/gpuDevice.ts`) — and says what its device got under
the `WebGPU device granted` capability diagnostic (`features`). A kernel branches on the device's
own `features` and keeps its plain path as the named fallback. The host URL parameter
`trillion3dGpuFeaturesOff=subgroups,shader-f16` leaves the named features unrequested, so the plain
paths run on a device that has them: the fallback's proof (0 px against the features on). It acts
only on a device the engine requests; a host's own `gpuDevice` is taken as it is.

**GPU timing.** `timestamp-query` is requested when the adapter advertises it (`gpu-timing-status`).
Summary mode instruments at most one submission in 60, trace mode every one, with one outstanding
readback, and as many pass pairs as the frame that redraws the largest shadow pool encodes: 256
passes plus 32 for each of 171 shadow batches (`gpu/timing/queries.ts`), in query sets of 4 096
timestamps, so shadow GPU time and its cull and raster split are never truncated; `flush()`
publishes `gpu-timing` events outside the beauty loop. A sample (`gpu/timing/sample.ts`) carries
`totalMs`, the sum of the listed pass intervals, not end-to-end GPU latency; `frameMs`, the span
from the earliest beginning to the latest end over every part of the image; `submittedMs`, the sum
of the per-submission spans, the GPU time proper; and `hostGapMs`, their difference. Invalid or
truncated passes make them `null`. A per-pass duration says where, never how much: on tile-based
GPUs passes overlap.

**CPU timing.** `cpu-timing` reports render duration, light updates, selection, residency and target
management, encoding and submission; `transparentEncodeMs` is a subset of `encodeSubmitMs`, never
added to it. Six named steps split the shadow work inside the encode bounds, never added to them
(#1207): planning — `shadowPlanMs` (the plan around the scheduler), `shadowRequestsMs` (reading the
request report), `shadowAdmissionMs` (admitting pages) — and encoding — `shadowBatchesMs` (the
batches around their regions and passes), `shadowRegionsMs`, `shadowPassesMs`. They are filed in the
same profile row (`cpuSteps()`, `cpu-timing`) and published per frame as `cpuShadowPlanMs`,
`cpuShadowRequestsMs`, `cpuShadowAdmissionMs`, `cpuShadowBatchesMs`, `cpuShadowRegionsMs` and
`cpuShadowPassesMs`; a step the frame did not run, or WebGL2 cannot time, reads `null`, never 0. The
Shadows stage's GPU time (`gpuShadowsMs`) spans exactly the shadow passes of the pass table
(`stage/mapping.ts`, `SHADOW_STAGE_PASSES`); the light cut is its own stage (`shadowCasters`). CPU
and GPU times are never added together.

**Surface capture for global illumination.** `explorer.captureSurfaceView(pose, { width, height,
signal })` returns an owned `SurfaceCapture` version 1 — the four material textures, depth, inverse
view-projection, camera position and selected triangle count — for future lighting work. It reuses
the page cache, selects for the requested camera in a view of its own, leaves the main view as it
was and must be serialized with ordinary rendering; translucency is excluded. The WebGL2 path draws
no material surfaces and refuses it by name (`SURFACE_CAPTURE_UNSUPPORTED`).

## Proofs

`pnpm run test:gpu` runs every hardware proof (`tests/browser/probes/`, `tests/browser/renders/`)
with the repository's own Playwright and esbuild, the machine's Chrome and its WebGPU device, and
the assets under `.mesure/assets/` ([TESTS.md](TESTS.md)). The material proof
(`tests/browser/renders/witness-materials.browser.ts`) renders twelve fixtures against the WebGL2
witness within one level per channel, except blending over an opaque surface, where the engine
blends in linear radiance and the witness in display space: the fixture declares that 45-level gap
and holds the engine inside it. The grazing fixtures are also cast on the CPU, the map's base level
averaged along each pixel's minified axis, on the tangent its derivatives lay, and cut once
(`tests/browser/support/groundTruth.ts`): a perfect anisotropic read, with no mip level and no
footprint cap. The proof counts both renderers' pixels over one level from it, silhouettes aside,
and requires the engine at 16× no farther than the witness, give or take CONTRIBUTING's tolerance:
0 px, 4 on the foliage cut-out (#443). A successful run is not a full-scene parity verdict and
measures no performance. The CPU shading oracle encodes linear lighting to sRGB without ACES; it
does not replace the displayed-image comparisons. Node tests validate orchestration with GPU doubles
and do not execute WGSL.

## Lighting: the target and the stages

The end goal of this engine, and the order it is reached in: the reference's lighting — dynamic
global illumination, reflections, shadows — at its performance, on the web. The geometry, the
temporal antialiasing and the memory budgets are the foundation. Each stage is measured before the
next is started, and a stage out of order is not out of scope. Nothing here is copied from any
engine: it comes from public material — SIGGRAPH talks of 2021 and 2022, published documentation —
and from what this engine already has.

| Reference piece | Role | What we have today | What is missing |
| --- | --- | --- | --- |
| Temporal antialiasing | denoises everything stochastic | shipped, exact at rest ([Temporal antialiasing](#temporal-antialiasing)) | — |
| Screen traces | first shot of every ray: image depth and normal, almost free | a projected pixel-grid traversal for mirror and rough reflections, WebGPU and WebGL2 ([Light that bounces](#light-that-bounces)); no screen-traced bounce | L1 (short bounce) |
| Distance fields (per mesh, then global) | off-screen rays without hardware ray tracing | certified-error resident proxy, walked triangle by triangle | L4 |
| Surface cache | radiance of off-screen surfaces, updated under budget | one radiance per triangle and proxy face, swept under budget | L4 |
| Screen probes (16 px grid) + world radiance cache | final gather, temporally filtered | cascaded SH2 world probes; no screen probe | L5 |
| Reflections | screen traces, then distance fields reading the cache | screen traces first; on a miss, with bounce on, the resident-proxy ray read in the surface cache and the probes; GGX rough lobe, accumulated on opaque WebGPU receivers, cone-filtered on transparent ones | L4 (off-screen detail) |
| Virtual shadow maps | virtual: 16 384² texels a map (128² pages); physical: a page pool of a set count; static pages cached | virtual: 8 192² texels a sun level (64² pages), 4 096² a lamp face; physical: a screen-sized pool (2 601 pages at 720p, 5 618 at most), per-pixel level, receiver-marked pages, a static layer ([SHADOWS.md](SHADOWS.md)) | — |
| Stochastic direct lighting | few samples per pixel, denoised | tiled culling; four draws per moving pixel, exact at rest | L2 (denoise) |

What the web imposes, and the answer:

- **No hardware ray tracing**: the reference's software path — screen traces first, distance
  fields next — is the one taken; the distance field is baked by the compiler, like textures, at a
  resolution fixed by the budget.
- **Bounded, unreadable memory**: what streams enters a host-set byte reservoir, never read off the
  machine ([memory budgets](SDK.md#memory-budgets), adjustable in session), and displays coarser if
  it does not fit, never refused; image targets follow resolution with no ceiling.
- **One browser frame**: each piece has a millisecond budget and a reading by envelope difference;
  lot order follows what the measurement says costs, not preference.
- **No persistent threads, eight storage buffers per stage**: worked around as for the DAG cut and
  the compute raster.

Stages, each with its proof (0 px A/A at rest, budget held, before/after published):

- **L0** — done (campaign of 18 Sept. 2026, Emerald 2496×1404): the sun is 4.7 ms of envelope on
  the ground view and 5.8 ms on the street view (`mobile` − `unlit`); lighting without maps
  ≤ 0.96 ms (`lights-4-no-shadows` − `unlit`); still camera: 0 page redrawn, envelope no lower.
  What remained, the sampling, is L2 — not a cascade ring.
- **L1** — screen traces: reflections done (mirror and rough, both backends); short bounce from the
  already-rendered HDR, depth and normal remains — the cheapest piece of the reference.
- **L2** — sampling done (#36, 20 Sept. 2026, Emerald 2496×1404, ground view, 32 shadowed lights
  reaching one pixel), as [Direct lighting](#direct-lighting) describes: envelope 39.9 → 17.9 ms
  GPU on a moving camera, grain in motion declared there. What remains: a spatial denoise before
  the history, where the reference has one.
- **L3** — done: shadows in virtual pages from the hardware raster, only the pages seen, cached
  ([SHADOWS.md](SHADOWS.md)). The compute raster stays off; measurement kept it off.
- **L4** — baked global distance field, walked in compute, reading the proxy's surface cache.
- **L5** — screen probes gathering L1 and L4, filtered by temporal history; world probes for the
  far field; bounce on by default when its budget holds.
- **L6** — rough reflections done (GGX, [Light that bounces](#light-that-bounces)); materials
  remain.

Exit criterion: on the same scene and the same machine as the reference, same image to the eye,
same byte budgets, same millisecond envelope.

## GPU deformation

`deformation/session.ts` reserves one control record per deformed placement: current and previous
joint palettes, morph weights, the shared physics wave parameters, and cooked soft-body positions
where present. CPU animation updates bones and controls, never skins or morphs vertices; soft-body
writeback is the existing physics upload. Page-authored geometry keeps its deformation streams
through the page cutter and worker protocol, and placement rows keep their animation owners.

`deformation/compute.ts` runs once per command encoder before WebGPU cut/raster consumers, writing
current/previous positions and normals into tails of the geometry-cache slots: eleven words per
vertex, owner and frame tags included, disjoint for placements sharing a source page. Slot admission
and the root coverage budget include these bytes; a placement capacity change reopens where
in-place growth cannot keep the allocation. Visibility, shadows, transparent pages and temporal
reprojection read the shared outputs. A settled frame keeps resident outputs; eviction makes a cold
record, never unrelated history. WebGL2 evaluates the sources in the vertex shader with the same
compiled stream semantics.

Transmission keeps its material-driven whole-mesh representation, volume/backdrop pass and
no-pages contract; its static source streams and per-placement output rows sit in the float
geometry pool, written by the same compute pass at a tagged output address — not a second
deformation stage nor a new virtualization exception. Bounds use the same control reach and dirty
only their old/new region. Unsupported pool capacity is an explicit setup error, never a silently
undeformed draw. The WebGL transmission vertex stage shares the skin, morph, wave and cooked-soft
source functions.

The control record's conservative reach expands bounds in the cut. Deformed coarse pages add twice
the displacement reach to their simplification error, since two source vertices may move apart;
exact leaves keep zero, and the resident parent covers children while finer pages stream. Static
subtree shortcuts cannot classify a moving subtree from rest bounds. Shadow dirtiness follows the
roots whose controls changed. The compute stage is timed as `gpuDeformationMs`, `null` without
samples or timestamp support; browser pixel/timing evidence is the recette's on `develop`, never
inferred from the source or replaced by CPU time.

Skin pages keep every imported influence; page format 7 stores source weights and morph
position/normal deltas as exact float32 values, which WebGL2 reads through its per-geometry
deformation texture. Like morph pages, skin pages use individual resident page buffers so
`gl_VertexID` addresses the correct source vertex, keeping their compiled clusters, DAG, cut,
streaming and shadows. The arena has no per-draw base-vertex correction for this lookup, so skin
pages leave arena batching, which may add draw calls: a frame cost unmeasured, for the post-merge
recette campaign.
