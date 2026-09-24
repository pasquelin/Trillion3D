/**
 * Reading the plan's roads: a road resampled every few metres with its heading, the points
 * beside it, and the stretches the plan bored through a ridge (`plan.tunnels`), a portal at
 * each end.
 */
import type { Road, Vec3, WorldPlan } from '../../plan/contract.ts';
import { isTerrainPlan } from '../../plan/plan.ts';
import { FOOTING } from '../../build/markers.ts';

export type Station = { at: Vec3; dir: readonly [number, number]; along: number };

/** The road every `step` metres along its polyline, each point with its unit heading (x, z). */
export function resample(road: Road, step: number): Station[] {
  const out: Station[] = [];
  let along = 0,
    next = 0;
  for (let i = 0; i + 1 < road.points.length; i++) {
    const a = road.points[i],
      b = road.points[i + 1],
      length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (length < 1e-6) continue;
    const dir = [(b[0] - a[0]) / length, (b[2] - a[2]) / length] as const;
    while (next <= along + length) {
      const t = (next - along) / length;
      out.push({
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
        dir,
        along: next,
      });
      next += step;
    }
    along += length;
  }
  return out;
}

/** The point `offset` metres to the right (side 1) or left (side -1) of a station. */
export const beside = (s: Station, offset: number, side: 1 | -1): [number, number] => [
  s.at[0] - s.dir[1] * offset * side,
  s.at[2] + s.dir[0] * offset * side,
];

/** The yaw that turns a prop's +Z along the heading (x, z). */
export const headingYaw = (dx: number, dz: number) => Math.atan2(dx, dz);

/** Whether a road point lies on the ground: not on a bridge deck, not under a tunnel's rock. */
export const onGround = (plan: WorldPlan, at: Vec3) =>
  Math.abs(at[1] - plan.height(at[0], at[2])) <= FOOTING;

export type TunnelRun = { road: Road; stations: Station[] };

/** How far apart a tunnel's stations are, metres. */
const STEP = 10;

/** Distance along `road` to its point nearest `p`. */
function alongTo(road: Road, p: Vec3): number {
  let along = 0,
    best = Infinity,
    at = 0;
  road.points.forEach((q, k) => {
    if (k) along += Math.hypot(q[0] - road.points[k - 1][0], q[2] - road.points[k - 1][2]);
    const d = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (d < best) [best, at] = [d, along];
  });
  return at;
}

/** Every run of `road` the plan bored through a ridge, resampled from portal to portal. */
export function tunnelRuns(plan: WorldPlan, road: Road): TunnelRun[] {
  if (!isTerrainPlan(plan)) return [];
  const stations = resample(road, STEP);
  return plan.tunnels
    .filter((t) => t.road === road.id)
    .map((t) => {
      const [from, to] = [alongTo(road, t.from), alongTo(road, t.to)];
      return { road, stations: stations.filter((s) => s.along >= from && s.along <= to) };
    })
    .filter((run) => run.stations.length > 1);
}
