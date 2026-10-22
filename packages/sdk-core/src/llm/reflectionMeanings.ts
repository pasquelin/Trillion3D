import { REFLECTION_LEVEL_KNOBS } from '../contracts/reflectionLevels.ts'
import {
  REFLECTION_RULES,
  REFLECTION_WORK_PER_STEP,
  type ReflectionField,
} from '../contracts/reflectionOptions.ts'

const R = REFLECTION_RULES

/** What one level holds, in words: the side of its blocks, the neighbours its reconstruction reads and its minimum weight. */
const levelRow = (level: keyof typeof REFLECTION_LEVEL_KNOBS) => {
  const knobs = REFLECTION_LEVEL_KNOBS[level]
  return `${level} a ray every ${knobs.downsample === 1 ? 'pixel' : `${knobs.downsample}x${knobs.downsample} pixels`}, ${knobs.reconstructionSamples} neighbours read, minimum weight ${knobs.reconstructionMinWeight}`
}

/** What each setting of the reflections means (`../contracts/reflectionOptions.ts`); they apply where the
 *  scene has a reflecting surface. The defaults and the ranges are the schema's own. */
export const REFLECTION_MEANINGS: Readonly<Record<ReflectionField, string>> = {
  reflectionQuality: `How the reflections are traced: a level sets how many rays a pixel's reflection is made of and how the rays around it are read: ${levelRow('high')}; ${levelRow('ultra')}; ${levelRow('cinematic')}. off traces no ray: every surface reads the world's probes alone, and a quality preset writes it for the two lowest. true is the default level, false is off.`,
  reflectionScreenTraces: `Whether a reflected ray first looks at what the screen shows (on by default): it marches the depth the image drew and reads the last lit image where it meets a surface. Off, a ray goes straight to the scene, and the far screen trace and the lit image of a scene hit are off with it.`,
  reflectionScreenSteps: `The iterations of the march a reflected ray makes of the depth pyramid before the scene answers (${R.reflectionScreenSteps.default} by default): a ray whose march spends them has hit nothing on the screen and goes on to the scene from where it stopped; a ray that goes behind a surface gives the screen up there. Fewer steps cost less and see less far along the ray.`,
  reflectionRelativeDepthThickness: `How thick a surface of the screen march is, as a share of its depth (${R.reflectionRelativeDepthThickness.default} by default): a ray that passes behind a surface by more goes behind it, by less hits it.`,
  reflectionRingSteps: `The steps a reflected ray may take in each ring of the scene (${R.reflectionRingSteps.default} by default): the four cubes of the world's probes about the eye cut the ray into as many segments, each walked with this budget — a step is ${REFLECTION_WORK_PER_STEP} units of the scene tracer's work, a box or a triangle tested, so a ring reaches about as many placements as it has steps, more or fewer by how the scene is laid — and the nearest surface of the first segment that holds one ends the ray. A ring that spends its steps before it found a surface is skipped: the ray goes on at its end; one that found a surface keeps it. A ray that meets nothing answers the far screen trace, then the sky. More steps reach more of a dense street; fewer cost less. screenProbeSceneTraces switches the scene trace, here as for the screen probes: false, a ray goes from the screen to the sky.`,
  reflectionRingResolution: `The voxels across each ring's cube (${R.reflectionRingResolution.default} by default): a ring begins and ends one voxel of its cube inside its edge, and a ray that left the screen resumes four voxels before where it stopped.`,
  reflectionMeshTraces: `Whether the first metres of a reflected ray are walked in detail before the rings (the reference's own switch for it, on): it applies only where the screen probes' detail trace is on (screenProbeMeshTraces, off by default, and a level that allows it), whose length (screenProbeMeshTraceDistance) and fade distance (screenProbeMeshTraceEndDistance) it shares. What the detail walk finds, or where a walk that spends its steps stopped, is a hit by noise against a fade; false, the rings alone.`,
  reflectionDetailSteps: `The steps of the detail walk (${R.reflectionDetailSteps.default} by default, the units of reflectionRingSteps).`,
  reflectionDistantScreenTraces: `Whether a reflected ray that left the outermost cube of the world's probes looks once more at what the screen shows, from there up to reflectionDistantScreenDistance, before the sky answers (on by default); it needs reflectionScreenTraces. false, it goes to the sky.`,
  reflectionDistantScreenSteps: `The steps of that far screen trace (${R.reflectionDistantScreenSteps.default} by default), taken in a straight line over the screen, jittered by noise.`,
  reflectionDistantScreenDistance: `Metres: how far that far screen trace goes along the ray from the surface (${R.reflectionDistantScreenDistance.default} by default).`,
  reflectionDistantScreenDepthThreshold: `How much the depth under the far screen trace may differ from the ray's, as a multiple of the slope between its steps (${R.reflectionDistantScreenDepthThreshold.default} by default): more lets it hit what it would pass in front of or behind.`,
  reflectionDistantScreenOffsetBias: `A shift of the far screen trace's jitter, in steps (${R.reflectionDistantScreenOffsetBias.default} by default).`,
  reflectionSampleSceneColor: `Whether a surface the scene trace hits takes the image the screen already lit where it agrees with the depth and faces the eye (${R.reflectionSampleSceneColor.default} by default): 0 never, 1 only where the screen is traced, 2 always. It hides the places the screen gave up behind a foreground object.`,
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
  reflectionMaxRoughnessToTrace: `The roughness past which a lobe casts no ray, the world's probes answering it (${R.reflectionMaxRoughnessToTrace.default} by default).`,
  reflectionRoughnessFadeLength: `The roughness band under reflectionMaxRoughnessToTrace over which a lobe's ray gives way to the probes (${R.reflectionRoughnessFadeLength.default} by default).`,
  reflectionGGXSamplingBias: `The share of a lobe's grazing normals no ray is drawn from (${R.reflectionGGXSamplingBias.default} by default): it removes the flicker of the dimmest, noisiest rays for a little of the lobe's energy.`,
}
