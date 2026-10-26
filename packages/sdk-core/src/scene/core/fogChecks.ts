/**
 * THE CHECKS EVERY FIELD OF A FOG IS READ WITH: a finite number, a colour of three, a number
 * within its range, a switch — each refused by the name of the field, the same error for every
 * part of the fog (`fog.ts`, `fogSecond.ts`, `fogCubemap.ts`, `fogVolumetric.ts`), and for the
 * atmosphere (`atmosphere.ts`), whose fields are read with the same refusal and colour check under
 * its name.
 */
import { EngineError } from '../../contracts/cache.ts'
import { isRecord } from '../../contracts/nameMatch.ts'
import type { LinearRgb } from '../../contracts/material.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'

/** The refusal of the part of a scene `part` names — `'fog'`, `'atmosphere'` —: the error every
 *  field's check throws, `message` naming the field, `subject` what was declared. */
export const refusal =
  (part: string) =>
  (message: string, subject: unknown): never => {
    throw new EngineError('INVALID_SCENE_ENVIRONMENT', `${part}: ${message}`, { [part]: subject })
  }

/** Refuses a fog. */
export const refuse = /* @__PURE__ */ refusal('fog')

/** A colour of three finite numbers ≥ 0, a copy; refused by `refuseWith` (a fog's by default). */
export function colourOf(
  color: unknown,
  name: string,
  subject: unknown,
  refuseWith: (message: string, subject: unknown) => never = refuse,
): LinearRgb {
  if (
    !Array.isArray(color) ||
    color.length !== 3 ||
    !color.every((c) => isFiniteNumber(c) && c >= 0)
  )
    refuseWith(`${name} expects three finite numbers ≥ 0`, subject)
  const [r, g, b] = color as number[]
  return [r, g, b]
}

/** `value` where it is `true` or `false`, else the fog refused by `name`. */
export function booleanOf(value: unknown, name: string, fog: unknown) {
  if (typeof value === 'boolean') return value
  return refuse(`${name} must be true or false`, fog)
}

/** The range a number must lie in, both ends included. */
export type FogRange = readonly [number, number]

/** `value` where it lies in `[lo, hi]`, else the fog refused by `name`. */
export function ranged(value: unknown, name: string, [lo, hi]: FogRange, fog: unknown) {
  if (isFiniteNumber(value) && value >= lo && value <= hi) return value
  const wanted = lo === -Infinity ? 'finite' : hi === Infinity ? `≥ ${lo}` : `in [${lo}, ${hi}]`
  return refuse(`${name} must be ${wanted}`, fog)
}

/** Copies into `out` the numbers of `source` that `ranges` names, each within its range and named
 *  `prefix` + its field in a refusal; a field `source` leaves out stays out. */
export function rangedFields<T extends object>(
  source: T,
  out: T,
  ranges: Readonly<Record<string, FogRange>>,
  fog: unknown,
  prefix = '',
) {
  const from = source as Record<string, unknown>
  const into = out as Record<string, unknown>
  for (const [name, range] of Object.entries(ranges))
    if (from[name] !== undefined) into[name] = ranged(from[name], prefix + name, range, fog)
}

/** An object of the fog's declaration, else the fog refused by `name`. */
export function objectOf<T extends object>(value: unknown, name: string, fog: unknown): T {
  if (!isRecord(value)) refuse(`${name} expects an object`, fog)
  return value as T
}
