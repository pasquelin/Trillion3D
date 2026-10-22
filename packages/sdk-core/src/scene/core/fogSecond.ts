/**
 * THE FOG'S SECOND LAYER: another medium that thins out with height, added to the first.
 *
 * The two layers share one ray: what the light crosses is the sum of their line integrals
 * (`fogHeight.ts` states the law of one), so a thin haze at the ground and a thicker layer higher
 * up, say, are one fog. The second layer has its own density, falloff and base height — the first
 * layer's `baseHeight` plus its `heightShift` — and nothing else: its colour, opacity, distances
 * and lobe are the first layer's. It is off by default, a density of zero; a fog whose first layer
 * has none still shows where the second has one.
 */
import { clampSecondLayer } from './fogBounds.ts'
import { objectOf, rangedFields, type FogRange } from './fogChecks.ts'

/** The second layer of a height fog (`SceneHeightFog.secondLayer`). */
export interface SceneSecondLayer {
  /** The density at its base height, per metre, ≥ 0; 0, the default, is no second layer. Held to
   *  1 at every run. */
  baseDensity?: number
  /** How fast its density falls off with height, per metre, ≥ 0: it halves every `1 / falloff`
   *  metres; 0.02 by default. Held to 0.2 at every run. */
  falloff?: number
  /** Where its base lies above the first layer's `baseHeight`, metres, negative below; 0 by
   *  default. */
  heightShift?: number
}

/** The second layer with every field set. */
export interface ResolvedSecondLayer {
  baseDensity: number
  falloff: number
  heightShift: number
}

/** The defaults of the second layer: none of it, the first layer's falloff, at its height. */
export const SECOND_FOG_DEFAULTS: ResolvedSecondLayer = {
  baseDensity: 0,
  falloff: 0.02,
  heightShift: 0,
}

/** The second layer a declaration is, every field set and held to its bounds as every run holds
 *  it: the defaults for what it leaves out. */
export function resolveSecondLayer(second: SceneSecondLayer | undefined): ResolvedSecondLayer {
  const held = clampSecondLayer(second ?? {})
  return { ...SECOND_FOG_DEFAULTS, ...held }
}

/** The range of each number of the second layer. */
const SECOND_RANGES = {
  baseDensity: [0, Infinity],
  falloff: [0, Infinity],
  heightShift: [-Infinity, Infinity],
} as const satisfies Record<string, FogRange>

/** A second layer checked, a copy of what it declares: its densities and falloff ≥ 0, its offset
 *  finite. A number past the bounds is not refused: it reads as the bound (`clampSecondLayer`). */
export function validateSecondLayer(second: unknown, fog: unknown): SceneSecondLayer {
  const layer = objectOf<SceneSecondLayer>(second, 'secondLayer', fog)
  const out: SceneSecondLayer = {}
  rangedFields(layer, out, SECOND_RANGES, fog, 'secondLayer.')
  return out
}
