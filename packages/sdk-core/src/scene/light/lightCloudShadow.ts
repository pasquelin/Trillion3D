import { EngineError } from '../../contracts/cache.ts'
import {
  CLOUD_SHADOW_LIGHT_RULES,
  resolveCloudShadowLight,
  type CloudShadowLight,
} from '../../modules/sky/cloudShadow.ts'
import type { SceneLight } from './contracts.ts'

/**
 * THE CLOUD SHADOW FIELDS OF A LIGHT RECORD (`SceneLight.castCloudShadows` and the fields beside it,
 * one for each rule of `CLOUD_SHADOW_LIGHT_RULES`, the one source of their names and defaults):
 * validated here by those rules, kept apart from the other fields, and read through
 * `cloudShadowOfLight`, which answers each field's default where the record holds none. They are a
 * directional light's alone: the air has the clouds' shade for each of its two lights, and only a
 * directional light can be one.
 */
const FIELDS = Object.keys(CLOUD_SHADOW_LIGHT_RULES) as readonly (keyof CloudShadowLight)[]

type CloudShadowFields = Partial<Record<keyof CloudShadowLight, unknown>>

/** The cloud shadow fields of `light` into `validated`, each as its rule takes it, and refused on a
 *  light that is not a directional one. */
export function validateLightCloudShadow(light: SceneLight, validated: SceneLight) {
  const given: Record<string, unknown> = {}
  const from = light as unknown as CloudShadowFields
  for (const field of FIELDS) if (from[field] !== undefined) given[field] = from[field]
  if (!Object.keys(given).length) return
  if (light.kind !== 'directional')
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${light.id}: ${Object.keys(given)[0]} expects a directional light: it exists only for one`,
      given,
    )
  let resolved: CloudShadowLight
  try {
    resolved = resolveCloudShadowLight(given)
  } catch (error) {
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${(error as Error).message}`, given)
  }
  const into = validated as unknown as Record<string, unknown>
  for (const field of Object.keys(given)) {
    const value = resolved[field as keyof CloudShadowLight]
    into[field] = Array.isArray(value) ? [...value] : value
  }
}

const held = new WeakMap<SceneLight, CloudShadowLight>()

/** The cloud shadow settings of a held record, each its default where the record names none. The
 *  record is the store's own, replaced at every change: the answer is made once for it. */
export function cloudShadowOfLight(light: SceneLight): CloudShadowLight {
  let settings = held.get(light)
  if (!settings) {
    const given: Record<string, unknown> = {}
    const from = light as unknown as CloudShadowFields
    for (const field of FIELDS) if (from[field] !== undefined) given[field] = from[field]
    held.set(light, (settings = resolveCloudShadowLight(given)))
  }
  return settings
}

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.every((v, i) => v === b[i]) : a === b

/** Whether two lights ask the same cloud shadows. */
export function sameLightCloudShadow(a: SceneLight, b: SceneLight) {
  const x = cloudShadowOfLight(a),
    y = cloudShadowOfLight(b)
  return FIELDS.every((field) => sameValue(x[field], y[field]))
}
