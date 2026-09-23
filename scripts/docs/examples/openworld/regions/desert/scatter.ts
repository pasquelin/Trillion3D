/**
 * Plants and loose rock over the open desert, until the region's node budget is spent. Where
 * sand is scarce (the gravel plain) cacti, succulents, shrubs and boulders grow in clumps; on
 * the erg's fringe only shrubs and tumbleweed hold; the heart of the sand sea stays bare.
 */
import { between, hash01 } from '../../props/index.ts';
import type { Build } from './build.ts';
import { sandSupply } from './dunes.ts';
import { rockAt } from './relief.ts';

/** Clump members by ground: plain (reg), erg fringe. Relative frequencies by repetition. */
const REG = [
  'desert/cactus-giant',
  'desert/cactus-tall',
  'desert/cactus-young',
  'desert/cactus-young',
  'desert/prickly-pear',
  'desert/agave',
  'desert/agave',
  'desert/barrel-cactus',
  'desert/barrel-cactus',
  'desert/dry-shrub',
  'desert/dry-shrub',
  'desert/dry-shrub',
  'desert/boulder-0',
  'desert/boulder-2',
  'desert/boulder-3',
  'desert/scree-b',
  'desert/outcrop-0',
  'desert/outcrop-1',
  'desert/outcrop-2',
];
const FRINGE = [
  'desert/dry-shrub',
  'desert/dry-shrub',
  'desert/tumbleweed',
  'desert/dead-tree',
  'desert/agave',
];

/** Nodes left for scatter once `target` is reached: stop. Clumps of 1–6 within 14 m. */
export function scatter(b: Build, target: number) {
  const { minX, minZ, maxX, maxZ } = b.site.bounds,
    tries = target * 8;
  for (let i = 0; i < tries && b.site.instances.length < target; i++) {
    const x = minX + (maxX - minX) * hash01(b.seed + 21, i),
      z = minZ + (maxZ - minZ) * hash01(b.seed + 22, i),
      sand = sandSupply(x, z),
      rock = rockAt(x, z).owned;
    // Plants keep off the tablelands' cliffs and tops; the talus has its own scree.
    const kind = sand < -0.1 ? REG : sand < 0.3 ? FRINGE : undefined;
    const chance = kind === REG ? 1 : kind ? 0.35 : 0;
    if (rock > 0.2 || hash01(b.seed + 23, i) >= chance || !kind) continue;
    const members = 1 + Math.floor(hash01(b.seed + 24, i) * 6);
    for (let m = 0; m < members && b.site.instances.length < target; m++) {
      const prop = kind[Math.floor(hash01(b.seed + 25, i, m) * kind.length)],
        a = between(b.seed + 26, i * 8 + m, 0, Math.PI * 2),
        r = m ? between(b.seed + 27, i * 8 + m, 3, 14) : 0,
        size = prop.startsWith('desert/boulder')
          ? between(b.seed + 28, i * 8 + m, 0.5, 1.4)
          : between(b.seed + 28, i * 8 + m, 0.75, 1.2);
      b.site.place(prop, x + Math.cos(a) * r, z + Math.sin(a) * r, a * 3, { scale: size });
    }
  }
}
