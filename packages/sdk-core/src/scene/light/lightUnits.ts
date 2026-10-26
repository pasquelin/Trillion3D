import { clamp } from '../../../../math/src/scalar/reals.ts'

/**
 * THE UNITS A LAMP'S INTENSITY IS WRITTEN IN. A point, a spot and a rect light read their
 * `intensity` in one of five units (`SceneLight.intensityUnits`); the light store turns it into the
 * one physical number the GPU holds for the kind (`brightnessOf`, `fields.ts`):
 * - `candelas`: a luminous intensity, the number as it is;
 * - `lumens`: a luminous flux, spread over the sphere of a point, the cone of a spot, the cosine
 *   lobe of a rect;
 * - `nits`: a luminance, times the area of the source (a point or spot's capsule, a rect's face);
 * - `ev`: an exposure value at ISO 100, `2^ev` candelas, a luminance over an implicit square metre;
 * - `unitless`: the default scale, 16 for every 10 000 candelas.
 * A directional light's intensity is in lux and names no unit.
 */
export const LIGHT_UNITS = ['unitless', 'candelas', 'lumens', 'nits', 'ev'] as const
/** One of the units a lamp's intensity is written in (`LIGHT_UNITS`). */
export type LightUnits = (typeof LIGHT_UNITS)[number]
/** The unit of a lamp that names none. */
export const DEFAULT_LIGHT_UNITS: LightUnits = 'unitless'
/** Square centimetres in a square metre: the area the legacy and the EV units are scaled by. */
const CM2_PER_M2 = 1e4
/** What one unitless intensity is worth, in candelas times `CM2_PER_M2`. */
const UNITLESS_SCALE = 16
/** The least gap of a cone's half-angle cosine below 1: the solid angle of a lumen never vanishes. */
const CONE_COSINE_GAP = 1e-4

/** What one intensity of `units` is worth in the scale both ends of a conversion share; a lumen's
 *  the solid angle of a cone of half-angle cosine `cosHalfCone`. A nit's depends on the source's
 *  area: it has no factor here. */
function unitScale(units: LightUnits, cosHalfCone: number) {
  if (units === 'nits') return 1
  if (units === 'candelas' || units === 'ev') return CM2_PER_M2
  if (units === 'lumens') return CM2_PER_M2 / 2 / Math.PI / (1 - cosHalfCone)
  return UNITLESS_SCALE
}

/** The factor an intensity written in `from` is multiplied by to be written in `to`, for a light
 *  whose cone has the half-angle cosine `cosHalfCone` (−1 for a point's whole sphere, 0.5 for a
 *  rect, whose lumen spreads over π): 1 for the same unit. */
export function lightUnitsFactor(from: LightUnits, to: LightUnits, cosHalfCone: number) {
  if (from === to) return 1
  const cos = clamp(cosHalfCone, -1, 1 - CONE_COSINE_GAP)
  return unitScale(from, cos) / unitScale(to, cos)
}

/** A lamp's intensity of `units` as candelas, for a point or spot's inverse square: `area` the
 *  source's in square metres, `steradians` the solid angle its lumen spreads over. */
export function lampCandelas(
  intensity: number,
  units: LightUnits,
  area: number,
  steradians: number,
) {
  if (units === 'candelas') return intensity
  if (units === 'nits') return intensity * area
  if (units === 'lumens') return intensity / steradians
  if (units === 'ev') return 2 ** intensity
  return (intensity * UNITLESS_SCALE) / CM2_PER_M2
}
