/**
 * Natural lumps and shrubs: rocks are cube-spheres displaced by fractal noise (smooth-shaded,
 * dense enough to hold their cracks and ledges at close range), bushes are small grown plants
 * (`branches.ts`). Seeded: same seed, same bytes.
 */
import type { MeshPart, PropMesh, Surface, Vec3 } from '../plan/contract.ts';
import { foliage, grow, wood, type GrowthRule } from './branches.ts';
import { deform } from './geometry.ts';
import { fractalNoise } from './noise.ts';
import { roundedBox } from './smooth.ts';
import { SURFACES } from './surfaces.ts';
import { prop } from './transform.ts';

/**
 * A lump of half-extents `radius`, its underside flattened to sit on y = 0, its surface pushed
 * in and out by up to about `roughness` × radius of fractal noise at `frequency` bumps across.
 * `detail` cells per cube face side: 48 × detail² triangles.
 */
export function blob(
  surface: Surface,
  radius: Vec3,
  seed: number,
  { detail = 12, roughness = 0.25, frequency = 1.6 } = {},
): MeshPart {
  const sphere = roundedBox(surface, [2, 2, 2], 1, detail);
  return deform(sphere, ([x, y, z]) => {
    const p: Vec3 = [x, y - 1, z],
      bump =
        1 +
        roughness * fractalNoise(seed, [p[0] * frequency, p[1] * frequency, p[2] * frequency], 5);
    return [
      p[0] * bump * radius[0],
      Math.max(-0.35, p[1] * bump) * radius[1] + 0.35 * radius[1],
      p[2] * bump * radius[2],
    ];
  });
}

/** Three rocks, about a metre across before instance scale: a boulder, a slab, a spire. */
export const rocks = (seed: number): PropMesh[] => [
  prop('rock-boulder', [blob(SURFACES.rock, [0.6, 0.5, 0.52], seed, { detail: 16 })]),
  prop('rock-slab', [
    blob(SURFACES.rock, [0.75, 0.22, 0.55], seed + 1, { detail: 12, roughness: 0.2 }),
  ]),
  prop('rock-spire', [
    blob(SURFACES.rock, [0.34, 1.1, 0.3], seed + 2, { detail: 12, roughness: 0.3, frequency: 2.2 }),
  ]),
];

/** A shrub: a few stems from the ground, twigs, leaves. */
const SHRUB: GrowthRule = {
  length: [0.35, 0.9, 0.4],
  radius: [0.04, 0.02, 0.008],
  children: [9, 6],
  start: [0.1, 0.3],
  spread: [0.9, 0.8],
  bend: [0.2, -0.1],
  sides: [5, 4, 3],
  apical: 0.2,
  leaves: 14,
  leaf: [0.16, 0.1],
};

function bush(id: string, leaves: Surface, size: number, seed: number) {
  const rule = { ...SHRUB, length: SHRUB.length.map((l) => l * size) },
    branches = grow(rule, seed);
  return prop(id, [...wood(SURFACES.bark, branches, rule), foliage(leaves, branches, rule, seed)]);
}

/** Two bushes: a round garden shrub and a wider wild bush. */
export const bushes = (seed: number): PropMesh[] => [
  bush('bush-round', SURFACES.leaves, 1, seed),
  bush('bush-wild', SURFACES.birchLeaves, 1.5, seed + 100),
];
