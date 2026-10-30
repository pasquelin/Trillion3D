# Depth pyramid and light grid

**Depth pyramid settings.** The depth pyramid keeps its culling layer (the opaque depth, f32, the
farthest of each 2 × 2, edges clamped) whatever the settings; it starts at half resolution, reduced
from the depth texture itself, which holds the full-resolution depth, and the final build writes its
trace layers in the same dispatches. Its trace layers are what the reflections' screen march reads.

- By default (`hizTrace` `'reference'`) the nearest layer is the closest opaque depth of each texel's
  centre and the march is the reference's walk (`visibility/hiz/gpu/screenMarchReference.ts`): its
  level 1 is the half-resolution mip 0 and the walk goes down to the full-resolution depth image, as
  the reflections' reference does, a hit the tile's depth, flat. In that walk a ray hits a surface it
  lies less far behind than `reflectionRelativeDepthThickness` (0.005, a reflection setting) of the
  surface's depth (at least 10⁻⁷ m), times the projection's depth scale (1 under a perspective;
  `screenRelativeThickness` derives it under an orthographic one, from its depth range in centimetres,
  the depth measured from the eye's plane).
- `'planes'` keeps its thickness in pixels: the nearest layer holds each pixel's plane corner, a
  finished-depth farthest layer is built beside it, and the march is the engine's own
  (`screenMarchPlanes.ts`), which a grazing surface cannot slip through.
- The transparent front depth is folded into the trace layers only by `hizFoldTransparents` (off). A
  transparent cluster is tested against the culling layer at a finer level by default (`'finer'`,
  `visibility/hiz/gpu/rectWgsl.ts`, the half-resolution mip at the finest) or, by `hizTransparentTest`
  `'reference'`, over four texels a side of the lowest level that holds it
  (`visibility/hiz/gpu/footprintWgsl.ts`, the cut's own test).

The screen probes' trace walks the same pyramid with `screenMarch(..., full)`: `hizFullResDepth` (on)
takes the walk down to the full-resolution depth as the reflections' does; off, it stops at the
half-resolution level, each tile's depth scaled by a factor rising from 0.99 to 1 over the first tenth
of the march, and a hit is the centre of the 2 × 2 pixels of the texel. The relative thickness of its
surfaces is its own setting, `screenProbeRelativeDepthThickness` (0.02), times the projection's depth
scale (`screenRelativeThickness`, on the CPU) and written into the probes' uniform. A hit on a thin
sheet that transmits light (`SUBSURFACE_FLAG`) is dropped by `screenProbeSkipFoliageHits` (on): the
surface buffer's mark `SUBSURFACE_FLAG` is its backface diffuse light, which the reference tests as
`bHasBackfaceDiffuse`. The thickness of the surfaces is scaled by the pixel's surface: 1 where it has a
distance field to resume a ray behind it (`hasDistanceFieldRepresentation`, the surface flag 8 the
shade pass writes for the rows of a mesh that has a field, casts a dynamic shadow and affects
distance-field lighting: `FLAG_DISTANCE_FIELD`), `screenProbeThicknessScaleWithoutField` (2) where it
has none (`screenTraceDepthThresholdScale`), read at the probe's own pixel. Where foliage hits are
kept, a hit is followed by `screenProbeThicknessCertaintySteps` (4) linear samples along the ray toward
its end, over that many texels of the half-resolution level, and dropped (the ray goes on to the next
stage) if the ray is above the closest depth at any of them: a thin feature in front of it
(`spThinFeature`); while they are skipped the steps are 0.

The light grid (`lighting/tiles/`) reads the culling layer of the image's own pyramid, when
`lightGridHizCull` is on (the default): for each column of 64 pixels, widened by one fog cell where the
image builds a fog volume, `pyramidFarthest` (`visibility/hiz/gpu/footprintWgsl.ts`, the cut's 4 × 4
footprint read) gives the farthest depth; the cells whose nearest face lies behind it are left empty
and every light's run ends at the cell that holds it (`lighting/tiles/cullWgsl.ts`). A column with a
background pixel, or a pyramid that is not this image's, is not cut.

A cell's list is made from chains of links when `lightGridLinkedLists` is on (the default): a column's
lights go through in batches, each light a cell takes asks the view's pool for the next link and
chains it before the cell's head, and once every batch is in, each chain is written as a contiguous
list, in increasing light order. The pool holds `lightGridMaxCulledLightsPerCell` links for each cell
of the grid, as a whole: when links run short, the lights asked last are dropped and each cell keeps
the first lights of its list, with one console warning. With the option off, each cell has its own
`lightGridMaxCulledLightsPerCell` words of the pool and keeps its first lights up to them. The
settings are world options by their field, changed by `world.hiz` from the next frame
(`packages/sdk-core/src/contracts/hizOptions.ts`):

```ts
const world = createWorld(canvas, { hizTransparentTest: 'reference' })
world.hiz = { hizTrace: 'planes', hizFoldTransparents: true }
world.hiz = { hizTrace: null } // back to the default, the reference's walk
world.hiz = { hizFullResDepth: false } // the probes' walk stops at the half-resolution level
world.hiz = { lightGridHizCull: false } // every cell the lights reach is listed
world.hiz = { lightGridLinkedLists: false } // each cell keeps its own first lights, no shared links
world.hiz = { lightGridMaxCulledLightsPerCell: 64 } // 64 light entries a cell instead of 32
```

| Field | Meaning | Default |
| --- | --- | --- |
| `hizTrace` | How the reflections' trace reads the pyramid: `'reference'`, or `'planes'` | `'reference'` |
| `hizFoldTransparents` | The trace layers hold the nearest transparent surface beside the opaque one | `false` |
| `hizTransparentTest` | How a transparent cluster is tested: `'finer'` (16 texels), or `'reference'` | `'finer'` |
| `hizFullResDepth` | The screen probes' walk goes down to the full-resolution depth | `true` |
| `lightGridHizCull` | The light grid leaves empty the cells behind their column's farthest depth | `true` |
| `lightGridLinkedLists` | The cells' lists are chains of links from one shared pool; `false`: each cell has its own words | `true` |
| `lightGridMaxCulledLightsPerCell` | Light entries the view's light grid holds per cell; past it the lights asked last are dropped | `32` |
| `hizPrime` | When a primed pyramid is built: `'off'`, `'whenMissing'` or `'always'` | `'off'` |
| `hizPrimeSizeBias` | The primed draw is the image shifted right by `1 + this`, a whole number from 0 to 30 | `2` |
| `hizPrimeDepthBias` | Metres the primed depth is pushed away from the eye by, any number | `1.5` |
| `hizPrimeErrorScale` | Factor on the cut's pixel error for the primed draw, any number | `32` |
| `hizPrimeFarFieldOnly` | The primed draw holds the objects that set `farField` alone | `true` |
| `hzbOcclusion` | The main view leaves out the objects the depth hides: `0` none, `1` the roots' boxes, `2` forced | `0` |
| `hzbOcclusionNeverTestDistance` | Metres from the eye within which no object is tested | `0` |
| `hzbOcclusionExpandAmount` | Metres every tested box is grown by; `hzbOcclusionExpandNewlyAmount` for a newly tested one | `0` |
| `hzbOcclusionExpandScreenSpace` | Pixels every tested box is grown by; `hzbOcclusionExpandNewlyScreenSpace` for a newly tested one | `0` |
| `hzbOcclusionFramesNotTestedToExpand` | Images untested before an object counts as newly tested | `5` |
| `hzbOcclusionFramesToExpandNewly` | Images a newly tested object is grown for | `2` |

**The primed pyramid** (`frame/render/primeHiz.ts`). The cut's main pass tests a box against the
pyramid of the image before; a view with none (its first image, a resize, a cut of the camera) tests
nothing and draws everything its post pass would have judged. With `hizPrime` `'whenMissing'` such an
image first builds a pyramid of its own from a small draw, and `'always'` does for every image: the
previous image's pyramid is then left aside and the cut tests the primed one, where `'whenMissing'`
tests the previous image's when there is one. The primed view (`frame/render/primeState.ts`) holds a
depth target and a visibility target at the main view's allocated size shifted right by
`1 + hizPrimeSizeBias`, a raster over them and a Hi-Z pyramid. Its cut (`GpuSelection.aside(true)`) is
the main view's frustum at the image's render matrix, over the placements that set `farField` (the
cut's view filter, `geometry/selection/viewFilter.ts`; all of them without `hizPrimeFarFieldOnly`), at
`hizPrimeErrorScale` times the pixel error, in one pass: no page is asked and no readback copies it.
The main pass of that cut is rastered, hardware slots then software clusters, into the small depth
(`frame/render/primeStage.ts`, no identifier is resolved), and the pyramid is built from it with a push
of its level 0 (`visibility/hiz/gpu/primedWgsl.ts`): the depth is turned to the distance it stands
for, `hizPrimeDepthBias` is added and the sum turned back, clamped to [0, 1], the far plane's zero
staying zero. It is built in a command buffer of its own, submitted before the image's: the cut's
tables and the raster's buffers are written by the queue, and an image encoded behind it would read
the last write. The image's cut then runs two passes against it, with this image's matrix, depth map
and the primed size in place of the previous image's; it is never kept for the next image. A scene
where no object sets `farField` allocates nothing, encodes nothing and sends nothing. The
tessellation's patches test the same pyramid as the cut, and only a view that runs the cut's occlusion
primes. A compiled scene's node carries `farField` (the job's `objectSettings.farField`: the core node
and the cells' rows). The reference has a sixth setting, which lets the pass sample the depth of the
non-cluster geometry an early depth pass wrote; it has no counterpart here, which writes no depth
before the cut. Limits: the deformation is that of the image before and a tessellated cluster is left
out of the primed draw.

```ts
const world = createWorld(canvas, { hizPrime: 'whenMissing' })
mountains.farField = true // drawn into the primed pyramid
world.hiz = { hizPrime: 'always', hizPrimeSizeBias: 3, hizPrimeErrorScale: 16 }
world.hiz = { hizPrimeFarFieldOnly: false } // the whole cut is primed, not the flagged objects
world.hiz = { hizPrime: null } // back to 'off'
```
