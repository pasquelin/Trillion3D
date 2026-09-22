/**
 * THE ENVIRONMENT: WHAT LIGHTS A SURFACE FROM EVERY DIRECTION, AND HOW RADIANCE BECOMES AN IMAGE.
 *
 * Two things that are not lamps. The first is the light that arrives from everywhere at once —
 * a uniform ambient, a sky over a ground, a probe captured around the scene. None of them has a
 * position or a range; each is an irradiance that depends only on the normal it falls on, and all
 * of them add into ONE function of that normal: nine spherical-harmonic coefficients per colour
 * channel (Ramamoorthi and Hanrahan, "An Efficient Representation for Irradiance Environment
 * Maps", SIGGRAPH 2001). A uniform ambient is the constant band alone, a sky over a ground is the
 * constant and the linear bands exactly, a probe fills all nine. The surface model applies it to
 * the diffuse lobe: `albedo · (1 − metalness) / π · E(N)`.
 *
 * The second is the display chain: exposure multiplies linear radiance, then a tone-mapping
 * curve brings it into the display range (P4). Neither is a light: a scene with neither lamp nor
 * environment irradiance stays black whatever its exposure.
 */

/** The curves that bring scene radiance into the display range, by the rank shaders read. */
export const TONE_MAPPING_RANK = {
  none: 0,
  linear: 1,
  reinhard: 2,
  cineon: 3,
  aces: 4,
  agx: 5,
  neutral: 6,
} as const;
export type SceneToneMapping = keyof typeof TONE_MAPPING_RANK;
/** The display curve of a scene that names none, or declares no environment at all. */
export const DEFAULT_TONE_MAPPING: SceneToneMapping = 'aces';

export interface SceneEnvironment {
  /** Multiplier of linear radiance, applied before the curve. */
  exposure: number;
  /** The display curve; `DEFAULT_TONE_MAPPING` when absent. */
  toneMapping?: SceneToneMapping;
  /**
   * The irradiance arriving from every direction, as 27 numbers: nine coefficients, each an RGB
   * triple, in the band order constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`.
   * Absent, or all zero, nothing lights a surface but the declared lamps.
   */
  irradiance?: readonly number[];
}

/** Coefficients of the irradiance, and the floats they take in a GPU buffer: one `vec4` each.
 *  Written as literals, like the factors below, so a bundle that reads none of them keeps none. */
export const ENVIRONMENT_COEFFICIENTS = 9;
export const SCENE_ENVIRONMENT_FLOATS = 36;

/**
 * The factors of the cosine-lobe convolution per band (Ramamoorthi and Hanrahan, eq. 12): the
 * irradiance at a normal is the coefficient times this factor times the basis polynomial. The
 * linear and cross terms carry the paper's factor 2: `2 · 0.511664` and `2 · 0.429043`.
 */
export const IRRADIANCE_BAND = {
  constant: 0.886227,
  linear: 1.023328,
  quadraticCross: 0.858086,
  quadraticZ: 0.743125,
  quadraticZOffset: 0.247708,
  quadraticDifference: 0.429043,
} as const;

/** An irradiance with nothing in it, ready to receive sources. */
export const emptyIrradiance = () => new Array<number>(ENVIRONMENT_COEFFICIENTS * 3).fill(0);

/** Adds a uniform irradiance `rgb` — the same at every normal — to `sh`. */
export function addUniformIrradiance(sh: number[], rgb: readonly number[]) {
  for (let c = 0; c < 3; c++) sh[c] += rgb[c] / IRRADIANCE_BAND.constant;
  return sh;
}

/**
 * Adds a sky over a ground: `sky` irradiance on a normal along `up`, `ground` on the opposite
 * one, and the linear blend in between — `mix(ground, sky, (1 + N·up) / 2)`. That blend is the
 * constant band plus the linear one, so it is represented exactly.
 */
export function addHemisphereIrradiance(
  sh: number[],
  sky: readonly number[],
  ground: readonly number[],
  up: readonly number[],
) {
  const axis = [up[1], up[2], up[0]];
  for (let c = 0; c < 3; c++) {
    sh[c] += (sky[c] + ground[c]) / 2 / IRRADIANCE_BAND.constant;
    const slope = (sky[c] - ground[c]) / 2 / IRRADIANCE_BAND.linear;
    for (let band = 0; band < 3; band++) sh[(band + 1) * 3 + c] += slope * axis[band];
  }
  return sh;
}

/** Adds 27 coefficients a probe carries, scaled by `scale`. */
export function addIrradianceCoefficients(
  sh: number[],
  coefficients: ArrayLike<number>,
  scale: number,
) {
  for (let i = 0; i < ENVIRONMENT_COEFFICIENTS * 3; i++) sh[i] += (coefficients[i] ?? 0) * scale;
  return sh;
}

/** Writes an environment's irradiance into its GPU block, one `vec4` per coefficient. */
export function packEnvironment(environment: SceneEnvironment | undefined, out: Float32Array) {
  out.fill(0);
  const sh = environment?.irradiance;
  if (!sh) return out;
  for (let k = 0; k < ENVIRONMENT_COEFFICIENTS; k++)
    for (let c = 0; c < 3; c++) out[k * 4 + c] = sh[k * 3 + c];
  return out;
}

/** True when the environment lights something: one coefficient differs from zero. */
export const environmentLights = (environment: SceneEnvironment | undefined) =>
  !!environment?.irradiance?.some((value) => value !== 0);
