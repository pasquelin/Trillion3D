/**
 * Four tree species in two sizes each, real-world heights, rooted at the origin, grown from
 * branching rules (`branches.ts`): pine (a straight leader, whorls of drooping limbs, needle
 * tufts), oak (a short bole that forks into a broad crown), birch (a slim white stem, weeping
 * twigs), palm (`palm.ts`). Ids: `tree-<species>-<small|large>`.
 */
import type { PropMesh } from '../plan/contract.ts';
import { foliage, grow, wood, type GrowthRule } from './branches.ts';
import { palm } from './palm.ts';
import { SURFACES } from './surfaces.ts';
import { prop } from './transform.ts';

export type TreeSpecies = 'pine' | 'oak' | 'birch' | 'palm';
export type TreeSize = 'small' | 'large';

/** Rules by species and size: lengths and radii in metres, one value per branch level. */
const RULES: Record<Exclude<TreeSpecies, 'palm'>, Record<TreeSize, GrowthRule>> = {
  pine: {
    large: {
      length: [24, 6.5, 1.6],
      radius: [0.42, 0.11, 0.03],
      children: [56, 6],
      start: [0.22, 0.2],
      spread: [1.35, 0.7],
      bend: [-0.35, -0.2],
      sides: [14, 6, 3],
      apical: 0.92,
      leaves: 14,
      leaf: [0.55, 0.22],
    },
    small: {
      length: [9, 2.6, 0.9],
      radius: [0.16, 0.05, 0.02],
      children: [30, 5],
      start: [0.15, 0.2],
      spread: [1.3, 0.7],
      bend: [-0.3, -0.2],
      sides: [10, 5, 3],
      apical: 0.9,
      leaves: 12,
      leaf: [0.4, 0.16],
    },
  },
  oak: {
    large: {
      length: [7.5, 10, 4, 1.1],
      radius: [0.5, 0.24, 0.08, 0.025],
      children: [6, 7, 6],
      start: [0.55, 0.2, 0.25],
      spread: [0.85, 0.7, 0.8],
      bend: [0.1, -0.1, -0.2],
      sides: [16, 10, 5, 3],
      apical: 0.3,
      leaves: 14,
      leaf: [0.5, 0.34],
    },
    small: {
      length: [3.4, 3.2, 1.4, 0.6],
      radius: [0.18, 0.09, 0.035, 0.014],
      children: [4, 6, 5],
      start: [0.5, 0.25, 0.3],
      spread: [0.75, 0.7, 0.8],
      bend: [0.3, 0.1, -0.1],
      sides: [10, 6, 4, 3],
      apical: 0.3,
      leaves: 12,
      leaf: [0.34, 0.24],
    },
  },
  birch: {
    large: {
      length: [17, 6.5, 2.6, 0.9],
      radius: [0.24, 0.08, 0.03, 0.012],
      children: [16, 6, 4],
      start: [0.3, 0.2, 0.3],
      spread: [0.6, 0.7, 0.6],
      bend: [0.25, -0.5, -0.9],
      sides: [14, 6, 4, 3],
      apical: 0.55,
      leaves: 10,
      leaf: [0.34, 0.22],
    },
    small: {
      length: [7, 2.2, 1, 0.5],
      radius: [0.1, 0.035, 0.015, 0.008],
      children: [10, 5, 3],
      start: [0.3, 0.2, 0.3],
      spread: [0.6, 0.7, 0.6],
      bend: [0.25, -0.5, -0.9],
      sides: [10, 5, 3, 3],
      apical: 0.55,
      leaves: 10,
      leaf: [0.26, 0.17],
    },
  },
};

const LOOK = {
  pine: { bark: SURFACES.bark, leaves: SURFACES.needles },
  oak: { bark: SURFACES.bark, leaves: SURFACES.leaves },
  birch: { bark: SURFACES.birchBark, leaves: SURFACES.birchLeaves },
};

/** One tree prop. `seed` varies every branch and leaf; the height is the species' own. */
export function tree(species: TreeSpecies, size: TreeSize, seed: number): PropMesh {
  const id = `tree-${species}-${size}`;
  if (species === 'palm') return prop(id, palm(size === 'large' ? 16 : 7, seed));
  const rule = RULES[species][size],
    branches = grow(rule, seed),
    { bark, leaves } = LOOK[species];
  return prop(id, [...wood(bark, branches, rule), foliage(leaves, branches, rule, seed)]);
}

/** All eight trees. */
export const trees = (seed: number): PropMesh[] =>
  (['pine', 'oak', 'birch', 'palm'] as const).flatMap((species, i) =>
    (['small', 'large'] as const).map((size, j) => tree(species, size, seed + i * 1000 + j * 100)),
  );
