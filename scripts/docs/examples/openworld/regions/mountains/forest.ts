/**
 * The scatter that fills the region once everything built is placed: forest below the tree
 * line (spruce-like pines in the valleys, larches and snow-laden pines near the line, snags at
 * its edge), boulder fields above it, crags on the steep high faces. Ground is judged on a
 * 250 m grid; each suitable cell receives a share of the node budget weighted by its density.
 */
import { plantStands } from '../stands.ts';
import type { Placer } from './space.ts';
import { steep } from './surfaces.ts';
import { perlin, slopeOf, SNOW_LINE, TREE_LINE } from './terrain.ts';

const CELL = 250;

type Pick = readonly (readonly [string, number])[];

/** The tree mix by altitude band: the higher, the sparser, the hardier. */
const TREES: readonly { below: number; mix: Pick }[] = [
  {
    below: 1_400,
    mix: [
      ['tree-pine-large', 0.55],
      ['tree-pine-small', 0.25],
      ['tree-birch-large', 0.1],
      ['mountains/larch', 0.1],
    ],
  },
  {
    below: TREE_LINE - 250,
    mix: [
      ['tree-pine-large', 0.45],
      ['tree-pine-small', 0.25],
      ['mountains/larch', 0.2],
      ['mountains/pine-frosted', 0.1],
    ],
  },
  {
    below: Infinity,
    mix: [
      ['mountains/pine-frosted', 0.35],
      ['tree-pine-small', 0.3],
      ['mountains/larch', 0.25],
      ['mountains/snag', 0.1],
    ],
  },
];
const ROCKS: Pick = [
  ['mountains/boulder-0', 0.2],
  ['mountains/boulder-1', 0.2],
  ['mountains/boulder-2', 0.15],
  ['mountains/boulder-3', 0.15],
  ['rock-boulder', 0.15],
  ['rock-slab', 0.1],
  ['rock-spire', 0.05],
];

const choose = (mix: Pick, u: number) => {
  for (const [id, share] of mix) if ((u -= share) < 0) return id;
  return mix[mix.length - 1][0];
};

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Layer = {
  /** How much of this layer a cell at (x, z), height h, slope s wants, in [0, 1]. */
  density(x: number, z: number, h: number, s: number): number;
  place(placer: Placer, x: number, z: number, h: number, rand: () => number, n: number): boolean;
};

const forest = (seed: number): Layer => ({
  density: (x, z, h, s) =>
    s > steep(40) || h < 250
      ? 0
      : Math.max(0, perlin(seed, x / 1_800, z / 1_800) + 0.35) *
        smooth(TREE_LINE + 80, TREE_LINE - 300, h),
  place(placer, x, z, h, rand, n) {
    const id = choose(TREES.find((band) => h < band.below)!.mix, rand());
    return !!placer.place(id, x, z, {
      yaw: rand() * 6.283,
      scale: 0.75 + rand() * 0.5,
      sink: 0.15,
      maxSlope: steep(40),
      name: `mountains/tree-${n}`,
    });
  },
});

const boulders = (seed: number): Layer => ({
  density: (x, z, h, s) =>
    h < TREE_LINE - 400 || s < steep(10) || s > steep(50)
      ? 0
      : Math.max(0, perlin(seed + 1, x / 900, z / 900) + 0.1) *
        smooth(TREE_LINE - 400, TREE_LINE, h),
  place(placer, x, z, _h, rand, n) {
    const scale = 1 + 5 * rand() ** 3;
    return !!placer.place(choose(ROCKS, rand()), x, z, {
      yaw: rand() * 6.283,
      scale,
      sink: 0.12 * scale,
      name: `mountains/rock-${n}`,
    });
  },
});

const cragLayer: Layer = {
  density: (_x, _z, h, s) => (h > TREE_LINE && h < SNOW_LINE + 400 && s > steep(30) ? 0.3 : 0),
  place(placer, x, z, _h, rand, n) {
    const scale = 0.8 + rand() * 0.5;
    return !!placer.place(`mountains/crag-${Math.floor(rand() * 3)}`, x, z, {
      yaw: rand() * 6.283,
      scale,
      sink: 2,
      name: `mountains/crag-${n}`,
    });
  },
};

/** The region's cells where `layer` wants something, with its density at their centre. */
function cellsOf(placer: Placer, layer: Layer) {
  const { bounds, plan } = placer,
    cells: { x: number; z: number; d: number }[] = [];
  for (let x = bounds.minX; x < bounds.maxX; x += CELL)
    for (let z = bounds.minZ; z < bounds.maxZ; z += CELL) {
      const [cx, cz] = [x + CELL / 2, z + CELL / 2];
      if (!placer.owns(cx, cz)) continue;
      const d = layer.density(cx, cz, plan.height(cx, cz), slopeOf(plan.height, cx, cz));
      if (d > 0) cells.push({ x, z, d });
    }
  return cells;
}

/** Spreads `count` props of `layer` over the region's cells, proportional to their density. */
function spread(placer: Placer, layer: Layer, count: number, rand: () => number) {
  const { plan } = placer,
    cells = cellsOf(placer, layer);
  const total = cells.reduce((sum, c) => sum + c.d, 0);
  let placed = 0;
  for (const cell of cells) {
    const want = Math.round((count * cell.d) / (total || 1));
    for (let tries = 0, got = 0; got < want && tries < want * 3; tries++) {
      const [x, z] = [cell.x + rand() * CELL, cell.z + rand() * CELL];
      if (layer.place(placer, x, z, plan.height(x, z), rand, placed))
        [got, placed] = [got + 1, placed + 1];
    }
  }
  return placed;
}

/**
 * The forest's closed stands over the forest's `nodes` (`regions/stands.ts`); each patch keeps
 * clear of roads and props like any prop.
 */
function stands(placer: Placer, layer: Layer, nodes: number) {
  const { plan } = placer;
  return plantStands({
    seed: plan.subSeed('props'),
    height: plan.height,
    cells: cellsOf(placer, layer).map(({ x, z, d }) => [x, z, CELL, d] as const),
    biomeAt: (x, z, h, s) =>
      placer.owns(x, z) && layer.density(x, z, h, s) > 0 ? 'alpine' : undefined,
    place: (spot, name) =>
      placer.place(spot.variant.id, spot.x, spot.z, {
        yaw: spot.yaw,
        y: spot.y,
        group: 'forest-stands',
        name: `mountains/${name}`,
      }),
    nodes,
  });
}

/**
 * Fills the nodes left: three quarters forest — closed stands first, single trees on the edges
 * and slopes the stands leave — a fifth boulders, the rest crags.
 */
export function scatter(placer: Placer, seed: number, rand: () => number) {
  const room = placer.maxNodes - placer.instances.length,
    woods = forest(seed),
    share = Math.floor(room * 0.74),
    closed = stands(placer, woods, share);
  return {
    stands: closed.patches,
    standTrees: closed.trees,
    trees: spread(placer, woods, share - closed.patches, rand),
    rocks: spread(placer, boulders(seed), Math.floor(room * 0.2), rand),
    crags: spread(placer, cragLayer, Math.floor(room * 0.03), rand),
  };
}
