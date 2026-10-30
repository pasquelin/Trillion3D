# Surface cache

The compiler gives each mesh a few **cards** (`meshCards.bin`, [FORMAT.md](../FORMAT.md)): flat boxes
along its faces, each looking at the mesh along one of the six axis directions. The cache keeps what each
card sees (albedo, normal, emission, depth) in one **atlas** of 4096 × 4096 texels
(`surfaceCacheAtlasSize`), cut into pages of 128 × 128, so a ray that hits a mesh reads the colour of the
surface where it hit. A card's resolution follows its screen size (a power of two from 8 to 512 texels on
its longer side; levels under 128 are part of a page). The coarsest level of a wanted card is always in
the atlas, locked; a finer page is captured when rays ask for it and leaves when none read it for 256
images. CPU side: `packages/sdk-core/src/lighting/surfaceCache/` (cards per placement, resolution law,
allocator, requests, eviction); GPU side: `packages/sdk-browser/src/lighting/surfaceCache/`.

**Nothing is made for a scene nobody reads the cache of.** The state exists for a session whose cache
carries cards; its GPU side only while something asks each image: a diagnostic view of the atlas, or a
pass that reads it (`demandSurfaceCache`). Memory follows `surfaceCacheAtlasSize`:
- 454 MiB at the default 4096 (seven layers of one 32-bit word a texel: depth, albedo, normal, emission,
  direct, indirect and final light; one kernel text serves every device, and a compressed texture is no
  storage texture), 117 MiB at 2048, 33 MiB at 1024; each plus the capture atlas (5 MiB) and 9 MiB for
  the capture's surfaces.
- With `surfaceCacheCompress` 1 (the default) or 2 and a device with `texture-compression-bc`, albedo,
  normal and emission are kept in blocks (BC7, BC5, BC6H, a byte a texel): 311 MiB at 4096, 82 MiB at
  2048, 25 MiB at 1024; the colour layers fall from 192 to 48 MiB at 4096.

The memory is asked of the device's budget as one request (`ledgerAdmitted`); where there is no room the
cache is off and `metrics.surfaceCache.why` says so.

Each image of the main view, after the distance fields (`encodeSurfaceCache`):
1. placements follow the cut's roots (`placements.ts`: a root whose mesh keeps cards, an HLOD cell's
   actors by their field's stand-ins);
2. the atlases are made at the size the settings ask;
3. the cache updates for the camera (`updateSurfaceCache`: which placements have mesh cards, which pages
   are captured, nearest first, at most `surfaceCacheCardCapturesPerFrame`); what changed goes to the
   **tables** (`tables.ts`), one storage buffer of words: a header, the mesh cards, the cards, the page
   table, the pages' records, and the table from a placement to its mesh cards;
4. the captured pages are drawn by a raster of the cards' views, shaded, resolved, copied, in one compute
   pass (`SURFACE_CACHE_PASS`, the `surfaceCache` stage of the profile).

- **The raster is a seam** (`capture/raster.ts`, `setCardRaster`). A page is seen through an orthographic
  view along the card's depth axis from outside the mesh (`cardPageView`, `atlasViewProjection`); the
  raster draws the pages into the capture atlas's identifiers and depth and returns the images it drew.
  Until one is plugged in no page is made.
- **Shading** (`capture/shade.ts`) runs the engine's material classes over the capture atlas as over the
  image: same class pipelines, own bins, resolve uniform and surfaces. A texel is placed on its triangle
  by one view and the uniform and bins are written once an image, so an image holds the pages of one view
  and the frame shades the first image the raster returns; the others' pages are asked again.
- **Resolve** gives the card's encodings: albedo as the square root of the diffuse colour (base colour
  less its metal, plus what the specular lobe made fully rough sends back along its normal — the
  tabulated directional albedo of a GGX lobe of roughness 1 at normal incidence, weighted for multiple
  scattering, reflectance at grazing angles occluded under 2% —, plus the colour a thin double-sided
  sheet transmits); the normal's first two components in the card's frame; emission times the cached
  lighting pre-exposure. Before the image's tables go up (they are copied in on the image's encoder,
  `tables.ts`, so these read the cards as they were), two kernels run:
  - **resample** fills a page that takes the texels of another card (same mesh, same materials, facing
    the same way) or of its own finer level, reading the atlas bilinearly over texels holding a surface;
  - **resample lighting** (`surfaceCacheResampleLighting`) carries into the capture atlas the light the
    page's card held (a card that had pages before the image), read bilinearly from its finest page: the
    direct light and, with the radiosity, the indirect light and the tile's accumulation (the mean over
    its texels).

  **Copy** writes the pages into the atlas, one dispatch per layer in the order depth, albedo, normal,
  emission (depth as `1 - z` in sixteen bits, 65535 for no surface); with `surfaceCacheDilationMode` 2 a
  texel with no surface gets the mean of its neighbours. **Lights** writes the starting light: the
  carried direct and indirect light and accumulation, and as final light the captured albedo over π times
  their sum plus the captured emission; no light at all without `surfaceCacheResampleLighting`.
- **The compressed atlas** (`compress.ts`, `compressWgsl.ts`; `surfaceCacheCompress` 1 and 2). WebGPU
  cannot write a block-compressed texture through a view of another format, so blocks are made in a
  storage buffer and copied in. After the copy (which then writes the depth alone), one kernel per layer
  (BC7 albedo, BC5 the normal's two components, BC6H emission) encodes the blocks of 4 × 4 texels of every
  page of the image, a thread to a block, dilation applied as in the copy, into one section of a staging
  buffer laid like the capture atlas; the compute pass ends; one `copyBufferToTexture` per page rectangle
  and layer puts them in the atlas (rules of [texel copies](https://www.w3.org/TR/webgpu/#texel-copies):
  whole blocks, rows of 256 bytes). The read library hardware-decodes the layers, the emission as a float
  texture (the atlases' own `compressed` is what a program passes to `surfaceCacheSampleWgsl`). An
  emptied atlas is cleared by encoding a black texel's block and copying it over each square. Mode 1
  (compression by writing through a view of another format) has no WebGPU counterpart and compresses
  nothing, as on a platform without it; the default is 1. `metrics.surfaceCache.compressed` says whether
  the atlas is compressed, `compressionWhy` why not.
- **The read library** (`sampleWgsl.ts`, `surfaceCacheSampleWgsl(group, first, { feedback, compressed })`)
  is what a ray-tracing pass imports: `scSampleMeshCards` for a hit's position and normal and the hit
  placement's mesh cards, `scEvaluate` for the light there, and, with `feedback`, the report of the finer
  page the ray's cone would have read. The reflections' scene stage reads it through `scGlobalHit`
  (`hitWgsl.ts`).
- **The feedback** (`feedbackBuffer.ts`, `feedbackWgsl.ts`; `surfaceCacheFeedback`, `…FeedbackTileSize`
  16, `…FeedbackMinPageHits` 16, `…FeedbackUniqueElements` 1024). An image's rays write, in one pixel per
  tile (its place moving from image to image, `feedbackTileJitter`), the card, the level the cone calls
  for (half a level coarser than its footprint asks) and the page they would have read, into one buffer
  cleared each image, plus the last read of the page they did read. After the trace two kernels list each
  distinct element once with its write count (a table of keys, linear probing, then a list of at most
  `…FeedbackUniqueElements`); the list is copied to a staging buffer of a ring and mapped the image after
  the one that wrote it (`ring.submitted` at the next `begin`). The cache's update takes the newest list
  that came back (`UpdateView.feedback`): a page in the atlas that was read is kept; one hit more than
  `…MinPageHits` times and not in the atlas is requested, behind the coarse mips. The list holds the first
  distinct pages the table finds, not the most hit.
- **The lighting** (`lighting/surfaceCache/lighting/`; `lightSurfaceCache`, called from
  `encodeDirectLights` once the lights are in their buffer and before the bounce) updates the light of
  the cards' texels, a share of the atlas an image, in one compute pass (`SURFACE_CACHE_LIGHTING_PASS`,
  its own label in the `surfaceCache` stage), in this order:
  - _Update context_ (`contextWgsl.ts`). A thread per page puts its tiles of 8 × 8 texels in a histogram
    of 16 priority buckets: 15 less the log2 of four times the images since the page was lit times its
    speed, one over one plus its distance from the eye over the first clipmap's half side, doubled within
    `…MaxDistanceFromFrustumToPrioritize` (500 cm) of the frustum; a page never lit counts as having
    waited 2048 images. One thread takes the bucket whose tiles reach the budget
    (`surfaceCacheDirectLightingUpdateFactor` 32 and `…RadiosityUpdateFactor` 64: atlas texels over the
    factor, 530 000 texels of direct light an image at 4096); a thread per page lists its tiles up to it.
    Page state (the image each was last lit, its update count) lives in the records (`pageRecords.ts`,
    words 16 to 19).
  - _Direct light_. A workgroup per tile finds the tile's depth range and the `…MaxLightsPerTile` (8)
    lights of most luminance times what reaches its centre (`cullWgsl.ts`). Each kept light is a light
    tile appended to a list counted by the light's slot (point, spot and rectangle lights by type; a
    sun and a light apart from the atlas by rank: `…DirectLightingBatchShadows` 2), placed by a prefix
    sum of the slots and compacted so a slot's tiles lie in one run (`lightTilesWgsl.ts`). The light
    functions apart from the atlas and the shadow masks run over the runs by the slots' indirect
    arguments; a thread per texel adds the irradiance of each light of its tile (`directWgsl.ts`): the
    engine's one light term for a non-pixel point (falloff, range, a spot's fade, a rectangle's form
    factor, the cosine, the light function, the clouds' shade, the air's tint) and, for a shadow-casting
    light, one ray marched through the global distance field (`gdfTrace`) from the texel to the light,
    started `…GlobalSdfShadowRayBias` (1) voxels off the surface and three where it grazes the light, a
    lamp's ray ending a voxel short.
  - _Radiosity_. A probe every `…RadiosityProbeSpacing` (4) texels of a card, jittered over the images,
    traces `…HemisphereProbeResolution`² (16) rays from `…DistanceFieldSurfaceBias` (10) cm through the
    global field. A hit reads the cards at the point (the field's gradient is the face, its object grid
    gives the objects, their mesh cards the texels: `scGlobalHit`, `hitWgsl.ts`, the one hit read of every
    ray that brings light back) and gets their final light; a miss gets the sky light; no ray exceeds
    `…MaxRayIntensity` (40) times the exposure. Each ray is averaged with its neighbours' in the probes'
    atlas (four, off-plane probes left out) and projected on the first two spherical-harmonic bands; a
    texel integrates the four nearest probes' harmonics against the cosine lobe at its normal, blended
    over the last four images.
  - _Final light_ of a texel: its albedo (decoded, `surfaceCacheDiffuseColorBoost`) over π times direct
    plus indirect light, plus its emission; written after the direct light for the direct list and again
    after the radiosity for its own, all times the cached lighting pre-exposure.

  The probes keep their rays in a trace atlas (one word of light a ray) and their harmonics in a
  three-layer half-float atlas, 64 + 24 MiB at 4096; the rays the filter averages stay in a buffer of the
  update's size. The lighting settles over images (the larger factor times the blend: 256 at the
  defaults); the frame is not held meanwhile.
- **Who reads the cache.** The reflections' scene stage, the screen probes' scene stage, the radiance
  cache's trace, the world probes' update and the cache's own radiosity each march rays through the
  global field and read the final light at the hit with `scGlobalHit` (`hitWgsl.ts`; the reflections' rays
  also ask for the finest page and the page-use feedback, the others do not). A pass binds only the depth,
  the final light, the tables, the field's object grid and the table of instances (never albedo, normal,
  emission, or the direct and indirect light; the library reads none of the last two), made once a session
  (`surfaceHitReads`). Each such pass asks for the cache each image (`demandSurfaceCache`), so the field
  is sized for traces and carries its object grid. The global illumination level (`screenProbes`) sets the
  defaults of the atlas side, the cards' density and resolutions, the lights a tile, the update factors
  and the radiosity probes (`SURFACE_CACHE_LEVEL_ROWS`), a setting named over a row keeping its value:
  - `high`: the reference's rows, a 3584-texel atlas with cards of at least 4 texels, 4 lights a tile,
    update factors 64 and 128, probes every 8 texels and 9 rays;
  - `balanced`: a 2048-texel atlas at half the cards' density, at most 256 texels, update factors 128 and
    128, 9 rays (the reference's medium global illumination, which gathers by the irradiance field);
  - `ultra` and `cinematic`: the settings' own defaults.
- **Not carried over**: the far field, the heightfields, the compression by the framebuffer, the merging
  of the cards of many instances; of the lighting, the adaptive shadow tracing and the probes' occlusion
  (the reference runs both with hardware ray tracing alone), and the lighting channels. The cards' lights
  wear the light functions of `lightFunctionBounce`.

The diagnostic modes `surface-cache-albedo`, `-normal`, `-depth`, `-cards`, `-fill` and `-age` draw the
whole atlas onto the canvas (`debug.ts`): a layer of it, or what the CPU knows of each tile (its card,
whether its page is of the coarsest level, how long ago it was captured). `metrics.surfaceCache` carries
the atlas's fill, the placements, cards and pages, the pages captured, copied and left waiting in the
image, and why the cache is off.

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
