/**
 * THE ENVIRONMENT: WHAT LIGHTS A SURFACE FROM EVERY DIRECTION, AND HOW RADIANCE BECOMES AN IMAGE.
 *
 * Two things that are not lamps. The first is the light that arrives from everywhere at once —
 * a uniform ambient, a sky over a ground, a probe captured around the scene. None of them has a
 * position or a range; each is an irradiance that depends only on the normal it falls on, and all
 * of them add into ONE function of that normal: nine spherical-harmonic coefficients per colour
 * channel. A uniform ambient is the constant band alone, a sky over a ground is the
 * constant and the linear bands exactly, a probe fills all nine. The surface model applies it to
 * the diffuse lobe: `albedo · (1 − metalness) / π · E(N)`.
 *
 * The second is the display chain: exposure multiplies linear radiance, then a tone-mapping
 * curve brings it into the display range (P4). Neither is a light: a scene with neither lamp nor
 * environment irradiance stays black whatever its exposure.
 */
import type { NumberSink } from '../../../../math/src/matrix/matrix4.ts'
import { packFog, type SceneFog } from './fog.ts'

/** The curves that bring scene radiance into the display range, by the rank shaders read. */
export const TONE_MAPPING_RANK = {
  /** No curve. */
  none: 0,
  /** Exposure, then cut off. */
  linear: 1,
  /** A smooth squeeze. */
  reinhard: 2,
  /** The film look. */
  cineon: 3,
  /** The film industry's curve. */
  aces: 4,
  /** Natural colours in bright light. */
  agx: 5,
  /** The least colour change. */
  neutral: 6,
} as const
/** The name of a display curve the engine knows. */
export type SceneToneMapping = keyof typeof TONE_MAPPING_RANK
/** The display curve of a scene that names none, or declares no environment at all. */
export const DEFAULT_TONE_MAPPING: SceneToneMapping = 'aces'

/** The light around a scene: exposure, display curve and light from every direction. */
export interface SceneEnvironment {
  /** Multiplier of linear radiance, applied before the curve. */
  exposure: number
  /** The display curve; `DEFAULT_TONE_MAPPING` when absent. */
  toneMapping?: SceneToneMapping
  /**
   * The irradiance arriving from every direction, as 27 numbers: nine coefficients, each an RGB
   * triple, in the band order constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`.
   * Absent, or all zero, nothing lights a surface but the declared lamps.
   */
  irradiance?: readonly number[]
  /** Distance or height fog over every surface (`SceneFog`); absent, none. */
  fog?: SceneFog
}

/** Coefficients of the irradiance, and the floats they take in a GPU buffer: one `vec4` each.
 *  Written as literals, like the factors below, so a bundle that reads none of them keeps none. */
export const ENVIRONMENT_COEFFICIENTS = 9
/** Floats of the environment in the GPU buffer: the coefficients, 9 × 4, then the fog's block, 8. */
export const SCENE_ENVIRONMENT_FLOATS = 44

/**
 * The factors of the cosine-lobe convolution per band: the irradiance at a normal is the
 * coefficient times this factor times the basis polynomial (`IRRADIANCE_TERMS`,
 * `irradianceBasis.ts`). Derived: each is its band's clamped-cosine weight times the
 * normalisation of its orthonormal harmonic. The weight is `Â_l = 2π ∫₀¹ P_l(t) t dt`, `P_l` the
 * band's Legendre polynomial: `Â_0 = π`, `Â_1 = 2π/3`, `Â_2 = π/4`. So constant
 * `π · 1/(2√π) = √π/2`, linear `2π/3 · √(3/(4π)) = √(π/3)`, quadraticCross
 * `π/4 · √(15/(4π)) = √(15π)/8`, quadraticZ `π/4 · √(5/(16π)) = √(5π)/16`, quadraticDifference
 * `π/4 · √(15/(16π)) = √(15π)/16`. Each literal is within one unit in the last place of its
 * closed form, and the last is exactly half the cross one; `irradianceBasis.test.ts` checks each
 * against its closed form and all of them against the sphere integrated over 20 000 directions (a
 * constant sky gives `π L`).
 */
export const IRRADIANCE_BAND = {
  constant: 0.886226925452758,
  linear: 1.0233267079464885,
  quadraticCross: 0.8580855308097834,
  quadraticZ: 0.2477079561003757,
  quadraticDifference: 0.4290427654048917,
} as const

/** The 27 numbers an irradiance is summed into, read and written by index: a list, or the
 *  floats a program uploads. */
export type IrradianceSum = NumberSink

/** An irradiance with nothing in it, ready to receive sources. */
export const emptyIrradiance = () => new Array<number>(ENVIRONMENT_COEFFICIENTS * 3).fill(0)

/** Adds a uniform irradiance `rgb` — the same at every normal — to `sh`. */
export function addUniformIrradiance<T extends IrradianceSum>(sh: T, rgb: readonly number[]) {
  for (let c = 0; c < 3; c++) sh[c] += rgb[c] / IRRADIANCE_BAND.constant
  return sh
}

/**
 * Adds a sky over a ground: `sky` irradiance on a normal along `up`, `ground` on the opposite
 * one, and the linear blend in between — `mix(ground, sky, (1 + N·up) / 2)`. That blend is the
 * constant band plus the linear one, so it is represented exactly.
 */
export function addHemisphereIrradiance<T extends IrradianceSum>(
  sh: T,
  sky: readonly number[],
  ground: readonly number[],
  up: readonly number[],
) {
  const axis = [up[1], up[2], up[0]]
  for (let c = 0; c < 3; c++) {
    sh[c] += (sky[c] + ground[c]) / 2 / IRRADIANCE_BAND.constant
    const slope = (sky[c] - ground[c]) / 2 / IRRADIANCE_BAND.linear
    for (let band = 0; band < 3; band++) sh[(band + 1) * 3 + c] += slope * axis[band]
  }
  return sh
}

/** Adds 27 coefficients a probe carries, scaled by `scale`. */
export function addIrradianceCoefficients<T extends IrradianceSum>(
  sh: T,
  coefficients: ArrayLike<number>,
  scale: number,
) {
  for (let i = 0; i < ENVIRONMENT_COEFFICIENTS * 3; i++) sh[i] += (coefficients[i] ?? 0) * scale
  return sh
}

/** Writes an environment's irradiance into its GPU block, one `vec4` per coefficient, then its
 *  fog behind them. */
export function packEnvironment(environment: SceneEnvironment | undefined, out: Float32Array) {
  out.fill(0)
  packFog(environment?.fog, out, ENVIRONMENT_COEFFICIENTS * 4)
  const sh = environment?.irradiance
  if (!sh) return out
  for (let k = 0; k < ENVIRONMENT_COEFFICIENTS; k++)
    for (let c = 0; c < 3; c++) out[k * 4 + c] = sh[k * 3 + c]
  return out
}
