import {
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  rulesOf,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE VIEW'S SETTINGS OF THE CAPSULE SHADOWS: the soft shadows that spheres and capsules, fitted to a
 * skinned object's bones, cast on the scene (`packages/sdk-browser/src/lighting/capsuleShadows/`). A light
 * casts them on the pixels near the object (the direct shadows); the sky and the indirect light of the
 * place are blocked by them in the direction they come from (the indirect shadows). Only an object that
 * carries capsules and asks for them casts them (`castCapsuleDirectShadow`, `castCapsuleIndirectShadow`).
 * Run-time settings, as `./settingRules.ts` says; the quality levels write none of them.
 *
 * - `capsuleShadows` (on): the master switch; off, neither kind is cast;
 * - `capsuleDirectShadows` (on): the lights' shadows; needs `capsuleShadows`;
 * - `capsuleIndirectShadows` (on): the indirect light's and the sky's shadows; needs `capsuleShadows`;
 * - `capsuleShadowsFullResolution` (off): the shadow factors are computed at the image's resolution
 *   instead of half of it each way;
 * - `capsuleMaxDirectOcclusionDistance` (4 m): how far from a capsule a light's shadow reaches;
 * - `capsuleMaxIndirectOcclusionDistance` (2 m): how far the indirect shadow reaches;
 * - `capsuleShadowFadeAngleFromVertical` (π/3, radians, from 0 to π): the angle from straight up at
 *   which the indirect shadow starts to fade out, to hide the object's shadow on itself;
 * - `capsuleIndirectConeAngle` (π/8, radians): the angle of the light source when the indirect
 *   shadow's direction is read from the place's indirect light (no stationary sky light);
 * - `capsuleSkyAngleScale` (0.6): the factor on the angle read from the sky's unoccluded direction
 *   (stationary sky light);
 * - `capsuleMinSkyAngle` (15, degrees): the least angle read from the sky's unoccluded direction;
 * - `capsuleIndirectSelfShadowingIntensity` (0.8, from 0 to 1): how much of the indirect capsule shadow an object's own surface keeps.
 */
export const CAPSULE_SHADOW_RULES = /* @__PURE__ */ (() =>
  [
    flag('capsuleShadows', true),
    flag('capsuleDirectShadows', true),
    flag('capsuleIndirectShadows', true),
    flag('capsuleShadowsFullResolution', false),
    positive('capsuleMaxDirectOcclusionDistance', 4),
    positive('capsuleMaxIndirectOcclusionDistance', 2),
    number('capsuleShadowFadeAngleFromVertical', Math.PI / 3, [0, Math.PI]),
    positive('capsuleIndirectConeAngle', Math.PI / 8),
    nonNegative('capsuleSkyAngleScale', 0.6),
    positive('capsuleMinSkyAngle', 15),
    number('capsuleIndirectSelfShadowingIntensity', 0.8, [0, 1]),
  ] as const)()

/** The same rules by their field: what the frame reads the view's settings with. */
export const CAPSULE_SHADOW_VIEW_RULES = /* @__PURE__ */ rulesOf(CAPSULE_SHADOW_RULES)

/** The field of one capsule shadow setting. */
export type CapsuleShadowField = (typeof CAPSULE_SHADOW_RULES)[number]['field']
/** The capsule shadow settings, every field set. */
export type CapsuleShadowSettings = SettingValues<typeof CAPSULE_SHADOW_VIEW_RULES>

/** Whether the lights' capsule shadows are cast. */
export const capsuleDirectOn = (
  settings: Pick<CapsuleShadowSettings, 'capsuleShadows' | 'capsuleDirectShadows'>,
) => settings.capsuleShadows && settings.capsuleDirectShadows

/** Whether the indirect capsule shadows are cast. */
export const capsuleIndirectOn = (
  settings: Pick<CapsuleShadowSettings, 'capsuleShadows' | 'capsuleIndirectShadows'>,
) => settings.capsuleShadows && settings.capsuleIndirectShadows

/**
 * THE CAPSULE SHADOW SETTINGS OF AN OBJECT: whether a skinned object casts them, and the shapes it casts them with.
 *
 * - `castCapsuleDirectShadow` (off): the object's capsules shade the scene from the lights; the object needs to cast a dynamic shadow;
 * - `castCapsuleIndirectShadow` (off): the object's capsules shade the sky and the indirect light;
 * - `capsuleIndirectShadowMinVisibility` (0.1, from 0 to 1): the share of the indirect light that stays under the object's shadow, however
 *   dark it would be.
 */
export const OBJECT_CAPSULE_SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('castCapsuleDirectShadow', false),
    flag('castCapsuleIndirectShadow', false),
    number('capsuleIndirectShadowMinVisibility', 0.1, [0, 1]),
  ] as const))()

/** One shape of an object's shadow body, fitted to a bone: a sphere, or a capsule (`length` the straight part's, along the shape's z axis turned by
 *  `rotation`, a quaternion x, y, z, w), in the space of the bone `bone`, in metres. */
export type ShadowCapsuleBody =
  | {
      readonly bone: string
      readonly kind: 'sphere'
      readonly center: readonly [number, number, number]
      readonly radius: number
    }
  | {
      readonly bone: string
      readonly kind: 'capsule'
      readonly center: readonly [number, number, number]
      readonly radius: number
      readonly length: number
      readonly rotation: readonly [number, number, number, number]
    }

const isVector = (value: unknown, length: number): value is readonly number[] =>
  Array.isArray(value) && value.length === length && value.every(Number.isFinite)

/** Whether `value` is one shape of a shadow body: a sphere or a capsule of a bone, with a centre and a radius above 0, a capsule also a length of at least 0 and a rotation. */
function isShadowCapsuleBody(value: unknown): value is ShadowCapsuleBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  if (typeof body.bone !== 'string' || !body.bone) return false
  if (!isVector(body.center, 3) || typeof body.radius !== 'number' || !(body.radius > 0))
    return false
  if (body.kind === 'sphere') return true
  return (
    body.kind === 'capsule' &&
    typeof body.length === 'number' &&
    body.length >= 0 &&
    isVector(body.rotation, 4)
  )
}

/** Whether `value` is a list of shadow body shapes. */
export const isShadowCapsules = (value: unknown): value is readonly ShadowCapsuleBody[] =>
  Array.isArray(value) && value.every(isShadowCapsuleBody)

/** What a shadow body is, in words. */
export const SHADOW_CAPSULES_EXPECTED =
  'a list of { bone, kind: sphere | capsule, center: [x, y, z], radius above 0 } and, for a capsule, a length of at least 0 and a rotation [x, y, z, w]'

/** The shadow body of an object that sets none. */
export const NO_SHADOW_CAPSULES: readonly ShadowCapsuleBody[] = /* @__PURE__ */ Object.freeze([])
