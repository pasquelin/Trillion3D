# Light that bounces

Dynamic, on by default (`bounce: false` turns it off). World probes hold a radiance cache: a
per-probe direction map of light, traced through the global distance field with surface-cache light
at hits (`bounce/cache/`, `bounce/probeRayWgsl.ts`, `lighting/surfaceCache/hitWgsl.ts`), a budget of
probes per frame (level's `radianceProbeBudget` × `screenProbeUpdateSpeed`, `bounce/`). Screen
probes read it for rays the screen and near scene did not answer, and light pixels (below). Hit
light = cache's final lighting: declared lights' direct light, shadows traced through the field,
sky, cache's own radiosity.

**Where probes are.** Four levels, each a 48-cell-per-side cube centred on the eye, snapped to its
cells: first reaches 25 m, cell 1.04 m; each next level twice as far, cell twice as wide: 2.08,
4.17, 8.33 m (`cascadeLevels`, `cascadeSize`, `cascadeHalfExtentMetres`, `cascadeBase`,
`sdk-core/src/bounce/cascades.ts`). A level slides by whole cells with the eye. Beyond the last
level: sky light answers (below).

**Probes only where image reads.** A level holds 110 592 cells, four 442 368; a probe is made only
for a cell the image reads, from a 16 384 pool (`probePool`), all GPU (`bounce/pool/`).

- Image casting screen probes marks from their points once placed (uniform ones, one per tile, and
  adaptive ones: `bounce/pool/poolMarkWgsl.ts`, `markProbes`). Pool pass runs after placement
  (`frame/render/preLight.ts`: `placeScreenProbes`, `encodeQueuedBounce`, `traceScreenProbes`);
  placement also asks the probes of their pixels (`screenData`).
- Each point finds the finest level holding it (where two levels share the answer, per-pixel
  per-frame noise marks both in turn) and sets a bit for each of the eight probes around it; sky
  marks nothing.
- Image casting none marks from last image's cast points; if none, a thread takes a pixel of the
  image downsampled by `screenProbeInterpolateDownsampleFactor` (2) then
  `screenProbeMarkDownsampleFactor` (2), one of a four-rooks pattern turning with frame
  (`markImage`).
- Same pass (`bounce/pool/poolWgsl.ts`, kernels in order: `clearIndirection`, marks, `updateProbes`,
  `clearWork`, `allocateProbes`, then choice of probes to trace and dispatch arguments): a probe
  whose cell left its level when it slid is given back, so is one nothing read for
  `screenProbeRadianceCacheFramesToKeepProbes` frames (8); a marked cell with no probe takes one from
  the free-slot stack; given-back probes come first. Pool with none left refuses a mark: cell
  unanswered, next level or sky light answers (`refusedMarks` in diagnostic).
- Counters return to CPU a few images late via a readback ring (`bounce/pool/pool.ts`): probes
  alive, probes holding nothing yet or not traced since lights last changed, marks refused, probes
  queued, cells marked; series stays open while any are.

Full update (`bounce/pool/pool.ts`, `discard`): gives every probe back, takes new ones for cells the
image marks, traces all in that image, no budget. Happens on pool's first pass, the pass after
radiance cache maps were remade, and when sun colour (first directional light giving indirect
light) or sky light colour changes by more than 4× between images (`frame/prepare/globalLighting.ts`;
setting `surfaceCachePropagateGlobalLightingChange`, on by default, turns the last off). Any other
light or placement change only reopens the series: probes traced anew at budget.

**What lit passes read.** A one-layer table (`bounce/atlas.ts`) names the pool slot holding each
cell of each level (`publishTable` of `bounce/pool/poolWgsl.ts`). Table names a probe once its first
trace is queued, forgets it when given back; radiance cache tags say which cell and level a map was
made for, mismatch = none. Screen probes find eight probes round a point in it, read their maps
(`bounce/screen/cacheReadWgsl.ts`).

**What is traced, in what order.**

- Probe holding nothing yet precedes every refresh: finest level first, cells nearest the eye first,
  up to frame's queue, not budget. Queue = greater of 1/6 pool and 4× budget, in rows of a power of
  two (`probeQueueFor`, `sdk-core/src/bounce/contracts.ts`: 2752 probes at default budget, 5504 at
  greatest settings ask).
- Already-traced probes take what budget leaves, by priority: frames from probe's trace to last use,
  over its level plus one, log₂ cut to a bucket (lowest first; `bounce/pool/poolWgsl.ts`) until every
  probe is traced since lights last changed; then series closes, frame holds.
- A probe costs a whole map's cost, 1/4 past `screenProbeRadianceCacheDownsampleDistance`, 4× within
  `screenProbeRadianceCacheSupersampleDistance`.
- Budget = level's `radianceProbeBudget` (100, 150 or 350 probes) × `screenProbeUpdateSpeed` (held
  0.5 to 4): a probe count, not a duration (`passMs` in `metrics.bounce` publishes last pass
  duration).
- Probe map traced in 8 by 8 ray tiles. Default (`screenProbeRadianceCacheTraceTiles: 'automatic'`):
  screen probes add their pixels' cosine lobes to world probes round them (`scatterLobes`), and each
  world probe's tiles are cut by them: first-level tile (half side) cut in four where lobes weigh
  anything in its direction, again where they weigh more than
  `screenProbeRadianceCacheSupersampleTileBrdfThreshold` (0.1), as far as probe distance allows (one
  level past downsample distance, two within it, three within supersample distance). No screen
  probe lobes, or `'half'`, `'full'`, `'supersampled'` (one level for every probe): uniform tiles.
- New trace replaces probe map's radiance: written whole into raw atlas, then filtered with six
  neighbours' into final.

```ts
const world = createWorld(canvas, {
  // Trace at twice the resolution the directions the pixels read most (lobes weighing above 0.2 rather than 0.1).
  screenProbeRadianceCacheSupersampleTileBrdfThreshold: 0.2,
  // The irradiance field gathers the indirect light; its probes are moved off the surfaces before they are traced.
  finalGatherMethod: 'irradianceField',
  radianceCacheIrradianceProbeOffsetMode: 'gbuffer', // 'none', 'gbuffer' (the default) or 'globalDistanceField'
})
```

Irradiance field probes need not stay on cell centre (`radianceCacheIrradianceProbeOffsetMode`):

- `'gbuffer'`: before a queued probe is traced, one workgroup looks at its projected pixel and 63
  more within 16 pixels (`irradianceField/offsets.ts`); each pixel showing a surface at least as
  near as the probe votes for a place 1/5 along its normal and 4/5 toward the eye, 3/4 of 1/4 cell
  off the surface, if within 1/4 cell of cell centre; probe stands at mean of votes (keeps place if
  none voted).
- `'globalDistanceField'`: probe within 1/20 cell of a global-distance-field surface tries 64 places
  within 1/4 cell and moves to the one farthest from surfaces.
- `'none'`: every probe on cell centre.
- Offset lasts with probe slot; adaptive probes move like others.
- Reference differences: with `'globalDistanceField'` found place is added to the offset the probe
  already had, and the sum is held within 1/4 cell of cell centre, as `'gbuffer'` votes are.

A probe ray leaving the scene reaches sky (`lighting/atmosphere/skyReadWgsl.ts`): share of ray scene
lets through × sky light cube radiance in its direction (sky above horizon, sky light ground colour
below, black default), only where a sky light gives it (sky module's `skyLight` part).

- Pixel screen probes read takes sky light diffuse from them; pixel they did not read takes sky
  light's own unoccluded irradiance (`bounce/applyWgsl.ts`).
- Scene with no sky light: environment (ambient, hemisphere) is the pixel's own term.
- Sky light capturing in real time: probes wait for its first capture.
- Bounce off, or no lamp to bounce: sky light lights with unoccluded irradiance everywhere.

A cell no probe holds, or probe never traced for it, answers "not yet": next level reads and, past
last, sky light. A surface hit by a probe ray, screen probe ray or reflection is read in surface
cache (`lighting/surfaceCache/hitWgsl.ts`). A hit where cache holds no card, or no mesh card covers
the point, is dark, fills as cards are captured. Bounce counts publish probes alive and holding
nothing yet (`liveProbes`, `unfilledProbes`).

Probe ray cut at `screenProbeMaxTraceDistance` (200 m default, the one distance probes, reflections
and surface cache lighting trace to), past which sky answers. It leaves the probe centre, at nearest
probe ray start = diagonal of probe cell, and marches the global distance field (`gdfTrace`,
[Distance fields](distance-fields.md#distance-fields)): at most 256 steps per clipmap, surface
expanded by largest distance march read, ray stopped on a sample no mesh covers by noise; a ray
starting inside a surface brings back no light. Hit light read in surface cache at march end point
(`scGlobalHit`): field gradient gives face, object grid cell one voxel off it gives objects near (up
to four, nearest first) whose mesh cards are read, three voxels wide, until weights reach 0.9, ray
cone at hit = radius, coarsest card page, no feedback written. Still view whose cut refines or whose
pages arrive marks new surfaces' cells again (`lighting/bounce/pool/pool.ts`,
`frame/render/encodeLights.ts`). Frame metrics publish pool state as `metrics.bounce`
(`BounceFrameMetrics`): probes exist, alive, still unfilled, cells marked and refused, probes
queued, placements holding a box (`geometry/dag/placement/placementBoxes.ts`).

**What pixels read of screen probes** (`bounce/screen/`, settings `screenProbe…` in
`bounce/screenProbeOptions.ts`). A screen probe ray the screen did not answer is answered by one
scene stage (`traceSceneWgsl.ts`, one pass), in order:

- Ray marched through global distance field from where screen lost it (two biases back) to range
  radiance cache is trusted (`spLocalReach`); hit gives surface cache final light at point
  (`scGlobalHit`; hit light fades in over first 1.5 voxels).
- Radiance cache read (`cacheReadWgsl.ts`), environment where it covers none, for the ray march left,
  distance = ray end; never for a ray march stopped.
- `screenProbeSceneTraces` turns march off: screen, then radiance cache alone. Stage asks for surface
  cache (`demandSurfaceCache`) as reflections do.

Pixel keeps one `rgba32uint` texture of four words (`SCREEN_PROBE_FORMATS.history`), lighting's one
binding (`screenIndirect`), each accumulated over frames by temporal pass (`temporalWgsl.ts`):
diffuse light; rough specular reflection light; light at back of a thin double-sided transmitting
sheet; open-sky direction short-range occlusion found, beside its amount.

- Rough specular: four samples of pixel's GGX lobe (visible normals, Hammersley points turned by
  pixel noise) of radiance of probes pixel reads, each weighed by share of its direction pixel's
  open sky leaves, tone-mapped, bilinear in probe octahedron, mixed toward diffuse light over pi by
  roughness (`integrateWgsl.ts`, `SP_ROUGH_SPECULAR`), for pixel at or under
  `screenProbeMaxRoughnessToEvaluateRoughSpecular` (0.8; `…ForFoliage` for transmitting sheets,
  reflections' level row: 0.4 at `high`, 0.8 above and where off). World probes no longer light
  specular of opaque pixels whose reflection ray is not traced; reflections' resolve reads it
  (`screenRoughAt`, under `screenSpecularOcclusion`).
- Pixel with physical lobes (clear coat) never takes the whole-traced-reflection shortcut: rough
  specular is evaluated on base normal and roughness.
- Sheet back: irradiance of probes along opposite hemisphere, gathered where
  `screenProbeTwoSidedFoliageBackfaceDiffuse` on and level allows (`high` not; `ultra`, `cinematic`
  yes), pixel's own side otherwise (`screenBackAt`).
- Short-range occlusion keeps bent normal (mean unoccluded horizon-search directions, in pixel
  frame, 11 + 11 + 10 bits, amount in fourth word) where `screenProbeBentNormal` on and level allows
  (`ultra`, `cinematic`); specular occlusion = share of reflection cone covered by open-sky cone.
  Thin double-sided sheet pixels: amount mixed toward 1 by `screenProbeOcclusionFoliageStrength`
  (level row default, 0.7; `balanced` preset writes 1) before blending with history.
- Pixel probes did not read: zero alpha, lighting reads world probes.

**Reflection rays** (`lighting/reflections/`, settings `contracts/reflectionOptions.ts`, levels
`contracts/reflectionLevels.ts`). Level (`reflectionQuality`) sets the pixel-block side one grid
texel traces one ray for: one pixel at default and cinematic, 2 × 2 at `high`.

- Classification pass lists each image: 8 × 8-texel tracing tiles where a pixel lobe is under the
  roughness a ray is cast for (`reflectionMaxRoughnessToTrace`) and 8 × 8-pixel resolve tiles where
  one traces (`block` of them a side in a tracing tile); field alone answers others.
- Ray generation pass over tracing tiles: each texel picks the block pixel casting this image and,
  where its lobe traces, draws its ray (direction, cone angle, inverse ray pdf at least 10⁻⁵,
  negative for first-person object pixel) into the ray texture beside pixel depth (negated where it
  casts none). Ray goes as far as longest ray whatever pixel roughness.
- Transparents' front layer traced like an opaque surface only where level allows and level or
  project asks (`reflectionFrontLayer`, false default: never at `high`, always at `cinematic`).
  Without it a transparent surface reflects, along mirror direction, screen probes' radiance cache
  where it covers its point (`reflectionTranslucencyRadianceCache`, true), else environment, then
  last lit image via 12-step depth-pyramid march (`reflectionTranslucencyScreenQuality`, 3) on a
  device granting 23 sampled textures per stage (`grantsTranslucentReflection`), environment alone
  otherwise. Its front pass writes covering depth alone.
- Front pass draws only where a feature reads what it writes: `reflectionFrontLayer`, depth
  pyramid's transparents fold (`hizFoldTransparents`) or shadow pages translucent surfaces mark
  (`shadowTranslucentQuality` 1, `markingFrontLayer`).

Screen's answer to a ray = last lit image at the texel hit lands in, one level-0 point
(`reflectionSeenAnswer`), denoiser averaging rays (`litImage.ts`: `holdLitImage`, `adoptLitImage`).
Full-resolution traced pixel accumulates history over two images when a mirror, widening to
`reflectionMaxFramesAccumulated` with top-layer roughness over 0.05. A pixel whose lobe casts no ray
(rougher than `reflectionMaxRoughnessToTrace`) reflects surroundings through its lobe and, where
screen probes read it, their rough specular, which opaque resolve adds (`resolvedIndirect`), and
lobe share in the band where its ray gives way (`reflectionRoughnessFadeLength`), resolve reading
the share no ray answered from reflection target alpha (`reflectionLeftShare`). Environment alone
answers transparents and the part of a ray scene did not settle, sky light's where one shines.

Scene stage of a ray the screen left (`sceneTrace.ts`, `reflectionSceneTrace`) marches the global
distance field (`gdfTrace`, [Distance fields](distance-fields.md#distance-fields)) from where
screen stopped knowing the ray, less four half voxels of the clipmap holding that point, to longest
ray (`screenProbeMaxTraceDistance`), scene edge or surface screen met, nearest. Surface expanded by
largest distance read; step = distance × factor pixel noise draws between 0.95 and its reciprocal
near a mirror (whole from a π/256 cone).

- Surface hit read in [surface cache](surface-cache.md#surface-cache) final lighting (`scGlobalHit`,
  `surfaceCache/hitWgsl.ts`): as for probe rays, but cards read on finest page of a card in atlas
  (`reflectionHiResSurface`, on; off: coarsest), ray cone radius at hit (lobe's and pixel's). Grid
  object named by instance, which `hitInstances.ts` table turns into its cache placement.
- Where lit image agrees with depth at hit it is taken instead (`reflectionSampleSceneColor`), light
  fogged along ray. Hit no card gave weight to answers nothing; ray goes on to probes' field.
- March meeting nothing leaves scene: screen looked at once more from where ray leaves field's
  outermost clipmap (`gdfClipRayOutside`), then environment answers.
- One switch, `screenProbeSceneTraces`, shared with screen probes. On and level traces: field takes
  sizes of rays marched through it (`sizeForTraces`), surface cache and field object grid asked for
  (`demandSurfaceCache`) and rays write cache feedback.
- Bindings: field's six resources (`REFLECTION_FIELD_WGSL`, bindings 39 to 44 of trace group 0), its
  object grid (54), cache tables, depth and final layers, feedback buffer (45 to 53), placements
  table (55): fourteen of sixteen guaranteed sampled textures. Scene with no distance field binds
  stand-in (`createNoFieldRead`), rays answer nothing; cache not made yet: `hitCards.ts` stand-ins.
- Stage returns (hit light, or sky a ray reaches) take, before fog and under ray ceiling, sky light
  diffuse at hit normal (zero normal for sky) × `reflectionSkylightLeaking` (0 default: none), tint
  (`reflectionSkylightLeakingTintRed`, `…Green`, `…Blue`, white default) and hit average albedo
  (`reflectionSkylightLeakingAverageAlbedo`, 0.25) (`reflectionSkylightLeak`, `rayLightWgsl.ts`).
- Census counts each ray once by how march ended and steps taken (`ReflectionFrameMetrics.sceneEnded`,
  `sceneWork`), only where `reflectionStatistics` on (false default, read at session open).
