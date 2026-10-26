import { EngineError } from '../../contracts/cache.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import type { SceneLight } from './contracts.ts'

/** Three finite numbers, as a triple. */
export function vector(value: unknown, field: string, id: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${field} expects three finite numbers`, {
      field,
      value,
    })
  return [value[0], value[1], value[2]]
}
/** `value` divided by its `Math.hypot` length (docs/MATHS.md "Lengths", a declared use): the
 *  validated direction feeds, in double, the shadow clipmap's own normalise and basis, and the
 *  rule's product by an inverse root differs from this quotient in the last bit on about two
 *  directions in three; one not longer than 1e-6 is refused. */
export function normalized(value: [number, number, number], id: string): [number, number, number] {
  const length = hypot3(value[0], value[1], value[2])
  if (!(length > 1e-6))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: zero-length direction`, { value })
  return [value[0] / length, value[1] / length, value[2] / length]
}
/** A light's direction: three finite numbers, returned unit. The buffer sees no other. */
export function direction(value: unknown, id: string): [number, number, number] {
  return normalized(vector(value, 'direction', id), id)
}
/** Direction of a type that requires one: if missing, the light is rejected before any calculation. */
export function requiredDirection(
  value: unknown,
  id: string,
  why: string,
): [number, number, number] {
  if (value === undefined) throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${why}`, {})
  return direction(value, id)
}
/** A field a light type does not use is rejected, never accepted then ignored. */
export function unused(light: SceneLight, field: keyof SceneLight, why: string) {
  if (light[field] !== undefined)
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${field} ${why}`, { field })
}
