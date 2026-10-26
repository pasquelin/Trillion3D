import { EngineError } from '../../contracts/cache.ts'
import {
  LIGHT_SHADOW_FIELDS,
  LIGHT_SHADOW_RULES,
  resolveLightShadow,
  type LightShadow,
} from '../../contracts/lightShadowOptions.ts'
import { settingTakes } from '../../contracts/settingRules.ts'
import type { SceneLight } from './contracts.ts'

/**
 * THE SHADOW FIELDS OF A LIGHT RECORD (`SceneLight.shadowDistance` and the fields beside it, one for
 * each rule of `LIGHT_SHADOW_RULES`, the one source of their names and defaults): validated here by
 * those rules, kept apart from the other fields, and read through `shadowOfLight`, which answers
 * each field's default where the record holds none. They are a directional light's alone.
 */
type ShadowFields = Partial<Record<keyof LightShadow, unknown>>

/** The shadow fields `light` names. */
function givenOf(light: SceneLight) {
  const from = light as unknown as ShadowFields,
    given: Record<string, unknown> = {}
  for (const field of LIGHT_SHADOW_FIELDS) if (from[field] !== undefined) given[field] = from[field]
  return given
}

/** The shadow fields of `light` into `validated`, each as its rule takes it (a distance's `false` is
 *  0, its `true` the default), and refused on a light that is not a directional one. */
export function validateLightShadow(light: SceneLight, validated: SceneLight) {
  const given = givenOf(light)
  const first = Object.keys(given)[0]
  if (first === undefined) return
  if (light.kind !== 'directional')
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${light.id}: ${first} exists only for a directional light`,
      { field: first },
    )
  // A record holds a value or nothing: `null`, a host's way to ask for the default, is none.
  for (const [field, value] of Object.entries(given))
    if (value === null)
      throw new EngineError(
        'INVALID_SCENE_LIGHT',
        `${light.id}: ${field}: must be ${settingTakes(LIGHT_SHADOW_RULES[field as keyof LightShadow])}, got null`,
        { field },
      )
  let resolved: LightShadow
  try {
    resolved = resolveLightShadow(given)
  } catch (error) {
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${(error as Error).message}`, given)
  }
  const into = validated as unknown as Record<string, unknown>
  for (const field of Object.keys(given)) into[field] = resolved[field as keyof LightShadow]
}

const held = new WeakMap<SceneLight, LightShadow>()

/** The shadow settings of a held record, each its default where the record names none. The record is
 *  the store's own, replaced at every change: the answer is made once for it. */
export function shadowOfLight(light: SceneLight): LightShadow {
  let settings = held.get(light)
  if (!settings) held.set(light, (settings = resolveLightShadow(givenOf(light))))
  return settings
}

/** Whether two lights ask the same shadows: a light whose any differs is another, its shadow pages
 *  restart. */
export function sameLightShadow(a: SceneLight, b: SceneLight) {
  const x = shadowOfLight(a),
    y = shadowOfLight(b)
  return LIGHT_SHADOW_FIELDS.every((field) => x[field] === y[field])
}
