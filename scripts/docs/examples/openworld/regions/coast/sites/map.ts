/**
 * The coast read from the plan: a grid of ground heights over the region, which cells are land
 * and which sea, which land cells touch the sea (the shore) and which way the sea lies from
 * them, and which land belongs to the mainland and which to an island. Every site of the region
 * is chosen from this map, so any coastline the plan draws is dressed.
 */
import type { Bounds, Vec3, WorldPlan } from '../../../plan/contract.ts';

/** Grid spacing, metres: fine enough to see a 50 m headland, coarse enough to scan 600 km². */
export const STEP = 50;

export type Shore = {
  /** The shore cell's index in the grid. */
  cell: number;
  x: number;
  z: number;
  /** Unit vector from land toward the sea, in the ground plane. */
  normal: readonly [number, number];
  /** Ground height of the cell. */
  height: number;
  island: boolean;
};

export type CoastMap = {
  plan: WorldPlan;
  bounds: Bounds;
  nx: number;
  nz: number;
  heights: Float32Array;
  /** Land component of each cell (0 = sea; 1 = mainland; 2… = islands). */
  land: Int32Array;
  /** Whether the coast's biome owns the cell (or the sea around it). */
  ours: Uint8Array;
  shores: Shore[];
  x(i: number): number;
  z(k: number): number;
  height(x: number, z: number): number;
};

/** Labels 4-connected land cells; the component touching the region's inland (-X) edge is 1. */
function components(nx: number, nz: number, heights: Float32Array): Int32Array {
  const land = new Int32Array(nx * nz),
    stack: number[] = [];
  let next = 2,
    mainland = 0;
  for (let start = 0; start < land.length; start++) {
    if (land[start] || heights[start] <= 0) continue;
    const label = next++;
    let touchesInland = false;
    land[start] = label;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!,
        i = c % nx,
        k = (c - i) / nx;
      if (i === 0) touchesInland = true;
      for (const [di, dk] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const a = i + di,
          b = k + dk,
          n = b * nx + a;
        if (a < 0 || b < 0 || a >= nx || b >= nz || land[n] || heights[n] <= 0) continue;
        land[n] = label;
        stack.push(n);
      }
    }
    if (touchesInland && !mainland) mainland = label;
  }
  // Renumber: mainland 1, islands from 2, in first-seen order.
  return land.map((label) => (label === 0 ? 0 : label === mainland ? 1 : label + 1));
}

/** The seaward unit normal of a land cell: away from the mean of its land neighbours. */
function seaward(nx: number, nz: number, land: Int32Array, i: number, k: number) {
  let sx = 0,
    sz = 0;
  for (let dk = -2; dk <= 2; dk++)
    for (let di = -2; di <= 2; di++) {
      const a = Math.min(nx - 1, Math.max(0, i + di)),
        b = Math.min(nz - 1, Math.max(0, k + dk));
      if (!land[b * nx + a]) {
        sx += di;
        sz += dk;
      }
    }
  const length = Math.hypot(sx, sz) || 1;
  return [sx / length, sz / length] as const;
}

export function coastMap(plan: WorldPlan, bounds: Bounds): CoastMap {
  const nx = Math.floor((bounds.maxX - bounds.minX) / STEP),
    nz = Math.floor((bounds.maxZ - bounds.minZ) / STEP),
    x = (i: number) => bounds.minX + (i + 0.5) * STEP,
    z = (k: number) => bounds.minZ + (k + 0.5) * STEP,
    heights = new Float32Array(nx * nz),
    ours = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      heights[k * nx + i] = plan.height(x(i), z(k));
      const owner = plan.biome(x(i), z(k)).owner;
      ours[k * nx + i] = owner === 'coast' || owner === 'sea' ? 1 : 0;
    }
  const land = components(nx, nz, heights),
    shores: Shore[] = [];
  for (let k = 1; k < nz - 1; k++)
    for (let i = 1; i < nx - 1; i++) {
      const c = k * nx + i;
      if (!land[c] || !ours[c]) continue;
      if (land[c - 1] && land[c + 1] && land[c - nx] && land[c + nx]) continue;
      shores.push({
        cell: c,
        x: x(i),
        z: z(k),
        normal: seaward(nx, nz, land, i, k),
        height: heights[c],
        island: land[c] !== 1,
      });
    }
  return { plan, bounds, nx, nz, heights, land, ours, shores, x, z, height: plan.height };
}

/** Walks from (x, z) along `dir` until the ground crosses sea level; the waterline point. */
export function waterline(
  map: CoastMap,
  x: number,
  z: number,
  dir: readonly [number, number],
): Vec3 {
  let previous = map.height(x, z);
  for (let d = 1; d <= STEP * 4; d += 1) {
    const h = map.height(x + dir[0] * d, z + dir[1] * d);
    if (previous > 0 !== h > 0) return [x + dir[0] * d, 0, z + dir[1] * d];
    previous = h;
  }
  return [x, 0, z];
}

/** Sea cells within `radius` of (x, z), counted on the grid. */
export function seaAround(map: CoastMap, x: number, z: number, radius: number): number {
  const r = Math.ceil(radius / STEP),
    i0 = Math.floor((x - map.bounds.minX) / STEP),
    k0 = Math.floor((z - map.bounds.minZ) / STEP);
  let count = 0;
  for (let k = k0 - r; k <= k0 + r; k++)
    for (let i = i0 - r; i <= i0 + r; i++)
      if (i >= 0 && k >= 0 && i < map.nx && k < map.nz && (i - i0) ** 2 + (k - k0) ** 2 <= r * r)
        count += map.land[k * map.nx + i] ? 0 : 1;
  return count;
}
