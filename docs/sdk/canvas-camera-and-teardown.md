# Canvas, camera and teardown

The drawing buffer follows the canvas's CSS box, and `pixelRatio` the browser's, unless set;
`world.resize(width, height)` sets a size, omitted arguments reading the CSS box. A canvas hidden or
zero-size at creation needs an explicit `resize()` or showing first; one hidden later keeps its last
size.

`world.pixelError` is the DAG cut's screen error in pixels (`1` by default: a coarser level strays
at most one pixel from the finer one; `0` keeps the exact leaves, a larger value selects coarser
pages when the cache has them). `pose.fromBounds(box)` frames a box,
`pose.pointOfInterest(name, pose)` names one, `pose.runPath(world, poses, { images })` replays a
path, one display frame per pose, and answers the frames drawn, their CPU time summarized and the
display cadence.

`world.temporalAntialiasing` (option of `createWorld` too, `true` by default) jitters each image by
a sub-pixel offset and accumulates; `false` draws pixel centres with no history, as a pixel-exact
capture needs. A write applies next frame, no session reopened; a read says what the image carries.
`world.temporal` holds the pass's settings beside its level, each an option of `createWorld` too:
`temporalThinGeometry` (`false`) looks for geometry thinner than a pixel — a wire, a rail, which the
pixels it crosses see on some images and not on others — and relaxes the history there, at any level
but `'off'`, for the cost of the finding in every image. `temporalShadingRejectionMode` (`'stability'` or
`'responsive'`, `'stability'` by default) sets how the shading rejection widens its clamp: `'stability'` is
steadier and controls the rejection better but ghosts more; `'responsive'` widens the clamp by the blur
of the lesser total variation of the input's change and of the input, so it rejects less and ghosts
less, with blockier artifacts. Three settings ride on the level (table below):
`temporalResurrection` keeps older frames to bring a disoccluded pixel's detail back,
`temporalReprojectionField` reprojects the history by a field rather than by the dilated vector alone,
and `temporalShadingRejectionFlickering` widens the shading rejection by the flicker measure; each is
`'level'` (the default: the level's own choice), `'on'` or `'off'` whatever the level, at any level but
`'off'`. Three settings shape the history where it resurrects and reprojects by a field:
`temporalResurrectionFrames` (`2`, a
whole number of at least 1, rounded up to an even count) is the number of frames the history keeps
for good beside the last two, each costing a history's bytes; `temporalResurrectionInterval` (`31`,
a whole number of at least 1, made odd) is the number of images between two stored for good;
`temporalReprojectionFieldSpeed` (`0.125`, 0 or more) is the speed, in display pixels an image, from
which the field anti-aliases the edge of a moving surface. Three settings choose how its programs run,
the image the same: `temporalWaveOps` (`true`) gathers the half-size image the scene's chain reads
through the lanes of a subgroup, where the device grants `subgroups` at 16, 32 or 64 lanes (else through
workgroup memory); `temporalWaveSize` (`0`, the device's smallest size from 16; or 16, 32, 64 where the
device runs it) names the size; `temporalHalfPrecision` (`true`) runs the spatial anti-aliaser in 16-bit
floats where the device grants `shader-f16`. `temporalHistoryPacked` (`true`) keeps the history's colour in the 11-11-10 format where the device stores to it, four bytes a pixel; `false` keeps half floats, eight bytes, a finer blue and shadows (the `cinematic` preset writes it); the pass is made again when it changes. A write names the settings it changes, `null` one's default;
a value of another kind is refused by name.

Sixteen more settings are the reference's own knobs of the pass, each at its default. The history's
laws take four: `temporalHistorySampleCount` (`16`, 8 to 32) is the most samples a display pixel's
history holds, more steadying the highlights of a still image and ghosting more on fireflies;
`temporalShadingRejectionSampleCount` (`2`, 0 or more) is what it keeps after a total shading
rejection, lower clearer after one and less steady; `temporalVelocityWeightClampingSampleCount`
(`4`, 0 or more, in samples of a history pixel) is what it keeps once its pixel moves at
`temporalVelocityWeightClampingPixelSpeed` (`1`, above 0, in half display pixels an image), higher steadier
on a movement and blurrier. The flicker measure, where the shading rejection widens by it (`temporalShadingRejectionFlickering`),
takes four: `temporalFlickeringPeriod` (`2`, 0 or more, in images; `0` runs no measure) is the period at
which a luma oscillation, or a faster one, is a flicker the pass lets ghost;
`temporalFlickeringAdjustToFrameRate` (`true`) shortens it in proportion where the frame rate falls below
`temporalFlickeringFrameRateCap` (`60`, hertz above 0), so an effect animated in time is not taken for a
flicker; `temporalFlickeringMaxParallaxVelocity` (`10`, above 0) is the parallax speed, in pixels of a
1080p image at that frame rate, past which a texel is moving, not flickering.
`temporalShadingExposureOffset` (`0`, -20 to 20) adds stops to the exposure the rejection measures the
colours at, lifting the shadows it sees. Seven settings tune the thin geometry detection where
`temporalThinGeometry` runs it: `temporalThinGeometryErrorMultiplier` (`200`, 0 or more; a twentieth of
it, ten at the default, is the depth step in pixel depth errors past which a texel is a thin line),
`temporalThinGeometryMinKeepLineContrast` (`0.3`, 0 to 1; the luma contrast of a thin line of light),
`temporalThinGeometryLineFadeRate` (`0.1`, 0 to 1) and `temporalThinGeometryLineFadeRateInsideRegion`
(`0.03`; how often a high contrast line not seen again fades, outside and inside a cluster hole
region), `temporalThinGeometryLineWeight` (`0.6`; the relaxation weight near a high contrast line),
`temporalThinGeometryMaxRelaxationWeight` (`0.037`, 0 to 1; the greatest weight by which a cluster hole region
relaxes the history, before a 3×3 average spreads it) and `temporalThinGeometryRejectTranslucency` (`0.6`; the share of a texel's luma that the translucent layers
make, past which its thin geometry is rejected, `0` never) and `temporalThinGeometryShadingRange` (`'foliage'`, `'foliageAndHair'`, `'all'` or `'varying'`, `'varying'` by default; the shading models counted as thin geometry: `'varying'` counts every lit surface and relaxes the two-sided foliage with the dilation, the others by their edge alone, and needs the flicker measure running (`temporalFlickeringPeriod` above `0` and `temporalShadingRejectionFlickering` on) or `temporalThinGeometryMinKeepLineContrast` above `0`, else only the foliage counts). `temporalThinGeometryAntiFlickering` (`true`) has the flicker measure
consider the relaxation the detection gives the history, since the detection can fail to find some thin
geometry; `false` measures the flicker as if the history were not relaxed (the shading rejection itself
is relaxed either way). It applies where `temporalThinGeometry` runs and the flicker measure runs.
`temporalDownsampleQuality` (`'low'` or `'high'`, `'low'` by default)
says how the half-size image the exposure and the bloom read is made: `'low'` has the temporal pass
and the motion blur write it beside their own image, one filtered sample of four pixels, and the
chain's own pass only where neither draws; `'high'` has the chain draw it alone, four filtered
samples of the 4 × 4 pixels around a texel, steadier on a bright pixel in motion, for the cost of
that pass.

| Level (`temporalAntialiasing`) | History | Resurrection | Reprojection field | Flicker rejection | Spatial anti-aliaser samples a side |
| ------------------------------ | ------- | ------------ | ------------------ | ----------------- | ----------------------------------- |
| `'low'`                        | 100 %   | no           | no                 | no                | 0                                   |
| `'medium'`                     | 100 %   | yes          | no                 | no                | 3                                   |
| `'high'`                       | 100 %   | yes          | yes                | yes               | 3                                   |
| `'max'`                        | 200 %   | yes          | yes                | yes               | 8                                   |

The resurrection, the reprojection field and the flicker rejection columns are the defaults of the
three settings above: a setting that says `'on'` or `'off'` overrides its column at any level.

The history is kept at the percent of the display's size the level names, resolved down to the
display's before composition; a device that cannot make it that large (a side past its largest
texture) keeps it at 100 %. Its colour is stored in the
11-11-10 format and its validity in one 8-bit channel where the device stores to them (feature
`texture-formats-tier1`), else in half floats and four 8-bit channels. At 1920 × 1080 the `'max'`
history is 3840 × 2160 and four frames of 5 bytes a pixel, 166 MB (398 MB in half floats); at
5120 × 3280 it is 10240 × 6560, 1.34 GB (3.22 GB), and a device whose largest texture is 8192 keeps
it at 100 %, 336 MB (806 MB).

```js
const world = createWorld('viewer', { temporalThinGeometry: true })
world.temporal = { temporalThinGeometry: false } // back to the default, from the next frame
world.temporal = { temporalResurrection: 'off', temporalShadingRejectionFlickering: 'on' } // whatever the level says
world.temporal = { temporalResurrectionFrames: 4, temporalResurrectionInterval: 15 } // more, nearer frames to bring a disoccluded pixel back from
world.temporal = { temporalReprojectionFieldSpeed: null } // 0.125 again
world.temporal = { temporalWaveOps: false, temporalHalfPrecision: false } // the plain, 32-bit programs
world.temporal = { temporalHistoryPacked: false } // half-float history, as the cinematic preset
world.temporal = { temporalHistorySampleCount: 24 } // steadier highlights, more ghosting on fireflies
world.temporal = { temporalFlickeringPeriod: 3, temporalFlickeringFrameRateCap: 30 } // a longer period, followed below 30 Hz
world.temporal = { temporalThinGeometry: true, temporalThinGeometryMinKeepLineContrast: 0.2 } // finer lines of light
world.temporal = { temporalShadingRejectionMode: 'responsive' } // less ghosting, blockier artifacts
world.temporal = { temporalThinGeometry: true, temporalThinGeometryAntiFlickering: false } // the flicker measure ignores the thin geometry's relaxation
world.temporal = { temporalDownsampleQuality: 'high' } // the chain draws the half-size image, the wide filter
```

`world.softwareRaster` (option of `createWorld` too, `true` by default) rasters in compute each
cluster whose longest edge projects under `world.hardwareRasterEdgePixels` (option of `createWorld`
too, `32` by default, a finite number of pixels above zero) and whose box crosses neither clip
plane; every other cluster goes to the hardware rasterizer, and `false` hands it every one.
`world.depthBucketing` (option of `createWorld` too, `true` by default, the reference's) rasters
the software raster's cutout clusters nearest first, so that a
hidden cutout pixel leaves before its texture is read: each cluster is put in one of 256 buckets
spread by the logarithm of the view depth of its box between `world.depthBucketsMinZ` (`10`) and
`world.depthBucketsMaxZ` (`1000`), in metres, finite numbers above zero (the reference's
centimetres, `1000` and `100000`). As in the reference, the order is made only where the scene holds
voxels; it never changes a pixel. All five are render settings: the page's value holds over the
quality preset, a write applies next frame, and a value of another kind is refused by name.

```js
const world = createWorld('viewer', { softwareRaster: true, hardwareRasterEdgePixels: 32 })
world.softwareRaster = false // every cluster on the hardware rasterizer, from the next frame
world.hardwareRasterEdgePixels = 16 // fewer clusters on the software raster
world.depthBucketing = false // the cutout clusters unordered
world.depthBucketsMaxZ = 500 // the buckets end at 500 m
```

`world.cut` holds the cut's settings, each an option of `createWorld` too: `cutTwoPassOcclusion`
(`true`: the main view tests what it cuts against the previous image's depth, then what that hid
against the depth it just drew), `cutOcclusionCulling`, `cutFrustumCulling` and `cutMinLodCulling`
(`true`: each test on), `cutDrawDistanceCulling` (`true`: an object that names a draw distance —
`drawDistance`, [COMPILER.md](../compiler/the-partitions-grids.md#object-settings) — is culled outside it, in the cut, in
the sun's shadows and in the rays' scene; `false`, every instance of an instanced mesh is drawn at
every distance, while an object of its own is always culled by its distances),
`cutDistanceCullToSphereEdge` (`true`: an object's draw distance is measured to the edge of the
sphere of its bounds; `false`, to its centre), `cutViewDistanceScale` (`1`, a finite number of at
least 0: the scale every draw distance is multiplied by; the quality levels write it, 0.4 at
`smooth`, 0.6 at `balanced`, 0.8 at `fine`, 1 at `max`, 10 at `cinematic`), `cutViewDistanceApplySecondaryScale`
(`false`) and `cutViewDistanceSecondaryScale` (`1`): a second scale of the draw distances, applied
beside the first once the switch is on, `cutViewDistanceFovMinAngle` (`45`) and
`cutViewDistanceFovMaxAngle` (`90`), two horizontal fields of view in degrees from 0 to 360, with
`cutViewDistanceFovMinAngleScale` and `cutViewDistanceFovMaxAngleScale` (`1` both, 0 or more): the
scale the draw distances of an object of its own take at the first angle and under, at the second
and over, and linearly between (an orthographic view counts as 0 degrees; at 1 and 1 nothing
changes), `cutEdgeScaleBudgetMs` (`0`, none) and `cutEdgeScaleMinPercent` (`30`): a GPU time budget
for the main view's cut and its raster that coarsens its threshold, no further than that share of
its scale, while the render scale is `'auto'`, `cutLodBiasFollowsUpscale` (`true`: an upscaled image's screen error follows
the display over the render width), `cutLodBiasOffset` (`0`) and `cutLodBiasMin` (`-2`), that bias's
offset and floor in powers of two, and the caps of its lists, `cutMaxNodes` (`2097152`),
`cutMaxCandidateClusters` (`16777216`) and `cutMaxVisibleClusters` (`4194304`): past one, the cut
draws what fits and warns. Of these only `cutViewDistanceScale` is written by a quality level: a
value the page set holds over the preset. A write names the settings it changes, `null` one's
default; a value of another kind is refused by name ([ENGINE.md](../engine/webgpu-page-raster.md#webgpu-page-raster)).

```js
const world = createWorld('viewer', { cutTwoPassOcclusion: true })
world.cut = { cutLodBiasFollowsUpscale: false } // the screen error ignores the upscale, next frame
world.cut = { cutViewDistanceScale: 0.5 } // every object's draw distance halved
world.cut = { cutViewDistanceFovMaxAngleScale: 0.5 } // an object of its own: halved at 90 degrees and over
world.cut = { cutEdgeScaleBudgetMs: 6 } // with renderScale 'auto': the cut coarsens above 6 ms
```

`world.hiz` holds the depth pyramid's settings, each an option of `createWorld` too: `hizTrace`
(`'reference'`: the reflections' trace walks the closest opaque depth of each half-resolution texel,
mip by mip, down to the full-resolution depth, as the reference's does; `'planes'`: it reads each pixel as a plane, which keeps a hit on
a grazing surface that the centre alone passes over), `hizFoldTransparents` (`false`: the trace
layers hold the opaque depth alone; `true`, the nearest transparent surface of each pixel too, so a
ray stops at glass) and `hizTransparentTest` (`'finer'`: a transparent cluster is tested over up to
sixteen texels a side of a fine level; `'reference'`: over four texels a side of the lowest level
that holds it; the image is the same, `'finer'` rejects more clusters), `hizFullResDepth` (`true`: the screen probes' `'reference'` walk goes down to
the full-resolution depth; `false` stops at the half-resolution level, a little less exact and
cheaper; the reflections' walk always goes down) and `lightGridHizCull` (`true`: the light grid
leaves empty the cells behind the farthest depth of their column of the image, read from the pyramid
the image built; `false` lists every cell the lights reach), `lightGridLinkedLists` (`true`: the cells'
lists are chains of links taken from one pool shared by the whole grid, and when links run short each
cell keeps the first lights of its list; `false`: each cell has its own `lightGridMaxCulledLightsPerCell`
words and keeps its first lights up to them) and `lightGridMaxCulledLightsPerCell`
(`32`: the light entries the view's light grid holds per cell, from 1 to 1024; the pool holds that
many for each cell; the lights asked past it are dropped, with one console warning). The cut's occlusion reads
the culling layer, which no setting changes. A write names the settings it changes, `null` one's
default; a value of another kind is refused by name.

```js
const world = createWorld('viewer', { hizTrace: 'planes' })
world.hiz = { hizTrace: null, hizFoldTransparents: true } // the default trace, glass in the pyramid
world.hiz = { hizFullResDepth: false, lightGridHizCull: false } // half-resolution probe walk, no cull
world.hiz = { lightGridLinkedLists: false, lightGridMaxCulledLightsPerCell: 64 } // 64 words of its own a cell
```

`lightGridDebug` (`0`, off) draws the light grid over the image: `1` colours each cell from blue (no light) to
red (`lightGridDebugMaxThreshold` lights, `8` by default, from 1 to 1024) by the number of lights in the cell of
each pixel's depth, `2` by the greatest number over the slices of its column but the last (the last slice's
culling is too wide to mean much), `3` over all of them; the count is written in the middle of each cell and the
borders are drawn in grey. `lightGridDebugSlice` (`-1`) above `-1` shows the one slice of that index (read no
higher than the last) whatever the view. It needs lit lights in the scene.

```js
world.hiz = { lightGridDebug: 1 } // the lights in the cell of each pixel
world.hiz = { lightGridDebug: 3, lightGridDebugMaxThreshold: 16 } // the greatest count of a column, red at 16
world.hiz = { lightGridDebug: 1, lightGridDebugSlice: 12 } // only the twelfth slice
```

`hizPrime` (`'off'`) builds, before a view's cut tests anything, a primed pyramid from a small,
coarse draw of the objects that set `farField` (`object.farField = true`, `false` by default; a saved
scene keeps it when `true`), for the cut's main pass to test against: `'whenMissing'` for an image
whose view has no pyramid of the image before (its first, one after a resize, one after a cut of
the camera), `'always'` for every image. The draw is the image's size shifted right by
`1 + hizPrimeSizeBias` (`2`: an eighth), its depth pushed away from the eye by `hizPrimeDepthBias`
metres (`1.5`), its clusters cut at `hizPrimeErrorScale` (`32`) times the image's pixel error;
`hizPrimeFarFieldOnly` (`true`) draws the flagged objects alone, `false` the whole cut. With no
object flagged it draws nothing and costs nothing. The image is the same: the primed pyramid only
lets the main pass skip what it hides, and the post pass judges again what it hid.

```js
const world = createWorld('viewer', { hizPrime: 'whenMissing' })
mountains.farField = true // this object is drawn into the primed pyramid
world.hiz = { hizPrime: 'always', hizPrimeDepthBias: 3 } // every image, pushed away by 3 metres
world.hiz = { hizPrime: null } // back to the default, 'off'
```

`hzbOcclusion` (`0`) makes the main view leave out the objects the depth it drew hides. At `1` (or `2`, forced) the world box of
every object is projected each image and walked against the farthest depth of the pyramid, with the walk the transparent clusters are
tested with under `hizTransparentTest: 'reference'` (the lowest level that holds the box in four texels a side); the verdicts are copied
for the CPU and come back a few images late, and an object found behind the depth is left out of the next images' cut, in front again
when a test finds it so. An object with no box, outside the view or within `hzbOcclusionNeverTestDistance` metres (`0`) of the eye is
never rejected, and the shadow maps never see the verdict. `hzbOcclusionExpandAmount` (`0`) metres and
`hzbOcclusionExpandScreenSpace` (`0`) pixels grow every tested box, which hides fewer objects and shows fewer of them late;
`hzbOcclusionExpandNewlyAmount` and `hzbOcclusionExpandNewlyScreenSpace` (`0`) grow, beside them, an object not tested for
`hzbOcclusionFramesNotTestedToExpand` (`5`) images for the next `hzbOcclusionFramesToExpandNewly` (`2`) images it is tested in.

`occlusionQueries` (off) asks the same of the GPU's own occlusion queries instead, while `hzbOcclusion` is `0`: the world boxes of the
objects are drawn sixteen to a query against the depth the image drew (depth tested, nothing written), the counts come back a few images
late, and an object whose group let no sample through is left out of the next images' cut until a later group lets one through. An object
with no box, or a box that reaches the eye's plane, is never hidden; at most 65536 objects are queried.

```js
const world = createWorld('viewer', { occlusionQueries: true })
world.hiz = { occlusionQueries: null } // back to the default, off
```

`downsampledOcclusionQueries` (off) makes those queries test against a smaller copy of the depth: the image's depth is reduced to half its
size on each side first, each texel keeping the farthest of the four it covers, and the boxes are drawn at that size. An object is then
hidden only where the whole square of texels hides it: fewer objects are hidden and the queries count fewer samples.

```js
const world = createWorld('viewer', { occlusionQueries: true, downsampledOcclusionQueries: true })
world.hiz = { downsampledOcclusionQueries: null } // back to the default, off
```

```js
const world = createWorld('viewer', { hzbOcclusion: 1 })
world.hiz = { hzbOcclusionExpandScreenSpace: 8, hzbOcclusionNeverTestDistance: 2 } // grown by 8 pixels, none tested within 2 m
world.hiz = { hzbOcclusion: null } // back to the default, none
```

`world.tessellation` holds the settings of the run-time tessellation, each an option of
`createWorld` too. A write names the settings it changes, `null` one's default; a value of another
kind is refused by name. They are render settings: the page's value holds over the quality preset (no
preset level writes them), and a write applies next frame.

| Setting                           | Takes                                                                                                                                  | Default   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `tessellation`                    | `true` / `false`: displaced materials are tessellated and displaced; `false` draws every one flat and runs nothing of the tessellation | `true`    |
| `tessellationDicingRate`          | A finite number of pixels above 0: the size a micro-triangle is diced to; smaller cuts finer and costs more                            | `2`       |
| `tessellationMaxPatchesPerGroup`  | A whole number of at least 1: the patches one group of the dicing takes (held to 21)                                                   | `5`       |
| `tessellationMaxCandidatePatches` | A whole number from 1 to 134217727: the patches the splitting queue holds, 16 bytes each                                               | `2097152` |
| `tessellationMaxVisiblePatches`   | A whole number from 1 to 134217727: the patches a pass's visible list holds, 16 bytes each                                             | `2097152` |
| `tessellationShadowsDirectional`  | `true` / `false`: the shadow maps of the suns take a displaced surface's displaced shape                                               | `true`    |
| `tessellationShadowsLocal`        | `true` / `false`: the shadow maps of the local lights (points and spots) take it                                                       | `true`    |

A patch past either capacity is lost for the image. The buffers hold what the device lets one
storage buffer bind: capacities that would not fit are brought down in proportion. Neither shadow
setting does anything while `tessellation` is off or the scene holds no displaced material.

```js
const world = createWorld('viewer', { tessellationDicingRate: 2 })
world.tessellation = { tessellationDicingRate: 4 } // coarser micro-triangles, from the next frame
world.tessellation = { tessellationShadowsLocal: false } // lamps cast the flat surface
world.tessellation = { tessellation: false } // every displaced material drawn flat
world.tessellation = { tessellation: null, tessellationDicingRate: null } // back to the defaults
```

The explorer's tool `trillion3d_set_tessellation` writes one setting at a time (`field`, `value`).
Nothing of the tessellation is allocated while the setting is off or no displaced material is in the
scene; turning it off gives the buffers back.

What tessellation does not do:

- A displaced surface is drawn flat by the passes that do not read the visibility buffer's pixels:
  the rays' scene and the reflections' traced scene see the surface its triangles describe. Its
  motion vector is the flat surface's point moved as the surface moves, plus this image's
  displacement, whole ([ENGINE.md](../engine/tessellation-of-displaced-rows.md#motion-of-a-displaced-pixel)): the displacement itself is not tracked from image to image, so a
  height map that changes in time gets no velocity from its change.
- A masked displaced surface casts a tessellated shadow, cut out at the vertices of its patches on a
  device that grants nine storage buffers to a vertex stage and per pixel on a device that grants
  eight, which every WebGPU device does ([ENGINE.md](../engine/tessellation-of-displaced-rows.md#masked-casters-in-the-shadow-maps)). A shadow patch is judged by the frustum of
  the map and the page it casts into, not by the depth the page has already seen.
- A per-job override of a material's displacement fields is not read. The displacement baked into a
  mesh ([COMPILER.md](../compiler/displacement.md#baked-displacement)) is read for the rigid triangle primitives of
  a mesh, tessellated together; a primitive that deforms, or stands for a part of an assembly, bakes
  none.
- A scene compiled before the texture-coordinate density existed reads a density of 1 for every set;
  recompile it to measure it.

`world.volumetricLightmap` holds the setting of the precomputed indirect light a baked scene carries
(a `volumetric-lightmap.bin`, [FORMAT.md](../format/volumetric-lightmapbin.md#volumetric-lightmapbin)), an option of
`createWorld` too: `volumetricLightmap` (`true`: the lightmap is read by the fog's static term and by
the lighting of movable objects; `false`: every read of it answers black, as in a scene without one;
it does nothing where the scene has no lightmap), `volumetricLightmapLoadingRange` (64: the metres around the view within which the cells of the finest bricks are loaded) and `volumetricLightmapBrickMemory` (30: the megabytes of finest bricks that stay resident, the cells nearest the view winning them), then the view of the samples: `volumetricLightmapVisualize` (`false`: a sphere is drawn at every sample of the lightmap as an unlit surface right after the opaque resolve, so the lighting, the velocity and the fog treat it as such; lit by the harmonics stored there on a grey of 0.18 (the brightness of the lighting view in the `lighting` diagnostic), tested against the scene depth), `volumetricLightmapVisualizeRadiusScale` (`0.01`: the sphere's radius as a fraction of the world size of its brick) and `volumetricLightmapVisualizeMinScreenFraction` (`0.001`: the least share of the screen a sphere takes, measured with the projection's horizontal scale, i.e. the width, so a far one does not alias). The fog's static term is scaled by
the `heightFog` part's `volumetric.staticLightingScatteringIntensity` (`1`, never below `0`; `0` leaves the term
out). The fog's sky light follows the
sky light part's `mobility`: a `'static'` one lights the fog by none of its own harmonics (its light is the
lightmap's), a `'stationary'` one that casts shadows scatters multiplied by the lightmap's sky visibility (a lightmap
baked with a sky light; the compiler does not bake one yet), a `'movable'` one by the global distance field's. A write names the setting it changes, `null` its default; a value of another kind is refused
by name.

```js
const world = createWorld('viewer', { volumetricLightmap: false }) // the precomputed light off
// finest bricks streamed within 100 m of the view, 60 MB of them resident at most
world.volumetricLightmap = {
  volumetricLightmapLoadingRange: 100,
  volumetricLightmapBrickMemory: 60,
}
world.volumetricLightmap = { volumetricLightmap: null } // back to the default, on
world.volumetricLightmap = { volumetricLightmapVisualize: true, volumetricLightmapVisualizeRadiusScale: 0.02 } // the samples as spheres
```

`world.globalDistanceField` holds the settings of the global distance field, an option of `createWorld`
too: the clipmaps composited from the meshes' distance fields around the camera (a mesh has one where
its build sets `distanceField`, [COMPILER.md](../compiler/distance-fields.md#distance-fields)) and the brick atlas those
fields are streamed into ([ENGINE.md](../engine/distance-fields.md#distance-fields)). Lengths are in centimetres. Each
setting is the reference's console variable of that name with its default:
`globalDistanceField` (`true`), `globalDistanceFieldUpdate` (`true`), `globalDistanceFieldClipmaps` (`4`, at
most 6), `globalDistanceFieldViewDistance` (`20000`), `globalDistanceFieldClipmapExponent` (`2`),
`globalDistanceFieldResolution` (`128`), `globalDistanceFieldMipFactor` (`4`),
`globalDistanceFieldOccupancyRatio` (`0.3`), `globalDistanceFieldCacheMostlyStaticSeparately` (`true`),
`globalDistanceFieldPartialUpdates` (`true`), `globalDistanceFieldStaggeredUpdates` (`true`),
`globalDistanceFieldUpdatesPerFrame` (`2`), `globalDistanceFieldForceFullUpdate` (`false`),
`globalDistanceFieldForceUpdateOnce` (`false`), `globalDistanceFieldFastCameraMode` (`false`),
`globalDistanceFieldCameraVelocityDecay` (`0.7`), `globalDistanceFieldAverageCulledObjectsPerCell` (`512`),
`globalDistanceFieldRecacheOnStreaming` (`true`), `globalDistanceFieldForceRecacheOnStreaming` (`false`),
`globalDistanceFieldDebugShowStats` (`false`), which writes over the upper right of the image the pages of the field — the most
the atlas holds, those allocated and free, the pages of the clipmaps in use (combined), those among them with no surface and
the pages composited this image (`world.globalDistanceField = { globalDistanceFieldDebugShowStats: true }`, `null` back to off),
`globalDistanceFieldStartDistance` (`100`), `globalDistanceFieldMinMeshRadius` (`20`),
`globalDistanceFieldMinMeshRadiusInVoxels` (`0.5`), the ones of the rays the reflections march through the field —
`globalDistanceFieldTraceResolution` (`252`) and `globalDistanceFieldTraceClipmapExtent` (`2500`), the voxels along a
clipmap and the first clipmap's half-extent while rays are marched, each next clipmap twice the one before,
`globalDistanceFieldTraceViewDistance` (`20000`), the distance the scene is kept to then: the field makes one clipmap
more than `globalDistanceFieldClipmaps` where the extent of the next reaches it, two more where the one after does (the
default four clipmaps of 2500 become five at `40000` and six at `80000`); while rays are marched, which the reflections
do by default, `globalDistanceFieldViewDistance`, `globalDistanceFieldClipmapExponent` and `globalDistanceFieldResolution`
have no effect, the three above size the clipmaps in their place,
`globalDistanceFieldCoveredExpandSurfaceScale` (`1`) and `globalDistanceFieldNotCoveredExpandSurfaceScale` (`0.6`), the
scale of the half voxel by which a ray expands the surface it meets in the pages the meshes cover and in those only
two-sided meshes (foliage) reach, `globalDistanceFieldSimpleCoverageBasedExpand` (`false`), which reads the coverage
atlas, the coverage of each voxel of such a page, and where `true` counts the whole page as not covered and leaves the
atlas unread, `globalDistanceFieldNotCoveredMinStepScale` (`4`), the scale of its least step there,
`globalDistanceFieldDitheredTransparencyStepThreshold` (`0.5`) and `globalDistanceFieldDitheredTransparencyTraceThreshold`
(`0.9`), the noise under which a dithered ray is stopped there — and the atlas's `meshDistanceFieldMaxObjectRadius`
(`100000`), `meshDistanceFieldSurfaceBiasExpand` (`0.25`), `meshDistanceFieldBrickAtlasSize` (`128`, a power
of two, read when the atlas is made), `meshDistanceFieldBrickAtlasDepth` (`32`), `meshDistanceFieldUploadKiB`
(`8192`), `meshDistanceFieldBlockBricks` (`16`, read when the atlas is made), `meshDistanceFieldForceMips`
(`0`: follow the view; 1 to 3 loads that many mips of every mesh), `meshDistanceFieldReverseAllocation`
(`false`) and `runtimeMeshDistanceFields` (`false`): a mesh made at run time, which no compiler gave a field, gets
one built when it appears, on the page's GPU, by the compiler's own program (the same text, the same steps: the
nearest triangle within the band, the 98 rays across the sphere for the sign; the voxels the device is in doubt of
are measured again on the CPU, so the field is the compiler's). It is read when the scene's page records are made (a mesh cut at run time is flagged as having a field then) and each image after; set it with the world's other options before the scene opens. It costs the build once for each distinct mesh,
in chunks short enough for the page's frames to go on, and the rays marched through the field meet the mesh a few
frames after it appears. A mesh that deforms, one with no ray-tracing tree and one too deep for the program to walk
get none. The reference builds fields at import only, so the setting is off until a scene asks for it. A write
names the settings it changes, `null` one's default; a value of another kind is refused by name. A scene whose
meshes built no distance field, and none asked for them at run time, is not touched.

```js
const world = createWorld('viewer', { globalDistanceFieldClipmaps: 5 }) // one more clipmap
world.globalDistanceField = {
  globalDistanceFieldViewDistance: 40000,
  meshDistanceFieldUploadKiB: 16384,
}
world.globalDistanceField = { globalDistanceFieldFastCameraMode: true } // follow a fast camera, lower quality
world.globalDistanceField = { globalDistanceFieldFastCameraMode: null } // back to the default, off
// A cheaper march for the reflections: coarser clipmaps while rays are marched
world.globalDistanceField = { globalDistanceFieldTraceResolution: 140 }
// A scene kept to 800 m while rays are marched: the field grows from four clipmaps to six
world.globalDistanceField = { globalDistanceFieldTraceViewDistance: 80000 }
// Meshes made at run time (a generated terrain, a procedural prop) take part in the marched rays too
world.globalDistanceField = { runtimeMeshDistanceFields: true }
// Cheaper still, a page foliage reaches counted as not covered whole, the coverage atlas unread
world.globalDistanceField = { globalDistanceFieldSimpleCoverageBasedExpand: true }
```

`world.distanceFieldOcclusion` holds the settings of the sky light's occlusion by the distance fields, an option of
`createWorld` too: how much of the sky each pixel sees, from cones traced against the global field and the meshes' own
fields ([ENGINE.md](../engine/distance-fields.md#distance-fields)), drawn when the sky light is movable and casts shadows, the bounce is
off (with it on, its probes carry the sky and the screen probes its visibility) and a mesh built a distance field. The
sky light then lights each pixel along the way its sky is most open and by the share of it the pixel sees: the sky's
diffuse light is read along a normal turned toward that direction and scaled by the visibility, and the sky's reflection
off a rough surface is occluded by the cone the sky leaves open (`distanceFieldOcclusionSpecularMode`: 0 by the share of
sky seen, 1 by the intersection of the reflection's cone with the open one, `skyLightSpecularOcclusionStrength` its
strength). The light's own settings shape it: `occlusionMaxDistance`, `contrast`, `occlusionExponent`, `minOcclusion`,
`occlusionTint` and `occlusionCombineMode`. The settings below, each with its default; lengths are in centimetres: `distanceFieldOcclusion` (`true`), `distanceFieldOcclusionQuality`
(`2`: 0 off, 1 the global field alone, 2 the meshes' fields too), `distanceFieldOcclusionObjects` (`true`),
`distanceFieldOcclusionStepExponentScale` (`0.5`), `distanceFieldOcclusionMaxViewDistance` (`20000`, held to 65000),
`distanceFieldOcclusionViewFadeDistanceScale` (`0.7`), `distanceFieldOcclusionSampleSet` (`1`),
`distanceFieldOcclusionJitterConeDirections` (`false`), `distanceFieldOcclusionUseJitter` (`true`),
`distanceFieldOcclusionTraverseMips` (`true`), `distanceFieldOcclusionUseHistory` (`true`),
`distanceFieldOcclusionHistoryStabilityPass` (`true`), `distanceFieldOcclusionHistoryWeight` (`0.85`),
`distanceFieldOcclusionHistoryDistanceThreshold` (`30`), `distanceFieldOcclusionSpecularMode` (`1`),
`skyLightSpecularOcclusionStrength` (`1`, at least 0.1 where it is used) and `distanceFieldOcclusionObjectsPerCullTile`
(`512`). A write names the settings it changes, `null` one's default; a value of another kind is refused by name. A
scene whose meshes built no distance field is not touched.

```js
const world = createWorld('viewer', { distanceFieldOcclusionQuality: 1 }) // the global field alone
world.distanceFieldOcclusion = { distanceFieldOcclusionMaxViewDistance: 40000 } // light pixels up to 400 m
world.distanceFieldOcclusion = { distanceFieldOcclusionUseHistory: false } // no temporal filter
world.distanceFieldOcclusion = { distanceFieldOcclusionQuality: null } // back to the default, 2
```

`world.surfaceCache` holds the settings of the surface cache, an option of `createWorld` too: the atlas that keeps the
captured surface of the meshes' cards (flat boxes along a mesh's faces, built by the compiler), which the rays that
leave the screen will read where they hit a mesh. Each setting is the reference's of that meaning, with its default, the
row of the screen probes' level `ultra` (the default; `cinematic` holds the same); the level `high` holds another
row of the atlas's side, the cards' density and resolutions, the lights a tile, the lighting's update factors and the radiosity's
probes (`SURFACE_CACHE_LEVEL_ROWS`), which a setting you name overrides; lengths are in centimetres. The atlas: `surfaceCacheAtlasSize` (`4096`, texels a side, cut into pages of 128) and
`surfaceCacheResolution` (`1`, from 0.5: a factor on the pages along a side, held between 1 and 64, and on the cards'
resolutions). Which resolution a card is kept at, from its larger half side over the eye's distance, a metre at least:
`surfaceCacheCardTexelDensityScale` (`100`), `surfaceCacheCardMaxTexelDensity` (`0.2`), `surfaceCacheCardMaxResolution`
(`512`, up to 2048), `surfaceCacheCardMinResolution` (`2`), `surfaceCacheOrthographicCardMinResolution` (`1`: an
orthographic view's own least, `0` takes the plain one), `surfaceCacheSceneDetail` (`1`, from 0.125 to 8: it divides the
least resolution) and `surfaceCacheCardCaptureMargin` (`0`, added to the distance of the global distance field's
outermost clipmap, past which a card is not kept). Which meshes get cards: `surfaceCacheMeshCardsMinSize` (`10`: the area
a mesh's largest face must exceed is its square, a fifth of that for an emissive mesh) and `surfaceCacheMeshCardsCullFaces`
(`true`: a card whose face is under that area is left out). A mesh a world cut at run time, which no compiler gave cards,
has six axis-aligned cards made from its bounds, thickened by 5 cm, while `runtimeMeshCards` (`true`) is on; off, only the screen
sees it in a reflection that leaves the screen. What an image does: `surfaceCacheCardCapturesPerFrame` (`300`
cards captured, the nearest first; the cards of twice as many meshes are added; `0` stops every capture),
`surfaceCacheRemovesPerFrame` (`512`), `surfaceCacheGpuDrivenUpdate` (`false`, work in progress: a pass of the GPU tests every mesh's box against the eyes and lists the meshes to give cards and to take them from, read back a few images late and applied under the same limits; turn it on with `{ surfaceCacheGpuDrivenUpdate: true }` among the scene's settings), `surfaceCacheCardCaptureFactor` (`64`: the atlas's texels over those of the atlas
the captured pages are drawn in), `surfaceCacheCardCaptureRefreshFraction` (`0.125`: the share spent capturing pages again,
the oldest first, to follow the materials), `surfaceCacheCardCaptureEnableInvalidation` (`true`),
`surfaceCacheNumFramesToKeepUnusedPages` (`256`), `surfaceCacheCompress` (`1`: `1` and `2` keep the atlas's albedo, normal and emission in
block-compressed textures, BC7, BC5 and BC6H, a quarter of those layers' memory, where the device has `texture-compression-bc`
and leave it uncompressed elsewhere; `1` is compression by writing through a view of another format, which WebGPU cannot do,
so it takes the block copy of `2`, with the same result; `0` never),
`surfaceCacheAllowCardSharing` (`true`: cards of one mesh with the same
materials, face and proportions copy one capture), `surfaceCacheAllowCardDownsampleFromSelf` (`true`),
`surfaceCacheCaptureLodScaleFactor` (`1`: the view's pixel error over it is the error the pages are drawn at),
`surfaceCacheResampleLighting` (`true`), `surfaceCacheDilationMode` (`0`: 1 the
two-sided meshes, 2 all), `surfaceCacheDiffuseColorBoost` (`1`, up to `4`: the luminance of the albedo a read returns,
raised to the power of its inverse) and `surfaceCacheFastCameraMode` (`false`: lower density, half the greatest resolution, twice the
captures). The feedback that asks for finer pages: `surfaceCacheFeedback` (`true`), `surfaceCacheFeedbackTileSize` (`16`,
raised to a power of two), `surfaceCacheFeedbackMinPageHits` (`16`),
`surfaceCacheFeedbackUniqueElements` (`1024`) and `surfaceCacheFeedbackResLevelBias` (`-0.5`: levels added to the one a ray's cone calls for). The lighting of the cards' texels: `surfaceCacheDirectLightingUpdateFactor` (`32`) and
`surfaceCacheRadiosityUpdateFactor` (`64`: the atlas's texels over the texels lit directly, and given indirect light, in an
image, the pages left longest unlit first), `surfaceCacheLightingUpdateSpeed` (`1`, from 0.5 to 16: it divides both),
`surfaceCacheLightingQuality` (`1`, from 0.5 to 6: it multiplies the radiosity probes' hemisphere by its square root and, from 6, halves their
spacing), `surfaceCacheLightingForceFullUpdate` (`false`), `surfaceCacheFreezeUpdateFrame` (`0`; any other number stops the update clock
and the pages' record of being lit, so that every image lights the same subset, for debugging), `surfaceCacheLightingMaxDistanceFromFrustumToPrioritize` (`500`, `-1`
never: the pages near the frustum are lit twice as soon), `surfaceCacheLightingFeedback` (`true`: a page the rays read at its finest level in the last two images is lit at the greatest update speed, 4, where the scene has acceleration structures and `surfaceCacheDirectLightingHardwareRayTracing` is on), `surfaceCacheDirectLighting` (`true`),
`surfaceCacheDirectLightingMaxLightsPerTile` (`8`, up to 32, a power of two), `surfaceCacheDirectLightingBatchShadows` (`2`, from 0 to 2: the
tiles of each light are gathered into a run before the masks and the light functions are made over them; at `2` the point lights', the
spots' and the rectangles' tiles are each gathered by their type, at `0` and `1` each light has a run of its own; the image is the same), `surfaceCacheDirectLightingGlobalSdfShadowRayBias` (`1`:
voxels the shadow ray starts off the surface, three where it grazes the light) and `surfaceCacheDirectLightingCloudTransmittance`
(`true`). Where the scene has acceleration structures the direct light's shadow is traced through the scene's triangles instead:
`surfaceCacheDirectLightingHardwareRayTracing` (`true`; `false` keeps the distance field's ray) keeps, for each light of a tile, a
mask of the tile's texels (the light function and the clouds' shade, then whether a ray must settle it), and one ray goes from each
texel the mask leaves open; `surfaceCacheDirectLightingHardwareRayTracingShadowRayBias` (`1` cm off the texel, three where it grazes
the light), `…EndBias` (`1` cm: a lamp's ray stops short of it), `…AdaptiveShadowTracing` (`true`: a tile that every texel saw a light
at, or none did, at its last update traces one texel of each quad of four, a different one each update), `…ForceTwoSided` (`false`:
the front faces of a primitive that is not two-sided are culled; `true` takes all as two-sided), `surfaceCacheDirectLightingStochastic` (`false`, experimental, with the shadows traced: each texel is lit by
`surfaceCacheDirectLightingStochasticSamplePerTexel` (`1`, up to 4, 3 taken as 4) lights picked among those of its tile with a chance proportional to `log2(1 + luminance)`, a light under
`surfaceCacheDirectLightingStochasticMinWeight` (`0.001`) never picked, and only the picked ones traced; `…StochasticTemporal` (`true`) blends the result over at most
`…StochasticTemporalMaxFramesAccumulated` (`12`) images, the history held within `…StochasticTemporalNeighborhoodClampScale` (`2`) standard deviations of the texel's 5 × 5 neighbours; example:
`world.surfaceCache = { surfaceCacheDirectLightingStochastic: true, surfaceCacheDirectLightingStochasticSamplePerTexel: 2 }`) and
`surfaceCacheHardwareRayTracingMaxIterations` (`8192` triangles a ray may test; a ray that stopped counts as blocked). The radiosity, `surfaceCacheRadiosity` (`true`), `surfaceCacheRadiosityProbeSpacing` (`4`, texels, a power of two up to 8),
`surfaceCacheRadiosityHemisphereProbeResolution` (`4`, up to 16), `surfaceCacheRadiositySpatialFilterProbes` (`true`) with its
`…KernelSize` (`1`: 0 none, 1 four neighbours, 2 thirteen), `surfaceCacheRadiosityProbePlaneWeighting` (`true`) with its
`…DepthScale` (`-100`), `surfaceCacheRadiosityMaxRayIntensity` (`40`, times the exposure),
`surfaceCacheRadiosityDistanceFieldSurfaceBias` (`10` cm along a ray before it can hit) and `…SurfaceSlopeBias` (`5` cm off the
texel) for its rays through the global distance field; where the scene has acceleration structures and its cut draws no cell of
the world DAG, `surfaceCacheRadiosityHardwareRayTracing` (`true`) casts them through the scene's triangles instead, from
`…HardwareRayTracingNormalBias` (`0.1` cm off the texel along its normal) and `…HardwareRayTracingBias` (`0.1` cm along the ray),
the translucent primitives passed, the cards of the primitive hit read at the hit with
`surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias` (`10` cm) and no light from a hit nearer than
`surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache` (`10` cm) or on the back of a one-sided primitive, a
trace that stopped black and a miss the sky; `surfaceCacheHardwareRayTracingAvoidSelfIntersections` (`3`: 0 culls the back
faces, 1 traces again from past a near hit, 2 and 3 pass the near hits as the ray travels) with
`surfaceCacheHardwareRayTracingSkipBackFaceHitDistance` (`5` cm) and `…SkipTwoSidedHitDistance` (`1` cm) keeps a ray off the
geometry it starts on. `rayTracingExcludeSky` (`true`) leaves the primitives of a sky material (the compiler's `sky`
property) out of every ray through the scene's triangles, the path tracer's excepted, which always meets them:
`world.surfaceCache = { rayTracingExcludeSky: false }` includes the dome. `surfaceCacheRadiosityTemporal` (`true`) with its `…MaxFramesAccumulated` (`4`) and `…FixedJitterIndex` (`-1`: the probes'
jitter moves). A read of the cards finds each texel's final light, its albedo over π times its direct and indirect light plus its
emission; the lighting settles over some hundred images after a change, and the frame is not held while it does. The capture's
raster is not plugged in yet, so on an image today the cards hold no surface to light. A write names the settings it changes, `null` one's default; a value of
another kind is refused by name. A change that alters the atlas's pages, the compression, the sharing or the downsampling
empties the atlas. A scene whose meshes carry no cards is not touched.

```js
const world = createWorld('viewer', { surfaceCacheAtlasSize: 2048 }) // a smaller atlas, in less memory
world.surfaceCache = { surfaceCacheCardCapturesPerFrame: 150 } // half the captures of an image
world.surfaceCache = { surfaceCacheFeedback: false } // only the coarsest level of each card is kept
world.surfaceCache = { surfaceCacheGpuDrivenUpdate: true } // a GPU pass lists the meshes to give cards and to take them from, read back a few images late
world.surfaceCache = { surfaceCacheCompress: 0 } // the colour layers stay plain: four times the memory, no block loss
world.surfaceCache = { rayTracingExcludeSky: false } // the rays meet a sky dome too
world.surfaceCache = { surfaceCacheAtlasSize: null, surfaceCacheCardCapturesPerFrame: null } // back to the defaults
```

**Ray tracing switch.** `rayTracingEnable` (`true`, the value of a new project) is the one switch the features that cast rays through the scene's
triangles hang on. On, each takes its own setting; `false` makes every one of them read `false` whatever it is itself, so each marches the
distance fields, as a project with ray tracing off does: `reflectionHardwareRayTracing`, `screenProbeHardwareRayTracing`,
`screenProbeRadianceCacheHardwareRayTracing`, `screenProbeShortRangeAOHardwareRayTracing`, `surfaceCacheDirectLightingHardwareRayTracing`,
`surfaceCacheRadiosityHardwareRayTracing`, `translucencyGiHardwareRayTracing`, `heterogeneousVolumesHardwareRayTracing`, `visualizeHardwareRayTracing` and
`sampledLightsHardwareRayTracing`. The settings keep their values: `rayTracingEnable` back to `true` gives them back. It is a run-time setting, written
by `world.rayTracing`, the session's `setRayTracing` or the `trillion3d_set_ray_tracing` tool.

```ts
world.rayTracing = { rayTracingEnable: false } // every feature traces the distance fields, as a project with ray tracing off
world.rayTracing = { rayTracingEnable: null } // back to the default: each feature follows its own setting
```

**Ambient occlusion.** A crease, a corner or the foot of a wall receives less of the light that comes from all round than
an open surface does. The engine finds that loss in the depth the image drew, by one of two methods, and leaves one byte a
pixel, which the lighting multiplies in where it belongs: the emission of a surface (the light the base pass left in the
picture) and the sky light's diffuse (by the smaller of the material's occlusion and this one), never a declared light,
whose shadows are its own.

It draws **where no global illumination is on**, that is, with the bounce off (`bounce: false`, which a page writes: the
`smooth` quality level writes it too, but also `ambientOcclusionLevels: 0`, so that nothing is searched there). With the
bounce on — at any level of the screen probes, `'off'` included, where the world's probes light the pixels — the probes
carry their own short-range occlusion (`screenProbeShortRangeOcclusion`), the same contact shadow found another way, and
the two never meet: a view draws no ambient occlusion, holds no texture for it and runs no pass.
`ambientOcclusionWithScreenProbes` (off) draws it over the probes' light too, but only while their own short-range
occlusion is off (`screenProbeShortRangeOcclusion: false`), and then it occludes their light alone, at the strength
`screenProbeOcclusionIntensity` names.

**The disc search** (`ambientOcclusionMethod: 'disc'`, the default). Each pixel searches the depth round it, along a few
directions turned by a small noise and at a few distances, for what rises above its surface, and keeps the share of the
sky it still sees. The search runs at the image's size and at its half and its quarter, each coarser result blended into
the finer one. With `ambientOcclusionCompute` from 1 up the search is made in one resolution from the normals the depth
gives, without the blur among the four pixels of a quad, and, where the image does not accumulate in time, smoothed
(`ambientOcclusionComputeSmooth`).

**The horizon search** (`ambientOcclusionMethod: 'horizon'`). Each pixel looks, along a few directions in the image
(`ambientOcclusionHorizonAngles`), for the highest horizon each side of it finds in the depth, and integrates the sky that
is left against the surface's normal. The result is blurred in space (a square filter that weighs each neighbour by how
near it lies to the pixel's plane, which also applies the power and the intensity), blended in time into the last image's
(clamped to the neighbourhood of this one, the last image found again through the motion of the camera, or of the surface
where it moves by itself; the history is white where it does not reach) and upsampled to the image's size. The history
belongs to the view: dragging the intensity, the power or the radius keeps it, only a cut or a change that remakes the
textures (the filters, the half-size search, a resize) starts it again, and so does an image it skipped. A view at rest is
drawn again until the history has the images it needs to come within a tenth of what it converges to (22 at the default
blend of 0.1: `ceil(ln 0.1 / ln(1 − blend))`), whatever the temporal anti-aliasing does, then held. It has its own radius,
`ambientOcclusionHorizonRadius`; the distance fade, the quality's shape, the power and the intensity are the occlusion's.
With the spatial filter off, the last pass of the method applies the power and the intensity itself, so that the setting
changes the softness and nothing else.

**The ray-traced occlusion** (`rayTracedAmbientOcclusion`). A third way to find the occlusion, off by default (the reference's post-process switch
is off): each pixel casts rays over the hemisphere of its surface's geometric normal through the scene's triangles (the scene trace the lighting makes
for the image, `rayTracingFile`), as far as `rayTracedAmbientOcclusionRadius`, and keeps the share that arrive, every ray weighted by the cosine its
shading normal gives it over the cosine of the geometric one. The geometric normal is found from the depth round the pixel (a thin two-sided sheet and
a silhouette keep the shading normal), and the overlap of the two normals' lobes is a factor of the result. It replaces the screen-space search wherever it
is on and the scene has triangles — whatever `ambientOcclusion` says — and, like it, is drawn only where no global illumination is on; the lighting
applies the texture as it applies the search's (`ambientOcclusionStaticFraction`). Where the scene has no triangles, or while its program compiles,
the image keeps the search. It is wanted where `rayTracedAmbientOcclusionAllowed` holds (it reads off while the project's `rayTracing` switch is off),
`rayTracedAmbientOcclusion` says `'on'` — or `'auto'` and `rayTracedAmbientOcclusionEnabled` is on — and `rayTracedAmbientOcclusionIntensity` is above 0.
The ray's start leaves the surface by the larger of a ten-thousandth of the distance to the eye and the ray-traced shadows' normal bias
(`rayTracedShadowsNormalBias`, the reference's one `r.RayTracing.NormalBias`), the start the ray-traced shadows' rays have. Beside the occlusion the kernel
writes the distance of the nearest primitive any of the pixel's rays hit (100 m where none did, below zero where it cast none), and
`rayTracedAmbientOcclusionDenoiser` (on, the reference's `r.AmbientOcclusion.Denoiser`, whose values 1 and 2 are one denoiser here) runs the screen-space
denoiser on the two: the injestion of the pair into samples whose radius is that distance, the reconstruction (the quad's stochastic sets, in descending
rings, `rayTracedAmbientOcclusionDenoiserReconstructionSamples` of them at most), the pre-convolutions (`…PreConvolution` webs, the first
`…KernelSpreadFactor` pixels wide, doubling with each), a rejection pre-convolution (the share's first two moments over the pixel and its four neighbours),
the accumulation in time (the history held to 256 samples; bounded to 6 deviations of the neighbourhood's moments; none for an unlit pixel) and, when
`…HistoryConvolutionSamples` is above 1, a convolution of the history `…HistoryConvolutionKernelSpreadFactor` pixels wide. These are the shadow denoiser's
kernels run on this signal. A quiet view is drawn again until the history has settled (231 images), then holds. Two faults of the reference's denoiser are fixed:
its sample set for the temporal rejection is meant to be the rotated three by three, but a mistyped test of the shader selects a seven by seven box (forty-nine
taps), here the rotated three by three; and its occlusion samples carry the hit distance in a field the kernels do not read (they read another, left invalid), so that every sample's radius
is invalid and the descending rings never tell a near blocker from a far one; here the radius of a sample is its hit distance, which the rings use as they do for the shadows. One fault of the reference is fixed: its geometric normal reads a neighbour's
depth at the pixel clamped to the view but places it at the unclamped pixel, so that a pixel on the view's edge finds a normal from points that are not
neighbours; here both are read at the clamped pixel. Another, in its orthographic projection: the pixel's radius is not divided by the width, so that
the silhouette test is five half-widths of the view; here it is.

Every setting has the reference's default. Lengths are in metres (the reference's centimetres over a hundred):

| Setting                                                                                | Default              | Meaning                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ambientOcclusion`                                                                     | `true`               | The master switch; `false` draws none.                                                                                                                                                                 |
| `ambientOcclusionMethod`                                                               | `'disc'`             | `'disc'` or `'horizon'`.                                                                                                                                                                               |
| `ambientOcclusionIntensity`                                                            | `0.5`                | How much of the occlusion shows, 0 to 1; 0 is off.                                                                                                                                                     |
| `ambientOcclusionStaticFraction`                                                       | `1`                  | The share of a surface's emission the occlusion darkens, 0 to 1.                                                                                                                                       |
| `ambientOcclusionRadius`                                                               | `2`                  | How far from a point a surface may lie and occlude it, in metres (the disc search). In the default view-space mode it is the radius at 4 m from the eye and grows with the distance.                   |
| `ambientOcclusionRadiusInWorldSpace`                                                   | `false`              | The radius is the world's, at any distance.                                                                                                                                                            |
| `ambientOcclusionFadeDistance`, `ambientOcclusionFadeRadius`                           | `80`, `50`           | The occlusion has faded to nothing at 80 m, fading over the last 50 (both methods).                                                                                                                    |
| `ambientOcclusionPower`                                                                | `2`                  | The exponent of the occlusion, from 0.1.                                                                                                                                                               |
| `ambientOcclusionBias`                                                                 | `3`                  | How far a point is lifted off its surface along its normal, in thousandths of its depth (the disc search).                                                                                             |
| `ambientOcclusionQuality`                                                              | `50`                 | 0 to 100: the resolutions of the disc search (one below 35, two below 70, three above) and the samples a pixel takes (five shapes: 5, 25, 55 and 75 are the steps), the steps of the horizon search.   |
| `ambientOcclusionLevels`                                                               | `-1`                 | The resolutions, 1 to 3, 0 none (the horizon search too); -1 follows the quality.                                                                                                                      |
| `ambientOcclusionMaxQuality`                                                           | `100`                | A ceiling on the quality; a negative value forces the quality its absolute value names.                                                                                                                |
| `ambientOcclusionMipBlend`, `ambientOcclusionMipScale`, `ambientOcclusionMipThreshold` | `0.6`, `1.7`, `0.01` | The share of the coarser result blended in, the radius's growth at each coarser resolution, and the depth step under which neighbours count as one surface when a resolution is made.                  |
| `ambientOcclusionMipLevelFactor`                                                       | `0.4`                | How fast the samples climb the depth pyramid's coarser levels along the search; at 1 or less they stay on the finest.                                                                                  |
| `ambientOcclusionRadiusScale`                                                          | `1`                  | A scale on the radius, 0.1 to 15.                                                                                                                                                                      |
| `ambientOcclusionWithScreenProbes`                                                     | `false`              | Draw it over the probes' light, while the screen probes' own short-range occlusion is off.                                                                                                             |
| `ambientOcclusionCompute`                                                              | `0`                  | 0 the pixel passes; 1 to 3 the single compute-style pass (one resolution, the depth's normals, no quad blur). 2 and 3 name an asynchronous queue a browser device lacks: all three make the same pass. |
| `ambientOcclusionComputeSmooth`                                                        | `true`               | The compute pass is smoothed (a box of four taps two texels apart) where the image does not accumulate in time.                                                                                        |
| `ambientOcclusionHorizonNormals`                                                       | `false`              | The horizon search reads the surfaces' own normals rather than the depth's.                                                                                                                            |
| `ambientOcclusionHorizonFilterWidth`                                                   | `5`                  | The side of the spatial filter in pixels: 3 and 4 as they are, any other number the five-wide filter.                                                                                                  |
| `ambientOcclusionHorizonThickness`                                                     | `0.5`                | How thick a surface is taken to be (any number, it is squared): more lowers the occlusion a thin surface casts.                                                                                        |
| `ambientOcclusionHorizonRadius`                                                        | `2`                  | The distance in metres, from 0, at which an occluder stops counting for the horizon search.                                                                                                            |
| `ambientOcclusionHorizonAngles`                                                        | `2`                  | The directions a pixel searches, 1 to 16, spread over half a turn.                                                                                                                                     |
| `ambientOcclusionHorizonPauseJitter`                                                   | `false`              | The directions stop turning from image to image.                                                                                                                                                       |
| `ambientOcclusionHorizonDownsample`                                                    | `false`              | The horizon search runs at half the image's size and is upsampled at the end (the spatial filter then reads the depth at the right place; see below).                                                  |
| `ambientOcclusionHorizonTemporal`, `ambientOcclusionHorizonSpatial`                    | `true`, `true`       | The temporal filter and the spatial filter (a compute pass). With the spatial filter off the power and the intensity apply in the method's last pass.                                                  |
| `ambientOcclusionHorizonBlend`                                                         | `0.1`                | The share of this image the temporal filter takes, from 0; the rest is the history's.                                                                                                                  |
| `rayTracedAmbientOcclusion`                                                            | `'auto'`             | `'off'`, `'on'`, or `'auto'`, which follows `rayTracedAmbientOcclusionEnabled` (the reference's -1 / 0 / 1).                                                                                           |
| `rayTracedAmbientOcclusionAllowed`                                                     | `true`               | The scalability switch that lets it be on; it reads off while the project's `rayTracing` switch is off.                                                                                                |
| `rayTracedAmbientOcclusionEnabled`                                                     | `false`              | The post-process volume's switch, read where `rayTracedAmbientOcclusion` is `'auto'`.                                                                                                                  |
| `rayTracedAmbientOcclusionSamplesPerPixel`                                             | `-1`                 | The rays a pixel casts, from 0 (none: the pixel is unoccluded); -1 leaves it to `rayTracedAmbientOcclusionPostProcessSamplesPerPixel`.                                                                 |
| `rayTracedAmbientOcclusionPostProcessSamplesPerPixel`                                  | `1`                  | The post-process volume's rays a pixel casts, from 1.                                                                                                                                                  |
| `rayTracedAmbientOcclusionRadius`                                                      | `2`                  | The farthest a ray goes, in metres, 0 to 100.                                                                                                                                                          |
| `rayTracedAmbientOcclusionIntensity`                                                   | `1`                  | How much a blocked ray darkens, 0 to 1; 0 draws none.                                                                                                                                                  |
| `rayTracedAmbientOcclusionTwoSidedGeometry`                                            | `false`              | The geometry occludes from both faces; off, back faces are passed.                                                                                                                                     |
| `rayTracedAmbientOcclusionMaterials`                                                   | `false`              | The rays cut the masked surfaces by their mask; off, every triangle is opaque to them.                                                                                                                 |
| `rayTracedAmbientOcclusionDenoiser`                                                    | `true`               | The result is denoised from the occlusion and the distance of the nearest blocker (reconstruction, pre-convolutions, rejection pre-convolution, accumulation in time); off keeps the raw rays.      |
| `rayTracedAmbientOcclusionDenoiserReconstructionSamples`                               | `16`                 | The most samples of the denoiser's reconstruction, 1 to 56.                                                                                                                                            |
| `rayTracedAmbientOcclusionDenoiserPreConvolution`                                      | `2`                  | The pre-convolution passes after it, 0 to 4.                                                                                                                                                           |
| `rayTracedAmbientOcclusionDenoiserKernelSpreadFactor`                                  | `4`                  | The spread of the first pre-convolution, in pixels, doubling with each pass; 0 to 64.                                                                                                                  |
| `rayTracedAmbientOcclusionDenoiserTemporalAccumulation`                                | `true`               | The denoised occlusion is accumulated over the images.                                                                                                                                                 |
| `rayTracedAmbientOcclusionDenoiserHistoryConvolutionSamples`                           | `1`                  | The samples of the convolution of the accumulated history, 1 to 56; 1 runs none.                                                                                                                       |
| `rayTracedAmbientOcclusionDenoiserHistoryConvolutionKernelSpreadFactor`                | `7`                  | The spread of that convolution, in pixels; 0 to 64.                                                                                                                                                    |

The quality levels (`world.quality`, group `imageEffects`) write the reference's five post-process levels of the
resolutions, the ceiling, the climb and the radius scale: `smooth` — `ambientOcclusionLevels` 0 (none: no occlusion is
drawn at this level), ceiling 0, climb 1, scale 1.2; `balanced` — follows the quality, ceiling 60, climb 1, scale 1.5;
`fine` — ceiling 100, climb 0.6, scale 1.5; `max` writes nothing: the defaults are the reference's own default level
(ceiling 100, climb 0.4, scale 1); `cinematic` — the same as `max`, and the horizon search's number of angles
(`ambientOcclusionHorizonAngles`) at 4, the one value the reference's fifth level writes of it. A value the page writes
holds over the level. Two settings of the reference are not offered because they do nothing there (a falloff ratio and an upsample switch
that no shader reads); its dead deprecated distance, its depth-bounds test and its framebuffer compression have no form in
a browser.

Two faults of the reference, fixed. With the horizon search at half size the reference's spatial filter reads the depth at
the wrong place (it is told a reduction of one), so its weights come from the top-left quarter of the picture; here the
depth is read where the texel is. And with its spatial filter off the reference leaves the integral as the search writes
it — two over π, 0.637, on every open surface — and never applies the power or the intensity: the whole picture 36 %
darker and two settings inert; here the method's last pass takes the integral back to one and applies both, as the filter
does.

The occlusion publishes `ambientOcclusion: { method, drawn, bytes, why }` among the frame's metrics: which method ran,
whether the image drew it, the bytes its textures hold and, where the device's memory budget kept the view from being made,
the reason (the view is then asked again only once the budget's room holds it). An agent sets the settings through
`trillion3d_set_ambient_occlusion`.

```js
const world = createWorld({
  canvas,
  ambientOcclusionIntensity: 0.7, // a stronger darkening than the default 0.5
  bounce: false, // the occlusion draws where no global illumination is on
})
world.ambientOcclusion = { ambientOcclusionRadius: 3 } // a wider reach, from the next frame
world.ambientOcclusion = { ambientOcclusionMethod: 'horizon', ambientOcclusionHorizonAngles: 4 } // the horizon search, four directions
world.ambientOcclusion = { ambientOcclusionMethod: 'disc', ambientOcclusionCompute: 1 } // the disc search in one resolution, smoothed
world.ambientOcclusion = { ambientOcclusionRadius: null } // null gives a setting back to the preset
world.quality.preset = 'balanced' // writes the resolutions' ceiling, the climb and the radius scale
world.ambientOcclusion = { ambientOcclusion: false } // off: no pass, no texture, no byte
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'on' } // rays through the scene's triangles in place of the search
world.ambientOcclusion = { rayTracedAmbientOcclusionSamplesPerPixel: 4, rayTracedAmbientOcclusionRadius: 5 } // four rays a pixel, up to 5 m
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'auto', rayTracedAmbientOcclusionEnabled: true } // the post-process volume's way
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'on', rayTracedAmbientOcclusionDenoiser: false } // the raw rays, no denoiser
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'on', rayTracedAmbientOcclusionSamplesPerPixel: 2, rayTracedAmbientOcclusionDenoiserPreConvolution: 3 } // two rays a pixel, three pre-convolutions
```

The explorer takes the same by field (`explorer.setAmbientOcclusion('ambientOcclusionPower', 3)`).

`ambientCubemap` is a light from a cube of the page's, off until the world is given one: a world option, `{ size, texels }`, the
side of a face in texels (a power of two from 16 to 1024) and the six faces' linear colours (`6 · size² · 3` numbers, none negative;
a cube of another form is refused by name at the opening). It is a second source of the indirect light, beside the environment's and
the sky light's: a surface's diffuse colour is lit by the cube read along its normal at the mip where the cube is convolved by the
whole hemisphere, and its specular reflectance by the cube read along its reflection at the mip its roughness picks, weighed by the
same energy terms as the other sources, so the coat, the cloth's fuzz and a thin surface's back take it as they take the
others'. Its settings are `ambientCubemapTintRed`, `ambientCubemapTintGreen` and `ambientCubemapTintBlue` (`1` each, from 0), the
tint, and `ambientCubemapIntensity` (`1`, from 0), the scale that multiplies it; a colour that is black draws nothing, and an image
that sets no cube, or a black one, compiles no code for it and binds no texture. The cube's mip chain is filtered by angle on the GPU,
once for a cube, over the images a budget of texels an image allows (a cube of 16 texels a face in one image, a cube of 1024 in some
tens); the images drawn meanwhile are drawn again and light nothing from the cube. The cube can be changed or taken away while the
world runs: `explorer.setAmbientCubemapCube(cube)` replaces it (its chain is filtered again, the old one freed), `explorer.setAmbientCubemapCube(null)`
takes the light away, and a cube of another form is refused by name. The translucent surfaces take no light from it. An agent sets the
settings through `trillion3d_set_ambient_cubemap`.

```js
const world = createWorld({
  canvas,
  ambientCubemap: { size: 16, texels: new Float32Array(6 * 16 * 16 * 3).fill(0.4) }, // a grey cube
  ambientCubemapIntensity: 2, // twice its light
})
world.ambientCubemap = { ambientCubemapTintBlue: 1.5 } // bluer, from the next frame
world.ambientCubemap = { ambientCubemapIntensity: 0 } // off: no code, no texture
explorer.setAmbientCubemapCube({ size: 16, texels: new Float32Array(6 * 16 * 16 * 3).fill(0.1) }) // another cube, filtered from the next images
explorer.setAmbientCubemapCube(null) // no cube: the light goes, the texture is freed
```

`reflectionCapture` holds the settings of the scene's reflection captures. A capture is an object of the scene
(`explorer.addReflectionCapture`): a place the scene is drawn from through the six faces of a cube, which the surfaces around it read as
the light that comes from far away. Its fields are `id` (unique), `shape` (`'sphere'`, the default, or `'box'`), `matrix` (sixteen numbers,
column-major, metres: the translation is the centre, and for a box the lengths of the columns are its half extents and their directions its axes),
`influenceRadius` (a sphere's radius, `30` m by default, at least `0.08`), `boxTransitionDistance` (`1` m by default: how far inside its faces a box's
cube fades out), `brightness` (`1`, from 0: the factor its light is multiplied by) and `captureOffset` (`[0, 0, 0]`: where the scene is drawn from, relative to the centre).
Inside its shape the cube is read as if the scene it holds were the shape itself (the reflection ray is intersected with the sphere or the box, so a reflection
moves with the viewer), faded toward the shape's edge; where captures overlap the smallest is read first and lets through what it does not cover,
the sky light taking the rest. They light the rough reflection of the opaque surfaces — the share of a lobe that neither the screen nor the scene's rays answer —, composited over the sky light's. Where the reflection ray of the scene is
answered, the capture adds nothing. A capture is drawn between two images, one at a time, and again when its place moves or one of the face settings
changes; `explorer.recaptureReflectionCaptures()` asks them all again. The settings, all run-time: `reflectionCaptures` (`true`; off, none is made or read),
`reflectionCaptureResolution` (`128`, from 16 to 1024, the power of two at or below it), `reflectionCaptureSupersample` (`1`, from 1 to 8),
`reflectionCaptureNearPlane` (`0.05` m), `reflectionCaptureLightFunctions` (`false`), `reflectionCaptureDiffuse` (`false`: the cube's four smallest mips
(1, 2, 4 and 8 texels) hold the capture's diffuse light and the opaque surfaces take their diffuse light from the captures where they reach, in place of the sky light's)
and `reflectionCaptureDiffuseReference` (`true`: that diffuse light is the exhaustive convolution of the cube; `false`, it is evaluated from nine harmonics summed from the cube).
The diffuse light is the mean radiance weighted by the cosine in both ways. The captures hold the sky past the sky light's distance threshold, where a sky light that is not static shines.
The translucent surfaces and the strands take no light from the captures. An agent sets the settings through `trillion3d_set_reflection_capture`.

```js
explorer.addReflectionCapture({ id: 'hall', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 1.5, -2, 1], influenceRadius: 12 }) // a sphere
explorer.addReflectionCapture({ id: 'room', shape: 'box', matrix: [5, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 3, 0, 1], boxTransitionDistance: 2, brightness: 1.5 }) // 10 x 6 x 8 m
explorer.setReflectionCaptureObject('hall', { brightness: 0.8 }) // the records change, no new capture
explorer.setReflectionCapture('reflectionCaptureResolution', 256) // every cube is made again
world.reflectionCapture = { reflectionCaptureDiffuse: true } // the diffuse light of the captures, from the next images
explorer.removeReflectionCapture('hall')
```

A planar reflection is an object of the scene too (`explorer.addPlanarReflection`): a mirror the scene is drawn in again. The scene is drawn from the main
camera reflected across the plane, in a view of its own beside the main one, at a percentage of the main view's size and without temporal jitter, clipped to the viewer's
side of the plane; the opaque surfaces that stand near the plane and face it read that image as their reflection, sharp and exact for a flat floor, water or window, in place
of the screen's and the environment's. The image is blurred along its vertical by a gaussian that grows with the distance of the reflected surface behind the plane
(`prefilterRoughness`), and fades out with the surface's distance to the plane, its distance to the box's edges, the angle of its normal to the plane's and its roughness
(rougher than 0.2 reads none, fully rough than 0.3). Its fields are `id` (unique), `matrix` (sixteen numbers, column-major, metres: the translation is a point of the plane,
the second column its normal, the lengths of the first and third columns the factors of the 20 metres the box reaches along them), `normalDistortionStrength` (`5` m: how far
along the mirrored reflection direction the image is read, so the larger it is the more the surface's normal distorts the image), `prefilterRoughness` (`0.01`, from 0 to 0.04),
`prefilterRoughnessDistance` (`100` m), `screenPercentage` (`50`, from 25 to 100), `extraFov` (`0` degrees, from 0: the image is drawn with a wider field so the distortion does
not read outside it), `distanceFromPlaneFadeoutStart` and `distanceFromPlaneFadeoutEnd` (`0.6` and `1` m), `angleFromPlaneFadeStart` and `angleFromPlaneFadeEnd` (`20` and `30`
degrees) and `hidden` (the objects the mirrored view does not draw, each with everything under it: the water plane itself, usually). The mirrored view is drawn only while the
viewer stands on the side the normal points to and the box meets the view's frustum, and only for a perspective camera. The cut is clipped to the plane only where the world
was made with the project switch `cutClipPlane` on (`createWorld({ cutClipPlane: true })`); without it the image shows what lies under the plane too. The reflections are read by
the opaque surfaces of the main view alone (not by the translucent surfaces, the strands, the water's own reflection or the views `world.addView` draws), and they win over the
screen's, the scene's and the environment's reflection where their fade is whole. The mirrored view is lit by the lights and the sky light, with no traced reflection, light shaft
or effect of its own. The image is drawn before the main view, from the same camera.

```js
// the world is made with createWorld({ cutClipPlane: true }), so the image is clipped to the plane
explorer.addPlanarReflection({
  id: 'lake',
  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 12.4, 0, 1], // the plane y = 12.4, facing up
  prefilterRoughness: 0.02, // blur the image more
  screenPercentage: 75,
  hidden: [lakeSurface], // the mesh of the water, which would hide its own reflection
})
explorer.setPlanarReflection('lake', { normalDistortionStrength: 2 }) // a gentler distortion
explorer.removePlanarReflection('lake')
```

`world.shading` holds the material pass's settings, each an option of `createWorld` too:
`gpuTimingDetail` (`false`, the default: the material pass is one timed pass; `true`: a frame sampled for the GPU timing times its shading bins and each material class's shading as passes of their own, `Trillion3D material bins` and `Trillion3D material shading <class key>` in `gpuPassMs.passes`, the image the same),
`gpuShadeStage` (`0`, the default: the whole shading kernel; `1` to `5`: a diagnostic that stops each class's shading after its binned pixel, its triangle's header and indices, its vertex fetch and transform, its interpolation and derivatives, its material and surface, writing no surface — the image is not the scene's —, each class compiled again; with `gpuTimingDetail`, the difference of two stages' `Trillion3D material shading <class key>` times is the stage's cost),
`shadeBinningMode` (`'auto'`: each material's pixels binned as its shading asks — one by one for
every material of the engine —, `'pixel'` one by one, `'quad'` by 2 × 2 quad), the image the same in
each mode, `toonReflectionQuantization` (`false`, the default: the reflections of a toon surface are smooth; `true`: where the toon profile's `specularIndirectRampRepetition` is above 0, the logarithm of the reflections has its value repeated that many times and the fraction of it read in the profile's `specularIndirectRamp`; the profile's `specularIndirectScale` applies either way), `toonUnifiedDiffuse` (`false`, the default: each light applies the diffuse ramp of a toon surface to its own diffuse light; `true`: each light's draw, with its own shadows, adds its diffuse light unramped, with its weight and the cosine it lit at, to two more targets of the lit image's pass — they exist only while the setting is on and a material is toon —, and a step after the lights applies the ramp once, at the weighted mean cosine, to the sum), `toonProfileResolution` (`64`, the default and the least; up to `512`, rounded up to a multiple of 8: the texels the ramps and the pattern images of the toon profiles are baked at), `shadingRoughDiffuse` (`true`, the default: a lit surface's diffuse light is the energy-preserving rough diffuse of a new project, brighter against the light and darker at grazing views as the roughness grows, a rectangle light's and the indirect light's staying Lambert's; `false`: Lambert's diffuse whatever the roughness), `shadingAccurate` (`true`, the default: the visibility of the lit surfaces' specular lobes is the exact joint Smith term of the GGX lobe; `false`: its approximation), `irisNormal` (`false`, the default: an eye's iris is lit by the direction its `tangent` output gives; `true`: by an iris normal of its own, `clearCoatBottomNormal`) and `clearCoatNormal` (`false`, the default: a clear coat and its base share one normal; `true`: the base keeps the normal of a graph's `clearCoatBottomNormal` output or of a material's normal map, and the coat the `normal` output's or its own normal map's, their difference kept as the reference keeps it, in 8 bits, and the coat's highlight found without the Newton step). A write
names the settings it changes, `null` one's default; a value of another kind is refused by name
([ENGINE.md](../engine/material-surfaces.md#material-surfaces)); changing `irisNormal`, `clearCoatNormal`, `shadingRoughDiffuse` or `shadingAccurate` redraws a still view
from the next frame. `shadingFurnaceTest` (`false`, the default) replaces the lit image, after every light, by the furnace test of the shading, run only where `shadingFurnaceTestEnableForProject` (`false`, the default) is true: at each pixel the light its surface returns toward the eye in a uniform environment of radiance 0.5 (a directional light of 0.5 from every direction sampled), summed over `shadingFurnaceTestSampleCount` samples (`64`, from `16` to `2048`) of each of three distributions (the specular lobe, the cosine hemisphere, the clear coat's lobe) weighed by their power heuristic; an unlit pixel and the background show 0.5. A surface that conserves energy shows 0.5 or less; one that shows more creates light.

```js
const world = createWorld('viewer', { shadeBinningMode: 'pixel' })
world.shading = { shadeBinningMode: 'quad' } // every material binned by quad, next frame
world.shading = { irisNormal: null } // back to the default, false
world.shading = { irisNormal: true } // an eye's iris has the normal of the clearCoatBottomNormal output
world.shading = { gpuTimingDetail: true } // the material pass's bins and each class timed apart, next sampled frame
world.shading = { gpuShadeStage: 3 } // each class's shading stops after its vertex fetch and transform, next frames
world.shading = { clearCoatNormal: true } // a clear coat keeps the clearCoatBottomNormal output as its base's normal
world.shading = { shadingRoughDiffuse: false } // Lambert's diffuse everywhere, whatever the roughness
world.shading = { shadingAccurate: false } // the approximate specular visibility, a mobile project's
world.shading = { toonReflectionQuantization: true } // the toon reflections quantised by their profile's specularIndirectRamp, where its repetition is above 0
world.shading = { toonUnifiedDiffuse: true } // the toon diffuse ramp applied once to the sum of the lights, so overlapping lights give one set of bands
world.shading = { toonProfileResolution: 128 } // the toon ramps and pattern images baked at 128 texels, finer bands and patterns
world.shading = { shadingFurnaceTestEnableForProject: true, shadingFurnaceTest: true } // the furnace test: each lit pixel shows the light its surface returns in a uniform environment of radiance 0.5
world.shading = { shadingFurnaceTestSampleCount: 256 } // 256 samples of each of the three distributions at each pixel, less noise
```

`world.exposureSettings` holds the automatic exposure's settings, each an option of `createWorld`
too: `exposureBias` (`1`, stops added to the target: the mean lands at 0.18 · 2^bias before the
curve), `exposureMinBrightness` (`-10`) and `exposureMaxBrightness` (`20`), the range of the mean in
EV100 (the same value for both fixes the exposure), `exposureHistogramLogMin` (`-10`) and
`exposureHistogramLogMax` (`20`), the stops of luminance the histogram spans, `exposureLowPercent`
(`10`) and `exposureHighPercent` (`90`), from 1 to 99, the shares of the pixels, darkest first, left
out of the mean, `exposureSpeedUp` (`3`) and `exposureSpeedDown` (`1`) in stops a second (0 holds),
`exposureTransitionDistance` (`1.5` stops, past which the exposure moves linearly),
`exposureBlackBucketWeight` (`0`, from 0 to 1: how much the pixels of no light count) and
`exposureLuminanceMethod` (`'uniform'`, the mean of the channels; `'ntsc'`; `'workingSpace'`),
`exposureMethod` (`'histogram'`, the default; `'basic'`, the weighted mean of the log luminance of the image's cells, a
cheaper measure; `'manual'`, no measure: the camera's exposure), `exposureApplyPhysicalCamera` (`true`: where the method
is manual, the aperture — the depth of field's, f/4 by default —, `exposureCameraShutterSpeed` (`60`, in 1/s, from 0.01 to 8000) and `exposureCameraIso` (`100`, from 1) set the exposure, EV100 = `log2(aperture² · shutter speed · 100 / ISO)`;
`false` reads the camera as EV100 0 and the bias alone sets it) and `exposureLensAttenuation` (`0.78`, from 0.01: 0.78
makes lighting unitless, a luminance of 1 being EV100 0; a lower one raises the luminance every EV100 is read from).
They apply where `world.exposure` is `'auto'`, from the next frame; the exposure adapts on the world's time, so a world
that holds still does not move it. The metering mask, `exposureMeterMask` (an `ImageBitmap`, read at the opening;
`explorer.setExposureMeterMask(image)` changes it, `null` gives it back), weighs where the image is measured by its red
channel. A manual exposure that does not change costs the GPU nothing. The same object holds the
pre-exposure's three settings, which apply to a lit view whatever its exposure: `preExposure` (`true`:
every light is written to the image already multiplied by the exposure of the image before, and the
composition multiplies the image by the exposure over that number, so the picture is the same and
the half floats keep their range at any exposure; `false` writes every light as it is) and
`preExposureOverride` (`0`: above 0, the number every light is multiplied by, in place of the
exposure of the image before) and `cachedLightingPreExposure` (`4`, from −16 to 16: the stops the
sky light's real-time capture is pre-exposed by, whatever the exposure — it is written multiplied by
2 to the minus that number and read back multiplied by its inverse, so its half floats keep their
range from about −8 to +12 stops of exposure at 4, −4 to +16 at 8; read with `preExposure` on or
off). It also holds the local exposure's settings, `localExposure…`, which
apply to a lit view whatever its exposure (the effect chain, below). A write names the settings it changes, `null` one's default; a value a setting does
not take is refused by name.

The exposure's compensation curve, `exposureCurve` (an option of `createWorld` and of the explorer,
read at the opening; `explorer.setExposureCurve(curve)` changes it, `null` or `false` gives it back),
adds stops to the target by how bright the scene is: a list of keys `[ev, compensation]`, an EV100
(the mean luminance over middle grey, one stop a doubling) and the stops added there (0 none, -1
twice as dark, 1 twice as bright), linear between keys; or `{ keys, before, after }` for the
extrapolations (`'constant'` by default; `'cycle'`, `'cycleWithOffset'`, `'oscillate'`, `'linear'`,
`'none'`), a key an object `{ ev, compensation, interpolation, tangentMode, arriveTangent,
leaveTangent, … }` for a `'constant'` or `'cubic'` run. It is baked into 64 samples over EV100 -10 to
+20. None by default: the image is the same. A curve is replaced, not edited in place, and one that
is not a curve is refused by name.

```js
const world = createWorld('viewer', {
  exposureCurve: [
    [-4, 1],
    [0, 0],
    [8, -1],
  ],
})
explorer.setExposureCurve({
  keys: [
    [0, 0.5],
    [10, -0.5],
  ],
  after: 'linear',
})
explorer.setExposureCurve(null) // no compensation
```

The local exposure's contrast curves, `localExposureHighlightContrastCurve` and
`localExposureShadowContrastCurve` (options of `createWorld` and of the explorer;
`explorer.setLocalExposureHighlightContrastCurve(curve)` and
`explorer.setLocalExposureShadowContrastCurve(curve)` change them, `null` or `false` gives them
back), take the same keys `[ev, scale]` as the compensation curve, but the value of a key is a scale
the highlights' or the shadows' contrast (`localExposureHighlightContrast`,
`localExposureShadowContrast`) is multiplied by, read at the EV100 of the frame's mean luminance as
the compensation curve is. A curve set makes the local exposure run whatever the contrasts. None by
default: the contrasts are used as they are.

```js
const world = createWorld('viewer', {
  localExposureHighlightContrastCurve: [
    [0, 1],
    [8, 0.5], // a bright scene gets half the highlight contrast
  ],
})
explorer.setLocalExposureShadowContrastCurve({
  keys: [
    [-2, 1.5],
    [6, 1],
  ],
})
explorer.setLocalExposureShadowContrastCurve(null) // back to the setting alone
```

```js
const world = createWorld('viewer', { exposureBias: 0.5 })
world.exposure = 'auto' // the default: measured each frame
world.exposureSettings = { exposureSpeedUp: 8, exposureSpeedDown: 4 } // adapts faster, next frame
world.exposureSettings = { preExposure: false } // every light written as it is, the same picture
world.exposure = 1.5 // a fixed exposure, whatever the image holds
```

```js
const world = createWorld('viewer', {
  exposureMeterMask: await loader.imageBitmap('centre-weighted.png'),
})
world.exposureSettings = { exposureMethod: 'basic' } // the cheaper measure, weighed by the mask
explorer.setExposureMeterMask(null) // every pixel counts the same again
// The camera's exposure: no measure — f/2.8, 1/125 s, ISO 400, no bias.
world.effects.add(effect.depthOfField({ aperture: 2.8 }))
world.exposureSettings = {
  exposureMethod: 'manual',
  exposureCameraShutterSpeed: 125,
  exposureCameraIso: 400,
  exposureBias: 0,
}
world.exposure = 0.25 // a fixed exposure: the radiance multiplied by it, the bias and the camera ignored
```

`world.renderScale` (option of `createWorld` too, `'auto'` by default) is the per-axis fraction of
the display drawn before temporal antialiasing rebuilds the image: `'auto'` is a dynamic
resolution, choosing between 0.5 and 1 from the GPU frame time against the frame time budget
(`dynamicResolutionFrameTimeBudgetMs`, 33.3 ms by default, the frame cap's interval where it is 0);
without GPU timestamps it stays at 1. `{ min, max }` bounds it, a number fixes it. A read is the
last image's scale. Without temporal antialiasing the scale is chosen the same way and the image
upscaled to the display by a Catmull-Rom cubic over the drawn pixels. The same
history also fits the cut's GPU time budget (`cutEdgeScaleBudgetMs`), when the host gives one.

`world.dynamicResolution` holds the eleven settings that tune that fit, each an option of
`createWorld` too, `explorer.setDynamicResolution(field, value)` and the tool
`trillion3d_set_dynamic_resolution` writing them from the next GPU time: the frame time budget
(`dynamicResolutionFrameTimeBudgetMs`, `33.3`), the most the scale may be
(`dynamicResolutionThrottlingMaxPercent`, `0`, none), the headrooms
(`dynamicResolutionHeadroomPercent`, `10`, and `dynamicResolutionOverBudgetHeadroomPercent`, `0`),
the history (`dynamicResolutionHistorySize`, `16`, a whole number from 1 to 4096, and
`dynamicResolutionFrameWeightExponent`, `0.9`), the change period (`dynamicResolutionChangePeriod`,
`8`), how far a rise goes (`dynamicResolutionIncreaseAmortization`, `0.9`), the change under which
the scale does not move (`dynamicResolutionChangePercentThreshold`, `2`), the frames in a row over
the budget that count (`dynamicResolutionMaxOverBudgetFrames`, `2`) and whether a frame the CPU
took too long is not over budget by its GPU time (`dynamicResolutionUseCpuTimeLogic`, `false`).
None is written by a quality level; where the render scale is a number, none does anything
([ENGINE.md](../engine/temporal-antialiasing.md#dynamic-resolution)).

```js
const world = createWorld('viewer', { renderScale: 'auto', maxFrameRate: 60 })
world.dynamicResolution = {
  dynamicResolutionFrameTimeBudgetMs: 12,
  dynamicResolutionHeadroomPercent: 20,
}
world.dynamicResolution = { dynamicResolutionHeadroomPercent: null } // back to the default 10
```

`world.maxFrameRate` (option of `createWorld` too, `Infinity` by default) caps the frames a second
the world draws, even while its scene moves: the loop draws on a whole number of
refreshes, the fastest rate at or under the cap (12: every 5th refresh at 60 Hz, every 10th at
120 Hz), so each image is shown for the same time; the refreshes between draw and count nothing, and
the `'auto'` render scale fits each image to the time the cap gives it. A write applies from
the next frame; a page of several worlds caps those out of focus.

`world.effects` is the ordered chain of passes after temporal antialiasing, before the canvas.
A world starts with a bloom in its chain, `effect.bloom()` at its defaults: six Gaussian blurs of
the linear image at six scales, added to it before the exposure and the curve, in a view lit by
declared lamps — about 9 percent of the light at the default `intensity` of `0.675`. Remove it
(`world.effects.clear()`) or set its `intensity` to 0 for an image without. `effect.bloom({ intensity,
threshold, sizeScale, levels })`: `threshold` (`-1` by default, every pixel glows) the exposed
luminance past which a pixel glows; `sizeScale` (`4`) the multiplier of every level's width;
`levels` the six levels' `{ size, tint }`, finest first — `size` a percent of the level's width (`0.3`,
`1`, `2`, `10`, `30`, `64`; 0 leaves the level out), `tint` a number or `[r, g, b]` (`0.3465`,
`0.138`, `0.1176`, `0.066`, `0.066`, `0.061`). `world.vignette` (`0.4`; 0 none) darkens the
lit image toward its corners, and the local exposure — `localExposureHighlightContrast` and
`localExposureShadowContrast` (`0.8`), `localExposureDetailStrength` (`1`), `localExposureBlurBlend`
(`0.6`), `localExposureBlurSize` (`50`), `localExposureMiddleGreyBias` (`0`), the two thresholds
(`0`) and their strengths (`1`), in `world.exposureSettings` — brings each pixel's light nearer to
middle grey by how far the light around it is from it. It is on by default, as in a new project; `1` for both contrasts with a detail of `1` turns it off.

```js
const [bloom] = world.effects.passes // the bloom the world started with
bloom.intensity = 0.3 // a fainter glow; 0 turns it off, `world.effects.clear()` removes it
world.vignette = 0.2 // a lighter vignette; 0 none
world.exposureSettings = { localExposureHighlightContrast: 1, localExposureShadowContrast: 1 } // local exposure off
```

**Film effects.** The lit image of a view is finished with the effects of a lens and a film, after the exposure and before
the curve. `world.vignette` (`0.4`) is the strength of the vignette; the rest of its look, and the other effects, are the
run-time settings `world.film` — also options of `createWorld`, and `explorer.setFilm(field, value)` on a session; an
agent sets them through `trillion3d_set_film`. Each has the reference's default, so with nothing written the vignette and
the dither are on and the grain, the colour fringe and the tint are off. A write applies from the next frame; `null` gives
a setting back to its default or to the quality level's. The effects draw in the lit image only: a view that shows the
albedo, a diagnostic view and a capture show the image as it is.

| Setting                                                                                   | Default                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filmGrainIntensity`                                                                      | `0`                    | The film grain's strength; 0 draws none. The grain multiplies the exposed light by a noise of mean 1, so the image keeps its average brightness.                                                                                                                                                                                                                                                                                               |
| `filmGrainIntensityShadows`, `filmGrainIntensityMidtones`, `filmGrainIntensityHighlights` | `1` each               | The share of the grain in the dark, middle and bright pixels; all three at 0 draw none.                                                                                                                                                                                                                                                                                                                                                        |
| `filmGrainShadowsMax`                                                                     | `0.09`                 | The luminance up to which a pixel is dark: the dark share fades out to nothing there.                                                                                                                                                                                                                                                                                                                                                          |
| `filmGrainHighlightsMin`, `filmGrainHighlightsMax`                                        | `0.5`, `1`             | The luminances from which a pixel starts to be bright and from which it is wholly so.                                                                                                                                                                                                                                                                                                                                                          |
| `filmGrainScaleX`, `filmGrainScaleY`                                                      | `1`                    | The size of a grain along each axis: 1 is a texel of one pixel on an image 1920 wide, and the grain grows with the image.                                                                                                                                                                                                                                                                                                                      |
| `filmGrainSequenceLength`                                                                 | `97`                   | The images after which the grain's pattern repeats.                                                                                                                                                                                                                                                                                                                                                                                            |
| `chromaticAberration`                                                                     | `0`                    | The colour fringe's intensity, in percent of the distance to the centre. The red and the green of a pixel are read nearer the centre than its blue, by their wavelengths. 0.01 or less draws nothing.                                                                                                                                                                                                                                          |
| `chromaticAberrationStartOffset`                                                          | `0`                    | The distance from the centre, 0 to 1, where the fringe starts; 1 draws nothing.                                                                                                                                                                                                                                                                                                                                                                |
| `chromaticAberrationQuality`                                                              | `'high'`               | `'off'` draws no fringe whatever its intensity.                                                                                                                                                                                                                                                                                                                                                                                                |
| `chromaticAberrationMax`                                                                  | `-1`                   | −1 leaves the intensity as it is, 0 or more caps it there, −2 forces an extreme one (5).                                                                                                                                                                                                                                                                                                                                                       |
| `vignetteType`                                                                            | `'cosineFourthLaw'`    | The shape: the cosine-fourth law of a lens, or `'oval'`.                                                                                                                                                                                                                                                                                                                                                                                       |
| `vignetteColorRed`, `vignetteColorGreen`, `vignetteColorBlue`                             | `0`                    | The colour the image darkens toward (black).                                                                                                                                                                                                                                                                                                                                                                                                   |
| `vignetteCenterX`, `vignetteCenterY`                                                      | `0.5`                  | Where it is brightest; 0.5 is the middle.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `vignetteSizeX`, `vignetteSizeY`, `vignetteSoftness`                                      | `1`, `1`, `5`          | The oval's extent and how fast it falls to the colour.                                                                                                                                                                                                                                                                                                                                                                                         |
| `tonemapperQuality`                                                                       | `5`                    | 0 to 5: under 2 the vignette is off, under 4 the grain is. The quality levels write 0 at `'smooth'`, 2 at `'balanced'` and 5 at `'fine'` and `'cinematic'`.                                                                                                                                                                                                                                                                                    |
| `tonemapperSharpen`                                                                       | `-1`                   | Below 0 the scene's `sharpness`; 0 or more replaces it. Both are read from 0 to 10.                                                                                                                                                                                                                                                                                                                                                            |
| `sceneColorTintRed`, `sceneColorTintGreen`, `sceneColorTintBlue`                          | `1`                    | The tint the scene's colour is multiplied by; the bloom's glow is not tinted.                                                                                                                                                                                                                                                                                                                                                                  |
| `quantizationDitheringBits`                                                               | `0`                    | The dither that hides the display's steps: a triangular noise of one level of the display's channel added to the colour shown, always drawn, with a new pattern at each image drawn. 0 or less takes the step from the target (1/255 for an 8-bit one); a number of bits, any whole number, makes it 1/(2^bits − 1), 32 too small to show.                                                                                                     |
| `propagateAlpha`                                                                          | `false`                | Whether the image carries an alpha channel. Off, the colour is shown opaque and the alpha is read by nothing. On, the alpha is the share of the background the image leaves visible, an inverse opacity: 1 where nothing is drawn, 0 on a surface, multiplied by the transmittance of the sky, the fog, the clouds and the translucent layers; the post stages read the colour as it is and carry the alpha beside it, and a capture holds it. |
| `primitiveAlphaHoldout`                                                                   | `false`                | Whether the engine supports the alpha holdout. It takes effect only with `propagateAlpha` on: the translucent layers are then drawn once more, far to near, to accumulate the share of the background they leave visible, which replaces the image's alpha, so a layer of blending `'alphaHoldout'`, or a sky, clouds or height fog that holds out (`holdout`), punches a hole in it.                                                          |
| `translucencyHoldoutLocation`                                                             | `'beforeDepthOfField'` | Where the accumulated alpha is laid over the image: `'beforeDepthOfField'`, with the translucent layers, or `'afterDepthOfField'`, only where a layer left something, once the depth of field has drawn.                                                                                                                                                                                                                                       |

```js
world.film = { filmGrainIntensity: 0.3, filmGrainScaleX: 1.5, filmGrainScaleY: 1.5 } // a coarser grain
world.film = { chromaticAberration: 2, chromaticAberrationStartOffset: 0.3 } // a fringe from a third of the way out
world.film = {
  vignetteType: 'oval',
  vignetteSizeX: 1.4,
  vignetteSoftness: 3,
  vignetteColorBlue: 0.04,
}
world.film = { tonemapperSharpen: 1 } // sharpen whatever the scene says; `null` gives the scene's back
world.film = { quantizationDitheringBits: 32 } // no visible dither: bit-exact captures
world.film = { propagateAlpha: true } // a capture carries the share of the background left visible (1 − opacity) in its alpha, for compositing
world.film = { propagateAlpha: true, primitiveAlphaHoldout: true } // holes in the alpha where a layer, the sky, the clouds or the fog hold out
const world = await createWorld(canvas, { filmGrainIntensity: 0.3 }) // as an option
```

The scene's own `sharpness` (the `environment` of the scene) is read from 0, none, to 10; 1 is a unit-gain sharpening and
0, the default, draws none. The dither is on by default: at one level of an 8-bit display, 1/255, its noise changes no
pixel by more than one level. The grain's pattern changes with each image: a view whose grain is drawn is drawn again at
every image, at rest too. The dither's pattern changes with each image that is drawn; a view at rest, which is not drawn
again, keeps the pattern of its last image — the held image is 8 bits, and a new noise added to it averages, over the
images, to the held image and not to the light; to draw every image at rest, as the reference does, open the session with
`drawConverged: true`.

**Colour grading.** The display turns the exposed light into the colour it shows through one table, baked from the scene's
display curve and these settings, `world.colorGrading` — also options of `createWorld`,
`explorer.setColorGrading(field, value)`, and the tool `trillion3d_set_color_grading`. A write applies from the next frame
and bakes the table again; `null` gives the default back. With nothing written the colour is the film curve's own: no white
balance, no grade. The film curve's own settings, its expansion of a bright colour's gamut, its blue correction and its
amount shape the curve the scene gets by default (`toneMapping: 'filmic'`); the white balance, the grade, the correction,
the display's gamma and the table apply to every curve but `'none'`. The translucent layers and the particles drawn over a
display filter show their colours through the same chain, so a grade, a white balance or a transfer moves them with the
scene under them. The scene's `toneMapping: 'filmic'` has two methods, `tonemappingMethod`: the film curve, and the
standard output transform of the film industry's colour system, in two versions (`acesVersion`). The scene's curve is
`'filmic'` or `'none'`, and no other.

| Setting                                                                                     | Default                             | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tonemappingMethod`                                                                         | `'filmic'`                          | How the scene's `'filmic'` display curve turns the light into colour: `'filmic'`, the film curve; `'standardAces'`, the standard output transform of the film industry's colour system. The film curve's settings below, the blue correction, the correction's polynomial and the display gamma's ratio do not shape it; the expansion of the gamut, the white balance and the grade do.                                                                                                                                                                                                                                                                                                                                                                            |
| `acesVersion`                                                                               | `2`                                 | 1 or 2: the version of the standard output transform. 2 is a model of the colour's lightness, colourfulness and hue, whose tone scale is fitted to a 100-nit display, whose colourfulness is compressed with the lightness and whose colours outside the display's gamut are pulled in along lines of constant hue; 1 is the earlier one, which works on the three channels — a glow on dark saturated colours, a pull of the reds by hue, a desaturation and a tone scale of a display of 1000 nits, of which the 100 an sRGB display shows are kept: **its picture is much brighter** (a neutral light of 0.18 is shown 0.26 in linear display light against version 2's 0.16). Only `'standardAces'` reads it, and `applyColorGrading: false` does not reset it. |
| `acesGamutCompression`                                                                      | `0`                                 | From 0 to 1: the share of a compression of the colours past the gamut's edge that version 1 applies first; 0 applies none. Version 2 does not read it, and `applyColorGrading: false` does not reset it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `acesSceneColorMultiplier`                                                                  | `1.5`                               | From 0: the factor the light is multiplied by before the standard output transform; only `'standardAces'` reads it, and `applyColorGrading: false` does not reset it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `filmSlope`, `filmToe`, `filmShoulder`, `filmBlackClip`, `filmWhiteClip`                    | `0.88`, `0.55`, `0.26`, `0`, `0.04` | The film curve: the straight run's slope in log luminance (any number but 0, which divides by it), how much of the range the toe (dark end) and the shoulder (bright end) bend over, and how far the black and the white are lifted. A toe above 0.8 puts middle grey on the straight run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `blueCorrection`                                                                            | `0.6`                               | 0 to 1: how far saturated blues are pulled toward the centre of the working gamut before the curve and given back after it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `expandGamut`                                                                               | `1`                                 | From 0: how far a bright, saturated colour is carried toward a wider gamut before the curve; 0 expands none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `toneCurveAmount`                                                                           | `1`                                 | From 0: how much of the curve is mixed into the colour; 0, with `expandGamut` 0, takes the curve away.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `temperatureType`                                                                           | `'whiteBalance'`                    | How the next two are read: `'whiteBalance'`, the white the scene was lit by, which is taken to white; `'colorTemperature'`, the colour of the light the image is turned toward.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `whiteTemperature`, `whiteTint`                                                             | `6500`, `0`                         | The white balance's temperature in kelvins and tint, −1 green to 1 magenta; 6500 and 0 leave the light as it is. Any number: the chain stays finite for every temperature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `colorSaturation…`, `colorContrast…`, `colorGamma…`, `colorGain…`, `colorOffset…`           | `1` (offset `0`)                    | The grade: five operations, each four numbers — `Red`, `Green`, `Blue` and `Master`, the one the three share — for all the light (`colorGainRed`), for its dark part (`colorGainShadowsRed`), its middle (`colorGainMidtonesRed`) and its bright part (`colorGainHighlightsRed`), which apply over the whole light's: 80 settings. A saturation of 1 leaves the colour, 0 takes it to its luminance; a contrast is the power about middle grey (0.18); a gamma the power 1 over it; a gain multiplies; an offset adds after the gain.                                                                                                                                                                                                                               |
| `colorCorrectionShadowsMax`, `colorCorrectionHighlightsMin`, `colorCorrectionHighlightsMax` | `0.09`, `0.5`, `1`                  | Where the dark part ends, and where the bright part starts and is whole; the middle is what is left of both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `colorMin`, `colorMid`, `colorMax`                                                          | `0`, `0.5`, `1`                     | The correction of the colour the film curve gives, each from −10 to 10: the polynomial through 0 → min, 0.5 → mid, 1 → max, in linear light. The defaults are the identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `applyColorGrading`                                                                         | `true`                              | `false` reads the white balance, the grade, the film curve's settings, the method and the bounds of the parts at their defaults, whatever was written; the correction, the display's gamma and transfer, the multiplier, version and gamut compression of the standard output transform and the table keep their values.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `displayGamma`                                                                              | `2.2`                               | The gamma the display is taken to have; its ratio to 2.2 is a power on the film curve's colour. 2.2 changes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tonemapperGamma`                                                                           | `0`                                 | 0 keeps the transfer; a number above 1 shows the colour through that gamma in place of the transfer (2.2 is the pure gamma some displays take); a number under 1 is read as 1: no transfer at all, the linear light as the display value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sdrInverseEotf`                                                                            | `'default'`                         | The transfer to the display value: `'default'`, the method's own — the sRGB curve for the film curve, the power 2.4 for `'standardAces'` —, `'srgb'`, or `'bt1886'`, the power 2.4 of a studio display.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `lutSize`                                                                                   | `32`                                | The texels a side of the cube the colour is baked into, from 2, with no other limit than the largest 3D texture the device makes (the cube is baked at that side) and the device's memory budget, which admits the cube (4 bytes a texel, 8 where the device has no storage textures of a 10-bit format: 128 KiB at 32, 1 MiB at 64, 64 MiB at 256, twice that without): where the budget's room holds fewer texels the cube is the largest side it holds, never a refusal, and the frame's metrics say so (`toneTable: { side, bytes, why }`). A larger cube follows the curve more closely (at 32 its mean difference from the exact curve is a fifth of one display level, at 64 a twentieth) and costs more to bake.                                            |
| `lutShaper`                                                                                 | `'log'`                             | How a light addresses the cube: by its logarithm over 14 stops, or `'pq'`, the perceptual quantizer of a high-range display (100 times the light, in nits).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

```js
world.colorGrading = { whiteTemperature: 4800, whiteTint: 0.1 } // warm the cold light of a scene
world.colorGrading = { colorSaturationMaster: 1.2, colorContrastMaster: 1.1 } // a richer image
world.colorGrading = { colorGainShadowsBlue: 1.15, colorGainHighlightsRed: 1.05 } // blue shadows, warm highlights
world.colorGrading = { filmSlope: 0.91, filmToe: 0.53, filmShoulder: 0.23, filmWhiteClip: 0.035 } // another film
world.colorGrading = { applyColorGrading: false } // the defaults of the whole grade, keeping the table
world.colorGrading = { tonemappingMethod: 'standardAces' } // the standard output transform, shown through the power 2.4
world.colorGrading = {
  tonemappingMethod: 'standardAces',
  sdrInverseEotf: 'srgb',
  acesSceneColorMultiplier: 1.2,
}
world.colorGrading = {
  tonemappingMethod: 'standardAces',
  acesVersion: 1,
  acesGamutCompression: 0.5,
} // the earlier version, half compressed
world.colorGrading = { colorSaturationMaster: 0 } // a monochrome scene: its tinted glass and its sparks are monochrome too
const world = await createWorld(canvas, { lutSize: 64, colorMin: 0.01 }) // as options
```

`effect.outline({ objects, color, thickness })` lines the visible silhouette of `objects`, each
with its subtree — a runtime mesh or a loaded model's node, at whatever detail is drawn —, over the
display image after tone mapping, so `color` (`#ff9f1c` by default) shows as written; `thickness`
(`2` by default, up to `32`) is in CSS pixels. What hides a selected object hides its line.
`outline.objects = [...]`, `outline.color.set(...)` and `outline.thickness` show next frame; with no
object, no pass runs and nothing is allocated.
`world.effects.add(pass, index?)`, `remove(pass)` and `clear()` change the chain; settings show next
frame. An empty chain costs nothing; a still image is post-processed once.

`world.addView({ canvas | viewport, camera?, renderScale?, temporalAntialiasing?, maxFrameRate? })`
draws the same world from another camera — into a canvas of its own (a canvas, an element to draw
in, or the ID of either), or over a `viewport` rectangle of the world's canvas, CSS pixels —, one
of the two, else `INVALID_VIEW`. A view shares everything no camera changes: the scene, its
placements, the pages and their pools, the materials, the shadow pool (each view keeps the clipmap
of a sun centred on its own eye; the local lights' maps and the pages rendered are shared), the
physics and the clips, so it costs no second scene, upload or simulation. It owns what a camera
changes: its cut, visibility and occlusion pyramid, lighting resolve, temporal history and effects.
Each frame of the world draws its own camera, then every view due, in the order added, in one loop
and one budget: `'auto'` render scales fit the whole frame, every view's GPU time in it, to the
refresh. `camera` is a perspective camera of its own by default; `renderScale` (`'auto'`),
`temporalAntialiasing` (`true`) and `maxFrameRate` (`Infinity`: every frame of the world) read as
the world's own, and are written on the returned `WorldView` from its next image, as are `camera`
and `viewport`. `view.onFrame(({ delta, metrics }) => …)` runs after each frame that drew it;
`metrics` (`ViewFrameMetrics`) carries its GPU time, passes, drawn size and scale, triangles and
target bytes, and the world's frame lists the views it drew in `metrics.views`. `view.dispose()`
takes it out, keeping a canvas the page gave it; `world.views` lists them, and `world.dispose()`
takes them all. Pages showing one scene several times (camera walls, stereo, plan views) add views;
separate worlds remain for different scenes or looks.

Dispose in the page's teardown, **not right after startup**: `world.dispose()` removes owned
controls, observers, queued frames and abort listeners and closes the engine, keeping the canvas.
`createJob` wraps `scene.load(url, { signal, onProgress })` for cancellation and an observable
status.

`world.textureFiltering` holds the settings of the anisotropic filtering, each an option of
`createWorld` too: the most reads a texture takes along the longer axis of its footprint. A texture
that asks for less (`Texture.anisotropy`, 8 for a new one; the `maximum` detail asks 16) keeps its
own; one that asks for more is held to the ceiling. A write names the settings it changes, `null`
one's default; a value of another kind is refused by name. They are render settings of the textures
group: the quality presets write them (below), the page's value holds over a preset, and a write
applies from the next image.

| Setting                              | Takes                                                                                                                                                                                                                                                                                                                                                                                                                               | Default |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `textureMaxAnisotropy`               | A whole number from 1 to 16: the ceiling of the sampler the clouds' textures, the only ones not streamed by tile, are read through; `1` turns their anisotropic filtering off                                                                                                                                                                                                                                                       | `8`     |
| `virtualTextureMaxAnisotropy`        | A whole number from 1 to 16, held to the power of two at or below it: the ceiling of the reads and of the tile requests of every map of a material; a lower one reads fewer taps                                                                                                                                                                                                                                                    | `8`     |
| `virtualTextureAnisotropicFiltering` | `true` / `false`: `false` reads a streamed texture ONCE per sample, at the level of the footprint's longer axis moved toward the shorter by the elongation (up to the ceiling's logarithm), picked among the two levels it straddles by a per-pixel, per-image noise, the tiles asked being that level's; `true` takes as many taps along the footprint as the elongation asks, up to the ceiling. The same at every quality preset | `false` |

| Quality preset                | `smooth` | `balanced` | `fine` | `max` | `cinematic` |
| ----------------------------- | -------- | ---------- | ------ | ----- | ----------- |
| `textureMaxAnisotropy`        | `1`      | `2`        | `4`    | `8`   | `8`         |
| `virtualTextureMaxAnisotropy` | `4`      | `4`        | `8`    | `8`   | `8`         |

The streamed textures' ceiling bounds what a pixel asks to stream as much as what it reads: a surface
seen at a grazing angle is read at a coarser level when the ceiling is low, and asks for fewer
tiles. The headers of the textures are written again when it moves; the clouds' textures' sampler is
made again.

```js
const world = createWorld('viewer', { virtualTextureMaxAnisotropy: 4 })
world.textureFiltering = { virtualTextureMaxAnisotropy: 16 } // sharper at a slant, from the next image
world.textureFiltering = { textureMaxAnisotropy: 1 } // the clouds' textures read isotropic
world.textureFiltering = { virtualTextureAnisotropicFiltering: true } // taps along the footprint, as many as the elongation asks
world.textureFiltering = { virtualTextureMaxAnisotropy: null, textureMaxAnisotropy: null } // defaults
```

The explorer's tool `trillion3d_set_texture_filtering` writes one setting at a time (`field`, `value`).

- [Camera controllers](canvas-camera-and-teardown/camera-controllers.md)
- [Picking, moving and saving](canvas-camera-and-teardown/picking-moving-and-saving.md)
- [Live material values](canvas-camera-and-teardown/live-material-values.md)
- [Geometry rewritten every frame](canvas-camera-and-teardown/geometry-rewritten-every-frame.md)
- [Particles: emitters spawning with the world's frames](canvas-camera-and-teardown/particles-emitters-spawning-with-the-worlds-frames.md)
- [Guides: lines, points and helpers over the image](canvas-camera-and-teardown/guides-lines-points-and-helpers-over-the-image.md)
