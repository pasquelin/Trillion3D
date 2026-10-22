/**
 * THE BOUNDS OF A FOG'S SECOND LAYER: where its density and its falloff are held, at every run,
 * silently (`clampSecondLayer`, which `heightFogOf` reads), so a value past them reads as the
 * bound. The first layer, the distances and the cubemap are taken as written.
 *
 * The bounds are those of the engines that fixed the fog's numbers: their density 10 and falloff 2,
 * per 1000 centimetres, are 1 and 0.2 per metre (the ÷ 10 `fogHeight.ts` states).
 */
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { SceneSecondLayer } from './fogSecond.ts'

/** The bounds of the second layer's numbers, each `[lowest, highest]`. */
export const FOG_BOUNDS = {
  /** Density per metre of a layer: the 10 of the engines per 1000 centimetres. */
  baseDensity: [0, 1],
  /** Falloff per metre of a layer: the 2 of the engines per 1000 centimetres. */
  falloff: [0, 0.2],
} as const

/** The second layer held to its bounds, as every run holds it: its density and its falloff; a
 *  number left out stays out. */
export function clampSecondLayer(second: SceneSecondLayer): SceneSecondLayer {
  const out = { ...second }
  for (const key of ['baseDensity', 'falloff'] as const)
    if (second[key] !== undefined) out[key] = clamp(second[key], ...FOG_BOUNDS[key])
  return out
}
