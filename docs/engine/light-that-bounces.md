# Light that bounces

Dynamic, on by default (`bounce: false` turns it off): the world's probes hold a radiance cache, a map of the light by direction
in each, traced through the global distance field with the light the surface cache holds where a ray meets a surface
(`bounce/cache/`, `bounce/probeRayWgsl.ts`, `lighting/surfaceCache/hitWgsl.ts`), a budget of probes a frame
(the level's `radianceProbeBudget` times `screenProbeUpdateSpeed`, `bounce/`). The screen probes read it for the rays the screen and the near scene did not answer, and
light the pixels (below); no other grid of rays is traced for the world. The light of a hit is the cache's final lighting, which holds the direct light of
the declared lights, their shadows traced through the field, the sky and the cache's own radiosity: no probe lights a surface
itself, and no ray of the bounce walks a list of lights or casts a shadow ray of its own.

**Where the probes are.** Four levels of probes, each a cube of 48 cells a side centred on the eye and
snapped to its own cells: the first reaches 25 m, its cell 1.04 m, and each next level twice as far,
its cell twice as wide — 2.08, 4.17, 8.33 m (`cascadeLevels`, `cascadeSize`, `cascadeHalfExtentMetres`,
`cascadeBase`, `sdk-core/src/bounce/cascades.ts`). The cells never depend on the scene: a 20 m street is
twenty cells across wherever it lies and however large the district is, where a grid laid on the whole
extent made its cell a fraction of it. A level slides by whole cells with the eye. Beyond the last level,
the sky light answers (below).

**Probes only where the image reads.** A level holds 110 592 cells, the four 442 368; a probe is made
only for a cell the image reads, from a pool of 16 384 (`probePool`), all of it on the GPU, none of it read back to be
decided (`bounce/pool/`). An image that casts screen probes marks from their points once it placed them — the uniform
ones, one a tile, and the adaptive ones placed (`bounce/pool/poolMarkWgsl.ts`, `markProbes`) —: the pool's pass waits for
the placement, which also asks the probes of their pixels (`screenData`) (`frame/render/preLight.ts`: `placeScreenProbes`, `encodeQueuedBounce`, then `traceScreenProbes`), so the radiance cache's
update that follows fills every cell the probes read before they read it, however far the view moved. Each image that marks
finds for each point the finest level that holds it — the rule the lit passes read the field by, the point itself, never pushed
off its surface; where two levels share the answer, a noise picked per pixel and per frame marks both in turn — and sets a bit for each of the eight probes
around it; sky marks nothing.
An image that casts none marks from the points the last image cast; where that one cast none either, a thread takes a pixel of the
image downsampled by `screenProbeInterpolateDownsampleFactor` (2) and then by `screenProbeMarkDownsampleFactor` (2), one of a
four-rooks pattern that turns with the frame, and reads the surface there (`markImage`). In the same pass
(`bounce/pool/poolWgsl.ts`, the kernels in the order they run: `clearIndirection`, the marks, `updateProbes`, `clearWork`, `allocateProbes`, then the choice of the
probes to trace and the arguments of the dispatches over them) a probe whose cell left its level when the level slid is given back, so is one nothing read for
`screenProbeRadianceCacheFramesToKeepProbes` frames (8 by default), and a cell marked with no probe takes
one from the stack of free slots, a cell marked again keeps its own; the probes given back come first, so a full pool
gives before it takes. A pool with none left refuses a mark: that cell goes
unanswered, and the next level or the sky light answers for it (`refusedMarks` in the diagnostic). Only a few counters
come back to the CPU, a few images late, through the readback ring (`bounce/pool/pool.ts`, no frame waits): the
probes alive, those holding nothing yet or not traced since the lights last changed, the marks refused, the probes queued and the cells
marked; the series stays open while any are, which is all the CPU needs of the pool.

A full update (`bounce/pool/pool.ts`, `discard`) gives every probe back, takes new ones for the cells the image marks and traces all of
them in that image, at no budget, the queue holding the whole pool: it is the pool's first pass, the pass after the maps of the radiance
cache were made again, and the pass that sees the colour of the sun (the first directional light that gives indirect light) or of the sky
light grow or shrink by more than four times from one image to the next (`frame/prepare/globalLighting.ts`; the setting
`surfaceCachePropagateGlobalLightingChange`, on by default, turns the last off). Any other change of the lights or of the placements only
opens the series again: the probes are traced anew at the budget.

**What the lit passes read.** A table of one layer (`bounce/atlas.ts`) names the slot of the pool that holds each cell of each
level, by its remainder modulo the side, so that sliding by a cell changes only the entries that come in (written by `publishTable` of
`bounce/pool/poolWgsl.ts`). The table names a probe once its first trace was queued, and forgets it the moment it is given back; the
radiance cache's tags say which cell and level a map was made for, and a mismatch is as good as none. The screen probes find the
eight probes round a point in it and read their maps (`bounce/screen/cacheReadWgsl.ts`).

**What is traced, in what order.** A probe that holds nothing yet comes before every refresh (it is alone in the first of the 16 buckets of
the one priority histogram): the finest level first, the cells nearest the eye first, up to the frame's queue rather than the
budget. The queue is the greater of a sixth of the pool and four times the budget, laid in rows of a power of two
(`probeQueueFor`, `sdk-core/src/bounce/contracts.ts`: 2752 probes at the default budget, 5504 at the greatest the settings ask), so that a view
moving fast fills every cell it reaches in the image that first reads it. The probes already traced take what the budget leaves, by the
priority a light cache gives them — the frames from a probe's trace to its last use, over its level plus one, their log₂ cut to a bucket, the
sooner a probe is wanted the lower its bucket, the lowest filled first (`bounce/pool/poolWgsl.ts`: the one histogram of costs and the cut the
budget stops in) — until every probe has been traced since the lights last changed: then the series closes and the frame holds. A probe costs a
whole map's cost, a quarter of it past `screenProbeRadianceCacheDownsampleDistance` and four times it within
`screenProbeRadianceCacheSupersampleDistance`. The budget is the level's `radianceProbeBudget` (100, 150 or 350 probes) times
`screenProbeUpdateSpeed` (held between 0.5 and 4) — a count of probes, not a duration: the
probes of a frame run side by side and the pass lasts about as long as its longest ray, so the time of a
batch does not follow its size, and a servo on it starved the field (`passMs` in `metrics.bounce`
publishes the last duration of the pass, and steers nothing). A probe's map is traced in tiles of 8 by 8 rays. By default (`screenProbeRadianceCacheTraceTiles: 'automatic'`)
the screen probes first add the cosine lobes of their pixels to the world probes round them (`scatterLobes`, eight probes a
screen probe, the nine harmonics and a weight in integer sums), and each world probe's tiles are cut by them: a tile of the
first level (half the side) is cut in four where the lobes weigh anything in its direction, and again where they weigh more
than `screenProbeRadianceCacheSupersampleTileBrdfThreshold` (0.1 by default), as far as the probe's distance allows (one level
past the downsample distance, two within it, three within the supersample distance). Where no screen probe made the lobes, or with
`'half'`, `'full'` or `'supersampled'` (one level for every probe), the tiles are uniform. A new trace replaces the radiance the probe's map held: it is written whole into the raw atlas, then
filtered with the six neighbours' into the final one.

```ts
const world = createWorld(canvas, {
  // Trace at twice the resolution the directions the pixels read most (lobes weighing above 0.2 rather than 0.1).
  screenProbeRadianceCacheSupersampleTileBrdfThreshold: 0.2,
  // The irradiance field gathers the indirect light; its probes are moved off the surfaces before they are traced.
  finalGatherMethod: 'irradianceField',
  radianceCacheIrradianceProbeOffsetMode: 'gbuffer', // 'none', 'gbuffer' (the default) or 'globalDistanceField'
})
```

The irradiance field's probes do not all stay on their cell's centre (`radianceCacheIrradianceProbeOffsetMode`). With `'gbuffer'`, before a queued probe is traced one workgroup looks at the pixel it projects to and 63 more within 16 pixels of it
(`irradianceField/offsets.ts`); each pixel that shows a surface at least as near as the probe votes for the place a fifth of the way along its normal and four fifths toward the eye, three quarters of a quarter of a cell off the surface, if that lies within a quarter of a cell of the
cell's centre, and the probe stands at the mean of the votes (it keeps its place when none voted). With `'globalDistanceField'`, a probe within a twentieth of a cell of a surface of the global distance field tries 64 places in a quarter of a cell round it and moves to the one farthest from the surfaces. The offset lasts with the probe's slot
and is read by its trace, by the filter's weights of its neighbours, by the validity test and by the gather. `'none'` keeps every probe on its cell's centre. Adaptive probes are moved like the others. Two deliberate differences from the reference: with `'globalDistanceField'` the place found is added to the offset the probe already had (the reference stores it alone, which moves the probe to a place it did not measure), and that sum is held within a quarter of a cell of the cell's centre, as the votes of `'gbuffer'` are.

A probe's ray that leaves the scene reaches the sky (`lighting/atmosphere/skyReadWgsl.ts`): the share
of the ray the scene lets through times the radiance of the sky light's cube in its direction, the
sky above the horizon, the sky light's ground colour below it, black by default — where a sky light
gives it (the sky module's `skyLight` part), none else, whatever the atmosphere draws. The maps thus hold the sky the scene lets through: a street is
lit from above, an arcade is not. A pixel the screen probes read takes the sky light's diffuse light from them, never added again beside the
environment; a pixel they did not read takes the sky light's own unoccluded irradiance (`bounce/applyWgsl.ts`), so the image shows no hole
while the probes fill. A scene with no sky light has no unoccluded light to give there: its
environment (ambient, hemisphere) is the pixel's own term. With a sky light that
captures in real time the probes wait for its first capture, so none holds a sky of none. With the bounce off, or no lamp to bounce, the sky light lights with its unoccluded
irradiance everywhere.

A cell no probe holds, or a probe never traced for it, as
on the first image or after the eye jumped, answers "not yet": the next level reads, and, past the last, the sky light, never dark. A surface a probe's ray, a screen probe's ray or a
reflection hits is not read by the probes: it is read in the surface cache (`lighting/surfaceCache/hitWgsl.ts`), the final
light of the card texels near the hit, which the cache's own lighting keeps up to date from the lights, the sky and its radiosity, so
that a surface out of view has its light and a second bounce of its own. A hit where the cache holds no card, or no card
of the object's mesh cards covers the point, is dark, and fills as the cards are captured. The frame's
bounce counts publish how many probes are alive and how many hold nothing yet (`liveProbes`,
`unfilledProbes`, zero once the light the image reads is filled), and the probe series stays open until
none is, until every probe has its updates and the marks owed are in.

A probe's ray is cut at `screenProbeMaxTraceDistance` (200 m by default, the one distance the probes, the reflections and the surface cache's lighting trace to), past which the sky answers. It leaves the probe's centre, from the
nearest a probe's ray starts at, the diagonal of the probe's cell, so that no ray finds what the probe stands in, and is marched
through the global distance field (`gdfTrace`, [Distance fields](distance-fields.md#distance-fields)) as far as that reach: at most 256 steps a
clipmap, a surface expanded by the largest distance the march read, a ray stopped on a sample no mesh covers by noise
drawn at the texel and the image's turn; a ray that starts
inside a surface brings back no light. The light of its hit is read in the surface cache at the point the march ended at
(`scGlobalHit`): the field's gradient gives the face, the object grid's cell one voxel off it the objects near — up to four, the
nearest first — whose mesh cards are read, three voxels wide, until the weights they gave reach 0.9, the cone of the ray at the hit
its radius, the coarsest page of a card, always resident, and no feedback written (a probe's ray asks no finer page; only the
reflections' do). The marks follow what the image draws: a view that stands still but whose cut refines, or whose pages arrive,
marks the cells of its new surfaces again (`lighting/bounce/pool/pool.ts`, `frame/render/encodeLights.ts`). The
frame metrics publish the state of the pool as `metrics.bounce` (`BounceFrameMetrics`): whether the probes
exist, the probes alive, those still unfilled, the cells marked and refused, the probes queued, and the placements that hold a box
(`geometry/dag/placement/placementBoxes.ts`, whose extent the levels are first centred on: no triangle of the scene is loaded or posed for the bounce).

**What the pixels read of the screen probes** (`bounce/screen/`, settings `screenProbe…` in `bounce/screenProbeOptions.ts`).
A ray of a screen probe the screen did not answer is answered by one scene stage (`traceSceneWgsl.ts`, one pass, one
kernel), in the order of the reference: the ray is marched through the global distance field from where the screen lost it (two
biases back) as far as the range the radiance cache is trusted to (`spLocalReach`), a hit giving the final light of the surface
cache at the point (`scGlobalHit`; the hit's light fading in over its first voxel and a half, so that a ray never reads its own
surface), and the radiance cache is read (`cacheReadWgsl.ts`), the environment where it covers none, for the ray the march left, its
distance the end of the ray; the cache is never read for a ray the march stopped, and no pass of its own reads it. The
switch `screenProbeSceneTraces` turns the march off: the screen, then the radiance cache alone. The stage asks for the surface cache
(`demandSurfaceCache`) as the reflections do. What a pixel keeps is one `rgba32uint` texture of four words (`SCREEN_PROBE_FORMATS.history`), the lighting's one binding
(`screenIndirect`), each word accumulated over the frames by the temporal pass (`temporalWgsl.ts`) like the irradiance:
the diffuse light; the light of the pixel's rough specular reflection; the light at the back of a thin double-sided sheet that
transmits light; and the direction of open sky the short-range occlusion found, beside its amount. The rough specular is
four samples of the pixel's GGX lobe (visible normals, Hammersley points turned by the pixel's noise) of the radiance of the
probes the pixel reads, each weighed by the share of its direction the pixel's open sky leaves (the occlusion's bent normal and
amount against the hemisphere), tone-mapped, bilinear in the probe's octahedron, mixed toward the diffuse light over pi by the roughness
(`integrateWgsl.ts`, `SP_ROUGH_SPECULAR`) for a pixel at or under `screenProbeMaxRoughnessToEvaluateRoughSpecular` (0.8;
`…ForFoliage` for the sheets that transmit, the reflections' level's row: 0.4 at `high`, 0.8 above and where they are off): the world's probes no longer light the specular of the opaque pixels whose
reflection ray is not traced, the reflections' resolve reads it (`screenRoughAt`, under `screenSpecularOcclusion`). A pixel
that carries physical lobes (a clear coat, which the surface flag does not tell from an anisotropy) never takes the shortcut of a
reflection traced whole: the base lobe under a coat casts no ray, so its rough specular is evaluated on the base normal and roughness. The back of a
sheet is the irradiance of the probes along the opposite hemisphere, gathered where `screenProbeTwoSidedFoliageBackfaceDiffuse`
is on and the level allows it (`high` does not, `ultra` and `cinematic` do), the pixel's own side otherwise
(`screenBackAt`). The short-range occlusion keeps its bent normal — the mean of the unoccluded directions of the horizon search,
turned onto the pixel's frame, 11 + 11 + 10 bits with its amount in the fourth word — where `screenProbeBentNormal` is on and
the level allows it (`ultra` and `cinematic`): the temporal pass blends it by its direction and its amount, and
the specular occlusion is the share of the reflection's cone the cone of open sky covers. On the pixels of a thin double-sided
sheet the amount is mixed toward 1 by `screenProbeOcclusionFoliageStrength` (the level's row by default, 0.7; the `balanced` preset writes 1), the light scattering through the sheet,
before it is blended with its history (the neighbourhood it is held to is mixed the same way). A pixel the probes did not read has a
zero alpha and the lighting reads the world's probes, as before.

**The reflections' rays** (`lighting/reflections/`, settings in `contracts/reflectionOptions.ts`, levels in
`contracts/reflectionLevels.ts`). A level (`reflectionQuality`) sets the side of the blocks of pixels a grid texel
traces one ray for: one pixel at the default level and the cinematic one, 2 × 2 at `high`. A classification pass
lists, each image, the tracing tiles of 8 × 8 texels where a pixel's lobe is under the roughness a ray is cast for
(`reflectionMaxRoughnessToTrace`), and, for the pixels, the resolve tiles of 8 × 8 pixels where one traces —
`block` of them a side in a tracing tile — and the others, which the field answers alone. A ray generation pass then runs over
the tracing tiles: each texel picks the pixel of its block that casts this image and, where that pixel's lobe traces, draws its ray (direction, and the cone
angle, the inverse of the ray's pdf, at least 10⁻⁵, negative for a pixel of a first-person object) into the ray texture the screen and scene stages and the
resolve read, beside the pixel's depth (negated where it casts none). A ray goes as far as the longest ray whatever the roughness of its pixel: the reflections
reuse no radiance cache that would shorten it. The transparents' front layer is
traced like an opaque surface only where the level allows it and the level or the project asks for it
(`reflectionFrontLayer`, false by default: never at `high`, always at `cinematic`); without it a transparent
surface reflects, along its mirror direction, the screen probes' radiance cache where it covers its point (`reflectionTranslucencyRadianceCache`,
true), else the environment, then the last lit image through a 12-step march of the depth pyramid (`reflectionTranslucencyScreenQuality`, 3) on a device that
grants 23 sampled textures a stage (`grantsTranslucentReflection`: its reflection group then holds the whole pyramid, the lit image and the cache), the environment
alone on one that does not, and its front pass writes the covering depth
alone, not the reflecting surface, so the front layer's normals, lobes and grids are never made. The front pass draws
only where a feature reads what it writes: the front layer's reflections (`reflectionFrontLayer`), the depth pyramid's
fold of the transparents (`hizFoldTransparents`) or the shadow pages the translucent surfaces mark
(`shadowTranslucentQuality` 1, `markingFrontLayer`); with none of them, no transparent run is drawn a second time.

The screen's answer to a ray is the last lit image at the texel the hit lands in, one point of its level 0
(`reflectionSeenAnswer`), the denoiser averaging the rays; the image is read as it is, no filtered level of it is built, and
the two HDR targets that take turns hold one level each (`litImage.ts`: `holdLitImage`, `adoptLitImage`). A pixel traced
at full resolution accumulates its history over two images when it is a mirror, widening to `reflectionMaxFramesAccumulated`
with the roughness of its top layer over 0.05. A pixel whose lobe casts no ray (rougher than
`reflectionMaxRoughnessToTrace`) reflects the surroundings through its lobe and, where the screen probes read it, the
screen probes' rough specular, which the opaque resolve adds (`resolvedIndirect`: `screenRoughAt` under
`screenSpecularOcclusion`, the surroundings giving way to it where the probes hold the sky), the share of a lobe in the band over which its ray gives way
(`reflectionRoughnessFadeLength`) as well, the resolve reading the share no ray answered from the alpha of the reflection target
(`reflectionLeftShare`); the environment alone answers the transparents and the part of a ray the scene did not settle, the sky light's
where one shines, as the reference's rays that miss take it.

The scene stage of a ray the screen left (`sceneTrace.ts`, `reflectionSceneTrace`) marches the global distance field
(`gdfTrace`, [Distance fields](distance-fields.md#distance-fields)) from where the screen stopped knowing the ray, less four half voxels of
the clipmap that holds that point, to the longest ray (`screenProbeMaxTraceDistance`), the scene's edge or the surface the
screen met, whichever is nearest: the surface is expanded by the largest distance read, not by the ray's time, and the
step is the distance times a factor the pixel's noise draws between 0.95 and its reciprocal near a mirror (whole from a
cone of π/256). Where it meets a surface, the surface's light is read in the [surface cache](surface-cache.md#surface-cache)'s final
lighting (`scGlobalHit`, `surfaceCache/hitWgsl.ts`): the field's gradient gives the face, one voxel of the hit's clipmap along it the
field's object grid gives the cell of the objects near the hit, up to four, and the cards of each are read in turn — at the
hit, three voxels of the clipmap wide, on the finest page of a card that is in the atlas (`reflectionHiResSurface`, on; off, the coarsest), the radius of the ray's cone
at the hit (the lobe's and the pixel's) — until the weights they gave reach 0.9; the light is the sums over their weight.
An object of the grid is named by its instance, which the table of `hitInstances.ts` turns into its placement in the cache
(the several stand-ins of one HLOD root answer to one instance and are told none). Where the lit image agrees with the depth at the hit it
is taken instead (`reflectionSampleSceneColor`), and the light is fogged along the ray; a hit no card gave any weight of
answers nothing, and the ray goes on to the probes' field. A march that meets nothing leaves the scene: the screen is looked at once more
from where the ray leaves the field's outermost clipmap (`gdfClipRayOutside`), then the environment answers. The scene
trace has one switch, `screenProbeSceneTraces`, shared with the screen probes; while it is on and the level traces, the
field takes the sizes of rays marched through it (`sizeForTraces`), the surface cache and the field's object grid are asked
for (`demandSurfaceCache`, from the image the trace runs in, so the cache serves the next) and the rays write the cache's feedback. The scene stage binds the
field's six resources (`REFLECTION_FIELD_WGSL`, bindings 39 to 44 of the trace's group 0), its object grid (54), the cache's tables, its
depth and final layers and its feedback buffer (45 to 53, the albedo, normal, emission, direct and indirect
layers, which no hit reads, left out of the layout), and the table of the placements (55): its sampled textures fourteen of the
sixteen WebGPU guarantees, the rays and the partial answers being read as storage textures for that: a scene with no distance field binds
the stand-in of one with no clipmap (`createNoFieldRead`) and its rays answer nothing, one whose cache is not made yet the stand-ins of `hitCards.ts`
(a hit then finds no card). What the scene stage returns — the light of a hit, or the sky a ray reaches — takes, before its fog and under the ceiling
of a ray, the sky light's diffuse light at the hit's normal (the zero normal for the sky) times `reflectionSkylightLeaking` (0 by default: none), its tint (`reflectionSkylightLeakingTintRed`, `…Green`, `…Blue`, white by default) and the average
albedo of a hit (`reflectionSkylightLeakingAverageAlbedo`, 0.25) (`reflectionSkylightLeak`, `rayLightWgsl.ts`; the normal of the hit, not the ray's direction). The census counts each ray once by
how its march ended and the steps the marches took (`ReflectionFrameMetrics.sceneEnded`, `sceneWork`), and only where
`reflectionStatistics` is on (false by default, read when the session opens): the kernels are compiled without the counting and bind no
buffer for it otherwise, and nothing is read back.
