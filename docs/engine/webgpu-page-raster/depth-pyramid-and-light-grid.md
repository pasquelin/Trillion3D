# Depth pyramid and light grid

**Depth pyramid settings.** The pyramid keeps its culling layer (opaque depth, f32, farthest of each
2 × 2, edges clamped), starting at half resolution; the final build writes its trace layers in the same
dispatches. The reflections' screen march reads them.

- `hizTrace` `'reference'` (default): nearest layer = closest opaque depth of each texel's centre;
  march `visibility/hiz/gpu/screenMarchReference.ts`: level 1 is half-resolution mip 0, the walk goes
  down to full-resolution depth. A ray hits a surface it lies behind by less than
  `reflectionRelativeDepthThickness` (0.005) of the surface's depth (at least 10⁻⁷ m) times the depth
  scale (1 perspective; orthographic: `screenRelativeThickness`).
- `'planes'`: thickness in pixels; nearest layer holds each pixel's plane corner, march
  `screenMarchPlanes.ts`.
- Transparent front depth enters the trace layers only with `hizFoldTransparents` (off). A transparent
  cluster is tested against the culling layer at a finer level (`'finer'`, default,
  `visibility/hiz/gpu/rectWgsl.ts`) or, with `hizTransparentTest` `'reference'`, over four texels a side
  (`visibility/hiz/gpu/footprintWgsl.ts`).

The screen probes' trace walks the same pyramid with `screenMarch(..., full)`: `hizFullResDepth` (on)
walks to full-resolution depth; off, it stops at half resolution, each tile's depth scaled by a factor
rising 0.99 to 1 over the first tenth of the march. Relative thickness:
`screenProbeRelativeDepthThickness` (0.02) times the depth scale (`screenRelativeThickness`, CPU). A hit
on a thin light-transmitting sheet (`SUBSURFACE_FLAG`; UE: `bHasBackfaceDiffuse`) is dropped by
`screenProbeSkipFoliageHits` (on). Thickness is scaled by the probe pixel's surface: 1 with a distance
field (`hasDistanceFieldRepresentation`, surface flag 8 `FLAG_DISTANCE_FIELD`), else
`screenProbeThicknessScaleWithoutField` (2) (`screenTraceDepthThresholdScale`). Where foliage hits are
kept, a hit is followed by `screenProbeThicknessCertaintySteps` (4) samples toward the ray's end over
that many half-resolution texels; dropped if the ray is above the closest depth at any
(`spThinFeature`); 0 steps while foliage hits are skipped.

The light grid (`lighting/tiles/`) with `lightGridHizCull` on (default): per column of 64 pixels,
`pyramidFarthest` (`visibility/hiz/gpu/footprintWgsl.ts`) gives the farthest depth; cells behind it are
left empty (`lighting/tiles/cullWgsl.ts`). A column with a background pixel, or a pyramid not this
image's, is not cut.

With `lightGridLinkedLists` on (default) a cell's list is a chain of links from the view's pool. The
pool holds `lightGridMaxCulledLightsPerCell` links per cell of the grid; when links run short, the
lights asked last are dropped, one console warning. Off, each cell has its own
`lightGridMaxCulledLightsPerCell` words. Settings are world options, changed by `world.hiz` from the
next frame (`packages/sdk-core/src/contracts/hizOptions.ts`). Every field, range, default and
example: [Depth pyramid and occlusion settings](../../sdk/canvas-camera-and-teardown/depth-pyramid-and-occlusion-settings.md#depth-pyramid-and-occlusion-settings).

**The primed pyramid** (`frame/render/primeHiz.ts`). `hizPrime` `'whenMissing'` builds a pyramid from
a small draw for an image with no previous one (first, resize, camera cut); `'always'` for every image.
The primed view
(`frame/render/primeState.ts`) holds a depth and a visibility target at the main size shifted right by
`1 + hizPrimeSizeBias`, a raster and a Hi-Z pyramid. Its cut (`GpuSelection.aside(true)`) is the main
frustum over placements that set `farField` (`geometry/selection/viewFilter.ts`; all without
`hizPrimeFarFieldOnly`), at `hizPrimeErrorScale` times the pixel error, one pass, no page asked. Its
main pass is rastered into the small depth (`frame/render/primeStage.ts`); the pyramid is built with a
push of level 0 (`visibility/hiz/gpu/primedWgsl.ts`): depth to distance, `hizPrimeDepthBias` added,
back, clamped to [0, 1]. Own command buffer, submitted before the image's; the image's cut runs two
passes against it; not kept. No `farField` object: nothing allocated. Tessellation patches test the
same pyramid; only a view running the cut's occlusion primes. A compiled node carries `farField` (job
`objectSettings.farField`). Limits: the reference's sixth setting (early depth pass of non-cluster
geometry) has no counterpart; deformation is the previous image's; a tessellated cluster is left out.
