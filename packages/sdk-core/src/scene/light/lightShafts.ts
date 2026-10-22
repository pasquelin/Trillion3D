import { EngineError } from '../../contracts/cache.ts'
import { resolveLightShaftLight, type LightShaftLight } from '../../modules/sky/lightShafts.ts'
import { finite } from '../core/fog.ts'
import type { SceneLight } from './contracts.ts'

/**
 * THE LIGHT SHAFT FIELDS OF A LIGHT RECORD (`SceneLight.shaft*`, defaults in
 * `../../modules/sky/lightShafts.ts`): validated here, kept apart from the other fields, and read
 * through `lightShaftOf`, which answers each field's default where the record holds none. The
 * occlusion and the override direction are a directional light's alone; the bloom belongs to every
 * kind of light, and the shafts are drawn for a directional one.
 */
const FLAGS = ['shaftOcclusion', 'shaftBloom'] as const
const NUMBERS = [
  'shaftOcclusionDarkness',
  'shaftOcclusionDepthRange',
  'shaftBloomScale',
  'shaftBloomThreshold',
  'shaftBloomMaxBrightness',
] as const
const VECTORS = ['shaftOverrideDirection', 'shaftBloomTint'] as const
const DIRECTIONAL_ONLY = [
  'shaftOcclusion',
  'shaftOcclusionDarkness',
  'shaftOcclusionDepthRange',
  'shaftOverrideDirection',
] as const

const bad = (id: string, field: string, what: string, value: unknown) =>
  new EngineError('INVALID_SCENE_LIGHT', `${id}: ${field} expects ${what}`, { [field]: value })

/** The light shaft fields of `light` into `validated`: each a boolean, a finite number or three
 *  finite numbers (the tint's of at least 0), and the directional ones refused on another kind. */
export function validateLightShafts(light: SceneLight, validated: SceneLight) {
  const { id } = light
  if (light.kind !== 'directional')
    for (const field of DIRECTIONAL_ONLY)
      if (light[field] !== undefined)
        throw bad(id, field, 'a directional light: it exists only for one', light[field])
  const into = validated as unknown as Record<string, unknown>
  for (const field of FLAGS) {
    const value = light[field]
    if (value === undefined) continue
    if (typeof value !== 'boolean') throw bad(id, field, 'a boolean', value)
    into[field] = value
  }
  for (const field of NUMBERS) {
    const value = light[field]
    if (value === undefined) continue
    if (!finite(value)) throw bad(id, field, 'a finite number', value)
    into[field] = value
  }
  for (const field of VECTORS) {
    const value = light[field]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.length !== 3 || !value.every(finite))
      throw bad(id, field, 'three finite numbers', value)
    if (field === 'shaftBloomTint' && value.some((channel) => channel < 0))
      throw bad(id, field, 'channels of at least 0', value)
    into[field] = [value[0], value[1], value[2]]
  }
}

const held = new WeakMap<SceneLight, LightShaftLight>()

/** The light shaft settings of a held record, each its default where the record names none. The
 *  record is the store's own, replaced at every change: the answer is made once for it. */
export function lightShaftOf(light: SceneLight): LightShaftLight {
  let settings = held.get(light)
  if (!settings) {
    const given: Record<string, unknown> = {}
    for (const field of [...FLAGS, ...NUMBERS, ...VECTORS])
      if (light[field] !== undefined) given[field] = light[field]
    held.set(light, (settings = resolveLightShaftLight(given)))
  }
  return settings
}

const sameVector = (a: readonly number[], b: readonly number[]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/** Whether two lights ask the same light shafts. */
export function sameLightShafts(a: SceneLight, b: SceneLight) {
  const x = lightShaftOf(a),
    y = lightShaftOf(b)
  return (
    FLAGS.every((field) => x[field] === y[field]) &&
    NUMBERS.every((field) => x[field] === y[field]) &&
    VECTORS.every((field) => sameVector(x[field], y[field]))
  )
}
