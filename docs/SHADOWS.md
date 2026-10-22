# Shadows

How the WebGPU engine draws cast shadows: virtual shadow maps, whose pages exist in memory only
where the image reads them. A map: each mechanism's rule is stated where it lives, and this page
names the file and the rules that span files. Paths are under `packages/sdk-browser/src/`: `vsm/`
holds the passes and their shaders, `lighting/shadows/vsm/frame/` the frame's plan, grant and
encoding. Lights, tiles and the resolve are [ENGINE.md](ENGINE.md#direct-lighting); the
options a page sets (`castShadow`, `transparentShadow`) are [SDK.md](SDK.md#lights).

## Pages and the pool

Every map is virtual: a page table over a fixed physical page pool in two slices, dynamic and
static. The sizes are tuning values the engine declares, each with its reason, in
`vsm/constants.ts` (`VSM_PAGE_TEXELS`, `VSM_LEVEL0_PAGES`, `VSM_MIPS`, `VSM_POOL_PAGES`); the
buffers are `vsm/resources.ts`. A light takes no page of its own: the pixels mark the pages they
read, only those are allocated and drawn, and a page nobody marks is evicted when a new one needs
room, in the order of the pool rank every GPU pool evicts by (`vsm/freePagesWgsl.ts`). The set is made at the first lit frame with a casting light, sized for the lights that cast
(`lighting/shadows/vsm/frame/engineVsm.ts:fullMapsFor`), and grows with its cache kept
(`lighting/shadows/vsm/frame/vsmGrant.ts:growEngineVsm`).

## Memory

The set, the mask, the raster's lists and the blended casters' atlas are granted within the room
the GPU budget leaves the shadows (`lighting/shadows/vsm/frame/vsmGrant.ts:grantEngineVsm`); their
total is `shadowPoolBytes` (`lighting/shadows/vsm/frame/vsmStats.ts`). Rules a contributor keeps:

- **Sized by the view, grown by its fill.** The physical pool asked follows the drawing buffer: the
  full pool (`VSM_POOL_PAGES`) for 1920 × 1080 pixels or more, its share of the pixels below, a
  power of two down to an eighth (`vsmViewPoolPages`, `vsm/poolDraw.ts`). A fill past the pressure's
  load asks the pool that holds it (`vsmDemandPages`), up to the full pool, never lowered for the
  session (`vsmPoolAsked`, `lighting/shadows/vsm/frame/vsmLightMaps.ts`): a small view holds a small
  pool, a busy one the pages it marks.

- **Never a crash, never an allocation the budget refuses.** Past the room, the pool is made with
  half the pages, down to an eighth: coarser shadows, said once (`gpu-out-of-memory`). When not
  even an eighth fits, the lights read no shadow, by name, until the room holds it or the lights
  change. A set the device refuses is undone whole and asked again only for other lights.
- **Coarser, then finer again.** A short pool grows to the one asked once the room holds it, at most
  every `VSM_PRESSURE_CALM_FRAMES` (`shadow-pool-regrown`). A full pool raises a global resolution
  bias (`VsmCacheManager.readPoolFeedback`, `vsm/cacheManager.ts`).
- **Said, never hidden.** `shadowResolutionBias` is the pool's halvings from the one asked plus that bias; above `0`
  the reference mode refuses its capture (`REFERENCE_SHADOWS_REDUCED`).

## One frame

Encoded in the direct-lighting step, after the visibility and material passes and before the
lighting pass (`lighting/shadows/vsm/frame/engineVsm.ts`, `vsmEncode.ts`), in this order:

1. Invalidation: one stale over the previous frame's maps, its dispatch sized on the GPU. It reads
   the boxes the rows pass appended to the shadow changes' list (`shadows/casters/castChanges.ts`),
   never read by the CPU, then the CPU's boxes of what no row says, records of the same format in
   their own buffer (`invalidation/castBoxes.ts`, `invalidation/castInvalidation.ts`, `invalidation/castStale.ts`).
2. The plan: clipmaps, local lights, map ids, projection data (`vsm/frameSetup.ts`,
   `vsm/clipmap.ts`, `vsm/localLight.ts`, `vsm/cacheManager.ts`).
3. Page address update, carrying last frame's pages to this frame's ids
   (`vsm/pageManagementPass.ts:encodeVsmPageCarry`).
4. Page marking (`vsm/markingPass.ts`, `vsm/markingWgsl.ts`).
5. Page allocation (`vsm/pageManagementPass.ts:encodeVsmPageMapping`, `vsm/physicalPagesWgsl.ts`).
6. The shadow raster on the camera cut's resident rows (`render/renderPass.ts`,
   `render/renderCullWgsl.ts`, `render/renderRasterWgsl.ts`) — those its level of detail selects and
   its HLOD switch draws (`geometry/dag/shader/worldGateWgsl.ts`, `worldDraws`): an HLOD actor the
   view does not draw, or a cell's objects it does not draw, casts nothing —, a sun's far casters left
   out ([Far casters](#far-casters)), its chunks sized
   from histograms of the rows' spheres the GPU bins after it and reads back a few frames late
   (`rows/rowBinsWgsl.ts`, `rows/rowPageBound.ts`).
7. Post render (`vsm/pageManagementPass.ts:encodeVsmAfterRaster`), the blended casters' atlas
   (`transmission/transmissionPass.ts`), then the projection into the mask (`projection/projectionPass.ts`,
   `projection/projectionWgsl.ts`, `trace/traceWgsl.ts`).
8. The lighting pass reads the mask; the frame end copies the counters back a few frames late
   (`lighting/shadows/vsm/frame/vsmFrameEnd.ts`).

Rules across passes: every page allocated and valid this frame is drawn this frame, no list
overflows (`rows/rowPageBound.ts`); a still scene draws nothing after its first frames, every page
keeping its static depth, and a static caster that moves redraws only the pages its box covers,
into the dynamic slice (`VSM_STILL_FRAMES`); a cell that switches between its objects and its HLOD
actor redraws, in the same image, the pages the rows of both cover
(`frame/prepare/lightResources.ts:shadowsFollowCells`).

## Far casters

A sun's shadow maps follow the eye, and a caster far past the distance they are asked to reach would
cost a raster pass for a shadow nobody reads, so the caster list leaves it out
([SDK.md](SDK.md#a-suns-shadow-distance-and-its-far-casters) tells the settings). The caster kernel
(`vsmRenderCandidates`, `vsm/render/renderCandidatesWgsl.ts`) gives each candidate the depth along
the main view of the nearest point of its object's sphere (`farDepth`: the sphere the rows pass
derives for every row from its object's box — the placement's root box or, for a page of the world
DAG, its actor's (`casters/objectSphere.ts`) — as four singles in two of the row's input doubles,
the offset of its centre from the row's own and its radius, turned by the root's world and scaled by
its stretch into the row's `object` words) and two flags: the test reaches its row (a placement of
the world DAG, or any row under `farShadowCullsAllMeshes`) and its object casts far shadows
(`MOBILITY_FAR_SHADOW`, a bit of the row's mobility word; a flip of the flag stales the row's pages,
its cast state holding the bit). When every map view of the frame is a sun that has a distance, the
candidate pass itself leaves out a caster past the greatest of them (`farDrop`, a parameter of the
frame, `lighting/shadows/vsm/frame/vsmFarShadow.ts`); the cull (`vsmRenderCull`) drops a candidate
from every level of one sun's clipmap when its row is tested, does not cast far, and its `farDepth`
is past that sun's far-shadow distance, which each map's projection record carries
(`farShadowDistance`, 0 for none; a local light's is 0). The distance is no part of the clipmap's
cache key: a new distance reaches the next frame's test, and the cached pages are kept.

The edge's layout (four near levels at most, growth 3, overlap 0.1 times the scale, a far field
under 512 m) shapes nothing but this edge: the engine draws neither cascades nor distance-field
shadows. The count of near levels, the scale on the overlap and the far field are settings
(`shadowNearLevels`, `shadowOverlapScale`, `shadowFarField`), the growth, the tenth and the 512 m
constants of `farShadowDistance` (`packages/sdk-core/src/contracts/shadowOptions.ts`).

A caster whose object names draw distances it lies outside of (`drawDistance`,
[ENGINE.md](ENGINE.md#webgpu-page-raster)) is left out by the same kernel, before the far test, from
the main view's eye in every pass of the light.

## Reading the shadow

One estimator shades every surface: the receiver's trace (`trace/receiverTraceWgsl.ts`) — the
normal bias, a screen ray for the contact, then rays across the light's disk or sphere marched
through the stored depths. Opaque surfaces read it from the mask, where the projection pass traced
it 64 pixels a workgroup, its 32-pixel halves voting their ray count. Blended surfaces and water
trace their own fragment with it on the same view, noise, maps and depth pyramid
(`lighting/direct/shadowWgsl.ts:vsmTraceFactor`), lone: no vote, so a fragment stops early only on
its own narrow contact and never traces fewer rays than a voting pixel. Every pass reads the pool
through the same windows: buffers of WebGPU's guaranteed binding size, the same on every device
(`vsm/layout.ts:poolWindowSizes`, `vsm/resources.ts`). A page not drawn hands its point to the next coarser level mapped; where none
holds it, it is lit.

## Metrics

The `shadow*` fields are documented on the contract
(`packages/sdk-core/src/contracts/shadowMetrics.ts`) and filled by
`lighting/shadows/vsm/frame/vsmStats.ts`. The page counters need the page-counter readback on
(`countersOn`).
