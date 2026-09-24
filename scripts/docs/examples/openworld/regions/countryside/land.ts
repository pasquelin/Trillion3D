/**
 * How the countryside shares its land: a seeded forest mask (woods on the rolling ground, open
 * farmland between, villages kept clear), a local frame for laying out a farm or a village, and a
 * seeded shuffle so a capped fill spreads evenly over the whole region.
 */
import type { Settlement, Vec3, WorldPlan } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { fbm } from './ground.ts';

/** Wavelength of the woods' pattern, metres: a wood every couple of kilometres. */
const WOODS = 1_800;

export type Land = {
  /** Above 0 in woodland, below in farmland; distance from 0 is how deep inside. */
  forest(x: number, z: number): number;
  /** Which tree species a wood holds at (x, z): -1 birch … 1 pine. */
  species(x: number, z: number): number;
  villages: readonly Settlement[];
};

export function land(plan: WorldPlan, seed: number): Land {
  const b = plan.regions.countryside.bounds,
    villages = plan.settlements.filter(
      ({ kind, region, centre: [x, , z] }) =>
        region === 'countryside' &&
        (kind === 'village' || kind === 'town') &&
        x >= b.minX &&
        x <= b.maxX &&
        z >= b.minZ &&
        z <= b.maxZ,
    );
  return {
    villages,
    forest(x, z) {
      const wood = fbm(seed, x / WOODS, z / WOODS, 3) - 0.05;
      // Villages clear the land around them: fields and gardens, not woods.
      const near = villages.reduce(
        (m, v) => Math.min(m, Math.hypot(v.centre[0] - x, v.centre[2] - z) / (v.radius * 1.6)),
        Infinity,
      );
      return near < 1 ? Math.min(wood, near - 1) : wood;
    },
    species: (x, z) => fbm(seed + 17, x / 900, z / 900, 2) * 2,
  };
}

/** A local frame at (x, z) turned by `yaw`: local (a, b) → world, and local yaw → world yaw. */
export function frame(x: number, z: number, yaw: number) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return {
    at: (a: number, b: number): [number, number] => [x + a * c + b * s, z - a * s + b * c],
    yaw: (local: number) => yaw + local,
  };
}

/** The items in a seeded order (Fisher–Yates). */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(hash01(seed, i) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Points on a jittered grid of `spacing` over the region's bounds, jitter up to half a cell. */
export function scatter(plan: WorldPlan, spacing: number, seed: number): [number, number][] {
  const b = plan.regions.countryside.bounds,
    out: [number, number][] = [];
  for (let i = 0; (i + 0.5) * spacing < b.maxX - b.minX; i++)
    for (let j = 0; (j + 0.5) * spacing < b.maxZ - b.minZ; j++)
      out.push([
        b.minX + (i + 0.5 + hash01(seed, i, j) - 0.5) * spacing,
        b.minZ + (j + 0.5 + hash01(seed + 1, i, j) - 0.5) * spacing,
      ]);
  return out;
}

/** The point of the plan's roads nearest (x, z), with the road's direction there. */
export function nearestRoad(plan: WorldPlan, x: number, z: number) {
  let best: { point: Vec3; along: [number, number]; distance: number } | undefined;
  for (const road of plan.roads)
    for (let i = 1; i < road.points.length; i++) {
      const [ax, ay, az] = road.points[i - 1],
        [bx, by, bz] = road.points[i],
        ux = bx - ax,
        uz = bz - az,
        length = Math.hypot(ux, uz) || 1,
        t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / (length * length))),
        px = ax + ux * t,
        pz = az + uz * t,
        distance = Math.hypot(px - x, pz - z);
      if (!best || distance < best.distance)
        best = { point: [px, ay + (by - ay) * t, pz], along: [ux / length, uz / length], distance };
    }
  return best;
}
