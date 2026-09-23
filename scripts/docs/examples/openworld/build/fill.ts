/**
 * No empty land (#332): once every region has placed its content, each 100 m cell of dry land
 * that holds nothing — no prop reaching into it, no road, no water, not the airport platform —
 * receives a few of the plants its own region already scatters most (its trees, bushes, cacti,
 * dune grass: props the physics walks through), turned and offset at random, standing on the plan's ground. Nothing new is
 * modelled: a cell looks like the region around it.
 */
import { WORLD, type Instance, type PropMesh, type RegionName } from '../plan/contract.ts';
import type { TerrainPlan } from '../plan/plan.ts';
import { hash01 } from '../props/index.ts';

/** Side of a checked cell, metres, and the props one empty cell receives. */
export const FILL_CELL = 100;
const PER_CELL = 4;
/** A region's prop counts as scattered when it places at least this many copies of it. */
const SCATTERED = 24;
/** Clearance kept from a road's edge, metres. */
const VERGE = 8;

const SIDE = WORLD.size / FILL_CELL,
  HALF = WORLD.size / 2;

/** The horizontal reach of each mesh from its origin, metres. */
function reaches(meshes: readonly PropMesh[]) {
  const out = new Map<string, number>();
  for (const mesh of meshes) {
    let reach = 0;
    for (const part of mesh.parts)
      for (let i = 0; i < part.positions.length; i += 3)
        reach = Math.max(reach, Math.hypot(part.positions[i], part.positions[i + 2]));
    out.set(mesh.id, reach);
  }
  return out;
}

/** The cells any placed prop reaches into. */
function occupied(instances: readonly Instance[], reach: ReadonlyMap<string, number>) {
  const used = new Uint8Array(SIDE * SIDE);
  for (const { prop, position, scale } of instances) {
    const s = typeof scale === 'number' ? scale : scale ? Math.max(scale[0], scale[2]) : 1,
      r = (reach.get(prop) ?? 0) * s,
      [i0, i1, k0, k1] = [position[0] - r, position[0] + r, position[2] - r, position[2] + r].map(
        (v) => Math.min(SIDE - 1, Math.max(0, Math.floor((v + HALF) / FILL_CELL))),
      );
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) used[k * SIDE + i] = 1;
  }
  return used;
}

/** Whether a cell is ground a prop may stand on: dry, off roads, lakes and the platform. */
function open(plan: TerrainPlan, x: number, z: number) {
  const p = plan.platform;
  if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return false;
  if (plan.natural(x, z) < 1) return false;
  if (plan.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius + FILL_CELL)) return false;
  return !plan.roads.some((road) =>
    road.points.some(
      (q) => Math.hypot(q[0] - x, q[2] - z) < road.width / 2 + VERGE + FILL_CELL / 2,
    ),
  );
}

/**
 * The instances that fill every empty land cell, and the share of land cells that were empty,
 * from each region's `placed` instances (in `names` order).
 */
export function fillEmptyLand(
  plan: TerrainPlan,
  names: readonly RegionName[],
  placed: readonly (readonly Instance[])[],
  meshes: readonly PropMesh[],
  solid: (prop: string) => boolean,
) {
  const reach = reaches(meshes),
    used = occupied(placed.flat(), reach),
    pools = new Map<string, string[]>();
  names.forEach((name, index) => {
    const counts = new Map<string, number>();
    for (const { prop } of placed[index]) counts.set(prop, (counts.get(prop) ?? 0) + 1);
    pools.set(
      name,
      [...counts]
        .filter(([prop, n]) => n >= SCATTERED && !solid(prop))
        .flatMap(([prop, n]) => Array(n).fill(prop)),
    );
  });
  const seed = plan.subSeed('fill'),
    out: Instance[] = [];
  let [land, empty] = [0, 0];
  for (let k = 0; k < SIDE; k++)
    for (let i = 0; i < SIDE; i++) {
      const x = -HALF + (i + 0.5) * FILL_CELL,
        z = -HALF + (k + 0.5) * FILL_CELL;
      if (!open(plan, x, z)) continue;
      land++;
      if (used[k * SIDE + i]) continue;
      empty++;
      const pool = pools.get(plan.biome(x, z).owner);
      if (!pool?.length) continue;
      for (let n = 0; n < PER_CELL; n++) {
        const px = x + (hash01(seed, i, k, n * 4) - 0.5) * FILL_CELL,
          pz = z + (hash01(seed, i, k, n * 4 + 1) - 0.5) * FILL_CELL;
        out.push({
          prop: pool[Math.floor(hash01(seed, i, k, n * 4 + 2) * pool.length)],
          position: [px, plan.height(px, pz), pz],
          yaw: hash01(seed, i, k, n * 4 + 3) * Math.PI * 2,
        });
      }
    }
  return { instances: out, land, empty };
}
