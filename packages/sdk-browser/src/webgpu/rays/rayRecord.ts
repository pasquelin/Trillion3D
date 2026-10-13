import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'

/**
 * THE RAY QUERY'S WORDS, one table each that the writer, the kernel (`rayQueryWgsl.ts`) and the
 * reader index (`fieldLayout`).
 *
 * A ray is 48 bytes: its origin as three doubles — a world position kept exact, as a placement's
 * translation is (`../../gpu/dag/worldOrigins.ts`), the eye every placement it meets is taken to
 * (`TRANSLATION_AT_EYE_WGSL`) —, the placements it may meet (`filterFirst`, the first of a sorted
 * list of ranks in the query's buffer, and `filterWord`, their count with `FILTER_INCLUDE`), its
 * unit direction and its reach. A hit is 32 bytes: its flags, the placement, the page and the
 * triangle met, the world normal of that triangle and the distance along the ray.
 */
export const RAY_RECORD = fieldLayout('RayRecord', [
  ['eyeXY', 'vec4u'],
  ['eyeZ', 'vec2u'],
  ['filterFirst', 'u32'],
  ['filterWord', 'u32'],
  ['direction', 'vec3f'],
  ['reach', 'f32'],
] as const)
export const RAY_HIT = fieldLayout('RayHit', [
  ['flags', 'u32'],
  ['placement', 'u32'],
  ['page', 'u32'],
  ['triangle', 'u32'],
  ['normal', 'vec3f'],
  ['distance', 'f32'],
] as const)

/** A hit's flags: a triangle was met; the walk was cut short by its bounds — a stack or a step
 *  count spent —, so a nearer triangle may have been left untested. */
export const HIT_FOUND = 1,
  HIT_CUT = 2
/** The filter word's top bit: set, the listed placements alone are met; clear, they are passed by. */
export const FILTER_INCLUDE = 0x80000000

/**
 * The farthest a ray reaches, in world units: under 2²⁴, where `reach + 1` still rounds above
 * `reach` in single precision — the traversal's bound on a span it does not keep
 * (`../../bounce/traceWgsl.ts`).
 */
export const RAY_REACH_MAX = 2 ** 23

/** One ray as a caller asks it: its origin and unit direction in doubles, its reach, and the sorted
 *  placements it may meet (`include`) or must pass by, at `filterFirst` of the batch's list. */
type RayAsk = {
  origin: readonly [number, number, number]
  direction: readonly [number, number, number]
  reach: number
  filterFirst: number
  filterCount: number
  include: boolean
}

/** Writes `ray` as its record at word `at` of `words` (`floats`, the same buffer). */
export function writeRay(words: Uint32Array, floats: Float32Array, at: number, ray: RayAsk) {
  // The eye's three doubles, x and y in `eyeXY`, z in `eyeZ` right behind it.
  packDoubles(words, at + RAY_RECORD.at.eyeXY, ray.origin)
  words[at + RAY_RECORD.at.filterFirst] = ray.filterFirst
  words[at + RAY_RECORD.at.filterWord] =
    (ray.filterCount | (ray.include ? FILTER_INCLUDE : 0)) >>> 0
  floats.set(ray.direction, at + RAY_RECORD.at.direction)
  floats[at + RAY_RECORD.at.reach] = ray.reach
}

/** What a hit record at word `at` says: none, or the placement, page, triangle, distance and world
 *  normal it met, and whether its walk was cut short. */
export function readHit(words: Uint32Array, floats: Float32Array, at: number) {
  const flags = words[at + RAY_HIT.at.flags]
  if (!(flags & HIT_FOUND)) return null
  const normal = at + RAY_HIT.at.normal
  return {
    placement: words[at + RAY_HIT.at.placement],
    page: words[at + RAY_HIT.at.page],
    triangle: words[at + RAY_HIT.at.triangle],
    distance: floats[at + RAY_HIT.at.distance],
    normal: [floats[normal], floats[normal + 1], floats[normal + 2]] as const,
    cut: (flags & HIT_CUT) !== 0,
  }
}
