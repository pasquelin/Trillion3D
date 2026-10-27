import { SCREEN_PROBE_LEVEL_KNOBS, type CastingLevel } from '../bounce/screenProbeLevels.ts'
import type { ScreenProbeField } from '../bounce/screenProbeOptions.ts'

/** What one level holds, in words: its tile, adaptive samples, rays a side and irradiance format. */
const levelRow = (level: CastingLevel) => {
  const knobs = SCREEN_PROBE_LEVEL_KNOBS[level]
  const format = knobs.irradianceFormat === 'sh3' ? 'spherical harmonics' : 'octahedral irradiance'
  return `${level} ${knobs.downsampleFactor}-pixel tiles, ${knobs.adaptiveProbes} adaptive samples, ${knobs.tracingResolution} rays a side, ${format}`
}

/** The screen probes switch, their placement, their rays, their filtering and their history. */
const PLACEMENT_AND_FILTER_MEANINGS = /* @__PURE__ */ (() =>
  ({
    screenProbes: `How a pixel gets its indirect light: from probes placed on the screen, one a tile of pixels, each tracing the screen, then the scene, then the world's bounce probes, filtered in space and time. A level sets the tile, the rays and the probes' format: ${levelRow('high')}; ${levelRow('ultra')}; ${levelRow('cinematic')}. low casts none and reads the world's bounce probes under the short-range occlusion; off lights nothing the screen probes do, and a quality preset writes the bounce off with it. true is the default level, false is off.`,
    screenProbeQuality:
      "Scale on the screen probes' rays and tiles: the rays along a probe's side follow its square root (powers of two, 4 to 16); from 6 the tiles are halved, from 4 the jitter of the probes a pixel reads is.",
    screenProbeUpdateSpeed:
      "Scale on how fast the indirect light follows a change: the frames a pixel's history holds follow the inverse of its square root, read from 0.5 to 8.",
    screenProbeAdaptiveFraction:
      "Share of the uniform probes the adaptive placement may add where a tile's probes do not cover a surface; 0 places none, above 1 is allowed.",
    screenProbeGatherScale:
      "The side of the octahedron a probe's rays are filtered and integrated at, as a share of the side they are traced at, from 0.1 to 1 (the whole number nearest its inverse divides the tracing side): above 1 would upsample, which the reference does not support.",
    screenProbeScreenTraces:
      "Whether a probe's ray first looks for what the last image shows (the depth pyramid and the lit image) before the world's bounce probes answer it; false, every ray is the bounce probes' alone.",
    screenProbeImportanceSampling:
      "Whether the probes' rays go where the light is: the directions are drawn by the cosine lobes of the pixels the probe stands for and by the light the last image gathered there, three rays under the minimum probability giving their place to one ray of the best, refined into four; false, the same octahedron of rays at every probe.",
    screenProbeSpatialFilter:
      "Whether a probe's gathered light is averaged with the four probes beside it, each weighed by its depth and by the angle its ray makes, as many passes as screenProbeSpatialFilterPasses; false, none.",
    screenProbeSpatialFilterPasses: 'Passes of the spatial filter.',
    screenProbeSpatialFilterKernel:
      'The half size of the spatial filter kernel: any value above 0 runs the filter, 0 turns it off (the filter itself is the fixed neighbourhood of four probes, eight more where a probe moves).',
    screenProbeMaxRayIntensity:
      "The most radiance a ray adds to its probe: a brighter ray is scaled down to it, so that a lit pixel's glare does not flicker in the probes. A number of the pre-exposed light (the light as the camera's exposure scales it, the reference's own unit), so a darker exposure holds a brighter scene radiance to it.",
    screenProbeTemporal:
      "Whether a pixel's indirect light is blended with its history, reprojected through the last image's view; false, each image stands alone.",
    screenProbeMaxFramesAccumulated:
      "The frames a pixel's history holds at most, from 1 (scaled by screenProbeUpdateSpeed, and a count past 15 is kept in four bits as a share of it): each new image enters at one over one plus the frames held.",
    screenProbeMaxRayDirections:
      "The directions a probe's rays turn through before they come round, from 1: each image traces each texel of the probe's octahedron through one of this many points of it, so that the history averages them. Should follow screenProbeMaxFramesAccumulated.",
    screenProbeTemporalFilterProbes:
      "Whether the radiance a probe's rays gathered is blended with the last image's before the spatial filter (false by default): the probe's texels read the last image's probes round where its surface stood (those on its plane, within two percent of its depth), weighed by screenProbeTemporalFilterProbesHistoryWeight. A smoother light for a lag in it; needs the last image's history to read.",
    screenProbeTemporalFilterProbesHistoryWeight:
      "The share of the last image's radiance the temporal filter of the probes keeps (0.5 by default), where the last image's probes were found round the probe: 0 is the new radiance alone, 1 the history alone; used only with screenProbeTemporalFilterProbes.",
    screenProbeExtraAmbientOcclusion:
      "Whether the probes keep an ambient occlusion of their own (false by default): each texel of a probe's octahedron holds how near the nearest hit its rays found there lies (its distance over screenProbeExtraAmbientOcclusionMaxDistance, to the power screenProbeExtraAmbientOcclusionExponent), filtered with the radiance, folded into the octahedron the irradiance is read from, and read by each pixel at its normal; at the integration the pixel's diffuse light is cut to the cone of open sky it leaves, with the multiple bounces of its albedo, and the directions of its rough specular are weighed by it, before the temporal pass blends them.",
    screenProbeExtraAmbientOcclusionMaxDistance:
      'Metres: the distance of the nearest hit past which a probe texel has no extra ambient occlusion (5 by default, from 0.000001 to 10000); used only with screenProbeExtraAmbientOcclusion.',
    screenProbeExtraAmbientOcclusionExponent:
      'The power the extra ambient occlusion of a probe texel is raised to (0.5 by default, from 0.01 to 100): below 1 lightens it near a hit; used only with screenProbeExtraAmbientOcclusion.',
    screenProbeGatherNumMips:
      "The levels of detail of the probes' filtered radiance, from 1 to 12 (1 by default): one texture of that many levels, each coarser level the mean of two by two texels of the one before, and the levels hold a border wide enough to read them; a pixel's rough specular reads the level its four samples' cone asks, the nearest.",
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** The short-range occlusion and the reach and start of the scene rays. */
const OCCLUSION_AND_TRACE_MEANINGS = /* @__PURE__ */ (() =>
  ({
    screenProbeMaterialAO:
      "Whether the material's own ambient occlusion darkens the probes' indirect light at the integration, before the temporal pass blends it, with the multiple bounces of the albedo (capped at screenProbeOcclusionMaxAlbedo) as the short-range occlusion has them; false, the material's occlusion does not reach it.",
    screenProbeShortRangeOcclusion:
      'Whether the contact shadow the probes cannot hold is searched in the depth round each pixel (a horizon search, a level sets its slices) and applied to the indirect light; false, none.',
    screenProbeOcclusionIntensity:
      'How strongly the short-range occlusion applies, from 0 (none) to 1 (whole).',
    screenProbeOcclusionTemporal:
      'Whether the short-range occlusion is blended with its history, held to the mean and deviation of its neighbourhood (screenProbeOcclusionClampScale); false, each image stands alone.',
    screenProbeBentNormal:
      'Whether the short-range occlusion keeps the direction of the open sky it finds (the bent normal) beside its amount, over a level that allows it (ultra and cinematic do; high does not): the temporal pass accumulates both and the lighting occludes the rough specular reflection by the cone of open sky along the reflection, as a scalar occlusion cannot; false, the amount alone, the surface normal as the direction.',
    screenProbeOcclusionSteps:
      'The samples of the depth the horizon search takes along each side of a slice, from 1.',
    screenProbeOcclusionForegroundFraction:
      "How much nearer to the eye than the pixel, as a share of the pixel's depth, a sample must be to count as foreground and have its occlusion rejected.",
    screenProbeOcclusionMaxAlbedo:
      'The albedo above which the multiple bounces of the occlusion see none more (the material occlusion too): near-white surfaces keep some.',
    screenProbeOcclusionFoliageStrength:
      "The most the short-range occlusion applies on the pixels of a thin double-sided sheet that transmits light (a leaf, a curtain: a material with a subsurface colour), from 0 (none) to 1 (whole): their occlusion amount is mixed toward 1 by it, which stands for the light scattering through the sheet. Negative, the default, is the level's row: 1 at low, whose world probes light them flatter, 0.7 at high, ultra and cinematic.",
    screenProbeOcclusionClampScale:
      "How far, in deviations of its neighbourhood, the history of the occlusion may stray from the neighbourhood's mean: larger ghosts more and flickers less; zero or less, no clamp.",
    screenProbeShortRangeAOApplyDuringIntegration:
      'Whether the short-range occlusion is applied to the light of a pixel, and the rough specular of a pixel weighed by the share of each direction it leaves open, at the integration (before the temporal blend, so that it streaks on moving objects; the history then keeps none of it, and the occlusion is searched at the reduction of the integration, screenProbeIntegrateDownsampleFactor, which it must be asked the same as); false (the default), the integration weighs nothing and the occlusion goes over the light once, where the lighting reads it.',
    screenProbeShortRangeAODownsampleFactor:
      "The reduction, 1 or 2, the short-range occlusion is searched at (the pixels of the image over a texel of it): 2 searches a fourth of the pixels and rebuilds the others from their neighbours. -1 (the default) takes the level's own (high 2, ultra and cinematic 1). It is 1 where the occlusion is applied during the integration (screenProbeShortRangeAOApplyDuringIntegration) and the integration is asked another reduction (screenProbeIntegrateDownsampleFactor), or where it is not blended with its history (screenProbeOcclusionTemporal false).",
    screenProbeIntegrateDownsampleFactor:
      'The reduction, 1 (the default) or 2, the integration of the probes runs at (the pixels of the image over a texel of it): 2 integrates a fourth of the pixels, one of each two by two block taken in turn over four images, which makes the pass faster but can blur some of the fine indirect light of a normal map; the temporal pass then rebuilds each pixel from the four texels round it, picked stochastically by their depth and normal. It is 1 where the short-range occlusion is applied during the integration (screenProbeShortRangeAOApplyDuringIntegration) at another reduction than this one (screenProbeShortRangeAODownsampleFactor), and where the level casts no probe or its tiles are not classified (screenProbeIntegrationTileClassification false). With both at 2 the occlusion is searched at the same reduction.',
    screenProbeIntegrationTileClassification:
      "Whether the integration of the probes is dispatched over lists of tiles of eight by eight pixels, one list for each of its three modes (true, the default): the simple mode takes the diffuse light over pi for the rough specular and samples nothing, the sampled mode samples the pixel's BRDF over the probes' radiance for its diffuse light where screenProbeDiffuseIntegralMethod asks it and samples the lobe of the rough specular, and the complete mode (any tile with a hair pixel) samples the whole sphere for hair; a tile with no lit pixel is cleared and integrated by none. A tile takes the most complete mode of its pixels. false, one dispatch over every pixel runs every branch for each of them (slower), and the integration is not downsampled (screenProbeIntegrateDownsampleFactor is then 1).",
    screenProbeDiffuseIntegralMethod:
      "How the diffuse light of a pixel is integrated from the probes it reads, 0 (the default), 1 or 2: 0 evaluates their preintegrated irradiance at the pixel's normal (the harmonics or the octahedral map their format keeps); 1 samples the pixel's diffuse BRDF eight times over the probes' coarsest filtered radiance (noisy and slower, but the same for any shading model; hair always takes it); 2 integrates numerically over every texel of the probes (the slow reference), which has no tile classification and so runs every branch for every pixel. The light is put under the occlusion of the probes and the short-range occlusion as the multiple bounces of the albedo make it.",
    screenProbeSceneTraces:
      "Whether a probe's ray the screen left is marched through the global distance field, from where the screen lost it to the reach of the probe's cell (as far as the radiance cache is asked to be traced before it is read), and, where it meets a surface, takes the light the surface cache holds there (its final lighting) — before the radiance cache answers what the march leaves; false, the screen then the radiance cache alone. The switch is shared with the reflections' march through the field.",
    screenProbeMaxTraceDistance:
      "Metres: the furthest a probe's ray looks for a surface, from 0.0001 to 10485.76; past it the ray has left the scene.",
    screenProbeMinTraceDistance:
      "Metres: the nearest a probe's scene ray starts (from the point it leaves the surface by), from 0.0001 (the default) to 10.",
    screenProbeSurfaceBias:
      "Metres: how far off the surface a probe's scene ray starts (along the surface's normal and along the ray), and, twice, how far back from where the screen lost the ray the trace begins.",
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** The interpolation, the history, the disocclusion and the screen trace. */
const HISTORY_AND_SCREEN_TRACE_MEANINGS = /* @__PURE__ */ (() =>
  ({
    screenProbeInterpolationDepthWeight:
      'The weight the plane distance of a probe, over its depth, gives in the interpolation a pixel makes between the probes round it: larger, the probes on other planes weigh nothing sooner (the exponent is this times minus ten thousand).',
    screenProbeInterpolationDepthWeightForFoliage:
      'screenProbeInterpolationDepthWeight for the pixels with backface diffuse light (thin double-sided sheets that transmit light and subsurface materials) alone: foliage has many edges, so a gentler distance test spawns fewer adaptive probes, and light leaking is less visible on it. It applies whether or not screenProbeTwoSidedFoliageBackfaceDiffuse gathers their backface light.',
    screenProbeInterpolationDepthWeightFallback:
      'The same weight for the probes a pixel falls back to where the first weights left none.',
    screenProbeHistoryDistanceThreshold:
      "The relative depth difference past which a pixel's history is another surface's and is dropped (raised at the grazing angles of the surface): lower removes ghosting, raises flicker.",
    screenProbeHistoryDistanceThresholdForFoliage:
      "screenProbeHistoryDistanceThreshold for the pixels with backface diffuse light (thin double-sided sheets that transmit light and subsurface materials) alone: foliage has many edges and discontinuities, so a larger threshold keeps more of its history. A history texel of the other kind (a sheet's against a solid surface's) is dropped whatever the threshold.",
    screenProbeRejectBasedOnNormal:
      "Whether a pixel's history is also dropped where the surface kept there faces another way than the pixel's (past screenProbeNormalThreshold): it removes the streaks a moving object leaves on the ground under it, for a little more cost.",
    screenProbeNormalThreshold:
      "The angle, in degrees, past which a history texel's normal is another surface's (with screenProbeRejectBasedOnNormal on).",
    screenProbeRelativeSpeedThreshold:
      "The speed difference, over the probe's depth (a metre at least), from which the end of a ray counts as moving against its probe.",
    screenProbeFastUpdateFraction:
      "The share of a pixel's light that must move (rays ending on moving surfaces) for its history to give way entirely.",
    screenProbeMaxFastUpdate:
      'The most the history gives way by where the light moves, from 0 to 1: nearer 1, faster to follow the change and noisier.',
    screenProbeFastUpdateClamp:
      "Whether the history is held to the new light's three-by-three neighbourhood around the moving objects.",
    screenProbeImportanceIncomingLighting:
      "Whether the importance sampling also follows the light that reaches the probe: each direction's probability is the cosine lobes' times the light's; false, the cosine lobes alone (with screenProbeImportanceSampling on).",
    screenProbeProbeRadianceHistory:
      "Whether the light the importance sampling follows is the last image's filtered probes (reprojected to where this probe stood); false, the world's bounce probes alone.",
    screenProbeMinPdfToTrace:
      'The least share of the cosine lobes, from 0 to 1, for which a ray is traced: a direction under it gives its ray to a more probable one, which is traced as four. Larger darkens corners, smaller noises them.',
    screenProbeSpatialFilterPositionWeightScale:
      "The scale of the weight a neighbouring probe's depth gives its light in the spatial filter: larger, the probes on other surfaces weigh nothing sooner.",
    screenProbeSpatialFilterMaxHitAngle:
      "Degrees: the angle past which a neighbouring probe's ray, seen from this probe, no longer weighs in the spatial filter.",
    screenProbeDisocclusionMaxFrames:
      "The frames the history of a probe's pixels holds under which a pixel counts as disoccluded; 0 turns the disocclusion filtering off.",
    screenProbeDisocclusionFraction:
      "The share, from 0 to 1, of a probe's pixels that must be disoccluded for the probe to be, which relaxes its spatial filter's angle test.",
    screenProbeHistoryDepthTestThickness:
      "How far apart, in device depth, a screen trace's hit and the last image's depth may be for the last image's lit colour to answer the ray, times the projection's depth scale (1 under a perspective); larger keeps more hits and ghosts more.",
    screenProbeRelativeDepthThickness:
      "The thickness, relative to its depth, the screen trace gives a surface it crosses (0.02 by default), times the projection's depth scale (1 under a perspective): larger finds hits behind thin edges.",
    screenProbeMaxIterations:
      "The most steps the screen trace's march takes through the depth pyramid.",
    screenProbeFixedJitterIndex:
      "From 0 on, the temporal index of the probes' jitter, of the directions of their rays and of the history they read is this index held, for debugging and to inspect the sampling patterns (-1 by default: it moves with the image). When -1, stochasticLightingFixedStateFrameIndex holds it if that is set, else screenProbeFixedStateFrameIndex.",
    screenProbeFixedStateFrameIndex:
      "From 0 on, the frame index the noise of the probes' screen trace, of the short-range occlusion and of the last blend of the light is drawn at is this index held, for debugging (-1 by default: it moves with the image; stochasticLightingFixedStateFrameIndex wins over it). It also holds the probes' jitter while screenProbeFixedJitterIndex and stochasticLightingFixedStateFrameIndex are -1.",
    stochasticLightingFixedStateFrameIndex:
      "From 0 on, the frame index the noise of the stochastic lighting is drawn at is this index held, for debugging (-1 by default: it moves with the image): the pixels' history test and the texel of the occlusion each pixel reads. It also holds the noise screenProbeFixedStateFrameIndex holds, and the probes' jitter while screenProbeFixedJitterIndex is -1.",
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** The radiance cache of the world's probes, the thickness of the surfaces and the foliage. */
const RADIANCE_CACHE_AND_FOLIAGE_MEANINGS = /* @__PURE__ */ (() =>
  ({
    screenProbeRadianceCache:
      "Whether the light a probe's ray finds beyond the screen and the near scene is read from the world's probes' radiance maps — every world probe holds the light it sees by direction, traced over its own octahedron, filtered with its neighbours and read by the eight probes round the point, as a level's row sets the map's side and the probes traced an image; false, such a ray sees the sky alone.",
    screenProbeRadianceCacheReprojectionRadiusScale:
      "How far, as a multiple of the probes' nearest ray start (the diagonal of their cell), the direction a ray reads a probe by is moved onto a sphere round the probe: larger, the probes read more as if their light came from far away.",
    screenProbeRadianceCacheFramesToKeepProbes:
      'The frames a world probe that no pixel reads any more stays in the radiance cache before it is given back (8 by default): larger, more probes are reused from one image to the next, but a pixel may filter from probes whose light is stale; 0, a probe is kept only while it is read.',
    screenProbeRadianceCacheTemporaryAtlasDownsampleFactor:
      "The factor, from 1 to 1024 (6 by default), the radiance cache's atlas is divided by for the temporary atlas the world probes one image updates are traced into: the pool over it is the most probes an image queues at a small budget (four times the budget past it). Larger, less transient memory, but a queue that may overflow and show artifacts.",
    screenProbeMarkDownsampleFactor:
      'Where the image casts no screen probe (the level low), the cells of the radiance cache it reads are marked from one pixel in this many along each side of the image already downsampled by screenProbeInterpolateDownsampleFactor (2 by default, from 1 to 8; the pixel turns with the frame): larger marks fewer pixels, but small geometry may flicker black.',
    screenProbeInterpolateDownsampleFactor:
      'The downsampling, from 1 to 2 (2 by default), of the image that the cells of the radiance cache are marked from where the image casts no screen probe, before screenProbeMarkDownsampleFactor: one pixel in this many along each side, turning with the frame.',
    screenProbeTranslucencyReflectionsRadianceCache:
      'Whether the translucent surfaces mark the cells of the radiance cache they read: their meshes are drawn once more, at the image downsampled by screenProbeTranslucencyReflectionsMarkDownsampleFactor, and each fragment marks the cells round its point, so that a pane in front of a cell no opaque pixel reads still finds its probes; false, only the opaque surfaces mark and a translucent surface may read probes that were never traced.',
    screenProbeTranslucencyReflectionsMarkDownsampleFactor:
      'The factor, from 1 to 64 (4 by default; a power of two advised), the image is downsampled by for the translucent surfaces to mark the radiance cache from: larger marks fewer fragments but leaves cells of small panes unmarked; smaller costs more fragments. The depth pyramid level of the occlusion test follows it.',
    screenProbeTranslucencyReflectionsHizOcclusionTest:
      'Whether a translucent fragment hidden behind the opaque surfaces, by the depth pyramid, marks nothing in the radiance cache; false, it marks the cells even behind a wall.',
    screenProbeTranslucencyReflectionsClipmapFadeSize:
      'Probes, from 0.001 to 16 (4 by default): the width of the dithered transition at the edge of a level of the radiance cache over which a translucent surface moves its mark from the level to the next coarser one.',
    screenProbeRadianceCacheSpatialFilter:
      "Whether a world probe's radiance is averaged, texel by texel, with its six neighbours' — each weighed by the angle its ray makes and by whether a surface stands between the two probes — when it is traced; false, as traced.",
    screenProbeRadianceCacheFilterHitAngle:
      "Radians: the angle past which a neighbouring world probe's ray, seen from this probe, no longer weighs in the radiance filter; larger filters nearby features and leaks more.",
    screenProbeRadianceCacheTraceTiles:
      "How densely a world probe's radiance map is traced: full (the default), the whole side for every probe; half, half the side; supersampled, twice the side, averaged down. Whichever it is, a probe past the downsample distance, or one first traced where the budget had no room, is traced at half a side, and one within the supersample distance at twice it.",
    screenProbeRadianceCacheDownsampleDistance:
      'Metres: the probes further than this from the eye are always traced at half a side.',
    screenProbeRadianceCacheSupersampleDistance:
      'Metres: only the probes nearer the eye than this may be supersampled; zero or less, none.',
    screenProbeRadianceCacheMipmaps:
      "The levels of detail of the radiance cache's maps, from 1 to 3: a ray's cone wider than a texel of the map reads a coarser level (each half the side of the one before), so that the maps' texels are not aliased; 1 keeps the whole side alone.",
    screenProbeRadianceCacheSkyVisibility:
      'Whether the radiance cache keeps the sky apart from the light: each texel holds, beside the light the rays found on surfaces, the share of its ray that left the scene, which the reader fills with the sky itself in that direction (the sky then follows the current sun without the maps being traced again); false, the sky is in the light.',
    screenProbeRadianceCacheHardwareRayTracing:
      "Whether a world probe's rays are cast through the scene's triangles (where the scene has acceleration structures, once the program is compiled) instead of marched through the global distance field: from the nearest a ray starts at, to the probes' reach less hardwareRayTracingPullbackBias, passing the translucent primitives and culling no face; the light of a hit is the surface cache's, read at its point from the cards of the placement it met with surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias, the back of a one-sided primitive bringing none; a ray that hits nothing leaves the scene, and one that stopped after surfaceCacheHardwareRayTracingMaxIterations triangles without a hit is a black hit.",
    hardwareRayTracingPullbackBias:
      "Metres: the pull-back bias every ray cast through the scene's triangles shares (0.08 by default, 8 centimetres): how far short of the probes' reach a world probe's ray ends (with screenProbeRadianceCacheHardwareRayTracing), and how far nearer than where the screen lost it a screen probe's ray resumes (with screenProbeHardwareRayTracing).",
    screenProbeHardwareRayTracing:
      "Whether the rays the screen left are cast through the scene's triangles (where the scene has acceleration structures, once the program is compiled) instead of marched through the global distance field (with screenProbeSceneTraces on): from where the screen lost the ray, pulled back by hardwareRayTracingPullbackBias, to the reach of the probe's cell, off the probe's surface along its normal by screenProbeHardwareRayTracingNormalBias (the normal turned toward the ray on a thin double-sided sheet) and no nearer along the ray than screenProbeHardwareRayTracingBias (screenProbeHardwareRayTracingHairBias for a hair pixel), passing the translucent primitives and avoiding the geometry the ray starts on as surfaceCacheHardwareRayTracingAvoidSelfIntersections says; the light of a hit is the surface cache's, read at its point from the cards of the placement it met with surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias, nothing from a hit nearer than surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache nor from the back of a one-sided primitive, dithered into the ray's word; a ray that stopped after surfaceCacheHardwareRayTracingMaxIterations triangles without a hit is a black hit; the rays that hit nothing are answered by the radiance cache.",
    screenProbeHardwareRayTracingBias:
      "Metres: the nearest along its direction a screen probe's ray through the scene's triangles starts (0.001 by default, a tenth of a centimetre); used only with screenProbeHardwareRayTracing.",
    screenProbeHardwareRayTracingNormalBias:
      "Metres: how far off its surface, along the probe's normal, a screen probe's ray through the scene's triangles starts (0.001 by default); used only with screenProbeHardwareRayTracing.",
    screenProbeHardwareRayTracingHairBias:
      "Metres: the nearest along its direction a ray through the scene's triangles starts from a hair pixel (0.02 by default), where the triangles heavily mismatch the surface drawn; used only with screenProbeHardwareRayTracing.",
    screenProbeThicknessScaleWithoutField:
      "The scale of the thickness the screen trace gives the depth buffer's surfaces at a pixel whose surface has no distance field to resume a ray behind it (2 by default; 1 where it has one): larger treats those surfaces as thicker; used only where the image's rays are not cast through the scene's triangles (screenProbeHardwareRayTracing off, or the scene without acceleration structures or its program not yet compiled), which make it 1 for every pixel.",
    screenProbeThicknessCertaintySteps:
      'The linear steps taken along the ray past a screen hit, from 0 to 64 (4 by default), that look for a thin feature in front of it and drop the hit if one is found; used only where foliage hits are not skipped (screenProbeSkipFoliageHits off), else 0.',
    screenProbeSkipFoliageHits:
      "Whether a screen trace's hit on a thin double-sided sheet that transmits light (a leaf, a curtain: a material with a subsurface colour) is dropped, so the ray goes on to the next stage; true by default, which avoids the aliasing of high-frequency foliage. The probes' march reads the half-resolution level of the depth pyramid or the full-resolution depth by hizFullResDepth.",
    screenProbeSkipHairHits:
      "Whether a screen trace's hit on a hair pixel is dropped, so the ray goes on to the next stage; false by default. True also keeps the pixels of hair from tracing the screen at all, their rays going on to the next stage whole: a way to avoid the aliasing of high-frequency hair cards.",
    screenProbeSkipUnlitHits:
      "Whether a screen trace's hit on an unlit surface is dropped, so the ray goes on to the next stage; false by default. A way to avoid the noise of strong emissives.",
    screenProbeScreenTracesHairBias:
      "Metres: how far along its direction a screen probe's ray from a hair pixel starts (0.02 by default, two centimetres), where hair is complex geometry that needs a bias of its own; used only with screenProbeScreenTraces.",
    screenProbeSkylightLeakingRoughness:
      "The roughness the sky light is read at for the light that leaks onto the surfaces a probe's ray finds (0.3 by default): 0 gives the sky unfiltered, larger values hide its features in the leaking. The leaking itself is the sky light's share reflectionSkylightLeaking names, tinted by reflectionSkylightLeakingTintRed, …Green and …Blue, which both the reflections and the probes' rays take (none by default).",
    screenProbeFullSkylightLeakingDistance:
      "Metres: the distance of a probe's ray hit at which the sky light leaks onto it whole (10 by default; the share grows linearly from the probe's surface), held to the furthest a ray looks (screenProbeMaxTraceDistance); used only where reflectionSkylightLeaking is above 0.",
    screenProbeHeightFogOnGI:
      "Whether the height fog is laid over the light the probes' rays bring back from the scene, as it is over the reflections' rays (false by default: the effect is usually less noticeable than on the reflections, and in a heavily fogged scene it mismatches the direct lighting, the sky lighting being removed). A ray a hit found is fogged along the distance it hit at, from the point it started at; a ray that found nothing, and was answered by the radiance cache or the sky, from the probe's own point over at least reflectionMinDistanceForFoggingSky; the fog is laid on the light where it is written, with no pass of its own; the rays the screen answered already hold the fog the image drew. It needs reflectionHeightFog on, and is used only at a level that casts probes.",
    screenProbeTwoSidedFoliageBackfaceDiffuse:
      "Whether the pixels of a thin double-sided sheet that transmits light (a leaf, a curtain: a material with a subsurface colour) gather the light along their backface from the probes, accumulated like the front's and lit on the subsurface colour, over a level that allows it (ultra and cinematic do; high does not); false, or at a level that does not, the back of the sheet reads the sky light's irradiance.",
    screenProbeMaxRoughnessToEvaluateRoughSpecular:
      "The roughness past which a pixel's rough specular reflection is the diffuse light over pi instead of four samples of its GGX lobe in the probes' radiance (blended over the 0.2 below it); a pixel whose reflection is traced whole takes the diffuse light too. Lower values save cost and lose rough specular.",
    screenProbeMaxRoughnessToEvaluateRoughSpecularForFoliage:
      "The same roughness for the pixels of a thin double-sided sheet that transmits light (a leaf, a curtain). Negative, the default, is the row of the reflections' level (reflectionQuality): 0.4 at high, 0.8 at ultra and cinematic and where the reflections are off.",
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** What each setting of the screen probes means (`../bounce/screenProbeOptions.ts`); they apply where the
 *  bounce is on and the scene has a lit surface. The defaults and the ranges are the schema's own. */
export const SCREEN_PROBE_MEANINGS: Readonly<Record<ScreenProbeField, string>> =
  /* @__PURE__ */ (() => ({
    ...PLACEMENT_AND_FILTER_MEANINGS,
    ...OCCLUSION_AND_TRACE_MEANINGS,
    ...HISTORY_AND_SCREEN_TRACE_MEANINGS,
    ...RADIANCE_CACHE_AND_FOLIAGE_MEANINGS,
  }))()
