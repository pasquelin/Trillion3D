import { SCREEN_PROBE_LEVEL_KNOBS, type CastingLevel } from '../bounce/screenProbeLevels.ts'
import type { ScreenProbeField } from '../bounce/screenProbeOptions.ts'

/** What one level holds, in words: its tile, adaptive samples, rays a side and irradiance format. */
const levelRow = (level: CastingLevel) => {
  const knobs = SCREEN_PROBE_LEVEL_KNOBS[level]
  const format = knobs.irradianceFormat === 'sh3' ? 'spherical harmonics' : 'octahedral irradiance'
  return `${level} ${knobs.downsampleFactor}-pixel tiles, ${knobs.adaptiveProbes} adaptive samples, ${knobs.tracingResolution} rays a side, ${format}`
}

/** What each setting of the screen probes means (`../bounce/screenProbeOptions.ts`); they apply where the
 *  bounce is on and the scene has a lit surface. The defaults and the ranges are the schema's own. */
export const SCREEN_PROBE_MEANINGS: Readonly<Record<ScreenProbeField, string>> = {
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
    "The most radiance a ray adds to its probe: a brighter ray is scaled down to it, so that a lit pixel's glare does not flicker in the probes.",
  screenProbeTemporal:
    "Whether a pixel's indirect light is blended with its history, reprojected through the last image's view; false, each image stands alone.",
  screenProbeMaxFramesAccumulated:
    "The frames a pixel's history holds at most, from 1 (scaled by screenProbeUpdateSpeed, and a count past 15 is kept in four bits as a share of it): each new image enters at one over one plus the frames held.",
  screenProbeMaxRayDirections:
    "The directions a probe's rays turn through before they come round, from 1: each image traces each texel of the probe's octahedron through one of this many points of it, so that the history averages them. Should follow screenProbeMaxFramesAccumulated.",
  screenProbeMaterialAO:
    "Whether the material's own ambient occlusion darkens the probes' indirect light, with the multiple bounces of the albedo (capped at screenProbeOcclusionMaxAlbedo) as the short-range occlusion has them; false, the material's occlusion does not reach it.",
  screenProbeShortRangeOcclusion:
    'Whether the contact shadow the probes cannot hold is searched in the depth round each pixel (a horizon search, a level sets its slices) and applied to the indirect light; false, none.',
  screenProbeOcclusionIntensity:
    'How strongly the short-range occlusion applies, from 0 (none) to 1 (whole).',
  screenProbeOcclusionTemporal:
    'Whether the short-range occlusion is blended with its history, held to the mean and deviation of its neighbourhood (screenProbeOcclusionClampScale); false, each image stands alone.',
  screenProbeOcclusionSteps:
    'The samples of the depth the horizon search takes along each side of a slice, from 1.',
  screenProbeOcclusionForegroundFraction:
    "How much nearer to the eye than the pixel, as a share of the pixel's depth, a sample must be to count as foreground and have its occlusion rejected.",
  screenProbeOcclusionMaxAlbedo:
    'The albedo above which the multiple bounces of the occlusion see none more (the material occlusion too): near-white surfaces keep some.',
  screenProbeOcclusionClampScale:
    "How far, in deviations of its neighbourhood, the history of the occlusion may stray from the neighbourhood's mean: larger ghosts more and flickers less; zero or less, no clamp.",
  screenProbeSceneTraces:
    "Whether a probe's ray the screen left is traced against the scene's coarse geometry — the proxy the world's probes and the reflections cast their rays over, its first surface lit where the ray lands — before the world's probes answer what it leaves; false, the screen then the world's probes alone. The coarse trace goes as far as the reach of the probe's cell.",
  screenProbeMeshTraces:
    'Whether the scene trace goes further for the probes near the eye (screenProbeMeshTraceDistance, within screenProbeMeshTraceEndDistance of it): a hit is then taken by noise and fades out over the last sixth of that distance; never at the high level.',
  screenProbeMeshTraceDistance:
    "Metres: the furthest a probe's ray near the eye is traced in detail when screenProbeMeshTraces is on, above 0: the coarse trace takes the ray from there to the reach of the probe's cell.",
  screenProbeMeshTraceEndDistance:
    'Metres: the distance from the eye within which the detail trace applies and past which it fades out.',
  screenProbeMaxTraceDistance:
    "Metres: the furthest a probe's ray looks for a surface, from 0.0001 to 10485.76; past it the ray has left the scene.",
  screenProbeMinTraceDistance:
    "Metres: the nearest a probe's scene ray starts (from the point it leaves the surface by), 0 by default.",
  screenProbeSurfaceBias:
    "Metres: how far off the surface a probe's scene ray starts (at least the proxy's own certified error), and, twice, how far back from where the screen lost the ray the trace begins.",
  screenProbeInterpolationDepthWeight:
    'The weight the plane distance of a probe, over its depth, gives in the interpolation a pixel makes between the probes round it: larger, the probes on other planes weigh nothing sooner (the exponent is this times minus ten thousand).',
  screenProbeInterpolationDepthWeightFallback:
    'The same weight for the probes a pixel falls back to where the first weights left none.',
  screenProbeHistoryDistanceThreshold:
    "The relative depth difference past which a pixel's history is another surface's and is dropped (raised at the grazing angles of the surface): lower removes ghosting, raises flicker.",
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
    "How far apart, in device depth, a screen trace's hit and the last image's depth may be for the last image's lit colour to answer the ray; larger keeps more hits and ghosts more.",
  screenProbeRelativeDepthThickness:
    'The thickness, relative to its depth, the screen trace gives a surface it crosses: larger finds hits behind thin edges.',
  screenProbeMaxIterations:
    "The most steps the screen trace's march takes through the depth pyramid.",
  screenProbeRadianceCache:
    "Whether the light a probe's ray finds beyond the screen and the near scene is read from the world's probes' radiance maps — every world probe holds the light it sees by direction, traced over its own octahedron, filtered with its neighbours and read by the eight probes round the point, as a level's row sets the map's side and the probes traced an image; false, such a ray sees the sky alone.",
  screenProbeRadianceCacheReprojectionRadiusScale:
    "How far, as a multiple of the probes' nearest ray start (the diagonal of their cell), the direction a ray reads a probe by is moved onto a sphere round the probe: larger, the probes read more as if their light came from far away.",
  screenProbeRadianceCacheSpatialFilter:
    "Whether a world probe's radiance is averaged, texel by texel, with its six neighbours' — each weighed by the angle its ray makes and by whether a surface stands between the two probes — when it is traced; false, as traced.",
  screenProbeRadianceCacheFilterHitAngle:
    "Radians: the angle past which a neighbouring world probe's ray, seen from this probe, no longer weighs in the radiance filter; larger filters nearby features and leaks more.",
  screenProbeRadianceCacheTraceTiles:
    "How densely a world probe's radiance map is traced: adaptive, half a side everywhere the pixels do not ask for more and the full side where their lobes do, within the downsample distance of the eye; half, full or supersampled (twice the side, averaged down), the same for every probe.",
  screenProbeRadianceCacheDownsampleDistance:
    'Metres: the probes further than this from the eye are always traced at half a side.',
  screenProbeRadianceCacheSupersampleDistance:
    'Metres: only the probes nearer the eye than this may be supersampled; zero or less, none.',
  screenProbeRadianceCacheMipmaps:
    "The levels of detail of the radiance cache's maps, from 1 to 3: a ray's cone wider than a texel of the map reads a coarser level (each half the side of the one before), so that the maps' texels are not aliased; 1 keeps the whole side alone.",
  screenProbeRadianceCacheSkyVisibility:
    'Whether the radiance cache keeps the sky apart from the light: each texel holds, beside the light the rays found on surfaces, the share of its ray that left the scene, which the reader fills with the sky itself in that direction (the sky then follows the current sun without the maps being traced again); false, the sky is in the light.',
  screenProbeRadianceCacheSupersampleThreshold:
    "The share, from 0 to 1, of the pixels' lobes above which a full-side tile of a probe's map is traced again at twice the side.",
}
