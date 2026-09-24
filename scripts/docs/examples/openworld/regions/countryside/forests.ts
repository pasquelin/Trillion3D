/**
 * The woods: every node the budget leaves goes to them. Closed stands first — a forest patch
 * (`props/stands.ts`) on every patch-grid cell of the woodland its ground holds — then, with the
 * nodes left, one tree of the kit per spot, some with a bush at its foot, on the edges and slopes
 * the patches leave, deepest woodland first, trunks one crown diameter apart (the crowns read
 * from the kit's own trees). Birch in the hollows, pine on the high ground, oak between.
 */
// Waiting on the engine: instances scattered on the GPU, so the woods could fill all the land
// the forest field gives them instead of the share of nodes the cache budget leaves.
import type { PropMesh } from '../../plan/contract.ts';
import { hash01, partBounds } from '../../props/index.ts';
import { plantStands } from '../stands.ts';
import { shuffle, type Land } from './land.ts';
import type { Site } from './site.ts';

/** Share of trees with a bush at their foot. */
const UNDERGROWTH = 0.3;
/** Height above which the woods turn to pine, metres. */
const PINE_LINE = 350;
/** Side of the cells the woods are chosen by, metres. */
const CELL = 100;
const SPECIES = ['oak', 'birch', 'pine'] as const;

/** Mean crown radius of the kit's wood trees: half the trunk spacing of a closed canopy. */
export function crownRadius(shared: readonly PropMesh[]): number {
  const crowns = shared
    .filter((p) => SPECIES.some((s) => p.id.startsWith(`tree-${s}-`)))
    .map((p) => {
      const [min, max] = partBounds(p.parts);
      return (max[0] - min[0] + max[2] - min[2]) / 4;
    });
  return crowns.reduce((a, b) => a + b, 0) / crowns.length;
}

function speciesAt(site: Site, land: Land, x: number, z: number) {
  const s = land.species(x, z);
  if (site.plan.height(x, z) > PINE_LINE || s > 0.45) return 'pine';
  return s < -0.35 ? 'birch' : 'oak';
}

/** The stand a wood of `species` makes. */
const STAND = { pine: 'alpine', birch: 'birch', oak: 'broadleaf' } as const;

/** The closed stands over the woodland `cells`, up to `nodes` placed nodes in all. */
function stands(site: Site, land: Land, nodes: number, cells: readonly [number, number, number][]) {
  const seed = site.plan.subSeed('props');
  return plantStands({
    seed,
    height: site.plan.height,
    cells: cells.map(([x, z, depth]) => [x, z, CELL, depth] as const),
    biomeAt: (x, z) => (land.forest(x, z) > 0 ? STAND[speciesAt(site, land, x, z)] : undefined),
    place: (spot, name) =>
      site.place(spot.variant.id, spot.x, spot.z, spot.yaw, {
        seat: { y: spot.y },
        name: `countryside/${name}`,
      }),
    nodes: nodes - site.instances.length,
  });
}

/**
 * Fills the woods up to `nodes` placed nodes in all, single trunks `gap` apart; the trees
 * planted, singly and in the closed stands.
 */
export function plantForests(site: Site, land: Land, nodes: number, gap: number, seed: number) {
  const b = site.bounds,
    cells: [number, number, number][] = [];
  for (let x = b.minX; x < b.maxX; x += CELL)
    for (let z = b.minZ; z < b.maxZ; z += CELL) {
      const depth = land.forest(x + CELL / 2, z + CELL / 2);
      if (depth > 0) cells.push([x, z, depth]);
    }
  const closed = stands(site, land, nodes, cells),
    spots = (nodes - site.instances.length) / (1 + UNDERGROWTH),
    result = { stands: closed.patches, standTrees: closed.trees, trees: 0 };
  if (spots <= 0) return result;
  // The deepest woodland cells first, a batch at a time: as many as the spots fill at canopy
  // spacing, then the next ones for the spots a road or a field refused.
  cells.sort((p, q) => q[2] - p[2] || p[0] - q[0] || p[1] - q[1]);
  const per = Math.max(1, Math.floor(CELL / gap)),
    batch = Math.max(1, Math.ceil(spots / (per * per)));
  let trees = 0;
  for (let first = 0; first < cells.length && site.instances.length < nodes; first += batch) {
    const points = cells.slice(first, first + batch).flatMap(([x, z]) =>
      Array.from({ length: per * per }, (_, n): [number, number] => {
        const i = n % per,
          j = Math.floor(n / per);
        return [
          x + (i + 0.2 + 0.6 * hash01(seed, x + i, z + j)) * (CELL / per),
          z + (j + 0.2 + 0.6 * hash01(seed + 1, x + i, z + j)) * (CELL / per),
        ];
      }),
    );
    for (const [k, [x, z]] of shuffle(points, seed + first).entries()) {
      if (site.instances.length >= nodes) break;
      const size = hash01(seed + 3, first, k) < 0.55 ? 'large' : 'small',
        yaw = hash01(seed + 4, first, k) * Math.PI * 2;
      if (!site.place(`tree-${speciesAt(site, land, x, z)}-${size}`, x, z, yaw)) continue;
      trees++;
      if (hash01(seed + 5, first, k) < UNDERGROWTH && site.instances.length < nodes)
        site.place(
          hash01(seed + 6, first, k) < 0.5 ? 'bush-wild' : 'bush-round',
          x + Math.cos(yaw) * 3,
          z + Math.sin(yaw) * 3,
          yaw,
        );
    }
  }
  return { ...result, trees };
}

/** The deepest point of the woods on a coarse grid: where the clearing opens. */
export function deepestWood(site: Site, land: Land): [number, number] | undefined {
  const b = site.bounds;
  let best: [number, number] | undefined,
    depth = 0;
  for (let x = b.minX + CELL; x < b.maxX - CELL; x += CELL * 2.5)
    for (let z = b.minZ + CELL; z < b.maxZ - CELL; z += CELL * 2.5) {
      const d = land.forest(x, z);
      if (d > depth) [best, depth] = [[x, z], d];
    }
  return best;
}
