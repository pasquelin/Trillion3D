import { clamp } from '../../../math/src/scalar/reals.ts'
import {
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
} from './settingRules.ts'

/**
 * The traced translucency (`packages/sdk-browser/src/lighting/reflections/translucency/`), settings of the
 * reflections family (`./reflectionOptions.ts`, which lists `TRACED_TRANSLUCENCY_RULES`): run-time settings as `./settingRules.ts` says, each
 * default the reference's.
 *
 * THE TRACED TRANSLUCENCY. The see-through surfaces are drawn in the scene's colour by rays cast through the scene's triangles instead of the
 * raster pass: one ray a pixel of the front transparent layer, from the eye to just short of the opaque depth, followed through the
 * surfaces it meets (the primary path) and, off each, a reflection ray and a refraction ray (the secondary paths), until the throughput of the
 * path falls under `rayTracedTranslucencyPathThroughputThreshold` or the events are spent. It is on when `rayTracedTranslucency` says so:
 * `'translucencyType'` follows the scene's translucency method (`translucencyType`, `'raster'` by default), `'off'` and `'on'` decide for it.
 *
 * - `rayTracedTranslucencyForceOpaque`, off — the rays treat every surface as opaque, so masked materials show their holes filled.
 * - `rayTracedTranslucencyRefraction` — whether the rays bend through surfaces of an index of refraction above one: `'translucencyRefraction'`
 *   follows the scene's switch of that name (off by default), `'off'` and `'on'` decide for it. On, the rays bend, the downsampling is one and the
 *   result is composed back onto the scene's colour in the last pass; off, a refractive surface lets the ray through straight.
 * - `rayTracedTranslucencySampleTranslucentReflectionInReflections`, on — a reflection ray that meets a translucent surface picks stochastically
 *   between its reflection and its refraction; off, translucent surfaces lose their reflections in reflections but the image is less noisy.
 * - `rayTracedTranslucencyPathThroughputThreshold`, 0.001 — the throughput under which a path ends.
 * - `rayTracedTranslucencyDownsampleFactor`, 1 — pixels a side one ray stands for, 1 or 2; one with ray bending.
 * - `rayTracedTranslucencyMaxPrimaryHitEvents`, −1: the scene's `translucencyMaxPrimaryHitEvents` (4) — the surfaces a primary path passes, 1 to 64.
 * - `rayTracedTranslucencyMaxSecondaryHitEvents`, −1: the scene's `translucencyMaxSecondaryHitEvents` (2) — the surfaces a secondary path passes, 0 to 64.
 * - `rayTracedTranslucencyMaxRayIntensity`, 1000 — the most a pixel's ray brings back, in the display's white (the radiance times the image's pre-exposure).
 */

/** The scene's translucency methods: the raster passes, or rays. */
export const TRANSLUCENCY_TYPES = ['raster', 'rayTraced'] as const
/** The tri-state of a switch the scene can also decide: it follows the scene (the first name), is off, or is on. */
const FOLLOW_OR = <const F extends string>(follow: F) => [follow, 'off', 'on'] as const
/** The traced translucency's settings by field, each with the reference's default. */
export const TRACED_TRANSLUCENCY_RULES = [
  choice('translucencyType', 'raster', TRANSLUCENCY_TYPES),
  choice('rayTracedTranslucency', 'translucencyType', FOLLOW_OR('translucencyType')),
  flag('rayTracedTranslucencyForceOpaque', false),
  choice(
    'rayTracedTranslucencyRefraction',
    'translucencyRefraction',
    FOLLOW_OR('translucencyRefraction'),
  ),
  flag('translucencyRefraction', false),
  flag('rayTracedTranslucencySampleTranslucentReflectionInReflections', true),
  nonNegative('rayTracedTranslucencyPathThroughputThreshold', 0.001),
  integer('rayTracedTranslucencyDownsampleFactor', 1, [1, 2]),
  integer('rayTracedTranslucencyMaxPrimaryHitEvents', -1, [-1, 64]),
  integer('translucencyMaxPrimaryHitEvents', 4, [1, 64]),
  integer('rayTracedTranslucencyMaxSecondaryHitEvents', -1, [-1, 64]),
  integer('translucencyMaxSecondaryHitEvents', 2, [0, 64]),
  nonNegative('rayTracedTranslucencyMaxRayIntensity', 1000),
] as const

/** The fields of `TRACED_TRANSLUCENCY_RULES`. */
export type TracedTranslucencyField = (typeof TRACED_TRANSLUCENCY_RULES)[number]['field']

/** The values of the settings above, as the reflections' resolved values hold them. */
export interface TracedTranslucencyValues {
  translucencyType: (typeof TRANSLUCENCY_TYPES)[number]
  rayTracedTranslucency: 'translucencyType' | 'off' | 'on'
  rayTracedTranslucencyForceOpaque: boolean
  rayTracedTranslucencyRefraction: 'translucencyRefraction' | 'off' | 'on'
  translucencyRefraction: boolean
  rayTracedTranslucencySampleTranslucentReflectionInReflections: boolean
  rayTracedTranslucencyPathThroughputThreshold: number
  rayTracedTranslucencyDownsampleFactor: number
  rayTracedTranslucencyMaxPrimaryHitEvents: number
  translucencyMaxPrimaryHitEvents: number
  rayTracedTranslucencyMaxSecondaryHitEvents: number
  translucencyMaxSecondaryHitEvents: number
  rayTracedTranslucencyMaxRayIntensity: number
}

/** Whether the traced translucency is on (`rayTracedTranslucency`): the setting decides, else the scene's translucency method. */
export const tracedTranslucencyOn = (v: TracedTranslucencyValues) =>
  v.rayTracedTranslucency === 'translucencyType'
    ? v.translucencyType === 'rayTraced'
    : v.rayTracedTranslucency === 'on'

/** Whether the traced translucency bends its rays through refractive surfaces (`rayTracedTranslucencyRefraction`). */
export const tracedRefractionOn = (v: TracedTranslucencyValues) =>
  v.rayTracedTranslucencyRefraction === 'translucencyRefraction'
    ? v.translucencyRefraction
    : v.rayTracedTranslucencyRefraction === 'on'

/** The pixels a side one ray stands for: one with ray bending, the setting held to 1 or 2 otherwise. */
export const tracedDownsampleOf = (v: TracedTranslucencyValues) =>
  tracedRefractionOn(v) ? 1 : v.rayTracedTranslucencyDownsampleFactor

/** The surfaces a primary path passes, 1 to 64: the setting, else the scene's. */
export const tracedPrimaryEventsOf = (v: TracedTranslucencyValues) =>
  clamp(
    v.rayTracedTranslucencyMaxPrimaryHitEvents < 0
      ? v.translucencyMaxPrimaryHitEvents
      : v.rayTracedTranslucencyMaxPrimaryHitEvents,
    1,
    64,
  )

/** The surfaces a secondary path passes, 0 to 64: the setting, else the scene's. */
export const tracedSecondaryEventsOf = (v: TracedTranslucencyValues) =>
  clamp(
    v.rayTracedTranslucencyMaxSecondaryHitEvents < 0
      ? v.translucencyMaxSecondaryHitEvents
      : v.rayTracedTranslucencyMaxSecondaryHitEvents,
    0,
    64,
  )
