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
    screenProbes: `How a pixel gets its indirect light: from probes placed on the screen, one a tile of pixels, each tracing the screen, then the scene, then the world's bounce probes, filtered in space and time. A level sets the tile, the rays and the probes' format: ${levelRow('high')}; ${levelRow('ultra')}; ${levelRow('cinematic')}. off lights nothing the screen probes do (the pixels' indirect light is then black while the bounce is on), and the smooth quality preset writes the bounce off with it; the balanced preset is the high level with the irradiance field gathering the light (finalGatherMethod). true is the default level, false is off.`,
    screenProbeQuality:
      "Scale on the screen probes' rays and tiles: the rays along a probe's side follow its square root (powers of two, 4 to 16); from 6 the tiles are halved, from 4 the jitter of the probes a pixel reads is.",
    screenProbeUpdateSpeed:
      "Scale on how fast the indirect light follows a change: the frames a pixel's history holds follow the inverse of its square root, read from 0.5 to 8.",
    screenProbeAdaptiveFraction:
      "Share of the uniform probes the adaptive placement may add where a tile's probes do not cover a surface; 0 places none, above 1 is allowed.",
    screenProbeGatherScale:
      "The side of the octahedron a probe's rays are filtered and integrated at, as a multiple of the side they are traced at, from 0.1 to 4: under 1 the whole number nearest its inverse divides the tracing side, from 1 the whole number nearest it multiplies it, to at most 16 texels a side (the workgroup memory of the conversion).",
    screenProbeScreenTraces:
      "Whether a probe's ray first looks for what the last image shows (the depth pyramid and the lit image) before the world's bounce probes answer it; false, every ray is the bounce probes' alone.",
    screenProbeImportanceSampling:
      "Whether the probes' rays go where the light is: the directions are drawn by the cosine lobes of the pixels the probe stands for and by the light the last image gathered there, three rays under the minimum probability giving their place to one ray of the best, refined into four; false, the same octahedron of rays at every probe.",
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** The spatial and temporal filters. */
const FILTER_MEANINGS = /* @__PURE__ */ (() =>
  ({
    screenProbeSpatialFilter:
      "Whether a probe's gathered light is averaged with the four probes beside it, each weighed by its depth and by the angle its ray makes, as many passes as screenProbeSpatialFilterPasses; false, none.",
    screenProbeSpatialFilterPasses: 'Passes of the spatial filter.',
    screenProbeSpatialFilterKernel:
      'The half size of the spatial filter kernel: any value above 0 runs the filter, 0 turns it off (the filter itself is the fixed neighbourhood of four probes, eight more where a probe moves).',
    screenProbeMaxRayIntensity:
      "The most radiance a ray adds to its probe: a brighter ray is scaled down to it, so that a lit pixel's glare does not flicker in the probes. A number of the pre-exposed light (the light as the camera's exposure scales it, the reference's own unit), so a darker exposure holds a brighter scene radiance to it. Held to 100000 at most.",
    screenProbeTemporal:
      "Whether a pixel's indirect light is blended with its history, reprojected through the last image's view; false, each image stands alone.",
    screenProbeDownsampleFactor:
      "Pixels along a side of the tile one probe is placed on, from 4 to 64; a negative value takes the level's row.",
    screenProbeTracingResolution:
      "Rays along a side of a probe's octahedron before the quality scales them, 4 to 16 (a power of two); a negative value takes the level's row.",
    screenProbeNumAdaptiveProbes:
      "Adaptive probes a tile may add (4 takes a 2 by 2 sample grid, 8 a 4 by 2, 16 or more a 4 by 4); a negative value takes the level's row.",
    screenProbeFullResolutionJitterWidth:
      "The width, in tiles, the point a pixel reads its probes from is jittered by (halved from quality 4); a negative value takes the level's row.",
    screenProbeOcclusionSlices:
      "View-space slices the short-range occlusion searches a pixel along; a value under 1 takes the level's row.",
    screenProbeOcclusionForegroundPower:
      "How strongly occluders in front of the horizon weigh, held to 0.1 to 10; a negative value takes the level's row.",
    screenProbeOcclusionPyramid:
      "Whether the short-range occlusion reads the depth pyramid (1, quicker, less detail on thin occluders) or the depth itself (0); a negative value takes the level's row.",
    screenProbeIrradianceFormat:
      "How a probe keeps its irradiance: 'level' the level's row, 'sh3' spherical harmonics, 'octahedral' an octahedral map; an occlusion applied during the integration with the bent normal always takes the harmonics.",
    screenProbeRadianceCacheUpdate:
      "Whether the world's probes are updated at every image (their marks, the probes given back and the maps traced); false freezes them as they are, for debugging.",
    screenProbeRadianceCacheForceFullUpdate:
      "Whether every image updates the whole world's probes cache at no budget (every probe given back and traced anew, after the final maps and the sky's share are set to black), for debugging.",
    screenProbeGatherDebug:
      "Writes over the image the number of screen probes, of the uniform ones and of the adaptive ones, for debugging (off by default); read back from the GPU a few images late. The diagnostic mode 'screen-probe-gather-debug' shows it whatever the setting says.",
    screenProbeTileDebugMode:
      "Writes over the image the table of the integration's tile classification: the tiles of the simple, importance sampled and complete modes and their total, with the legend of the three, for debugging (off by default); read back from the GPU a few images late. The diagnostic mode 'screen-probe-tile-stats' shows it whatever the setting says.",
    screenProbeGatherDebugProbePlacement:
      "Draws over the image where the screen probes stand, for debugging (0 off, the default): 1 a small yellow quad at the pixel of every uniform probe and a magenta one at each adaptive probe's, 2 the adaptive probes' alone, 3 a cross and a line along the normal, ten centimetres long, at the point of every probe (yellow uniform, magenta adaptive). The diagnostic mode 'screen-probe-placement' shows 1 whatever the setting says.",
    screenProbeRadianceCacheStats:
      "Writes over the image the update statistics of the world's probes (the probes the atlas holds out of the most it can, those holding nothing yet, those not traced since the lights changed, those refused for want of a slot, those queued this image and the cells marked), for debugging (off by default); read back from the GPU a few images late. The diagnostic mode 'radiance-cache-stats' shows it whatever the setting says.",
    screenProbeDebugForceTracesMoving:
      'Whether every probe counts as moving (its history gives way and its filter reaches twelve neighbours), for debugging.',
    screenProbeReferenceMode:
      "Whether the probes are the slow reference of the indirect light: tiles of 16 pixels, 32 rays along a probe's side (workgroups of 1024 threads: a device granting fewer refuses the probes), a gather side of 8, every pixel integrated numerically over the probes' radiance, and no importance sampling, spatial filter, probe filtering in time, radiance cache or short-range occlusion, whatever those settings say.",
    screenProbeFilteringWaveOps:
      "Whether the conversion of a probe's radiance to its harmonics sums over the subgroups of the device (32 or 64 lanes, where every subgroup has as many) instead of one thread adding the texels in turn: the same sums, added in another order.",
    screenProbeScreenTracesMinimumOccupancy:
      "The number of lanes of a subgroup (32 threads) that must still be marching the depth pyramid for the screen trace of a probe's ray to go on (0 by default: never given up): when fewer are left, the rays still marching give the screen up where they stopped and go on to the scene. A scalability setting that abandons the few long traces that keep a whole subgroup waiting.",
    screenProbeScreenTracesHZBTraversal:
      "Whether a probe's ray walks the depth pyramid hierarchically, which finds thin features, or casts a ray of 16 fixed steps over the furthest depth, limited to a fifth of the screen's width, which is quicker and misses thin features and ends at the first sample behind a surface.",
    screenProbeRadianceCacheSortTraceTiles:
      "Whether the trace tiles of the world's probes are ordered by the direction they trace, in groups of 64 tiles, before they are traced, so that the rays of a subgroup point the same way (false by default, as the reference).",
    screenProbeOcclusionVisibilityBitmask:
      "Whether the short-range occlusion keeps, for each slice, a bitmask of 32 sectors the samples occlude (a sample's surface given a thickness of half the foreground fraction of the pixel's depth), instead of the highest horizon of each side: a thin occluder then leaves the sectors beside it open. The direction of the open sky is not found in this mode (the normal stands in for it).",
    screenProbeOcclusionHorizonSearch:
      'Whether the short-range occlusion searches the depth along view-space slices for the occluded horizon (true), or integrates the hemisphere stochastically: 4 rays a pixel (8 from a quality of 2, 16 from 6), cosine distributed, each cast over the furthest depth in four steps, blocked where it meets a surface.',
    screenProbeOcclusionSlopeCompareToleranceScale:
      'Scales the slope tolerance of the rays the stochastic hemisphere casts to tell a hit (0.5 by default); read only where the horizon search is off.',
    screenProbeShortRangeGI:
      "Whether the short-range occlusion also gathers the light the near surfaces of the last image give a pixel (experimental in the reference): along its slices, past the occlusion's reach to a fraction of the screen, the horizon's new surfaces add their lit colour, weighed by the share of the horizon they raise, the cosines of the two normals and a fade at the edge of the search. Only the horizon search finds it (not the visibility bitmask nor the stochastic hemisphere).",
    screenProbeShortRangeGIMaxScreenFraction:
      "The furthest the short-range global illumination reaches, as a fraction of the screen's width (0.1 by default), held between the occlusion's reach and one.",
    screenProbeShortRangeGIMaxRayIntensity:
      'The most a sample of the short-range global illumination adds, in the pre-exposed light of the last image (5 by default): a brighter one is scaled down to it.',
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** The rest of the filters. */
const FILTER_MEANINGS_REST = /* @__PURE__ */ (() =>
  ({
    screenProbeShortRangeGIHistoryDepthTestRelativeThickness:
      "The relative depth thickness within which the last image's depth must agree with a sample's expected depth for the sample to give light (0.0005 by default).",
    finalGatherMethod:
      "How the indirect light of the opaque surfaces is gathered: 'screenProbes' (the default), probes placed on the screen that trace the screen and the scene, filtered in space and time, or 'irradianceField', the world's probes placed round the pixels, their irradiance and occlusion precomputed, interpolated to the pixels: quicker, lower quality. The irradianceField* settings shape the field.",
    irradianceFieldNumClipmaps:
      'The levels of probes of the irradiance field, from 1 (4 by default); each is wider than the one before by irradianceFieldClipmapDistributionBase.',
    irradianceFieldClipmapWorldExtent:
      'The extent of the first level of the irradiance field, in metres (50 by default).',
    irradianceFieldClipmapDistributionBase:
      'The base of the power that sizes each next level of the irradiance field against the first (2 by default).',
    irradianceFieldNumProbesToTraceBudget:
      'The probes of the irradiance field traced each image, in the cost of a whole map each (100 by default).',
    irradianceFieldGridResolution:
      "The cells a side of a level of the irradiance field's probe placement grid, from 1 to 256 (64 by default).",
    irradianceFieldProbeResolution:
      "The texels a side of a probe's radiance map in the irradiance field, 8 to 64 (16 by default): the rays traced for a probe are its square.",
    irradianceFieldIrradianceProbeResolution:
      "The texels a side of a probe's irradiance map in the irradiance field (6 by default).",
    irradianceFieldOcclusionProbeResolution:
      "The texels a side of a probe's occlusion map in the irradiance field (16 by default).",
    irradianceFieldNumMipmaps:
      'The levels of detail of the radiance maps of the irradiance field, 1 to 3 (3 by default).',
    irradianceFieldProbeAtlasResolutionInProbes:
      "The probes along a side of the irradiance field's atlas, 1 to 255 (128 by default): the memory the field holds; past it the cells go unanswered.",
    irradianceFieldProbeOcclusionBias:
      'The bias off the surface, along its normal and toward the viewer, the occlusion of a probe is read at to avoid self-occlusion, in metres (0.008 by default).',
    irradianceFieldShortRangeAORadius:
      'The radius of the short-range occlusion the irradiance field gathers with, in pixels (32 by default).',
    irradianceFieldInterpolateDownsampleFactor:
      'The reduction the irradiance field is interpolated and shaded at, 1 or 2 (2 by default).',
    irradianceFieldMarkProbesDownsampleFactor:
      "The reduction, on top of the interpolation's, the pixels mark the irradiance field's probes at, 1 to 8 (2 by default): too high and small geometry flickers black.",
    irradianceFieldAdaptivePlacement:
      'Whether the irradiance field places probes where an interpolation fails for want of an unoccluded one (false by default).',
    irradianceFieldAdaptivePlacementFeedbackTileSize:
      'One pixel in every tile of this many pixels a side reports the interpolation failures of the adaptive placement, 1 to 256 (8 by default).',
    radianceCacheIrradianceProbeOffsetMode:
      "How the irradiance field's probes are moved off the surfaces they stand too near before they are traced: gbuffer (the default), toward the ideal place the image's pixels near the probe show (a fifth along their normal, four fifths toward the eye, a quarter of a cell off the surface), averaged, within a quarter of a cell of the cell's centre; globalDistanceField, to the best of 64 places within a quarter of a cell round a probe that stands within a twentieth of a cell of a surface of the global distance field; none, probes stay on their cell's centre. Adaptive probes are moved like the others. With globalDistanceField the place found is added to the probe's offset (the reference stores it alone) and the sum is held within a quarter of a cell of the cell's centre.",
    irradianceFieldMaxRoughnessToEvaluateRoughSpecular:
      'The roughness past which a pixel of the irradiance field takes its diffuse light as its rough specular (0.8 by default).',
    screenProbeClearHistoryEveryFrame:
      "Whether the probes' history is cleared at every image, for debugging: each image then stands alone, as after a camera cut.",
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
      "The most the short-range occlusion applies on the pixels of a thin double-sided sheet that transmits light (a leaf, a curtain: a material with a subsurface colour), from 0 (none) to 1 (whole): their occlusion amount is mixed toward 1 by it, which stands for the light scattering through the sheet. Negative, the default, is the level's row: 0.7 at high, ultra and cinematic (the balanced preset writes 1, whose irradiance field lights them flatter).",
    screenProbeOcclusionClampScale:
      "How far, in deviations of its neighbourhood, the history of the occlusion may stray from the neighbourhood's mean: larger ghosts more and flickers less; zero or less, no clamp.",
    screenProbeShortRangeAOApplyDuringIntegration:
      'Whether the short-range occlusion is applied to the light of a pixel, and the rough specular of a pixel weighed by the share of each direction it leaves open, at the integration (before the temporal blend, so that it streaks on moving objects; the history then keeps none of it, and the occlusion is searched at the reduction of the integration, screenProbeIntegrateDownsampleFactor, which it must be asked the same as); false (the default), the integration weighs nothing and the occlusion goes over the light once, where the lighting reads it.',
    screenProbeShortRangeAODownsampleFactor:
      "The reduction, 1 or 2, the short-range occlusion is searched at (the pixels of the image over a texel of it): 2 searches a fourth of the pixels and rebuilds the others from their neighbours. -1 (the default) takes the level's own (high 2, ultra and cinematic 1). It is 1 where the occlusion is applied during the integration (screenProbeShortRangeAOApplyDuringIntegration) and the integration is asked another reduction (screenProbeIntegrateDownsampleFactor), or where it is not blended with its history (screenProbeOcclusionTemporal false).",
    screenProbeIntegrateDownsampleFactor:
      'The reduction, 1 (the default) or 2, the integration of the probes runs at (the pixels of the image over a texel of it): 2 integrates a fourth of the pixels, one of each two by two block taken in turn over four images, which makes the pass faster but can blur some of the fine indirect light of a normal map; the temporal pass then rebuilds each pixel from the four texels round it, picked stochastically by their depth and normal. It is 1 where the short-range occlusion is applied during the integration (screenProbeShortRangeAOApplyDuringIntegration) at another reduction than this one (screenProbeShortRangeAODownsampleFactor), and where its tiles are not classified (screenProbeIntegrationTileClassification false). With both at 2 the occlusion is searched at the same reduction.',
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
      "Metres, from 0.0001 to 1: how far off the surface a probe's scene ray starts (along the surface's normal and along the ray), and, twice, how far back from where the screen lost the ray the trace begins.",
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
      "The share of a pixel's light that must move (rays ending on moving surfaces) for its history to give way entirely (taken as 0.001 at least).",
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
      'Where the image casts no screen probe (the irradiance field or the light of the screen itself gathers it, the level is off, or it is the first image), the cells of the radiance cache it reads are marked from one pixel in this many along each side of the image already downsampled by screenProbeInterpolateDownsampleFactor (2 by default, from 1 to 8; the pixel turns with the frame): larger marks fewer pixels, but small geometry may flicker black.',
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
      "How densely a world probe's radiance map is traced: automatic (the default), tile by tile at the resolution the screen probes' pixels ask for in that direction (a tile whose direction their cosine lobes weigh above screenProbeRadianceCacheSupersampleTileBrdfThreshold is traced at twice the resolution, and again at four times within the supersample distance), half the side where no screen probe's pixels reach the probe; full, the whole side for every probe; half, half the side; supersampled, twice the side, averaged down. Whichever it is, a probe past the downsample distance, or one first traced where the budget had no room, is traced at half a side, and one within the supersample distance at twice it.",
    screenProbeRadianceCacheSupersampleTileBrdfThreshold:
      "From 0 (the default is 0.1): the value of the screen probes' cosine lobes in a direction (0 to 1) above which a tile of a world probe's radiance map is traced at twice the resolution, so that the directions the pixels read most are the best sampled; read only with screenProbeRadianceCacheTraceTiles automatic.",
    screenProbeRadianceCacheDownsampleDistance:
      'Metres: the probes further than this from the eye are always traced at half a side.',
    screenProbeRadianceCacheSupersampleDistance:
      'Metres: only the probes nearer the eye than this may be supersampled; zero or less, none.',
    screenProbeRadianceCacheMipmaps:
      "The levels of detail of the radiance cache's maps, from 1 to 3: a ray's cone wider than a texel of the map reads a coarser level (each half the side of the one before), so that the maps' texels are not aliased; 1 keeps the whole side alone.",
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** The rest of the radiance cache's. */
const RADIANCE_CACHE_MEANINGS_REST = /* @__PURE__ */ (() =>
  ({
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
  }) satisfies Partial<Record<ScreenProbeField, string>>)()

/** The foliage and the roughness limits. */
const FOLIAGE_MEANINGS = /* @__PURE__ */ (() =>
  ({
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
    ...FILTER_MEANINGS,
    ...FILTER_MEANINGS_REST,
    ...OCCLUSION_AND_TRACE_MEANINGS,
    ...HISTORY_AND_SCREEN_TRACE_MEANINGS,
    ...RADIANCE_CACHE_AND_FOLIAGE_MEANINGS,
    ...RADIANCE_CACHE_MEANINGS_REST,
    ...FOLIAGE_MEANINGS,
  }))()
