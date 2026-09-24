/**
 * What grows and lies about: marram grass on the dunes behind the beaches, coastal pine woods
 * on the land above them — closed stands (`props/stands.ts`) in their deeper half, single pines
 * and bushes on their margin — and guardrails where a road of the plan runs along a drop
 * or the sea. Counts are shares of the nodes the budget leaves once the built sites are placed.
 */
import type { Road } from '../../../plan/contract.ts';
import { plantStands } from '../../stands.ts';
import { field } from '../relief.ts';
import { CLIFF_MIN } from './cliffs.ts';
import { yawToward, type Layout } from './layout.ts';
import { STEP } from './map.ts';

const TUFTS = ['coast-marram-small', 'coast-marram-large', 'coast-marram-sparse'];
const WOOD = [
  'tree-pine-small',
  'tree-pine-large',
  'tree-pine-small',
  'tree-oak-small',
  'bush-wild',
  'bush-round',
];

/** Land cells of the coast, filtered, in grid order. */
function cells(layout: Layout, keep: (h: number, i: number, k: number) => boolean): number[] {
  const { map } = layout,
    out: number[] = [];
  for (let k = 0; k < map.nz; k++)
    for (let i = 0; i < map.nx; i++) {
      const c = k * map.nx + i;
      if (map.land[c] && map.ours[c] && keep(map.heights[c], i, k)) out.push(c);
    }
  return out;
}

/** Places up to `count` of `ids` over `pool` cells, jittered inside each, in 3 × `count` tries. */
function scatter(
  layout: Layout,
  pool: readonly number[],
  ids: readonly string[],
  count: number,
  scale: [number, number],
) {
  const { map } = layout;
  let placed = 0;
  for (let n = 0; pool.length && placed < count && n < count * 3; n++) {
    const c = pool[Math.floor(layout.random() * pool.length)],
      i = c % map.nx,
      k = (c - i) / map.nx;
    const done = layout.place(
      ids[Math.floor(layout.random() * ids.length)],
      map.x(i) + (layout.random() - 0.5) * STEP,
      map.z(k) + (layout.random() - 0.5) * STEP,
      layout.random() * Math.PI * 2,
      { scale: scale[0] + layout.random() * (scale[1] - scale[0]), maxRise: 1.5 },
    );
    if (done) placed++;
  }
}

/** Closed pine stands over the woods' cells and `nodes`; the patches and their trees. */
function stands(layout: Layout, woods: readonly number[], nodes: number) {
  const { map } = layout,
    wooded = new Set(woods),
    cellOf = (x: number, z: number) =>
      Math.floor((z - map.bounds.minZ) / STEP) * map.nx + Math.floor((x - map.bounds.minX) / STEP);
  return plantStands({
    seed: map.plan.subSeed('props'),
    height: map.height,
    cells: woods.map((c) => {
      const [i, k] = [c % map.nx, Math.floor(c / map.nx)];
      return [
        map.x(i) - STEP / 2,
        map.z(k) - STEP / 2,
        STEP,
        field(layout.seed, map.x(i), map.z(k), 900),
      ] as const;
    }),
    biomeAt: (x, z) => (wooded.has(cellOf(x, z)) ? 'alpine' : undefined),
    place: (spot, name) =>
      layout.place(spot.variant.id, spot.x, spot.z, spot.yaw, { y: spot.y, name: `coast/${name}` }),
    nodes,
  });
}

/** Grass on the dunes, woods on the land behind: `nodes` shared 60 / 40. */
export function vegetation(layout: Layout, nodes: number) {
  const low = new Set(layout.map.shores.filter((s) => s.height < CLIFF_MIN).map((s) => s.cell)),
    near = (i: number, k: number, r: number) => {
      for (let dk = -r; dk <= r; dk++)
        for (let di = -r; di <= r; di++)
          if (low.has((k + dk) * layout.map.nx + i + di)) return true;
      return false;
    };
  const dunes = cells(layout, (h, i, k) => h > 1.5 && h < 22 && near(i, k, 5)),
    woods = cells(
      layout,
      (h, i, k) =>
        h > 8 &&
        h < 400 &&
        !near(i, k, 2) &&
        field(layout.seed, layout.map.x(i), layout.map.z(k), 900) > 0.45,
    );
  scatter(layout, dunes, TUFTS, Math.round(nodes * 0.6), [0.8, 1.4]);
  const share = Math.round(nodes * 0.4),
    closed = stands(layout, woods, share);
  scatter(layout, woods, WOOD, share - closed.patches, [0.8, 1.2]);
  return closed;
}

/** Guardrail bays along plan roads where the ground beside them drops 2.5 m or meets the sea. */
export function guardrails(layout: Layout, roads: readonly Road[]) {
  const b = layout.map.bounds;
  for (const road of roads) {
    if (road.class === 'dirt' || road.class === 'runway' || road.class === 'taxiway') continue;
    for (let p = 0; p + 1 < road.points.length; p++) {
      const [a, c] = [road.points[p], road.points[p + 1]],
        length = Math.hypot(c[0] - a[0], c[2] - a[2]);
      if (length < 1 || a[0] < b.minX || a[0] > b.maxX || a[2] < b.minZ || a[2] > b.maxZ) continue;
      const [dx, dz] = [(c[0] - a[0]) / length, (c[2] - a[2]) / length];
      for (let s = 2; s + 2 <= length; s += 4)
        for (const side of [-1, 1]) {
          const [nx, nz] = [dz * side, -dx * side],
            offset = road.width / 2 + 0.6,
            x = a[0] + dx * s + nx * offset,
            z = a[2] + dz * s + nz * offset,
            y = a[1] + ((c[1] - a[1]) * s) / length,
            below = layout.map.height(x + nx * 4, z + nz * 4);
          if (below > 0 && y - below < 2.5) continue;
          layout.place('coast-guardrail', x, z, yawToward(-nx, -nz), { maxRise: 3, wet: true });
        }
    }
  }
}
