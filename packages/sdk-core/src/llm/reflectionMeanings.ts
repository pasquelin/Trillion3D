import { REFLECTION_LEVEL_KNOBS } from '../contracts/reflectionLevels.ts'
import { REFLECTION_RULES, type ReflectionField } from '../contracts/reflectionOptions.ts'

const R = REFLECTION_RULES

/** What one level holds, in words: the side of its blocks, the neighbours its reconstruction reads, its minimum weight and
 *  whether it traces the transparents' front layer. */
const levelRow = (level: keyof typeof REFLECTION_LEVEL_KNOBS) => {
  const knobs = REFLECTION_LEVEL_KNOBS[level]
  const front = knobs.frontLayerTraced
    ? "the transparents' front layer traced"
    : knobs.frontLayerAllowed
      ? 'the front layer when reflectionFrontLayer asks'
      : 'no front layer'
  return `${level} a ray every ${knobs.downsample === 1 ? 'pixel' : `${knobs.downsample}x${knobs.downsample} pixels`}, ${knobs.reconstructionSamples} neighbours read, minimum weight ${knobs.reconstructionMinWeight}, ${front}`
}

/** What each setting of the reflections means (`../contracts/reflectionOptions.ts`); they apply where the
 *  scene has a reflecting surface. The defaults and the ranges are the schema's own. */
export const REFLECTION_MEANINGS: Readonly<Record<ReflectionField, string>> =
  /* @__PURE__ */ (() => ({
    reflectionQuality: `How the reflections are traced: a level sets how many rays a pixel's reflection is made of and how the rays around it are read: ${levelRow('high')}; ${levelRow('ultra')}; ${levelRow('cinematic')}. off traces no ray: every surface reads the world's probes alone, and a quality preset writes it for the two lowest; the preset 'cinematic' writes cinematic. true is the default level, false is off.`,
    reflectionScreenTraces: `Whether a reflected ray first looks at what the screen shows (on by default): it marches the depth the image drew and reads the last lit image where it meets a surface. Off, a ray goes straight to the scene, and the far screen trace and the lit image of a scene hit are off with it. The scene trace marches the global distance field (its rays have their own settings: globalDistanceFieldTraceResolution, globalDistanceFieldTraceClipmapExtent, globalDistanceFieldTraceViewDistance, globalDistanceFieldSimpleCoverageBasedExpand and the expand and step scales of the pages only two-sided meshes reach) and is switched by screenProbeSceneTraces, shared with the screen probes: false, a ray goes from the screen to the sky.`,
    reflectionScreenSteps: `The iterations of the march a reflected ray makes of the depth pyramid before the scene answers (${R.reflectionScreenSteps.default} by default): a ray whose march spends them has hit nothing on the screen and goes on to the scene from where it stopped; a ray that goes behind a surface gives the screen up there. Fewer steps cost less and see less far along the ray.`,
    reflectionRelativeDepthThickness: `How thick a surface of the screen march is, as a share of its depth (${R.reflectionRelativeDepthThickness.default} by default): a ray that passes behind a surface by more goes behind it, by less hits it.`,
    reflectionDistantScreenTraces: `Whether a reflected ray that left the outermost clipmap of the global distance field looks once more at what the screen shows, from there up to reflectionDistantScreenDistance, before the sky answers (on by default); it needs reflectionScreenTraces. false, it goes to the sky.`,
    reflectionDistantScreenSteps: `The steps of that far screen trace (${R.reflectionDistantScreenSteps.default} by default), taken in a straight line over the screen, jittered by noise.`,
    reflectionDistantScreenDistance: `Metres: how far that far screen trace goes along the ray from the surface (${R.reflectionDistantScreenDistance.default} by default).`,
    reflectionDistantScreenDepthThreshold: `How much the depth under the far screen trace may differ from the ray's, as a multiple of the slope between its steps (${R.reflectionDistantScreenDepthThreshold.default} by default): more lets it hit what it would pass in front of or behind.`,
    reflectionDistantScreenOffsetBias: `A shift of the far screen trace's jitter, in steps (${R.reflectionDistantScreenOffsetBias.default} by default).`,
    reflectionSampleSceneColor: `Whether a surface the scene trace hits takes the image the screen already lit where it agrees with the depth and faces the eye (${R.reflectionSampleSceneColor.default} by default): 0 never, 1 only where the screen is traced, 2 always. It hides the places the screen gave up behind a foreground object.`,
    reflectionHiResSurface: `Whether a surface the scene trace hits is read on the finest page of its cards that is in the surface cache (on by default); off, on the coarsest page, which is always resident.`,
    reflectionSampleSceneColorDepthThickness: `How close, as a share of its depth, a scene hit must lie to the depth the image drew to take the lit image (${R.reflectionSampleSceneColorDepthThickness.default} by default).`,
    reflectionSampleSceneColorNormalThreshold: `Degrees: how far a scene hit's face may turn from the eye and still take the lit image (${R.reflectionSampleSceneColorNormalThreshold.default} by default); 0 only a face squarely on, 180 every face.`,
    reflectionHeightFog: `Whether the light a reflected ray brings back is fogged along its length by the scene's height fog (on by default), the sky over at least reflectionMinDistanceForFoggingSky, so a reflection shows what the eye would see there.`,
    reflectionMinDistanceForFoggingSky: `Metres: the least length a ray that leaves the scene is fogged over (${R.reflectionMinDistanceForFoggingSky.default} by default), so the fog of the sky does not depend on how far the rays go.`,
    reflectionMaxRayIntensity: `The most radiance a reflected ray brings back, in the display's white (${R.reflectionMaxRayIntensity.default} by default): a ray that lights more is scaled down to it, so a bright spot is not a firefly in the reflection.`,
    reflectionTemporal: `Whether a pixel's reflection is accumulated over the images before it (on by default); off, it is the image's rays alone.`,
    reflectionMaxFramesAccumulated: `The images a pixel's reflection averages at most (${R.reflectionMaxFramesAccumulated.default} by default).`,
    reflectionNeighborhoodClampScale: `The width of the clamp that pulls the history back to the pixels round it, in standard deviations (${R.reflectionNeighborhoodClampScale.default} by default).`,
    reflectionMaxRayDirections: `The directions a lobe's rays are drawn from before the sequence repeats (${R.reflectionMaxRayDirections.default} by default).`,
    reflectionHistoryDistanceThreshold: `The relative depth past which a history texel is another surface (${R.reflectionHistoryDistanceThreshold.default} by default).`,
    reflectionDenoiserTonemapRange: `The radiance, in the display's white, past which the denoiser weighs a ray as about that much (${R.reflectionDenoiserTonemapRange.default} by default): lower suppresses more fireflies and bright detail; 0 turns it off.`,
    reflectionReconstruction: `Whether a pixel's reflection is made of the rays round it, each weighed by how well it samples the pixel's lobe (on by default); off, the pixel's own block alone.`,
    reflectionReconstructionRadius: `Pixels: how far the reconstruction reaches for rays (${R.reflectionReconstructionRadius.default} by default).`,
    reflectionBilateralFilter: `Whether a last filter blurs a pixel whose history is short by the pixels round it, across the surface (on by default).`,
    reflectionBilateralRadius: `Pixels: the reach of that filter (${R.reflectionBilateralRadius.default} by default).`,
    reflectionBilateralSamples: `The neighbours that filter reads (${R.reflectionBilateralSamples.default} by default), twice as many for a pixel with no history.`,
    reflectionBilateralDisocclusionFrames: `The images of history under which that filter runs, the more the fewer (${R.reflectionBilateralDisocclusionFrames.default} by default).`,
    reflectionMaxRoughnessToTrace: `The roughness past which a lobe casts no ray, the screen probes' rough light answering it (${R.reflectionMaxRoughnessToTrace.default} by default).`,
    reflectionRoughnessFadeLength: `The roughness band under reflectionMaxRoughnessToTrace over which a lobe's ray gives way to the probes (${R.reflectionRoughnessFadeLength.default} by default).`,
    reflectionGGXSamplingBias: `The share of a lobe's grazing normals no ray is drawn from (${R.reflectionGGXSamplingBias.default} by default): it removes the flicker of the dimmest, noisiest rays for a little of the lobe's energy.`,
    reflectionSkylightLeaking: `The share, from 0 to 1, of the sky light's diffuse light that leaks onto every surface a reflected ray hits, whatever hides it (${R.reflectionSkylightLeaking.default} by default: none): an art-direction knob that keeps interiors from going fully black in a reflection. It applies to what the scene trace returns (a hit of the scene, lit by the surface cache, at its normal, a ray that reaches the sky), before its fog, and needs a sky light; it is a hit surface of the average albedo reflectionSkylightLeakingAverageAlbedo that reflects it.`,
    reflectionSkylightLeakingTintRed: `The red linear channel (1 by default) of the colour that tints the skylight leaking of the reflected hits.`,
    reflectionSkylightLeakingTintGreen: `The green linear channel (1 by default) of the colour that tints the skylight leaking of the reflected hits.`,
    reflectionSkylightLeakingTintBlue: `The blue linear channel (1 by default) of the colour that tints the skylight leaking of the reflected hits.`,
    reflectionSkylightLeakingAverageAlbedo: `The albedo, from 0 up (${R.reflectionSkylightLeakingAverageAlbedo.default} by default), a hit surface is taken to have when it reflects the leaking sky light: it scales reflectionSkylightLeaking.`,
    reflectionStatistics: `Whether the reflections count their rays — where each ended, the steps of each march — in counters read back a few images late and published with the frame's metrics (off by default: a diagnostic that costs atomic counts and a readback every image; off, the kernels are compiled without the counting). Read when the session opens.`,
    reflectionFrontLayer: `Whether the nearest transparent surface of a pixel — glass, water — is traced like an opaque one, its own rays, history and filter (off by default; the reference's high quality translucency reflections, a project setting): true traces it where the level allows it (high never, ultra and cinematic do), and the cinematic level traces it whatever this says. Off, a transparent surface reads what the screen and the world's probes hold, never a ray, which also leaves its front pass nothing to write but the covering depth.`,
  }))()
