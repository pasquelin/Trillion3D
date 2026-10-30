# Distance fields

A mesh whose `meshBuild` sets `distanceField` (true by default, as in the reference's gameplay
templates; the settings are in [COMPILER.md](../compiler/distance-fields.md#distance-fields)) gets a
signed distance field: bricks of 8 × 8 × 8 bytes around its surface, 7 voxels of each its own and
the eighth the trilinear filter's, a voxel the distance to the surface in the band of four voxels
either side, three mips, the coarsest always loaded. The compiler writes every mesh's records in
`distanceFields.bin` (`asset-compiler-rust/src/distance_field/`) and each mip's data in an object of
its own, both named by the manifest's `distanceFields` section;
`sdk-core/src/lighting/distanceFieldFile.ts` reads it (`parseDistanceFields`: per compiled mesh, or
HLOD cell, its box, and per mip the indirection table, the bricks, the distance scale and bias, the
volume-to-virtual-coordinate scale and add).

The global distance field composites them into clipmaps around the viewer:
`sdk-core/src/lighting/globalDistanceField.ts` places them (`clipmapExtent`, `pageAtlasSizeInPages`,
`updateFrequency`) and `contracts/globalDistanceFieldOptions.ts` holds the reference's settings with
their defaults (4 clipmaps of 128 voxels, an extent of the view distance 20000 cm over 8 doubling
for each next, mips by 4, pages of 7 voxels, the static meshes composited apart, two clipmaps
updated a frame; lengths in centimetres, as the sky light's).
`lighting/distanceField/globalReadWgsl.ts` reads them: `gdfSample`, `gdfDistanceToNearestSurface`,
`gdfConeTrace` and `gdfSkyVisibility`, the fog's sky visibility (one 45 degree cone straight up, ten
steps); The reads bind six resources, consecutive from a first binding: the view block (`GdfView`),
the page table (`texture_3d<u32>`), the page atlas as a buffer (a read-only storage buffer of bytes,
the coverage atlas past its pages), the coarse mip (`texture_3d<f32>`, `r32float`), the page atlas
as a texture (`texture_3d<f32>`, `r8unorm`) and its sampler (linear, repeating); the one of the two
page atlases the device does not keep is a stand-in of one texel, and the view block's flag says
which is read (`gdfAtlasSample`); a position is carried to the field's translated space by
`gdfTranslated` first. A pass takes their layout entries and bind group entries from the scene
(`readLayoutEntries`, `readEntries`) and makes its group again when `readGeneration` changes.
`lighting/distanceField/representationWgsl.ts` tells whether a pixel's surface has a field
(`hasDistanceFieldRepresentation`, `screenTraceDepthThresholdScale`):

```ts
import { globalDistanceFieldReadWgsl } from './lighting/distanceField/globalReadWgsl.ts'
const read = globalDistanceFieldReadWgsl(/* group */ 2, /* first binding */ 0)
// in a program: let visibility = gdfSkyVisibility(gdfTranslated(positionInCentimetres), vec3f(0.0, 1.0, 0.0));
```

The sky light's occlusion by the field (`lighting/distanceField/ao/`) is drawn
(`encodeSkyOcclusion`, in the pre-lighting step, after the distance fields' update and the depth
pyramid and before the sky light's read uniform is written) when the sky light is dynamic and casts
shadows, the bounce is off — with it on, the probes carry the sky and the screen probes its
visibility — and the scene has distance-field objects (`skyOcclusionGate`): the normals and depths
of the scene at half resolution (`dfaoNormals`); nine cones over each surface's hemisphere, traced
at a quarter of that resolution against the global field from the sky light's distance on
(`globalDistanceFieldStartDistance`, 100 cm) — and, at the high quality
(`distanceFieldOcclusionQuality` 2), against the meshes' own fields up to it, their screen tiles
listed by drawing each culled mesh's bounding sphere —; the cones' visibilities combined into a bent
normal; the bent normal upsampled by the surface's plane and normal and filtered over time
(`distanceFieldOcclusionUseHistory`, a history weight of 0.85, a stability pass that fills what
dropped its history). The settings are `contracts/distanceFieldOcclusionOptions.ts`, each with its
default. The last pass packs the image into a buffer, two words a cell (`dfaoPack`, `packWgsl.ts`):
the lit pass has no sampled texture left, so it reads the image from a read-only storage buffer and
a uniform of its own (`DEFERRED_BINDINGS.dfaoBent` and `dfaoRead`, `writeDfaoRead`), stand-ins where
the image drew none.

The indirect light's pass applies it, in a program that holds the code (`indirectPassWgsl` with
`skyShadowing`, `createContractVariants`): made at the first image that has the occlusion, it lights
that image once compiled, the program without it lighting the image meanwhile; no other program
holds the code or declares the two bindings — not the indirect program of an image without the
occlusion, not the light passes, nor the translucent layers'. A pixel reads the image once
(`dfaoBentNormal`): the four cells round its place weighed by their bilinear share and by `1 /
(|their depth − its depth| + 0.0001)`, the place held to the view, the result faded to the pixel's
normal from the farthest pixel lit (`distanceFieldOcclusionMaxViewDistance`,
`distanceFieldOcclusionViewFadeDistanceScale`). The sky light's diffuse light (`skyLightVisibility`)
then takes the bent normal's length as the share of the sky seen, through the contrast curve (a
logistic of `contrast · (10 · visibility − 5)` brought back to 0 .. 1), the exponent and the least
occlusion of the light's settings, combined with the material's and the screen's occlusion
(`occlusion.sky`) by the least or the product; it is read along the normal turned toward the bent
normal by the visibility lost, scaled by the visibility times `mix(dot(bent direction, normal), 1,
visibility)`, and lifted by the tint times what was lost (`environmentLightingOccluded`; the scene's
own environment keeps its occlusion). The sky's reflection goes under the specular occlusion
(`skyLightSpecularOcclusion`): the bent normal's length, or the intersection of the reflection's
cone (half angle `max(roughness, 0.1) · π`) with the open one (`length · π` over the strength),
smoothed and shadowed outright as the open angle falls under 0.1 .. 0.3, lifted by the least
occlusion, a two-sided surface taking the length either way. It reaches the share the reflection's
trace left to the field, the surroundings through the base lobe (`REFLECTION_PROBES_LEFT`), the sky
light's own specular light, with the tint of what it took added and weighed by the pixel's
reflectance (`resolvedReflectionOccluded`); what the screen, the march through the field answered,
hits of the scene, is left as it is. Not applied: a thin surface's back lighting, which reads the
sky unoccluded; the diffuse occlusion of an indirect irradiance, which only the mixing of a baked
irradiance with reflection captures reads, and the engine has none. The meshes' fields are read
through `meshFieldWgsl` (`loadDfObjectBounds`, `loadDfObjectData`, `dfAssetMip`), the one reader of
the placements' records; the sky light's read takes how the image is applied from the occlusion's
state (`skyOcclusionUse`, the `occlusion` argument of `writeSkyLightRead`).

The volumetric fog finds the sky's visibility of each sample of a cell, not of the cell's first
alone, through the global field (`FOG_SKY_VISIBILITY_WGSL`, a cone straight up), under the same gate
with the sky light's volumetric shadow, the global field on and a perspective view (`fogSkyField`);
the scatter that binds the field is made at the first image that wants it (`scatterSky`), the plain
one serving until it is compiled.

The scene side is `lighting/distanceField/scene.ts` (`createDistanceFieldScene`, made at the first
image of a session whose cache carries fields, `EngineContext.distanceFields`, read from the
manifest's `distanceFields` section by `fieldsLoad.ts`; each image of the main view calls
`encodeDistanceFields`, `frame.ts`):

- **Placements** (`objectTracker.ts`, `objectRecords.ts`, `objectBuffers.ts`): the cut's roots whose
  mesh has a field are read as they are, never changed; a root added, moved, shown or hidden, or
  that starts or stops moving (`lights.mobility.moves`), rewrites its records on the GPU — bounds, 3
  `vec4` (centre as a high and a low float, sphere radius, box half-extent, flags); data, 10 `vec4`
  (world-to-volume rows relative to the high centre, volume extent and surface bias, draw distances,
  volume-to-world rows and scale, asset) — and names the region it changed for the global field, per
  cache (static, movable). The world DAG is one root of the cut (one for each placement of its
  model), drawing every HLOD cell's actor at once, so it places no mesh itself: each HLOD cell's
  field (`MeshDistanceField.hlodCell`, one per cell the layer's `allowDistanceField` gave one, in
  the world's space, [FORMAT.md](../format/distancefieldsbin.md)) is placed by a stand-in for the
  root (`lighting/distanceField/hlodObjects.ts`): at the root's world matrix, with its mark (the
  world DAG's: the shell casts; a sun's far-shadow test reaches the subjects that are no cluster
  geometry, so it never leaves the shell out of the shadow maps), one for each instance of the world
  DAG and each cell. A stand-in is read by the tracker only while the cut draws the cell's actor
  (`WorldCells.draws`, the cell's word `CELL_DRAW.hlod`): a cell shown instead of its actor, or an
  actor not loaded, holds no placement and no room in the brick atlas and casts nothing; an actor
  drawn again is placed again, its coarsest mip taken first. The suns' mesh lists of the surface
  cache therefore hold a shell's field exactly where the shell is drawn.
- **Atlas** (`atlasState.ts`, `atlasRequests.ts`, `atlasGpu.ts`, `brickUpload.ts`, `streaming.ts`,
  `streamingWgsl.ts`): the coarsest mip of a mesh is loaded with its first placement; the GPU asks
  each frame for the mips its nearest placement wants (the outer clipmap's box: two mips; the
  clipmap half way in: three), the answer comes back through a ring of four staging buffers, and the
  mips that fit (`meshDistanceFieldBrickAtlasDepth`, `meshDistanceFieldUploadKiB`) are loaded a
  frame later, in blocks of `meshDistanceFieldBlockBricks` bricks of an `r8unorm` 3D texture, their
  indirection tables in one word buffer allocated first fit.
- **Clipmaps** (`updateRegions.ts`, `regionBounds.ts`): the centre snapped to a page, the scroll,
  the update regions (modified boxes that reach the clipmap, the slabs the camera uncovered, the
  static clipmap's for the movable one), the whole composition when needed, the frequency and phase
  of each clipmap's turn.
- **Passes** (`globalUpdate.ts`, `cullWgsl.ts`, `allocateWgsl.ts`, `composeWgsl.ts`,
  `coverageWgsl.ts`, `objectGridWgsl.ts`, `mipWgsl.ts`), per cache, in the reference's order:
  placements culled to the clipmaps; update regions to page tiles and culling cells; placements
  culled to the cells; pages allocated from the free list, and returned; pages composited, a voxel
  the nearest distance of the placements within the influence range, a byte over twice the range,
  the nearer of it and the static page under a movable one; while rays are marched through the field
  (`traced`), the coverage of the pages composited (`coverageWgsl.ts`: a group a page, a thread
  every second voxel along each axis, the 4 × 4 × 4 lattice; a voxel reached by a mostly two-sided
  placement and by no other within four voxels has a coverage of 0, else 1, written to the coverage
  atlas, four bytes of a row to a word, and one such voxel in the page sets the page's top bit, none
  clears it; the static page's voxel under a movable one counts by its own coverage in the atlas)
  and then, while a pass reads it (`grid`: the surface cache is asked for, `demandSurfaceCache`),
  their object grid (`objectGridWgsl.ts`: a group a page, a thread each of its 4 × 4 × 4 cells, of
  two voxels along each axis; a cell keeps the four objects whose surface lies nearest its centre
  within 1.44 of its extent plus three voxel extents, a word each, the object's row in 24 bits and
  its distance in 8, sorted; a movable page's cell begins with the static page's; the buffer is 64
  cells of 16 bytes a page of the atlas, held to what the device binds; `gdfObjectGridCellAt` reads
  the cell of a position, the read a hit evaluation adopts); the coarse mip propagated in five
  steps. The page tables are `r32uint` volumes, the mip an `r32float` volume. An indirect dispatch's
  arguments are written from counters by a one-thread pass, so a count past the device's workgroup
  limit runs in rows.
- **The page atlas** is a 3D texture of bytes (`r8unorm`, 128 × 128 pages of 8 × 8 × 8 voxels to a
  layer of 8 voxels, a page at the place its index splits into: x in 7 bits, y in 7, the layer
  above) written by the composition in place and read with the hardware's trilinear filter
  (`atlasFetchWgsl.ts`, `gdfAtlasSampleTexture`) where the device grants the feature
  `texture-formats-tier2` (read-write storage textures of 8-bit formats; § 25.19 and § 25.20 of the
  WebGPU specification, https://www.w3.org/TR/webgpu/#texture-formats-tier1; the format in WGSL
  needs the extension `texture_formats_tier1`, https://www.w3.org/TR/WGSL/#texel-formats). The
  session asks for it with the other optional features (`session/gpuDevice.ts`,
  `gpu/core/textureFormatsTier.ts`). A device without it keeps the atlas as a buffer of bytes, a
  page after the other, read with an explicit trilinear filter (`gdfAtlasSampleBuffer`) — the
  composition then gathers four voxels of a row into a word, since a buffer holds no byte store.
  Both paths are made from the one set of resources and the one text of the reads; the view block's
  flag chooses. The coverage atlas is a buffer on every device, past the pages' bytes
  (`coverageBase`, the word of the view block it begins at; 0 where the pages are a texture): as a
  second texture it would be the seventeenth sampled texture of the reflections' scene stage, as a
  buffer of its own one more of the eight storage buffers every consumer of the field has to spare.
- **The coverage atlas needs no atomics on textures.** A page's flag is set by an atomic OR into the
  page table when the eight groups that composite a page each add to it, which asks a platform that
  gives atomics on volume textures (Metal's newer shader model does, its older one does not). WGSL
  has atomics only on storage buffer variables and in workgroup memory (§ 6.2.8,
  https://www.w3.org/TR/WGSL/#atomic-types), none on a texture, and WebGPU has no feature that adds
  them. Here a group takes a whole page and its single thread writes the flag with a plain store,
  after the workgroup's own atomic OR over the lattice, so the atlas is built wherever rays are
  marched, on every device.
- **Reads**: the positions `globalReadWgsl.ts` takes are translated (`gdfTranslated`, the view's
  translation added to a world position in centimetres); the bindings are the view block, the page
  table, the atlas buffer, the coarse mip, the atlas texture and its sampler (`readLayoutEntries`,
  `readEntries`; they change with `readGeneration`).
- **Rays** (`globalTraceWgsl.ts`): `gdfTrace` marches a ray through the clipmaps from the finest
  that holds its start: at each step the coarse mip, then, near a surface, the page filtered, a
  flagged page having the coverage the coverage atlas gives at the sample, filtered
  (`gdfCoverageSample`, the lattice's 3 voxels across the page's 7), 0 whole with
  `globalDistanceFieldSimpleCoverageBasedExpand` (false by default); the surface is expanded by half
  a voxel scaled by the coverage (`globalDistanceFieldCoveredExpandSurfaceScale` 1,
  `globalDistanceFieldNotCoveredExpandSurfaceScale` 0.6), the least step by
  `globalDistanceFieldNotCoveredMinStepScale` (4) where it is 0, a dithered ray stopped there by
  noise under `globalDistanceFieldDitheredTransparencyStepThreshold` (0.5) and `…TraceThreshold`
  (0.9), at most 256 steps in a clipmap (`GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS`). `gdfNormal` is
  the central difference of the pages, `gdfClipRayOutside` draws a ray out of the outermost clipmap.
  While rays are marched the field takes `globalDistanceFieldTraceResolution` (252 voxels) and
  `globalDistanceFieldTraceClipmapExtent` (2500 cm, each next clipmap twice the one before) in place
  of its own sizes, and the clipmaps the options ask plus one where the extent of the next reaches
  `globalDistanceFieldTraceViewDistance` (20000 cm; 40000 gives a fifth, 80000 a sixth), plus two
  where the extent of the one after that does; its pages keep the coverage atlas, and the object
  grid while a pass reads it (`resourceShape` carries both, so a field composited without them is
  made again). The atlas as a buffer, the coverage atlas with it, holds the pages the device binds
  in one buffer at most, fewer than the settings ask where they ask for more.
- **Not carried over**: the reference's landscape heightfields belong to landscapes; this engine has
  none.

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

**The sun's distance-field shadow** is no pass of the image: the sun's shadow maps draw every
cluster at any distance, and every mesh the engine draws is made of clusters, so a distance-field
shadow of the view would leave the mask at 1 and shadow nothing (the cascade's settings and the edge
it moves are in [SHADOWS.md](../shadows/far-casters.md#far-casters)). The distance fields of the
meshes shade the sun on the surface cache's cards instead, which the shadow maps do not reach
(`lighting/surfaceCache/lighting/meshShadow.ts`): for each sun that has a shadow, the meshes of the
scene that cast culled to the hull of the cube the cards are kept in (extruded toward the light);
their boxes drawn into a grid of tiles across the light, counted, given runs of one list and
written; the cards' direct light then steps a ray from each texel through the meshes of its tile.
