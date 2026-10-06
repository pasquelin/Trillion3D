# Shadows

How the WebGPU engine draws cast shadows: virtual shadow maps, whose pages exist in memory only
where the image reads them. A map: each mechanism's rule is stated where it lives, and this page
names the file and the rules that span files. Paths are under `packages/sdk-browser/src/`: `vsm/`
holds the passes and their shaders, `webgpu/pages/render/vsm/` the frame's plan, grant and
encoding. Lights, tiles and the sampled resolve are [ENGINE.md](ENGINE.md#direct-lighting); the
options a page sets (`castShadow`, `transparentShadow`) are [SDK.md](SDK.md#lights).

## Pages and the pool

Every map is virtual: a page table over a fixed physical page pool in two slices, dynamic and
static. The sizes are tuning values the engine declares, each with its reason, in
`vsm/constants.ts` (`VSM_PAGE_TEXELS`, `VSM_LEVEL0_PAGES`, `VSM_MIPS`, `VSM_POOL_PAGES`); the
buffers are `vsm/resources.ts`. A light takes no page of its own: the pixels mark the pages they
read, only those are allocated and drawn, and a page nobody marks is evicted when a new one needs
room. The set is made at the first lit frame with a casting light, sized for the lights that cast
(`webgpu/pages/render/vsm/engineVsm.ts:fullMapsFor`), and grows with its cache kept
(`webgpu/pages/render/vsm/vsmGrant.ts:growEngineVsm`).

## Memory

The set, the mask, the raster's lists and the blended casters' atlas are granted within the room
the GPU budget leaves the shadows (`webgpu/pages/render/vsm/vsmGrant.ts:grantEngineVsm`); their
total is `shadowPoolBytes` (`webgpu/pages/render/vsm/vsmStats.ts`). Rules a contributor keeps:

- **Never a crash, never an allocation the budget refuses.** Past the room, the pool is made with
  half the pages, down to an eighth: coarser shadows, said once (`gpu-out-of-memory`). When not
  even an eighth fits, the lights read no shadow, by name, until the room holds it or the lights
  change. A set the device refuses is undone whole and asked again only for other lights.
- **Coarser, then finer again.** A short pool grows back once the room holds a larger one, at most
  every `VSM_PRESSURE_CALM_FRAMES` (`shadow-pool-regrown`). A full pool raises a global resolution
  bias (`VsmCacheManager.readPoolFeedback`, `vsm/cacheManager.ts`).
- **Said, never hidden.** `shadowResolutionBias` is the pool's halvings plus that bias; above `0`
  the reference mode refuses its capture (`REFERENCE_SHADOWS_REDUCED`).

## One frame

Encoded in the direct-lighting step, after the visibility and material passes and before the
lighting pass (`webgpu/pages/render/vsm/engineVsm.ts`, `vsmEncode.ts`), in this order:

1. Invalidation: the frame's moved boxes sorted by light on the CPU, then one GPU dispatch
   (`vsm/invalidationPass.ts`).
2. The plan: clipmaps, local lights, map ids, projection data (`vsm/frameSetup.ts`,
   `vsm/clipmap.ts`, `vsm/localLight.ts`, `vsm/cacheManager.ts`).
3. Page address update, carrying last frame's pages to this frame's ids
   (`vsm/pageManagementPass.ts:encodeVsmPageCarry`).
4. Page marking (`vsm/markingPass.ts`, `vsm/markingWgsl.ts`).
5. Page allocation (`vsm/pageManagementPass.ts:encodeVsmPageMapping`, `vsm/physicalPagesWgsl.ts`).
6. The shadow raster on the camera cut's resident rows (`vsm/renderPass.ts`,
   `vsm/renderCullWgsl.ts`, `vsm/renderRasterWgsl.ts`, `vsm/rowPageBound.ts`).
7. Post render (`vsm/pageManagementPass.ts:encodeVsmAfterRaster`), the blended casters' atlas
   (`vsm/transmissionPass.ts`), then the projection into the mask (`vsm/projectionPass.ts`,
   `vsm/projectionWgsl.ts`, `vsm/traceWgsl.ts`).
8. The lighting pass reads the mask; the frame end copies the counters back a few frames late
   (`webgpu/pages/render/vsm/vsmFrameEnd.ts`).

Rules across passes: every page allocated and valid this frame is drawn this frame, no list
overflows (`vsm/rowPageBound.ts`); a still scene draws nothing after its first frames, every page
keeping its static depth, and a static caster that moves redraws only the pages its box covers,
into the dynamic slice (`VSM_STILL_FRAMES`).

## Reading the shadow

Opaque surfaces read the mask. Blended surfaces and water read the page table and the pool
directly (`lighting/direct/shadowWgsl.ts`, by `translucentShadowFilter`); they bind the pool's
first part alone, so a device that splits a slice into parts gives them no shadow past it. A page
not drawn hands its point to the next coarser level mapped; where none holds it, it is lit.

## Metrics

The `shadow*` fields are documented on the contract
(`packages/sdk-core/src/contracts/shadowMetrics.ts`) and filled by
`webgpu/pages/render/vsm/vsmStats.ts`. The page counters need the page-counter readback on
(`countersOn`).

## WebGL2 has none

WebGL2 has no shadow path: its lights reach every surface (`webgl/cluster/lights.ts`).
`CONTRACT_LIGHTS_LIGHTING` publishes `shadows: false`, and the lights of the set that lights (the
contract's, else the source graph's) that ask to cast are handed to `ContractShadows` at each change
of that set. The world, or a session opened without one, names each as `shadows-refused`
(`noticeShadowRefusal`).
