# Distance fields

A mesh whose `meshBuild` sets `distanceField` (default true; settings in
[COMPILER.md](../compiler/distance-fields.md#distance-fields)) gets a signed distance field: bricks
of 8 × 8 × 8 bytes around its surface (7 voxels its own, the eighth the trilinear filter's), voxel =
distance to surface within four voxels either side, three mips, coarsest always loaded. Compiler
writes records in `distanceFields.bin` (`asset-compiler-rust/src/distance_field/`) and each mip's
data in its own object, named by the manifest's `distanceFields` section;
`sdk-core/src/lighting/distanceFieldFile.ts` reads it (`parseDistanceFields`).

Global distance field composites them into clipmaps around the viewer
(`sdk-core/src/lighting/globalDistanceField.ts`: `clipmapExtent`, `pageAtlasSizeInPages`,
`updateFrequency`); `contracts/globalDistanceFieldOptions.ts` holds settings with defaults (4
clipmaps of 128 voxels, extent of view distance 20000 cm over 8, doubling per next clipmap, mips by
4, pages of 7 voxels, static meshes composited apart, two clipmaps updated a frame; lengths in cm).
`lighting/distanceField/globalReadWgsl.ts` reads them: `gdfSample`, `gdfDistanceToNearestSurface`,
`gdfConeTrace`, `gdfSkyVisibility` (fog's: one 45 degree cone straight up, ten steps). Reads bind
six consecutive resources: view block (`GdfView`), page table (`texture_3d<u32>`), page atlas as
buffer (read-only storage buffer of bytes, coverage atlas past its pages), coarse mip
(`texture_3d<f32>`, `r32float`), page atlas as texture (`texture_3d<f32>`, `r8unorm`; one-texel
stand-in where the device keeps none), sampler (linear, repeating); the view block's flag says which
atlas is read (`gdfAtlasSample`). Positions go through `gdfTranslated` first. A pass takes layout
and entries from the scene (`readLayoutEntries`, `readEntries`), remaking its group when
`readGeneration` changes. `lighting/distanceField/representationWgsl.ts` tells whether a pixel's
surface has a field (`hasDistanceFieldRepresentation`, `screenTraceDepthThresholdScale`):

```ts
import { globalDistanceFieldReadWgsl } from './lighting/distanceField/globalReadWgsl.ts'
const read = globalDistanceFieldReadWgsl(/* group */ 2, /* first binding */ 0)
// in a program: let visibility = gdfSkyVisibility(gdfTranslated(positionInCentimetres), vec3f(0.0, 1.0, 0.0));
```

Sky light occlusion by the field (`lighting/distanceField/ao/`) is drawn (`encodeSkyOcclusion`, in
the pre-lighting step, after distance fields update and depth pyramid) when the sky light is dynamic
and casts shadows, the bounce is off and the scene has distance-field objects (`skyOcclusionGate`):

- scene normals and depths at half resolution (`dfaoNormals`);
- nine cones per surface hemisphere, traced at quarter of that resolution against the global field
  from `globalDistanceFieldStartDistance` (100 cm) on and, at high quality
  (`distanceFieldOcclusionQuality` 2), against meshes' own fields up to it;
- cone visibilities combined into a bent normal, upsampled by surface plane and normal, filtered
  over time (`distanceFieldOcclusionUseHistory`, history weight 0.85, a stability pass).

Settings: `contracts/distanceFieldOcclusionOptions.ts`. Last pass packs the image into a buffer, two
words a cell (`dfaoPack`, `packWgsl.ts`); the lit pass reads it from a read-only storage buffer and
its uniform (`DEFERRED_BINDINGS.dfaoBent`, `dfaoRead`, `writeDfaoRead`).

Indirect light's pass applies it (`indirectPassWgsl` with `skyShadowing`, `createContractVariants`).
A pixel reads the image once (`dfaoBentNormal`): four cells weighed by bilinear share and
`1 / (|their depth − its depth| + 0.0001)`, faded to the pixel's normal from the farthest lit pixel
(`distanceFieldOcclusionMaxViewDistance`, `distanceFieldOcclusionViewFadeDistanceScale`).

- Sky light diffuse (`skyLightVisibility`): bent normal's length = share of sky seen, through the
  contrast curve (logistic of `contrast · (10 · visibility − 5)` back to 0 .. 1), the light's
  exponent and least occlusion, combined with material and screen occlusion (`occlusion.sky`) by
  least or product; read along the normal turned toward the bent normal by lost visibility, scaled
  by visibility × `mix(dot(bent direction, normal), 1, visibility)`, lifted by tint × lost amount
  (`environmentLightingOccluded`).
- Sky reflection: specular occlusion (`skyLightSpecularOcclusion`) = bent normal length, or the
  intersection of the reflection cone (half angle `max(roughness, 0.1) · π`) with the open one
  (`length · π` over strength), shadowed outright as open angle falls under 0.1 .. 0.3, lifted by
  least occlusion. Applies to the share the reflection trace left to the field
  (`REFLECTION_PROBES_LEFT`, `resolvedReflectionOccluded`).
- Not applied: thin surface back lighting; diffuse occlusion of an indirect irradiance.
- Mesh fields are read through `meshFieldWgsl` (`loadDfObjectBounds`, `loadDfObjectData`,
  `dfAssetMip`); the sky light read takes the occlusion's state (`skyOcclusionUse`, `occlusion`
  argument of `writeSkyLightRead`).

Volumetric fog takes sky visibility from the global field (`FOG_SKY_VISIBILITY_WGSL`, `fogSkyField`;
field-binding scatter `scatterSky`, made at the first image wanting it).

Scene side: `lighting/distanceField/scene.ts` (`createDistanceFieldScene`, made at the first image
of a session whose cache carries fields: `EngineContext.distanceFields`, `fieldsLoad.ts`; each
main-view image calls `encodeDistanceFields`, `frame.ts`):

- **Placements** (`objectTracker.ts`, `objectRecords.ts`, `objectBuffers.ts`): cut roots whose mesh
  has a field; a root added, moved, shown, hidden, or starting or stopping moving
  (`lights.mobility.moves`) rewrites its GPU records (bounds, 3 `vec4`: centre high and low, radius,
  box half-extent, flags; data, 10 `vec4`: world-to-volume rows, volume extent, surface bias, draw
  distances, volume-to-world rows, scale, asset) and names its changed region for the global field,
  per cache (static, movable). Landscape heightfields: none.
  - World DAG places no mesh itself: each HLOD cell's field (`MeshDistanceField.hlodCell`, world
    space, one per cell the layer's `allowDistanceField` gave one,
    [FORMAT.md](../format/distancefieldsbin.md)) is placed by a stand-in for the cut root
    (`lighting/distanceField/hlodObjects.ts`) at the root's world matrix, one per instance and cell.
  - A stand-in is read only while the cut draws the cell's actor (`WorldCells.draws`,
    `CELL_DRAW.hlod`); otherwise no placement, no brick atlas room, no cast.
- **Atlas** (`atlasState.ts`, `atlasRequests.ts`, `atlasGpu.ts`, `brickUpload.ts`, `streaming.ts`,
  `streamingWgsl.ts`): a mesh's coarsest mip loads with its first placement; each frame the GPU asks
  for the mips its nearest placement wants (outer clipmap's box: two; clipmap half way in: three),
  the answer returns through four staging buffers, and mips that fit
  (`meshDistanceFieldBrickAtlasDepth`, `meshDistanceFieldUploadKiB`) load a frame later, in blocks of
  `meshDistanceFieldBlockBricks` bricks of an `r8unorm` 3D texture.
- **Passes** (`globalUpdate.ts`, `updateRegions.ts`, `regionBounds.ts`, `cullWgsl.ts`,
  `allocateWgsl.ts`, `composeWgsl.ts`, `coverageWgsl.ts`, `objectGridWgsl.ts`, `mipWgsl.ts`), per
  cache (clipmap centre snapped to a page), in order: placements culled to
  clipmaps; update regions to page tiles and culling cells; placements culled to cells; pages
  allocated and returned; pages composited (voxel = nearest placement distance within the influence
  range, a byte over twice the range; under a movable page, the nearer of it and the static page).
  - While rays march (`traced`): coverage of composited pages (`coverageWgsl.ts`: 4 × 4 × 4
    lattice, one thread per second voxel; a voxel reached by a mostly two-sided placement and by no
    other within four voxels has coverage 0, else 1, written to the coverage atlas; one such voxel
    sets the page's top bit, none clears it).
  - While a pass reads it (`grid`: surface cache asked for, `demandSurfaceCache`), the object grid
    (`objectGridWgsl.ts`: 4 × 4 × 4 cells of two voxels per page; a cell keeps the four objects
    whose surface lies nearest its centre within 1.44 of its extent plus three voxel extents, a word
    each (object row 24 bits, distance 8), sorted; a movable page's cell begins with the static
    page's; 64 cells of 16 bytes per atlas page; `gdfObjectGridCellAt`).
  - Page tables are `r32uint` volumes, coarse mip an `r32float` volume, propagated in five steps.
- **Page atlas** = 3D byte texture (`r8unorm`, 128 × 128 pages of 8 × 8 × 8 voxels per 8-voxel
  layer, page index splits into x in 7 bits, y in 7, layer above) written in place by the
  composition and read with hardware trilinear filtering (`atlasFetchWgsl.ts`,
  `gdfAtlasSampleTexture`) where the device grants `texture-formats-tier2` (`session/gpuDevice.ts`,
  `gpu/core/textureFormatsTier.ts`; read-write 8-bit storage textures, WGSL extension
  `texture_formats_tier1`). Without it the atlas is a byte buffer read with explicit
  trilinear filtering (`gdfAtlasSampleBuffer`); the composition then gathers four voxels of a row
  into a word. The coverage atlas is a buffer on every device, past the pages' bytes
  (`coverageBase`, view block word it begins at; 0 where pages are a texture); it costs one of the
  eight storage buffers.
- **Rays** (`globalTraceWgsl.ts`): `gdfTrace` marches a ray through the clipmaps from the finest one
  holding its start: each step the coarse mip, then near a surface the filtered page, a flagged page
  having the coverage the coverage atlas gives at the sample (`gdfCoverageSample`), 0 whole with
  `globalDistanceFieldSimpleCoverageBasedExpand` (false by default).
  - Surface expanded by half a voxel × coverage (`globalDistanceFieldCoveredExpandSurfaceScale` 1,
    `globalDistanceFieldNotCoveredExpandSurfaceScale` 0.6), least step
    `globalDistanceFieldNotCoveredMinStepScale` (4) where it is 0, a dithered ray stopped there by
    noise under `globalDistanceFieldDitheredTransparencyStepThreshold` (0.5) and `…TraceThreshold`
    (0.9); at most 256 steps per clipmap (`GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS`).
  - `gdfNormal` = central difference of the pages; `gdfClipRayOutside` draws a ray out of the
    outermost clipmap.
  - While rays march, the field takes `globalDistanceFieldTraceResolution` (252 voxels) and
    `globalDistanceFieldTraceClipmapExtent` (2500 cm, each next twice the previous) instead of its
    own sizes, and the options' clipmaps plus one where the next extent reaches
    `globalDistanceFieldTraceViewDistance` (20000 cm; 40000 gives a fifth, 80000 a sixth), plus two
    where the one after's does; its pages keep the coverage atlas, and the object grid while a pass
    reads it (`resourceShape`; a field composited without them is remade). Atlas as buffer holds at
    most the pages the device binds in one buffer.

```ts
const scene = createDistanceFieldScene(device, fields) // fields: parseDistanceFields(bytes)
scene.occlusionDistance = 600 // the sky light's occlusion distance, centimetres
// each image, before the passes that read the field:
scene.update(
  encoder,
  {
    roots,
    moving: (rank) => false,
    epoch: 0,
    origin: eyeInCentimetres,
    frame,
    delta,
    traced: false,
  },
  settings,
)
device.queue.submit([encoder.finish()])
scene.submitted()
```

**Sun's distance-field shadow** is no image pass (cascades:
[SHADOWS.md](../shadows/far-casters.md#far-casters)); mesh fields shade the sun on surface cache
cards only (`lighting/surfaceCache/lighting/meshShadow.ts`): per shadowed sun, casting meshes
culled to the cards' cube hull (extruded toward the light), their boxes drawn into a tile grid
across the light; the cards' direct light steps a ray from each texel through its tile's meshes.
