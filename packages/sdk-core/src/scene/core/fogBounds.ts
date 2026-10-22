/**
 * THE BOUNDS OF A FOG: where a number is held, and by whom.
 *
 * The engines that fixed the fog's numbers hold them in two places, and so do we. A person editing
 * a fog — a panel, a slider — is held to the bounds of `FOG_BOUNDS` (`clampEditedFog`, applied
 * where an edit lands, never to a fog a script sets: that one is taken as written). The second
 * fog layer is held to its own at every run, silently (`clampSecondLayer`, which `heightFogOf` reads),
 * so a value past them reads as the bound.
 *
 * The bounds are those of the engines' editor, in scene metres: their density 10 and falloff 2,
 * per 1000 centimetres, are 1 and 0.2 per metre (the ÷ 10 `fogHeight.ts` states); their distances
 * are centimetres ÷ 100; the largest world is 8 796 093 022 208 centimetres across.
 */
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { CUBEMAP_DEFAULTS } from './fogCubemap.ts'
import type { SceneHeightFog } from './fogHeight.ts'
import type { SceneSecondLayer } from './fogSecond.ts'

/** The largest distance of a scene, metres: the largest world. */
const WORLD_MAX = 87960930222.08

/** The bounds of a fog's numbers, each `[lowest, highest]`. */
export const FOG_BOUNDS = {
  /** Density per metre of a layer: the 10 of the editor per 1000 centimetres. */
  baseDensity: [0, 1],
  /** Falloff per metre of a layer: the 2 of the editor per 1000 centimetres. */
  falloff: [0, 0.2],
  maxOpacity: [0, 1],
  startDistance: [0, WORLD_MAX],
  horizontalLimit: [0, 10 * WORLD_MAX],
  cutoffDistance: [0, 10 * WORLD_MAX],
  /** The cubemap's direct-use distance. */
  sharpFrom: [0, WORLD_MAX],
  /** The cubemap's rotation, degrees. */
  turn: [0, 360],
} as const

/** Holds into `out` the numbers `keys` name of `source` to `FOG_BOUNDS`; a number left out stays out. */
function holdIn<T extends object>(out: T, source: T, keys: readonly (keyof typeof FOG_BOUNDS)[]) {
  const from = source as Record<string, number | undefined>
  const into = out as Record<string, number | undefined>
  for (const key of keys) {
    const value = from[key]
    if (value !== undefined) into[key] = clamp(value, ...FOG_BOUNDS[key])
  }
  return out
}

/** The second layer held to its bounds, as every run holds it: its density and its falloff. */
export function clampSecondLayer(second: SceneSecondLayer): SceneSecondLayer {
  return holdIn({ ...second }, second, ['baseDensity', 'falloff'])
}

/**
 * A height fog as a person's edit leaves it: the density and falloff of both layers, the opacity,
 * the three distances, the cubemap's direct-use distance, its average-colour distance — held to
 * the first, as set or by default — and its rotation, each held to `FOG_BOUNDS`; a field left out stays out. Call it where
 * a value is edited, not where a script writes one.
 */
export function clampEditedFog(fog: SceneHeightFog): SceneHeightFog {
  const out = holdIn({ ...fog }, fog, [
    'baseDensity',
    'falloff',
    'maxOpacity',
    'startDistance',
    'horizontalLimit',
    'cutoffDistance',
  ])
  if (fog.secondLayer) out.secondLayer = clampSecondLayer(fog.secondLayer)
  if (fog.cubemap) {
    const cube = holdIn({ ...fog.cubemap }, fog.cubemap, ['sharpFrom', 'turn'])
    const direct = cube.sharpFrom ?? CUBEMAP_DEFAULTS.sharpFrom
    if (cube.averageUntil !== undefined) cube.averageUntil = clamp(cube.averageUntil, 0, direct)
    out.cubemap = cube
  }
  return out
}
