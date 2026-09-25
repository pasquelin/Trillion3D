/**
 * FOG: THE LIGHT A MEDIUM ABSORBS AND SCATTERS BETWEEN A SURFACE AND THE EYE.
 *
 * A term of the one lighting model, applied per pixel to every surface, opaque and transparent,
 * lit or unlit alike — a normal or depth view and the diagnostic views excepted: the surface's
 * radiance `L` reaches the eye as `mix(color, L, T)`, where `T` is the transmittance along the
 * view ray and `color` the radiance the medium scatters toward the eye. Three laws give `T` at a
 * distance `d` from the eye:
 * - linear: `T = clamp((far − d) / (far − near), 0, 1)`;
 * - exponential (Beer-Lambert, a uniform medium): `T = exp(−density · d)`;
 * - exponential height fog, a medium whose density falls off with height,
 *   `density · exp(−heightFalloff · (y − baseHeight))`: `T = exp(−τ)`, the optical depth `τ`
 *   integrated in closed form along the ray (Wenzel, "Real-time Atmospheric Effects in Games",
 *   SIGGRAPH 2006; Quilez, "Better fog", 2010). A falloff of zero is the uniform medium.
 * The distance is measured from the camera's position, the height along +y.
 */
import { EngineError } from '../../contracts/cache.ts';

/** A linear RGB triple. */
type Rgb = readonly [number, number, number];

/** Fog that starts at `near` and hides everything from `far` on, distances from the eye. */
export interface SceneLinearFog {
  /** The radiance the fog fades toward, linear RGB. */
  color: Rgb;
  /** Distance from the eye where the fog starts. */
  near: number;
  /** Distance from the eye where nothing but the fog is seen. */
  far: number;
}

/** Fog thickening with distance: `density` per scene unit; with `heightFalloff`, it thins out
 *  above `baseHeight`, divided by e every `1 / heightFalloff` units up. */
export interface SceneExponentialFog {
  /** The radiance the fog fades toward, linear RGB. */
  color: Rgb;
  /** Extinction per scene unit, at `baseHeight`; ≥ 0. */
  density: number;
  /** How fast the density falls off with height, per scene unit; 0, the default, keeps it
   *  uniform at every height. */
  heightFalloff?: number;
  /** The height the density is `density` at; 0 by default. */
  baseHeight?: number;
}

/** Distance or height fog, as the lighting reads it. */
export type SceneFog = SceneLinearFog | SceneExponentialFog;

/** The law of a fog, by the rank shaders read: none leaves the surface as it is. */
export const FOG_MODE = { none: 0, linear: 1, exponential: 2 } as const;

/** Floats of a fog in a GPU block: the colour and the mode, then the law's three parameters. */
export const SCENE_FOG_FLOATS = 8;

/** A finite number, the one test every scene contract field is read with. */
export const finite = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value);
const refuse = (message: string, fog: unknown): never => {
  throw new EngineError('INVALID_SCENE_ENVIRONMENT', `fog: ${message}`, { fog });
};

/** Checks a fog and returns it validated, a copy: a colour of three finite numbers ≥ 0, then
 *  either `0 ≤ near < far`, or `density ≥ 0`, `heightFalloff ≥ 0` and a finite `baseHeight`. */
export function validateSceneFog(fog: SceneFog): SceneFog {
  const color = fog?.color;
  if (!Array.isArray(color) || color.length !== 3 || !color.every((c) => finite(c) && c >= 0))
    refuse('color expects three finite numbers ≥ 0', fog);
  const rgb: Rgb = [color[0], color[1], color[2]];
  if ('density' in fog) {
    const { density, heightFalloff = 0, baseHeight = 0 } = fog;
    if (!finite(density) || density < 0) refuse('density must be ≥ 0', fog);
    if (!finite(heightFalloff) || heightFalloff < 0) refuse('heightFalloff must be ≥ 0', fog);
    if (!finite(baseHeight)) refuse('baseHeight must be finite', fog);
    return { color: rgb, density, heightFalloff, baseHeight };
  }
  const { near, far } = fog as SceneLinearFog;
  if (!finite(near) || !finite(far) || near < 0 || far <= near)
    refuse('expects 0 ≤ near < far, or a density', fog);
  return { color: rgb, near, far };
}

/** A fog's mode and the three parameters of its law, in the order the GPU block holds them. */
const lawOf = (fog: SceneFog) =>
  'density' in fog
    ? [FOG_MODE.exponential, fog.density, fog.heightFalloff ?? 0, fog.baseHeight ?? 0]
    : [FOG_MODE.linear, fog.near, fog.far, 0];

/** Writes a fog into its GPU block at `offset`: colour and mode, then `near, far` or
 *  `density, heightFalloff, baseHeight`; all zero, mode none, without one. */
export function packFog(fog: SceneFog | undefined, out: Float32Array, offset: number) {
  out.fill(0, offset, offset + SCENE_FOG_FLOATS);
  if (!fog) return out;
  const [mode, ...law] = lawOf(fog);
  out.set(fog.color, offset);
  out[offset + 3] = mode;
  out.set(law, offset + 4);
  return out;
}

/** True when two validated fogs, or their absence, read the same in the GPU block. */
export function sameSceneFog(a: SceneFog | undefined, b: SceneFog | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  const lawA = lawOf(a),
    lawB = lawOf(b);
  return lawA.every((value, i) => value === lawB[i]) && a.color.every((c, i) => c === b.color[i]);
}
