/**
 * Living props of the countryside, grown with the kit's branching plants: a hedgerow bay and a
 * dry-stone wall bay (each `BAY` metres along X, chained along field edges) and an orchard apple
 * tree hung with fruit. Stems and trunks reach below the ground, so a bay on a slope never shows a
 * floating foot.
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import {
  between,
  cylinder,
  foliage,
  grow,
  jitter,
  partBounds,
  prop,
  roundedBox,
  sphere,
  SURFACES,
  transform,
  wood,
  type GrowthRule,
} from '../../props/index.ts';
import { LAND } from './ground.ts';

/** Length of one hedge or wall bay, metres. */
export const BAY = 10;
/** Depth stems and trunks reach below their base, metres. */
const ROOT = 0.4;

/** A hawthorn-like shrub of a hedgerow: many stems, dense twigs, small leaves. */
const HEDGE_SHRUB: GrowthRule = {
  length: [1.3, 0.9, 0.4],
  radius: [0.05, 0.025, 0.01],
  children: [8, 5],
  start: [0.15, 0.3],
  spread: [0.75, 0.8],
  bend: [0.15, -0.1],
  sides: [5, 4, 3],
  apical: 0.25,
  leaves: 12,
  leaf: [0.14, 0.09],
};

/** An apple tree: a short trunk opening into a low, wide crown. */
const APPLE: GrowthRule = {
  length: [2.2, 2, 0.7],
  radius: [0.15, 0.06, 0.018],
  children: [6, 6],
  start: [0.55, 0.3],
  spread: [0.95, 0.7],
  bend: [0.15, -0.25],
  sides: [9, 5, 3],
  apical: 0.3,
  leaves: 10,
  leaf: [0.13, 0.07],
};

/** Parts squeezed along X to lie within ± `half`, so chained bays never overlap. */
function fitAlongX(parts: readonly MeshPart[], half: number): MeshPart[] {
  const [min, max] = partBounds(parts),
    reach = Math.max(-min[0], max[0]);
  return reach <= half
    ? [...parts]
    : parts.map((p) => transform(p, { scale: [half / reach, 1, 1] }));
}

/** A hedgerow bay: shrubs grown side by side, sunk a little into the ground. */
function hedge(seed: number): PropMesh {
  const shrubs = Array.from({ length: 6 }, (_, i) => {
    const branches = grow(HEDGE_SHRUB, seed + i),
      at = {
        at: [-BAY / 2 + 1 + i * 1.6, -ROOT, between(seed, i, -0.15, 0.15)] as const,
        yaw: i * 1.7,
      };
    return [
      ...wood(SURFACES.bark, branches, HEDGE_SHRUB),
      foliage(LAND.hedge, branches, HEDGE_SHRUB, seed + i),
    ].map((p) => transform(p, at));
  });
  return prop('countryside/hedge', fitAlongX(shrubs.flat(), BAY / 2 - 0.05));
}

/** A dry-stone wall bay, about a metre high: three courses of rounded stones and a coping row. */
function stoneWall(seed: number): PropMesh {
  const stones: MeshPart[] = [];
  for (let course = 0; course < 4; course++) {
    const height = course === 3 ? 0.22 : 0.36,
      y = -ROOT + course * 0.36,
      width = 0.7 - course * 0.08;
    let x = -BAY / 2 + 0.05 + (course % 2) * 0.35;
    while (x < BAY / 2 - 0.25) {
      const length = Math.min(
          between(seed, course * 100 + stones.length, 0.6, 1.2),
          BAY / 2 - 0.05 - x,
        ),
        stone = roundedBox(LAND.stone, [length - 0.04, height, width], 0.07, 2);
      stones.push(
        transform(jitter(stone, [0.01, 0.03, 0.04], seed + stones.length), {
          at: [x + length / 2, y, 0],
        }),
      );
      x += length;
    }
  }
  return prop('countryside/stone-wall', fitAlongX(stones, BAY / 2 - 0.02));
}

/** An orchard apple tree: grown wood and leaves, a root below ground, red fruit at the twigs. */
function fruitTree(seed: number): PropMesh {
  const branches = grow(APPLE, seed),
    twigs = branches.filter((b) => b.level === APPLE.length.length - 1),
    fruit = twigs
      .filter((_, i) => i % 2 === 0)
      .map((twig, i) =>
        transform(sphere(LAND.fruit, 0.05, { segments: 6, rings: 4 }), {
          at: twig.points[Math.floor(twig.points.length * between(seed, i, 0.4, 0.9))],
        }),
      );
  return prop('countryside/fruit-tree', [
    transform(cylinder(SURFACES.bark, 0.2, ROOT * 2.5, { segments: 9 }), {
      at: [0, -ROOT * 2.5, 0],
    }),
    ...wood(SURFACES.bark, branches, APPLE),
    foliage(LAND.appleLeaves, branches, APPLE, seed),
    ...fruit,
  ]);
}

/** Every living prop of the region, grown from `seed`. */
export const natureProps = (seed: number): PropMesh[] => [
  hedge(seed),
  stoneWall(seed + 1),
  fruitTree(seed + 2),
];
