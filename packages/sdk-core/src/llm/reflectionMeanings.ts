import {
  REFLECTION_RULES,
  REFLECTION_WORK_PER_STEP,
  type ReflectionField,
} from '../contracts/reflectionOptions.ts'

/** What each setting of the reflections' trace means (`../contracts/reflectionOptions.ts`); they apply where
 *  the scene has a reflecting surface the screen cannot answer. The defaults and the ranges are the schema's own. */
export const REFLECTION_MEANINGS: Readonly<Record<ReflectionField, string>> = {
  reflectionScreenSteps: `The iterations of the march a reflected ray makes of the depth pyramid before the scene answers (${REFLECTION_RULES.reflectionScreenSteps.default} by default): a ray whose march spends them has hit nothing on the screen and goes on to the scene. Fewer steps cost less and let the screen miss thin or far surfaces.`,
  reflectionRingSteps: `The steps a reflected ray may take in each ring of the scene (${REFLECTION_RULES.reflectionRingSteps.default} by default): the four cubes of the world's probes about the eye cut the ray into as many segments, each walked with this budget — a step is ${REFLECTION_WORK_PER_STEP} units of the scene tracer's work, a box or a triangle tested — and the nearest surface of the first segment that holds one ends the ray. A ring that spends its steps hits nothing: the ray goes on at the ring's end, and a ray that meets nothing answers the sky. More steps reach more of a dense street; fewer cost less and let a crowded ring show the sky. screenProbeSceneTraces switches the scene trace, here as for the screen probes: false, a ray goes from the screen to the sky.`,
}
