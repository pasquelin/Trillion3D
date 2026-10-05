# Shadows

How the WebGPU engine draws cast shadows: virtual shadow maps, whose pages exist in memory only
where the image reads them. Lights, tiles and the sampled resolve are
[ENGINE.md](ENGINE.md#direct-lighting); the options a page sets (`castShadow`, `transparentShadow`)
are [SDK.md](SDK.md#lights). The code is `packages/sdk-browser/src/vsm/` (the passes and their
shaders) and `packages/sdk-browser/src/webgpu/pages/render/vsm/` (the frame's plan, grant and
encoding).

## Pages and the pool

Every shadow map is virtual: a table of `128 × 128` pages of `128 × 128` texels, `16 384²` texels at
its finest mip, down to a single page over `8` mips (`VSM_LEVEL0_PAGES`, `VSM_PAGE_TEXELS`,
`VSM_MIPS`). A page-table word per page names the physical page that holds it, if any.
Physical pages live in one pool of `2 048` pages (`VSM_POOL_PAGES`) of 32-bit depth texels,
in two slices — a dynamic one and a static one (`VSM_POOL_SLICES`) —, `256 MiB` in all, kept in
storage buffers split into parts of whole page rows when a slice exceeds the device's storage
binding size (`vsm/resources.ts`).

These sizes are tuning values this engine declares, not derived from the device. A table of `128 ×
128` pages is `16 384` virtual pages a mip-0 level, a `16 384²` map that is never allocated whole.
Each pool slice holds `2 048 × 128² × 4` bytes = `128 MiB`, `256 MiB` for the two. The clipmap's 17
levels (`VSM_SUN_FINEST_LEVEL` 6 to `VSM_SUN_COARSEST_LEVEL` 22) double their radius from 1.28 m
to 83.9 km. More pages cost memory in proportion and lower the resolution bias under load; fewer
raise it sooner (`vsm/constants.ts`).

A light that casts takes no page of its own. The pixels the image shades mark the pages they will
read, a pass allocates a physical page to each page marked and not yet held, and only those pages
are drawn (see One frame). A page nobody marks is evicted, the least recently requested first, when
a new one needs room.

The set — the page tables, the pool and the buffers beside them — is made at the first lit frame
that has a casting light, sized for the lights that cast: a sun takes `17` maps (its clipmap
levels), a point light `6` (its faces), a spot light `1`, and the table has room for twice that, plus
sixteen, for the entries the cache keeps ten frames after a light stops asking
(`fullMapsFor`, `vsmGrant.ts`). A light added later that needs more maps grows the tables with the
pool and its cache kept (`growEngineVsm`); when the room does not hold the new tables, the set is
made again and the cache restarts.

## Memory

The set is made within the room the GPU budget leaves it once the frame's other shadow bytes are set
aside: the page tables, the shadow mask (a layer of the projection's output per four casting
lights, at the size of the screen), the raster's lists, the blended casters' atlas and the passes'
own state (`vsmGrant.ts`, `bytesBeside`). The shadows' GPU total is `metric.frame(world)`'s
`shadowPoolBytes`.

When the room does not hold the full pool, the pool is made with half the pages, then a quarter, down
to an eighth of `2 048`: coarser shadows, said once by the `gpu-out-of-memory` diagnostic ("a smaller
shadow page pool"). When not even an eighth fits, the lights read no shadow, by name — the same
diagnostic, "no page pool fits the GPU budget" —, until the room holds the smallest pool or the lights
change. A set the device refuses is undone whole, and asked again only for other lights. A pool made
short grows back once the room holds a larger one, at most every ten frames
(`VSM_PRESSURE_CALM_FRAMES`), in the same frame, its cache restarting: the diagnostic
`shadow-pool-regrown` (`kind: 'info'`) says it.

While the pool is full, the maps lower their own resolution: a page-management pass reads the
fraction of the pool the frame allocated, and above `85 %` (`VSM_PRESSURE_LOAD`)
a global bias raises the mip each pixel reads, by at most `2` levels (`VSM_PRESSURE_BIAS_MAX`),
rising quickly (half the gap a frame) and decaying slowly (a tenth of it, after ten frames
under the limit): `shadowVsmLodBias` publishes it, `shadowVsmFreePages` the free pages the pool had.

`shadowResolutionBias` says how far the shadows draw coarser than they ask because of the pool: the
halvings the budget took off the full pool plus that bias (`vsmStats.ts`), `0` when the full pool
draws every page at the level asked, `null` while no set is held. Above `0`, the reference mode
refuses its capture (`REFERENCE_SHADOWS_REDUCED`). Decaying a tenth of the gap a frame in 32-bit
floats, the bias alone would stop on a subnormal value; under `2^-56`
(`VSM_PRESSURE_BIAS_FLOOR`), a quarter of the smallest bias that can move a level,
it is `0`.

## Sun clipmaps and lamp maps

- **A sun is a clipmap.** Level `L` is an orthographic map of radius `2^(L+1)` centimetres around
  the camera, snapped to whole pages so a camera step keeps every page still inside; `17` levels,
  `6` to `22` (`VSM_SUN_FINEST_LEVEL`, `VSM_SUN_COARSEST_LEVEL`): from `1.28 m` to `84 km`. The levels
  `15` to `18` are the coarse ones (`VSM_SUN_COARSE_FROM`, `VSM_SUN_COARSE_TO`),
  marked as coarse pages. A level's depth range is `1 000` times its radius, and a cached level stays
  valid while the camera's depth shift plus its radius is within `0.9` of the range it was drawn in
  (`VSM_SUN_DEPTH_SPAN`, `VSM_SUN_DEPTH_KEEP`). The sun's resolution bias is `-1.5`, at
  rest and moving; each unit below zero halves the texel.
- **A point light is six maps** (one per face of a cube), **a spot light one**, each a full virtual
  map with its mips; the near plane is `1 cm`, the far plane the light's range
  (`VSM_LOCAL_NEAR_PLANE`). A local light's resolution bias is `0` at rest and `1` while it moves,
  blended by the light's mobility factor, which falls from `1` to `0` over ten frames after the light
  changes (`VSM_LOCAL_LEVEL_BIAS`, `updateLightMobility`).
- **The mip is chosen per pixel** from its footprint, then raised by the light's and the global
  resolution biases (`vsmLocalMipLevel`, the clipmap's level for a sun). A page not mapped hands the
  point to the next coarser level that is.

## One frame

The frame's shadow work is encoded in the direct-lighting step, after the visibility and material
passes and before the lighting pass (`webgpu/pages/render/vsm/engineVsm.ts`, `vsmEncode.ts`):

1. **Invalidation.** The world boxes of the scene's moves since the last frame — each mover's box
   before and after its move — are sorted by light on the CPU
   (`vsmInvalidationPhaseFromShadowBoxes`): kept for each light whose maps may hold cached pages
   (not fully cached, uncached or invalidated), a moving box skipping the maps with a receiver
   mask, a local light keeping the boxes within its range. One GPU dispatch then flags the
   previous frame's pages each box touches, as dynamic for a moving box, else as static
   (`vsm/invalidationPass.ts`).
2. **The plan on the CPU.** The sun clipmaps, the local lights, the map ids and the projection data
   (`planVirtualShadowFrame`, `vsm/frameSetup.ts`). A light that moved or changed its cache key is
   set up uncached: its pages are drawn again.
3. **Physical page address update**, which carries the pages of the last frame's maps to this
   frame's ids and folds the invalidation into the page metadata.
4. **Page marking** (`vsm/markingPass.ts`), one compute pass with the address update as its first
   dispatch (its time, `shadowVsmMarkingMs`, holds the update's). The page tables and flags are cleared in one walk of each map's pages, the coarse pages
   marked, then every pixel on a stride of `2` in x and y reads the engine's light grid and marks, in
   each shadowed light's map, the page its point falls in (with a `5 %` dilation around the page's
   edge, so the filter's taps read pages that exist); back-facing pixels are skipped.
5. **Page allocation.** Pages marked and not held get a physical page from the free list, else the
   least recently requested one; a page requested this frame is never evicted
   (`encodeVsmPageMapping`).
6. **The shadow raster** (`vsm/renderPass.ts`, `renderCullWgsl.ts`, `renderRasterWgsl.ts`). Every page
   allocated and valid for rendering this frame is drawn this frame. The casters are the engine's
   resident cluster rows, chosen by the camera's cut on the GPU; a cull makes one command per
   `(map, mip)` the row's box meets and one `(row, page)` pair per page of that command's rectangle,
   and one indirect draw per chunk draws the pairs into the pool. Chunks hold as many rows as the
   lists' size allows in the worst case (`vsm/rowPageBound.ts`), so no list overflows and no page
   waits for a later frame.
7. **Post render**, then **the projection** (`vsm/projectionPass.ts`): for each shadowed light the
   mask the lighting reads is traced from the pool (see Reading the shadow); the mask is an array
   texture of one layer per four casting lights. Each 8 × 8 tile tests only the lights whose sphere
   meets the box of its points, traces only those a pixel of it is in, and stores only their layers,
   which its tile word names to the lighting: an empty tile traces and stores nothing.
8. **The lighting pass** reads the mask. At the frame's end, a copy of the page counters and of the
   pool's free-page count comes back a few frames late, and the frame's data becomes the previous
   frame's (`vsmFrameEnd.ts`).

## Static and dynamic pages

The pool has two slices, and a page holds a depth in each. A primitive is **dynamic** when it moved
in the last `100` frames (`VSM_STILL_FRAMES`) and **static** otherwise; unknown ones are
dynamic. A still scene draws nothing after its first frames: every page keeps its static depth. When
a dynamic primitive has not been invalidated for a hundred frames, it becomes static and its pages
are invalidated once, so it is drawn into the static slice; when a static one moves, only the pages
its box covers are flagged and drawn again, into the dynamic slice, over the static depth.

The caches of lights not requested for ten frames are dropped (`VSM_LIGHT_KEEP_FRAMES`).
A distant light whose pages are all mapped and drawn is refreshed one at a time, the oldest first.

## Blended casters

A surface that casts and lets light through (`transparentShadow`) is drawn into a **transmission
atlas** made with the first such caster (`vsm/transmissionPass.ts`): after the opaque raster and
before the projection, the pages whose slice is redrawn give their slots back and the blended
rows are drawn multiplicatively into slots of the atlas, one per page and slice — the same
static-or-dynamic rule, so a still scene redraws none —, then a resolve pass writes the stamped slots
into the atlas the shadow reads. The slot pool starts small and doubles when a frame finds it short,
read back a few frames late. A receiver behind a pane reads that pane's colour through it: a blended
surface steps its own receiver toward the light past its layer, so a pane never shadows itself.

## Reading the shadow

- **Opaque surfaces** read the mask: the projection traces, for each pixel and light, at most `7` rays (the count adapts) of `8`
  samples through the shadow map (`VSM_TRACE_RAYS_*`, `VSM_TRACE_STEPS_*`), starting a
  small share of the screen along the ray (`VSM_SCREEN_RAY_SHARE`, `0.015`), the normal offset a
  ratio of the camera distance (`VSM_NORMAL_BIAS`), with a spatio-temporal blue noise
  (`vsm/blueNoise.ts`: three `64 × 64` void-and-cluster maps, `64` temporal slices).
- **Blended surfaces and water** read the page table and the pool directly
  (`lighting/direct/shadowWgsl.ts`), by the setting `translucentShadowFilter`
  (`LIGHT_SETTINGS`): `0` one lookup, `1` (the default) sixteen taps a texel apart, each a bilinear
  compare read in its own page, `2` the opaque projection's rays traced in the fragment. They need
  the pool in one binding: a device that splits a slice into parts reads no shadow there.
- **A page not drawn** hands its point to the next coarser level that is mapped; where no page holds
  the point, it is lit.

## Metrics

| Metric                                                                       | Meaning                                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shadowVsmLights`, `shadowVsmMaps`, `shadowVsmProjectionPasses`              | the frame's shadowed lights, the maps they take, the projection passes it ran      |
| `shadowVsmPagesRequested`, `shadowVsmPagesAllocated`, `shadowVsmPagesCached` | the pages the pixels marked, the new ones the pool gave, the ones kept from before |
| `shadowVsmPagesRendered`                                                     | pages cleared then drawn: read back a few frames late                              |
| `shadowVsmFreePages`, `shadowVsmLodBias`                                     | the pool's free pages and the global bias its load sets                            |
| `shadowVsmInvalidationMs`, `shadowVsmMarkingMs`, `shadowVsmPageManagementMs` | GPU time of the passes of that name (`vsm.` labels, timed with the Shadows stage)  |
| `shadowVsmRenderMs`, `shadowVsmProjectionMs`, `shadowVsmTransmissionMs`      | GPU time of the raster, the projection and the transmission atlas                  |
| `shadowPoolBytes`                                                            | GPU bytes the shadows hold: the set, the mask, the raster's lists, the atlas       |
| `shadowResolutionBias`                                                       | the pool's halvings plus its load's bias: above `0`, no reference capture          |

The page counters need the page-counter readback on (`countersOn`); the other `shadow*` fields of the
public contract are kept for hosts that read them and are `null` here.

## WebGL2 has none

WebGL2 has no shadow path: its lights reach every surface (`webgl/cluster/lights.ts`).
`CONTRACT_LIGHTS_LIGHTING` publishes `shadows: false`, and the lights of the set that lights (the
contract's, else the source graph's) that ask to cast are handed to `ContractShadows` at each change
of that set. The world, or a session opened without one, names each as `shadows-refused`
(`noticeShadowRefusal`).
