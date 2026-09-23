/**
 * Desert plants at real size, rooted at the origin: the cacti and succulents (`cacti.ts`),
 * grown dry shrubs and a dead tree (the kit's `grow`), a tumbleweed (also rolled by the page as
 * a mover) and reeds for the oasis. Thin leaves are `card/…` surfaces, drawn from both sides.
 */
import type { PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  between,
  card,
  foliage,
  grow,
  meshPart,
  prop,
  transform,
  tube,
  wood,
  type GrowthRule,
} from '../../props/index.ts';
import { agave, barrel, columnar, pricklyPear } from './cacti.ts';
import { DESERT, srgb } from './palette.ts';

const REED = card('desert/reed', srgb(120, 128, 60)),
  DRY_LEAF = card('desert/dry-leaf', srgb(110, 104, 60), 0.9);

/** A grown plant: wood from `rule`, leaves on its twigs when the rule has any. */
function grown(id: string, rule: GrowthRule, seed: number): PropMesh {
  const branches = grow(rule, seed),
    parts = wood(DESERT.deadWood, branches, rule);
  return prop(id, rule.leaves ? [...parts, foliage(DRY_LEAF, branches, rule, seed)] : parts);
}

/** A creosote-like shrub: many thin stems from the root, small dry leaves at their tips. */
const SHRUB: GrowthRule = {
  length: [0.15, 1.1, 0.45],
  radius: [0.05, 0.02, 0.008],
  children: [8, 4],
  start: [0.1, 0.35],
  spread: [0.55, 0.6],
  bend: [0.15, 0.1],
  sides: [6, 4, 3],
  apical: 0.2,
  leaves: 7,
  leaf: [0.06, 0.025],
};

/** A dead desert tree, 5 m: a short twisted trunk, bare spreading limbs. */
const DEAD_TREE: GrowthRule = {
  length: [2, 2.4, 1.1, 0.45],
  radius: [0.2, 0.09, 0.04, 0.015],
  children: [4, 3, 3],
  start: [0.45, 0.3, 0.3],
  spread: [0.85, 0.7, 0.6],
  bend: [0.05, -0.05, 0.05],
  sides: [10, 7, 5, 4],
  apical: 0.4,
  leaves: 0,
  leaf: [0, 0],
};

/** A tumbleweed: a ball of crossing twigs, 0.8 m across, its centre 0.4 m up. */
function tumbleweed(id: string, seed: number): PropMesh {
  const loops = Array.from({ length: 40 }, (_, i) => {
    const ring = Array.from({ length: 17 }, (_, k): Vec3 => {
      const a = (k / 16) * Math.PI * 2,
        r = 0.4 * (0.85 + 0.15 * Math.sin(a * 3 + i));
      return [Math.cos(a) * r, Math.sin(a) * r, 0];
    });
    return transform(tube(DESERT.dryBrush, ring, 0.008, { segments: 3 }), {
      at: [0, 0.4, 0],
      pitch: between(seed, i, 0, Math.PI),
      yaw: between(seed + 1, i, 0, Math.PI * 2),
    });
  });
  return prop(id, loops);
}

/** A clump of reeds: 60 blades, each bending out from the water's edge. */
function reeds(id: string, seed: number): PropMesh {
  const positions: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 60; i++) {
    const h = between(seed, i, 1.2, 2.4),
      a = i * 2.39996,
      lean = between(seed + 1, i, 0.1, 0.5),
      [bx, bz] = [between(seed + 2, i, -0.6, 0.6), between(seed + 3, i, -0.6, 0.6)],
      first = positions.length / 3;
    for (let s = 0; s <= 4; s++) {
      const t = s / 4,
        out = lean * h * t * t,
        w = 0.025 * (1 - t);
      for (const side of [-1, 1])
        positions.push(
          bx + Math.cos(a) * out - Math.sin(a) * w * side,
          h * t,
          bz + Math.sin(a) * out + Math.cos(a) * w * side,
        );
    }
    for (let s = 0; s < 4; s++) {
      const q = first + s * 2;
      indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  }
  return prop(id, [meshPart(REED, positions, indices)]);
}

/** Every plant prop of the desert, seeded. */
export const plantProps = (seed: number): PropMesh[] => [
  columnar('desert/cactus-giant', 12, 4, seed),
  columnar('desert/cactus-tall', 8, 2, seed + 10),
  columnar('desert/cactus-young', 3.5, 0, seed + 20),
  pricklyPear('desert/prickly-pear', seed + 30),
  agave('desert/agave', 1.6, 30, seed + 40),
  barrel('desert/barrel-cactus'),
  grown('desert/dry-shrub', SHRUB, seed + 50),
  grown('desert/dead-tree', DEAD_TREE, seed + 60),
  tumbleweed('desert/tumbleweed', seed + 70),
  reeds('desert/reeds', seed + 80),
];
