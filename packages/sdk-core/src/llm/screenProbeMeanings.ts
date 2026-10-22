import { SCREEN_PROBE_LEVEL_KNOBS, type ScreenProbeLevel } from '../bounce/screenProbeLevels.ts'
import type { ScreenProbeField } from '../bounce/screenProbeOptions.ts'

/** What one level holds, in words: its tile, adaptive samples, rays a side and irradiance format. */
const levelRow = (level: Exclude<ScreenProbeLevel, 'off'>) => {
  const knobs = SCREEN_PROBE_LEVEL_KNOBS[level]
  const format = knobs.irradianceFormat === 'sh3' ? 'spherical harmonics' : 'octahedral irradiance'
  return `${level} ${knobs.downsampleFactor}-pixel tiles, ${knobs.adaptiveProbes} adaptive samples, ${knobs.tracingResolution} rays a side, ${format}`
}

/** What each setting of the screen probes means (`../bounce/screenProbeOptions.ts`); they apply where the
 *  bounce is on and the scene has a lit surface. The defaults and the ranges are the schema's own. */
export const SCREEN_PROBE_MEANINGS: Readonly<Record<ScreenProbeField, string>> = {
  screenProbes: `How a pixel gets its indirect light: from probes placed on the screen, one a tile of pixels, each tracing the screen, then the scene, then the world's bounce probes, filtered in space and time. A level sets the tile, the rays and the probes' format: ${levelRow('high')}; ${levelRow('ultra')}; ${levelRow('cinematic')}. true is the default level, false or off casts none: the pixel reads the world's bounce probes.`,
  screenProbeQuality:
    "Scale on the screen probes' rays and tiles: the rays along a probe's side follow its square root (powers of two, 4 to 16); from 6 the tiles are halved, from 4 the jitter of the probes a pixel reads is.",
  screenProbeUpdateSpeed:
    "Scale on how fast the indirect light follows a change: the frames a pixel's history holds follow the inverse of its square root, read from 0.5 to 8.",
  screenProbeAdaptiveFraction:
    "Share of the uniform probes the adaptive placement may add where a tile's probes do not cover a surface; 0 places none.",
  screenProbeScreenTraces:
    "Whether a probe's ray first looks for what the last image shows (the depth pyramid and the lit image) before the world's bounce probes answer it; false, every ray is the bounce probes' alone.",
  screenProbeImportanceSampling:
    "Whether the probes' rays go where the light is: the directions are drawn by the cosine lobes of the pixels the probe stands for and by the light the last image gathered there, three rays under the minimum probability giving their place to one ray of the best, refined into four; false, the same octahedron of rays at every probe.",
  screenProbeSpatialFilter:
    "Whether a probe's gathered light is averaged with the four probes beside it, each weighed by its depth and by the angle its ray makes, as many passes as screenProbeSpatialFilterPasses; false, none.",
  screenProbeSpatialFilterPasses: 'Passes of the spatial filter.',
  screenProbeMaxRayIntensity:
    "The most radiance a ray adds to its probe: a brighter ray is scaled down to it, so that a lit pixel's glare does not flicker in the probes.",
  screenProbeTemporal:
    "Whether a pixel's indirect light is blended with its history, reprojected through the last image's view; false, each image stands alone.",
  screenProbeMaxFramesAccumulated:
    "The frames a pixel's history holds at most (scaled by screenProbeUpdateSpeed): each new image enters at one over one plus the frames held.",
  screenProbeShortRangeOcclusion:
    'Whether the contact shadow the probes cannot hold is searched in the depth round each pixel (a horizon search along two slices) and applied to the indirect light; false, none.',
  screenProbeOcclusionIntensity:
    'How strongly the short-range occlusion applies, from 0 (none) to 1 (whole).',
  screenProbeSceneTraces:
    "Whether a probe's ray the screen left is traced against the scene's coarse geometry — the proxy the world's probes and the reflections cast their rays over, its first surface lit where the ray lands — before the world's probes answer what it leaves; false, the screen then the world's probes alone. The coarse trace goes as far as the reach of the probe's cell.",
  screenProbeMeshTraces:
    'Whether the scene trace goes further for the probes near the eye (screenProbeMeshTraceDistance, within screenProbeMeshTraceEndDistance of it): a hit is then taken by noise and fades out over the last sixth of that distance; never at the high level.',
  screenProbeMeshTraceDistance:
    "Metres: the furthest a probe's ray near the eye is traced in detail when screenProbeMeshTraces is on, from 0.01 to 200: the coarse trace takes the ray from there to the reach of the probe's cell.",
  screenProbeMeshTraceEndDistance:
    'Metres: the distance from the eye within which the detail trace applies and past which it fades out.',
  screenProbeSurfaceBias:
    "Metres: how far off the surface a probe's scene ray starts (at least the proxy's own certified error), and, twice, how far back from where the screen lost the ray the trace begins.",
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
    "The frames the history of a probe's pixels holds under which a pixel counts as disoccluded, from 1 to 15.",
  screenProbeDisocclusionFraction:
    "The share, from 0 to 1, of a probe's pixels that must be disoccluded for the probe to be, which relaxes its spatial filter's angle test.",
  screenProbeHistoryDepthTestThickness:
    "How far apart, in device depth, a screen trace's hit and the last image's depth may be for the last image's lit colour to answer the ray; larger keeps more hits and ghosts more.",
  screenProbeRelativeDepthThickness:
    'The thickness, relative to its depth, the screen trace gives a surface it crosses: larger finds hits behind thin edges.',
  screenProbeMaxIterations:
    "The most steps the screen trace's march takes through the depth pyramid, from 1 to 256.",
}
