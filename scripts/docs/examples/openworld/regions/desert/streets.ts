/**
 * The ground a settlement is laid out on: its site (the flattest ground near the plan's centre)
 * and its streets, which join the region's roads and keep every later prop off them.
 */
import { WORLD, type Road, type Settlement, type Vec3 } from '../../plan/contract.ts';
import { along, lengthOf, type Build } from './build.ts';
import type { Point } from './geometry2.ts';

/** Flattest ground within `reach` metres of `hint`, at least `margin` inside the region. */
export function flattest(b: Build, [hx, hz]: Point, reach: number, margin: number): Point {
  const { minX, minZ, maxX, maxZ } = b.site.bounds,
    samples = 120;
  let best: Point = [hx, hz],
    score = Infinity;
  for (let k = 0; k < samples; k++) {
    const r = (reach * k) / samples,
      a = k * 2.39996,
      x = Math.min(maxX - margin, Math.max(minX + margin, hx + r * Math.cos(a))),
      z = Math.min(maxZ - margin, Math.max(minZ + margin, hz + r * Math.sin(a)));
    let lo = Infinity,
      hi = -Infinity;
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++) {
        const h = b.plan.height(x + (i * margin) / 5, z + (j * margin) / 5);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    // Dry land only: a site whose lowest ground is under the sea does not count.
    if (lo > WORLD.seaLevel + 2 && hi - lo < score) [best, score] = [[x, z], hi - lo];
  }
  return best;
}

/** A street on the ground through `points`, added to the region's roads and kept clear. */
export function street(b: Build, id: string, cls: Road['class'], width: number, points: Point[]) {
  const road: Road = {
    id,
    class: cls,
    width,
    points: points.map(([x, z]): Vec3 => [x, b.plan.height(x, z), z]),
  };
  b.roads.push(road);
  b.site.keepClear(road);
  return road;
}

/** The closest point of a polyline to `p`, within `limit` metres, sampled every 50 m. */
export function nearest(line: readonly Vec3[], [px, pz]: Point, limit: number): Point | undefined {
  let best: Point | undefined,
    d = limit;
  for (let t = 0; t <= lengthOf(line); t += 50) {
    const s = along(line, t),
      dist = Math.hypot(s.x - px, s.z - pz);
    if (dist < d) [d, best] = [dist, [s.x, s.z]];
  }
  return best;
}

/** The desert's settlements from the plan, the largest first (the town, then villages). */
export const settlementsOf = (b: Build): Settlement[] =>
  b.plan.settlements
    .filter((s) => s.region === 'desert' && s.kind !== 'airport')
    .sort((p, q) => q.radius - p.radius || (p.id < q.id ? -1 : 1));
