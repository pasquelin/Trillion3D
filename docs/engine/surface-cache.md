# Surface cache

The compiler gives each mesh a few **cards** (`meshCards.bin`, [FORMAT.md](../FORMAT.md)): flat boxes
along its faces, each looking at the mesh along one of the six axis directions. The cache keeps what
each card sees (albedo, normal, emission, depth) in one **atlas** of 4096 × 4096 texels
(`surfaceCacheAtlasSize`), in pages of 128 × 128; a ray hitting a mesh reads the surface colour there.
A card's resolution follows its screen size (power of two, 8 to 512 texels on its longer side). A
wanted card's coarsest level is locked in the atlas; a finer page is captured when rays ask for it and
leaves when none read it for 256 images. Code: `packages/sdk-core/src/lighting/surfaceCache/`
(CPU), `packages/sdk-browser/src/lighting/surfaceCache/` (GPU).

The GPU side exists only while a diagnostic view or reading pass asks (`demandSurfaceCache`). Memory:
- 454 MiB at the default 4096 (seven 32-bit layers), 117 MiB at 2048, 33 MiB at 1024; each plus the
  capture atlas (5 MiB) and 9 MiB for the capture's surfaces.
- `surfaceCacheCompress` 1 (default; compresses nothing on WebGPU) or 2 with `texture-compression-bc`
  keeps albedo, normal, emission in blocks (BC7, BC5, BC6H): 311 MiB at 4096, 82 at 2048, 25 at 1024.

Memory is one request to the device's budget (`ledgerAdmitted`); with no room the cache is off and
`metrics.surfaceCache.why` says so.

Each image of the main view, after the distance fields (`encodeSurfaceCache`):
1. placements follow the cut's roots (`placements.ts`: a root whose mesh keeps cards, an HLOD cell's
   actors by their field's stand-ins);
2. the atlases are made at the settings' size;
3. the cache updates for the camera (`updateSurfaceCache`: pages captured nearest first, at most
   `surfaceCacheCardCapturesPerFrame`); changes go to the **tables** (`tables.ts`), one storage buffer:
   header, mesh cards, cards, page table, page records, placement-to-mesh-cards table;
4. captured pages are drawn, shaded, resolved, copied in one compute pass (`SURFACE_CACHE_PASS`,
   `surfaceCache` stage of the profile).

- **Raster seam** (`capture/raster.ts`, `setCardRaster`). A page is an orthographic view along the
  card's depth axis (`cardPageView`, `atlasViewProjection`); the raster draws into the capture atlas,
  returning the images drawn. With none plugged in no page is made.
- **Shading** (`capture/shade.ts`): only the raster's first image is shaded; the others' pages are
  asked again.
- **Resolve** encodes albedo as the square root of the diffuse colour (base colour less its metal,
  plus the rough GGX lobe's directional albedo, plus a thin double-sided sheet's transmitted colour);
  the normal's first two components in the card's frame; emission times the cached lighting
  pre-exposure. Before the tables go up (`tables.ts`), two kernels run:
  - **resample** fills a page from another card's texels (same mesh, materials, facing) or its own
    finer level;
  - **resample lighting** (`surfaceCacheResampleLighting`) carries the card's light (direct, and with
    the radiosity indirect and accumulation) into the capture atlas.

  **Copy** writes the pages into the atlas (depth as `1 - z` in sixteen bits, 65535 for no surface);
  with `surfaceCacheDilationMode` 2 a texel with no surface gets the mean of its neighbours.
  **Lights** writes the starting light: the carried light, and as final light captured albedo over π
  times it plus captured emission; none without `surfaceCacheResampleLighting`.
- **Compressed atlas** (`compress.ts`, `compressWgsl.ts`; `surfaceCacheCompress` 1 and 2). After the
  copy, a kernel per layer (BC7 albedo, BC5 normal, BC6H emission) encodes the pages' 4 × 4 blocks into
  a staging buffer; `copyBufferToTexture` per page rectangle and layer fills the atlas
  ([texel copies](https://www.w3.org/TR/webgpu/#texel-copies): whole blocks, rows of 256 bytes).
  `metrics.surfaceCache.compressed` says whether it is compressed, `compressionWhy` why not.
- **Read library** (`sampleWgsl.ts`, `surfaceCacheSampleWgsl(group, first, { feedback, compressed })`;
  `compressed`: the atlases' flag): `scSampleMeshCards` (a hit's position, normal and mesh cards),
  `scEvaluate` (the light there), with `feedback` the finer page the cone would read; `scGlobalHit`
  is in `hitWgsl.ts`.
- **Feedback** (`feedbackBuffer.ts`, `feedbackWgsl.ts`; `surfaceCacheFeedback`, `…FeedbackTileSize`
  16, `…FeedbackMinPageHits` 16, `…FeedbackUniqueElements` 1024). An image's rays write, in one pixel
  per tile (moving each image, `feedbackTileJitter`), the card, the level the cone calls for (half a
  level coarser than its footprint) and the page they would have read; distinct elements are listed
  with their counts (at most `…FeedbackUniqueElements`). The update takes the
  newest list (`UpdateView.feedback`): a page in the atlas that was read is kept; one hit more than
  `…MinPageHits` times and not in the atlas is requested, behind the coarse mips.
- **Lighting** (`lighting/surfaceCache/lighting/`; `lightSurfaceCache`, called from
  `encodeDirectLights`, before the bounce) updates the light of a share of the atlas's texels an
  image, in one compute pass (`SURFACE_CACHE_LIGHTING_PASS`, in the `surfaceCache` stage), in order:
  - _Update context_ (`contextWgsl.ts`). Each page puts its 8 × 8 texel tiles in 16 priority buckets:
    15 less the log2 of four times the images since the page was lit times its speed, one over one plus
    its eye distance over the first clipmap's half side, doubled within
    `…MaxDistanceFromFrustumToPrioritize` (500 cm) of the frustum; never lit counts as 2048 images.
    Buckets fill the budget (`surfaceCacheDirectLightingUpdateFactor` 32 and
    `…RadiosityUpdateFactor` 64: atlas texels over the factor, 530 000 texels of direct light an image
    at 4096). Page state is in the records (`pageRecords.ts`, words 16 to 19).
  - _Direct light_. Each tile keeps the `…MaxLightsPerTile` (8) lights of most luminance times what
    reaches its centre (`cullWgsl.ts`, `lightTilesWgsl.ts`; a sun and a light apart from the atlas by
    rank: `…DirectLightingBatchShadows` 2). Each texel adds its tile's lights' irradiance
    (`directWgsl.ts`; falloff, range, spot fade, rectangle form factor, cosine, light function,
    clouds' shade, air tint) and, for a shadow-casting light, one ray
    through the global distance field (`gdfTrace`) to the light, started `…GlobalSdfShadowRayBias` (1)
    voxels off the surface and three where it grazes the light, a lamp's ray ending a voxel short.
  - _Radiosity_. A probe every `…RadiosityProbeSpacing` (4) texels of a card, jittered, traces `…HemisphereProbeResolution`² (16) rays from `…DistanceFieldSurfaceBias` (10) cm through
    the global field. A hit gets the final light of the cards there (`scGlobalHit`); a miss gets the
    sky light; no ray exceeds `…MaxRayIntensity` (40) times the exposure. Rays are averaged with their
    four neighbours' (off-plane probes left out) and projected on two spherical-harmonic bands; a texel
    integrates the four nearest probes against the cosine lobe, blended over the last four images.
  - _Final light_: albedo (decoded, `surfaceCacheDiffuseColorBoost`) over π times direct plus indirect
    light, plus emission, times the cached lighting pre-exposure; written after the direct light and
    again after the radiosity.

  Probe atlases: 64 + 24 MiB at 4096. Lighting settles in 256 images.
- **Who reads the cache.** The reflections' and screen probes' scene stages, the radiance cache's
  trace, the world probes' update and the radiosity read the final light at a global-field hit with
  `scGlobalHit` (`surfaceHitReads`; only the reflections ask for the finest page and feedback). The global illumination level (`screenProbes`) sets the defaults of atlas side, cards' density and
  resolutions, lights a tile, update factors and radiosity probes (`SURFACE_CACHE_LEVEL_ROWS`); a
  setting named over a row keeps its value:
  - `high`: 3584-texel atlas, cards of at least 4 texels, 4 lights a tile, update factors 64 and 128,
    probes every 8 texels, 9 rays;
  - `balanced`: 2048-texel atlas, half the cards' density, at most 256 texels, update factors 128 and
    128, 9 rays;
  - `ultra`, `cinematic`: the settings' defaults.
- Cards' lights wear the light functions of `lightFunctionBounce`. Not supported: far field,
  heightfields, merged instance cards, adaptive shadow tracing, probe occlusion, lighting channels.

Diagnostic modes `surface-cache-albedo`, `-normal`, `-depth`, `-cards`, `-fill` and `-age` draw the
atlas (`debug.ts`): a layer, or each tile's card, coarsest-level flag or capture age.
`metrics.surfaceCache`: fill, placements, cards, pages, captured, copied, waiting, why off.

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
