import { BOUNCE_SETTINGS } from '../bounce/contracts.ts'
import {
  contextReader,
  integerSetting as integer,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The reflections' trace: what a reflected ray may spend on its way, stage by stage — the screen
 * first, then the scene's rings, then the far field. Run-time settings, as `./settingRules.ts` says:
 * no compiler job names them, so no manifest carries them; each is read again at each image by the
 * trace (`packages/sdk-browser/src/lighting/reflections/`), and each default is the reference's.
 *
 * THE SCREEN: a ray first marches the depth pyramid and reads the last lit image where it meets a
 * surface, `reflectionScreenSteps` iterations at most (50). A march that spends them is no hit: the
 * stages after it answer, as for a ray that left the image.
 *
 * THE SCENE, in rings: the cascades' four cubes about the eye (the cells of the world's probes, 25, 50,
 * 100 and 200 m from it) cut the ray into as many segments, from the finest cube that holds its start
 * to the outermost; each is walked on its own, `reflectionRingSteps` steps at most (256), the nearest
 * surface of the segment ending the ray. A ring that spends its steps is no hit: the ray goes on at the
 * ring's end, and a ray that meets nothing in any ring answers the sky. Its budget is counted in
 * steps, the unit the reference counts a distance field's march in; the tracer counts work, a box
 * tested, a node visited, a triangle tested (`BOUNCE_SETTINGS.probeRayWork`), and a step stands for
 * `REFLECTION_WORK_PER_STEP` units of it, the proportion the probes' own ray already holds between the
 * reference's longest ray (the four rings' 4 x 256 steps) and the work the tracer gives it. The scene trace
 * has one switch, the screen probes' (`screenProbeSceneTraces`, `../bounce/screenProbeOptions.ts`): off, a
 * ray goes from the screen to the sky, in the reflections as in the probes.
 */

/** The steps of the reference's scene trace in each ring, and the rings it has: the bounds of its
 *  longest ray, over which the engine holds its probes' work (`BOUNCE_SETTINGS.probeRayWork`). */
const REFERENCE_RING_STEPS = 256
const REFERENCE_RINGS = BOUNCE_SETTINGS.cascadeLevels

/** The tracer's work, in units (`lighting/bounce/runtime/runtimeLayout.ts`), that one step of the scene
 *  trace stands for: the probes' work over the reference's longest ray, four units. */
export const REFLECTION_WORK_PER_STEP =
  BOUNCE_SETTINGS.probeRayWork / (REFERENCE_RINGS * REFERENCE_RING_STEPS)
/** The triangle tests of the tracer that one step stands for, in the same proportion. */
export const REFLECTION_TESTS_PER_STEP =
  BOUNCE_SETTINGS.probeRayTriangles / (REFERENCE_RINGS * REFERENCE_RING_STEPS)

/** The reflections' settings by field, each with the reference's default:
 *  `reflectionScreenSteps` (50), the iterations of a ray's march of the screen; `reflectionRingSteps`
 *  (256), the steps of a ray's walk of the scene in each ring. */
export const REFLECTION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integer('reflectionScreenSteps', 50, [1, 256]),
    integer('reflectionRingSteps', REFERENCE_RING_STEPS, [1, 4096]),
  ] as const))()
/** The field of one setting of the reflections. */
export type ReflectionField = keyof typeof REFLECTION_RULES
/** The reflections' settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type ReflectionOptions = SettingOptions<typeof REFLECTION_RULES>
/** The values of the reflections' settings, resolved. */
export type ReflectionValues = SettingValues<typeof REFLECTION_RULES>

/** The work, in the tracer's units, that `steps` steps of the scene trace give a ring's walk: at least one. */
export const reflectionRingWork = (steps: number) =>
  Math.max(1, Math.round(steps * REFLECTION_WORK_PER_STEP))
/** The triangle tests that `steps` steps of the scene trace give a ring's walk: at least one. */
export const reflectionRingTests = (steps: number) =>
  Math.max(1, Math.round(steps * REFLECTION_TESTS_PER_STEP))

/** Each frame's reading of one setting of the reflections from a runtime's context. */
export const readReflectionSetting = contextReader(REFLECTION_RULES)
