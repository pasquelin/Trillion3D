/**
 * FOG: THE LIGHT A MEDIUM ABSORBS AND SCATTERS BETWEEN A SURFACE AND THE EYE.
 *
 * A term of the one lighting model, applied per pixel to every surface, opaque and transparent,
 * lit or unlit alike — a normal or depth view and the diagnostic views excepted: the surface's
 * radiance `L` reaches the eye as `L · T + S`, where `T` is the transmittance along the view ray
 * and `S` the radiance the medium scatters toward the eye. Two laws give them, by the distance `d`
 * from the eye (measured from the camera's position, the height along +y):
 * - linear: `T = clamp((far − d) / (far − near), 0, 1)`, `S = color · (1 − T)`;
 * - height fog, a medium that thins out with height (`fogHeight.ts`: its law, its units, its
 *   defaults, and what the atmosphere's sky and sun add to `S`). A uniform medium is its falloff
 *   of zero.
 * Three spellings declare them: `{ color, near, far }`; the height fog's own fields
 * (`SceneHeightFog`, every one with its default); and the extinction form
 * `{ color, density, heightFalloff?, baseHeight? }`, a medium of `density` per metre
 * (Beer-Lambert, `T = exp(−density · d)` where nothing falls off), divided by e every
 * `1 / heightFalloff` metres up: a spelling of the height law, mapped to it exactly.
 */
import { EngineError } from '../../contracts/cache.ts'
import type { LinearRgb } from '../../contracts/material.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import {
  heightFogOf,
  isExtinctionFog,
  type SceneFogDirectional,
  type SceneHeightFog,
} from './fogHeight.ts'

export type { SceneFogDirectional, SceneHeightFog } from './fogHeight.ts'

/** Fog that starts at `near` and hides everything from `far` on, distances from the eye. */
export interface SceneLinearFog {
  /** The radiance the fog fades toward, linear RGB. */
  color: LinearRgb
  /** Distance from the eye where the fog starts. */
  near: number
  /** Distance from the eye where nothing but the fog is seen. */
  far: number
}

/** The extinction form of the height fog: `density` per scene unit; with `heightFalloff`, it
 *  thins out above `baseHeight`, divided by e every `1 / heightFalloff` units up. Mapped exactly
 *  to the height law (`heightFogOf`): `baseDensity = density / (ln 2)²`, `falloff = heightFalloff
 *  / ln 2`; the other fields of `SceneHeightFog` are at their defaults. */
export interface SceneExponentialFog {
  /** The radiance the fog fades toward, linear RGB. */
  color: LinearRgb
  /** Extinction per scene unit, at `baseHeight`; ≥ 0. */
  density: number
  /** How fast the density falls off with height, per scene unit; 0, the default, keeps it
   *  uniform at every height. */
  heightFalloff?: number
  /** The height the density is `density` at; 0 by default. */
  baseHeight?: number
}

/** Distance or height fog, as the lighting reads it. */
export type SceneFog = SceneLinearFog | SceneExponentialFog | SceneHeightFog

/** The law of a fog, by the rank shaders read: none leaves the surface as it is; `exponential`
 *  is the height law. */
export const FOG_MODE = { none: 0, linear: 1, exponential: 2 } as const

/** The `vec4` slots of a fog in a GPU block, by number: the colour and the mode; the law's four
 *  numbers (`near, far`, or `baseDensity, falloff, baseHeight, maxOpacity`); `startDistance,
 *  cutoffDistance`, then the lobe's exponent and start distance; the lobe's colour; the factor of
 *  the sky's radiance; the unit direction toward the sun and its luminance, written by the light
 *  store (`../light/fogSun.ts`), not by `packFog`. */
export const FOG_SLOT = { color: 0, law: 1, range: 2, lobe: 3, sky: 4, sun: 5 } as const
/** `vec4` slots of a fog in a GPU block. */
export const FOG_SLOTS = 6
/** Floats of a fog in a GPU block: four to a slot. Written as a literal, so a bundle that packs no
 *  fog keeps none. */
const SCENE_FOG_FLOATS = 24

/** The thinnest density and the lowest opacity a fog that shows may have: at or below them it
 *  hides nothing, and is not drawn. */
const MIN_DENSITY = 1e-9
const MIN_OPACITY = 1e-5
/** What a linear fog leaves of its law's last two floats, the range slot and the lobe slot. */
const NO_RANGE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
/** The lobe's exponent, held where a power of it stays defined. */
const LOBE_EXPONENT = [1e-6, 1000] as const

/** A finite number, the one test every scene contract field is read with. */
export const finite = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value)
const refuse = (message: string, fog: unknown): never => {
  throw new EngineError('INVALID_SCENE_ENVIRONMENT', `fog: ${message}`, { fog })
}

/** A colour of three finite numbers ≥ 0, a copy. */
function colourOf(color: unknown, name: string, fog: unknown): LinearRgb {
  if (!Array.isArray(color) || color.length !== 3 || !color.every((c) => finite(c) && c >= 0))
    refuse(`${name} expects three finite numbers ≥ 0`, fog)
  const [r, g, b] = color as number[]
  return [r, g, b]
}

/** The numbers of a height fog, each with the range it must lie in. */
const HEIGHT_RANGES = {
  baseDensity: [0, Infinity],
  falloff: [0, Infinity],
  baseHeight: [-Infinity, Infinity],
  maxOpacity: [0, 1],
  startDistance: [0, Infinity],
  cutoffDistance: [0, Infinity],
} as const

/** `value` where it lies in `[lo, hi]`, else the fog refused by `name`. */
function ranged(value: unknown, name: string, [lo, hi]: readonly number[], fog: unknown) {
  if (finite(value) && value >= lo && value <= hi) return value
  const wanted = lo === -Infinity ? 'finite' : hi === Infinity ? `≥ ${lo}` : `in [${lo}, ${hi}]`
  return refuse(`${name} must be ${wanted}`, fog)
}

/** A height fog checked, a copy of what it declares: its colours of three numbers ≥ 0, `baseHeight`
 *  finite, the other numbers ≥ 0, `maxOpacity` in [0, 1], the lobe's exponent above 0. */
function validateHeightFog(fog: SceneHeightFog): SceneHeightFog {
  const out: SceneHeightFog = {}
  if (fog.color !== undefined) out.color = colourOf(fog.color, 'color', fog)
  for (const [name, range] of Object.entries(HEIGHT_RANGES)) {
    const key = name as keyof typeof HEIGHT_RANGES
    if (fog[key] !== undefined) out[key] = ranged(fog[key], name, range, fog)
  }
  if (fog.skyContribution !== undefined)
    out.skyContribution = colourOf(fog.skyContribution, 'skyContribution', fog)
  const lobe = fog.directional
  if (lobe !== undefined) {
    if (typeof lobe !== 'object' || lobe === null) refuse('directional expects an object', fog)
    const kept: SceneFogDirectional = {}
    if (lobe.exponent !== undefined) {
      if (!finite(lobe.exponent) || lobe.exponent <= 0)
        refuse('directional.exponent must be > 0', fog)
      kept.exponent = lobe.exponent
    }
    if (lobe.startDistance !== undefined)
      kept.startDistance = ranged(
        lobe.startDistance,
        'directional.startDistance',
        [0, Infinity],
        fog,
      )
    if (lobe.color !== undefined) kept.color = colourOf(lobe.color, 'directional.color', fog)
    out.directional = kept
  }
  return out
}

/** Whether a fog is the linear one: it declares a `near` or a `far`. */
const isLinear = (fog: SceneFog): fog is SceneLinearFog => 'near' in fog || 'far' in fog

/** Checks a fog and returns it validated, a copy: a linear fog, a colour of three finite numbers
 *  ≥ 0 and `0 ≤ near < far`; an extinction-form fog, its colour, `density ≥ 0`,
 *  `heightFalloff ≥ 0` and a finite `baseHeight`; or a height fog, its numbers in their ranges
 *  (`SceneHeightFog`). */
export function validateSceneFog(fog: SceneFog): SceneFog {
  if (typeof fog !== 'object' || fog === null) refuse('expects an object', fog)
  if (!isLinear(fog) && !isExtinctionFog(fog)) return validateHeightFog(fog)
  const rgb = colourOf(fog.color, 'color', fog)
  if (isExtinctionFog(fog)) {
    const { density, heightFalloff = 0, baseHeight = 0 } = fog
    if (!finite(density) || density < 0) refuse('density must be ≥ 0', fog)
    if (!finite(heightFalloff) || heightFalloff < 0) refuse('heightFalloff must be ≥ 0', fog)
    if (!finite(baseHeight)) refuse('baseHeight must be finite', fog)
    return { color: rgb, density, heightFalloff, baseHeight }
  }
  const { near, far } = fog as SceneLinearFog
  if (!finite(near) || !finite(far) || near < 0 || far <= near)
    refuse('expects 0 ≤ near < far', fog)
  return { color: rgb, near, far }
}

/** The floats of a fog's first five slots, the order `FOG_SLOT` gives; none where the fog hides
 *  nothing. A distance fog takes the sky's radiance as it is (the factor 1). */
function numbersOf(fog: SceneFog | undefined): number[] {
  if (!fog) return []
  if (isLinear(fog))
    return [...fog.color, FOG_MODE.linear, fog.near, fog.far, ...NO_RANGE, 1, 1, 1, 0]
  const h = heightFogOf(fog)
  if (h.baseDensity <= MIN_DENSITY || h.maxOpacity <= MIN_OPACITY) return []
  const { exponent, startDistance, color } = h.directional
  return [
    ...h.color,
    FOG_MODE.exponential,
    h.baseDensity,
    h.falloff,
    h.baseHeight,
    h.maxOpacity,
    h.startDistance,
    h.cutoffDistance,
    clamp(exponent, LOBE_EXPONENT[0], LOBE_EXPONENT[1]),
    startDistance,
    ...color,
    0,
    ...h.skyContribution,
    0,
  ]
}

/** Writes a fog into its GPU block at `offset` (`FOG_SLOT`); all zero, mode none, without one or
 *  where it hides nothing. The sun's slot is left to the light store. */
export function packFog(fog: SceneFog | undefined, out: Float32Array, offset: number) {
  out.fill(0, offset, offset + SCENE_FOG_FLOATS)
  out.set(numbersOf(fog), offset)
  return out
}

/** True when two validated fogs, or their absence, read the same in the GPU block. */
export const sameSceneFog = (a: SceneFog | undefined, b: SceneFog | undefined) =>
  a === b || sameValues(numbersOf(a), numbersOf(b))
