/**
 * The desert's relief draws on the plan's own noise (`plan/noise.ts`) and adds the one shaping
 * curve its landforms share: benches, the stepped slope of alternating hard and soft strata.
 * Stateless: a value depends only on its seed and coordinates, so the plan samples in any order.
 */
import { WORLD } from '../../plan/contract.ts';
import { fbm, nameSeed, smoothstep } from '../../plan/noise.ts';
import { hash01 } from '../../props/index.ts';

export { fbm, hash01, smoothstep };

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Single-octave value noise in [-1, 1]. */
export const valueNoise = (seed: number, x: number, z: number) => fbm(seed, x, z, 1);

/**
 * Benches: `t` in [0, 1] across a slope broken into `steps` flat treads and steep risers (the
 * last `riser` share of each step). Differential erosion of hard and soft strata makes them.
 */
export function benches(t: number, steps: number, riser: number): number {
  const s = clamp01(t) * steps,
    k = Math.min(Math.floor(s), steps - 1);
  return (k + smoothstep(1 - riser, 1, s - k)) / steps;
}

/**
 * The seed of every desert field. `refine` sees no plan (it runs while the plan is composed),
 * so the relief draws from the world seed alone, under the region's own name.
 */
export const FIELD_SEED = nameSeed(WORLD.seed, 'desert/relief');
