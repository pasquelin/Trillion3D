# Surface cache

The compiler gives each mesh a few **cards** (`meshCards.bin`, [FORMAT.md](../FORMAT.md)): flat boxes along its faces, each
looking at the mesh along one of the six axis directions. The surface cache keeps the surface each card sees — its albedo,
its normal, its emission, its depth — in one **atlas** of 4096 × 4096 texels (`surfaceCacheAtlasSize`), cut into pages of
128 × 128, so that a ray that hits a mesh reads the colour of the surface where it hit, not one colour for the whole mesh. A
card is kept at a resolution that follows its size on the screen (a power of two from 8 to 512 texels along its longer side;
the levels under 128 are a part of a page). The coarsest level of a wanted card is always in the atlas and locked; a finer
page is captured when the rays asked for it and leaves the atlas when none read it for 256 images. The CPU's side is
`packages/sdk-core/src/lighting/surfaceCache/` (the cards of each placement, the law of the resolution, the allocator, the
requests, the eviction); the GPU's is `packages/sdk-browser/src/lighting/surfaceCache/`.

**Nothing is made for a scene nobody reads the cache of.** The state exists for a session whose cache carries cards, and its
GPU side only while something asks for it each image: a diagnostic view of the atlas, or a pass that reads it
(`demandSurfaceCache`). The memory is `surfaceCacheAtlasSize`: 454 MiB at the default 4096 (seven layers of one 32-bit word a
texel: depth, albedo, normal, emission, and the direct, indirect and final light; one kernel text serves every device, and a
compressed texture is no storage texture), 117 MiB at 2048, 33 MiB at 1024, each with the capture atlas (5 MiB) and 9 MiB for the
capture's surfaces. With `surfaceCacheCompress` 1 (the default) or 2 and a device that has `texture-compression-bc` the albedo, the normal and the
emission are kept in blocks (BC7, BC5, BC6H, a byte a texel): 311 MiB at 4096, 82 MiB at 2048, 25 MiB at 1024; the colour layers
fall from 192 to 48 MiB at 4096. They are asked of the device's budget as one (`ledgerAdmitted`): where it leaves no room the cache
is off and `metrics.surfaceCache.why` says so.

Each image of the main view, after the distance fields (`encodeSurfaceCache`): the placements follow the cut's roots
(`placements.ts`: a root whose mesh keeps cards, an HLOD cell's actors by the stand-ins of its field); the atlases are made
at the size the settings ask; the cache updates for the camera (`updateSurfaceCache`: which placements have mesh cards, which
pages of which cards are captured, the nearest first, at most `surfaceCacheCardCapturesPerFrame`), and what it changed goes
to the **tables** (`tables.ts`), one storage buffer of words the reads walk: a header, the mesh cards, the cards, the page
table, the pages' records and the table from a placement to its mesh cards. Then the pages it captures: drawn by a raster of
the cards' views, shaded, resolved, copied, in one compute pass (`SURFACE_CACHE_PASS`, the `surfaceCache` stage of the
profile).

- **The raster is a seam** (`capture/raster.ts`, `setCardRaster`). A card's page is seen through an orthographic view along
  the card's depth axis from outside the mesh (`cardPageView`, `atlasViewProjection`); a raster draws the pages into the
  capture atlas's identifiers and depth, and returns the images it drew. Until one is plugged in no page is made.
- **Shading** (`capture/shade.ts`) runs the engine's material classes over the capture atlas as they run over the image: the
  same class pipelines, their own bins, resolve uniform and surfaces. The surfaces' shading places a texel on
  its triangle by one view and writes its uniform and bins once an image, so an image holds the pages of one view and the
  frame shades the first image the raster returns; the pages of the others are asked again.
- **Resolve** gives the card's encodings: the albedo as the square root of the diffuse colour (the base colour less its metal
  plus what the specular lobe of the surface made fully rough sends back along its normal — the tabulated directional albedo of a GGX lobe of roughness 1 at normal incidence, weighted for its multiple scattering, the reflectance at grazing angles occluded under 2% —, plus the colour a thin double-sided sheet transmits), the normal's first two components in the card's frame, the emission
  multiplied by the cached lighting pre-exposure. Two kernels run first, before the image's tables go up — the tables are
  copied in on the image's encoder (`tables.ts`), so these read the cards as they were: **resample** fills a page that takes
  the texels of another card (cards of one mesh with the same materials, facing the same way) or of its own finer level,
  reading the atlas bilinearly over the texels that hold a surface; **resample lighting** (`surfaceCacheResampleLighting`)
  carries into the capture atlas the light each page's card held — a card that had pages before the image —, read
  bilinearly from the card's finest page: the direct light, and with the radiosity the indirect light and the tile's
  accumulation, the mean over its texels. **Copy** writes the pages into the atlas, a dispatch for each layer in the order depth, albedo, normal, emission — the depth as `1 - z` in sixteen bits,
  65535 for no surface — and, with `surfaceCacheDilationMode` 2, gives a texel with no surface the mean of the texels around
  it; **lights** writes the light they start with: the carried direct and indirect light and accumulation, and as final
  light the captured albedo over π times their sum plus the captured emission — no light at all without
  `surfaceCacheResampleLighting`.
- **The compressed atlas** (`compress.ts`, `compressWgsl.ts`; `surfaceCacheCompress` 1 and 2). WebGPU has no view of a block-compressed
  texture in another format to write through, so the blocks are made in a storage buffer and copied in. After the copy (which
  then writes the depth alone) a kernel for each layer — BC7 for the albedo, BC5 for the normal's two components, BC6H for the
  emission — encodes the blocks of 4 × 4 texels of every page of the image, a thread to a block, with the dilation applied as
  the copy applies it, into one section of a staging buffer laid like the capture atlas; the compute pass ends; and one
  `copyBufferToTexture` of each page's rectangle for each layer puts them in the atlas (the rules of
  [texel copies](https://www.w3.org/TR/webgpu/#texel-copies): whole blocks, rows of 256 bytes). The read library
  hardware-decodes the layers, the emission as a float texture (the atlases' own `compressed` is what a program passes to
  `surfaceCacheSampleWgsl`). An emptied atlas is cleared by encoding the block of a black texel and copying it over each
  square of the atlas. Mode 1 of the setting (compression by writing through a view of another format) has no counterpart in
  WebGPU and compresses nothing, as on a platform without it; the setting's default is 1. `metrics.surfaceCache.compressed`
  says whether the atlas is compressed and `compressionWhy` why not.
- **The read library** (`sampleWgsl.ts`, `surfaceCacheSampleWgsl(group, first, { feedback, compressed })`) is what a pass that
  traces rays imports: `scSampleMeshCards` for a hit's position and normal and the mesh cards of the placement it hit,
  `scEvaluate` for the light there, and, with `feedback`, the report of the finer page the ray's cone would have read. The
  reflections' scene stage reads it through `scGlobalHit` (`hitWgsl.ts`).
- **The feedback** (`feedbackBuffer.ts`, `feedbackWgsl.ts`; `surfaceCacheFeedback`, `…FeedbackTileSize` 16, `…FeedbackMinPageHits`
  16, `…FeedbackUniqueElements` 1024). The rays of an image write, in one pixel of each tile of the image — its place in the tile
  moving from image to image, `feedbackTileJitter` — the card, the level the cone calls for (half a level coarser than its
  footprint asks) and the page they would have read, into one buffer cleared each image, and the last read of the page they did
  read. After the trace two kernels list each distinct element once with the number of times it was written (a table of keys, linear
  probing, then a list of at most `…FeedbackUniqueElements`), the list is copied to a staging buffer of a ring, and the image
  after the one that wrote it (`ring.submitted` at the next `begin`) it maps; the cache's update takes the newest list that came
  back (`UpdateView.feedback`): a page in the atlas that was read is kept, one that was hit more than `…MinPageHits` times and is
  not in the atlas is requested, behind the coarse mips. The list holds the first distinct pages the table finds, not the most hit.
- **The lighting** (`lighting/surfaceCache/lighting/`; `lightSurfaceCache`, called from `encodeDirectLights` once the lights
  are in their buffer and before the bounce) brings the light of the cards' texels up to date, a share of the atlas an image, in
  one compute pass (`SURFACE_CACHE_LIGHTING_PASS`, its own label in the `surfaceCache` stage), in this order. _The update context_ (`contextWgsl.ts`): a thread a page puts the
  page's tiles of 8 × 8 texels in a histogram of 16 priority buckets — 15 less the log2 of four times the images since the page
  was lit times its speed, one over one plus its distance from the eye over the first clipmap's half side, doubled within
  `…MaxDistanceFromFrustumToPrioritize` (500 cm) of the frustum, a page never lit having waited 2048 images —, one thread takes
  the bucket whose tiles reach the budget (`surfaceCacheDirectLightingUpdateFactor` 32 and `…RadiosityUpdateFactor` 64: the atlas's
  texels over the factor, 530 000 texels of direct light an image at 4096), and a thread a page lists its tiles up to it; the
  pages' state (the image each was last lit, the count of its updates) lives in their records (`pageRecords.ts`, words 16 to
  19). _The direct light_: a workgroup a tile finds the tile's depth range and the `…MaxLightsPerTile` (8) lights of most
  luminance times what reaches its centre (`cullWgsl.ts`), each kept light a light tile appended to a list that is counted by the slot of the light
  (the point lights', the spots' and the rectangles' by their type, a sun's and a light apart from the atlas's by their rank:
  `…DirectLightingBatchShadows` 2), placed by a prefix sum of the slots and compacted so that a slot's tiles lie in one run
  (`lightTilesWgsl.ts`); the light functions apart from the atlas and the shadow masks run over the runs by the slots'
  indirect arguments, and a thread a texel adds the irradiance each light of its tile gives (`directWgsl.ts`):
  the engine's one light term for a point that is not a pixel — falloff, range, a spot's fade, a rectangle's form factor,
  the cosine, the light function, the clouds' shade, the air's tint — and, for a light that casts a shadow, one ray marched
  through the global distance field (`gdfTrace`) from the texel to the light, started `…GlobalSdfShadowRayBias` (1) voxels off the
  surface and three where it grazes the light, a lamp's ray ending a voxel short of it. _The radiosity_: a probe every
  `…RadiosityProbeSpacing` (4) texels of a card, jittered over the images, traces `…HemisphereProbeResolution`² (16) rays from
  `…DistanceFieldSurfaceBias` (10) cm, through the global field; a hit reads the cards at the point (the field's gradient is the face,
  the field's object grid gives the objects, the objects' mesh cards the texels: `scGlobalHit`, `hitWgsl.ts`, the one hit read of
  every ray that brings light back) and gets their final light, a
  miss the sky light; no ray brighter than `…MaxRayIntensity` (40) times the exposure. Each ray is averaged with its
  neighbours' in the probes' atlas (four of them, off-plane probes left out), projected on the first two bands of the
  spherical harmonics, and a texel integrates the four nearest probes' harmonics against the cosine lobe at its normal, blended over
  the last four images. _The final light_ of a texel — its albedo (decoded, `surfaceCacheDiffuseColorBoost`) over π times the direct
  and the indirect light, plus its emission — is written after the direct light for the direct list and again after the radiosity
  for its own, all multiplied by the cached lighting pre-exposure. The probes keep their rays in a trace atlas (one word of light a
  ray) and their harmonics in a three-layer atlas of half floats, 64 + 24 MiB at 4096; the rays the filter averages stay in a buffer of the update's
  size. The lighting settles over images (the larger factor times the blend: 256 at the defaults): the frame is not held while it does.
- **Who reads the cache.** The reflections' scene stage, the screen probes' scene stage, the radiance cache's trace, the world
  probes' update and the cache's own radiosity: each marches its rays through the global field and reads the final light at the hit
  with the same function (`scGlobalHit`, `hitWgsl.ts`; the reflections' rays ask it for the finest page and the page-use
  feedback, the others' do not). What a pass binds of it is the depth, the final light, the tables, the field's object grid and
  the table of instances — never the albedo, the normal, the emission or the direct and indirect light (the library reads
  none of the last two) —, made once a session (`surfaceHitReads`). Each of those passes asks for the cache each image
  (`demandSurfaceCache`), so that the field is sized for traces and carries its object grid. The level of the global illumination
  (`screenProbes`) sets the defaults of the atlas's side, the cards' density and resolutions, the lights a tile, the update factors
  and the radiosity's probes (`SURFACE_CACHE_LEVEL_ROWS`): the reference's rows, `high` a 3584-texel atlas with cards of at least 4
  texels, 4 lights a tile, update factors 64 and 128, probes every 8 texels and 9 rays; the `balanced` preset a 2048-texel atlas at half the cards' density,
  at most 256 texels, update factors 128 and 128, 9 rays (the reference's medium global illumination, which gathers by the irradiance field); `ultra` and `cinematic` the settings' own defaults; a setting named over
  a row keeps its value.
- **Not carried over**: the far field, the heightfields, the compression by the framebuffer, the merging of the cards of many instances; of the lighting, the adaptive
  shadow tracing (the reference runs it with hardware ray tracing alone), the probes' occlusion (likewise), and the lighting
  channels. The cards' lights wear the light functions of `lightFunctionBounce`.

The diagnostic modes `surface-cache-albedo`, `-normal`, `-depth`, `-cards`, `-fill` and `-age` draw the whole atlas onto the
canvas (`debug.ts`): a layer of it, or what the CPU knows of each tile — its card, whether its page is of the coarsest level,
how long ago it was captured. `metrics.surfaceCache` carries the atlas's fill, the placements, cards and pages, the pages the
image captured, copied and left waiting, and why the cache is off.

```ts
world.surfaceCache = { surfaceCacheAtlasSize: 2048 } // a smaller atlas, in less memory
world.diagnostic.mode = 'surface-cache-fill' // the atlas: coarsest levels in green, finer pages in blue
world.onFrame(({ metrics }) => {
  console.log(metrics.surfaceCache) // { pagesUsed, pagesTotal, captured, copied, waiting, why, ... }
})
// a raster of the cards' views (capture/raster.ts), when one exists:
setCardRaster(rt, {
  ready: (placement) => true,
  draw: (rt, encoder, targets, pages, views) => images,
})
```
