/**
 * What a marker occupies (#332): the walker's capsule, or a vehicle's own measured bounds turned
 * by the marker's yaw, and the solid triangles (`solids.ts`) it would cross or stand on. A
 * triangle is cut to the height span the footprint fills, then compared on the ground plane.
 */
import { FOOT } from '../../../../../site/examples/kit/openworld/play/sim/foot.ts';
import type { Marker, Vec3 } from '../plan/contract.ts';
import { partBounds, VEHICLE_SPECS } from '../props/index.ts';
import { sailboat } from '../props/sailboat.ts';
import type { Solid } from './solids.ts';

/** In the marker's frame: a disc radius or a rectangle, and the height span above the feet. */
export type Footprint = {
  radius: number;
  rect?: readonly [number, number, number, number];
  low: number;
  high: number;
};

const fromBounds = (list: readonly (readonly [Vec3, Vec3])[]): Footprint => {
  const [minX, minY, minZ] = [0, 1, 2].map((a) => Math.min(...list.map(([min]) => min[a])));
  const [maxX, maxY, maxZ] = [0, 1, 2].map((a) => Math.max(...list.map(([, max]) => max[a])));
  return {
    radius: Math.hypot(Math.max(-minX, maxX), Math.max(-minZ, maxZ)),
    rect: [minX, minZ, maxX, maxZ],
    low: minY,
    high: maxY,
  };
};
const specBounds = (kind: string) =>
  VEHICLE_SPECS.filter((spec) => spec.kind === kind).map((spec) => spec.bounds);

const PERSON: Footprint = { radius: FOOT.radius, low: 0, high: FOOT.height };
const VEHICLES = {
  car: fromBounds(specBounds('car')),
  plane: fromBounds(specBounds('plane')),
  boat: fromBounds([partBounds(sailboat().parts)]),
};

export const footprintOf = (marker: Marker): Footprint =>
  marker.kind === 'spawn' ? VEHICLES[marker.vehicle] : PERSON;

type Point = readonly [number, number];

/** The part of a triangle between heights `low` and `high`, as ground points (x, z). */
function slab(corners: readonly number[], low: number, high: number): Point[] {
  let polygon = [0, 1, 2].map((k) => corners.slice(k * 3, k * 3 + 3));
  for (const [limit, below] of [
    [low, false],
    [high, true],
  ] as const) {
    const inside = (p: number[]) => (below ? p[1] <= limit : p[1] >= limit);
    polygon = polygon.flatMap((p, i) => {
      const q = polygon[(i + 1) % polygon.length],
        cut = (p[1] - limit) * (q[1] - limit) < 0,
        t = (limit - p[1]) / (q[1] - p[1]),
        crossing = cut ? [p.map((v, a) => v + (q[a] - v) * t)] : [];
      return inside(p) ? [p, ...crossing] : crossing;
    });
  }
  return polygon.map((p) => [p[0], p[2]] as const);
}

/** Whether the convex ground polygons `a` and `b` overlap by more than a centimetre. */
function overlap(a: readonly Point[], b: readonly Point[]) {
  const edges = (list: readonly Point[]) =>
    list.map((p, i) => {
      const q = list[(i + 1) % list.length];
      return [p[1] - q[1], q[0] - p[0]] as const;
    });
  for (const [ux, uz] of [...edges(a), ...edges(b)]) {
    const length = Math.hypot(ux, uz);
    if (length < 1e-9) continue;
    const span = (list: readonly Point[]) => list.map(([x, z]) => (x * ux + z * uz) / length);
    const [sa, sb] = [span(a), span(b)];
    if (Math.min(...sa) >= Math.max(...sb) - 0.01 || Math.min(...sb) >= Math.max(...sa) - 0.01)
      return false;
  }
  return true;
}

/** Distance from (x, z) to a convex ground polygon, 0 inside. */
function distance(polygon: readonly Point[], x: number, z: number) {
  let nearest = Infinity,
    turns = 0;
  polygon.forEach(([px, pz], i) => {
    const [qx, qz] = polygon[(i + 1) % polygon.length],
      [ex, ez] = [qx - px, qz - pz],
      t = Math.max(0, Math.min(1, ((x - px) * ex + (z - pz) * ez) / (ex * ex + ez * ez || 1)));
    nearest = Math.min(nearest, Math.hypot(px + ex * t - x, pz + ez * t - z));
    turns += Math.sign(ex * (z - pz) - ez * (x - px));
  });
  return polygon.length > 2 && Math.abs(turns) === polygon.length ? 0 : nearest;
}

/** Whether `print`, its feet at (x, feet, z) and turned by `yaw`, crosses `solid` above `clear`. */
export function crosses(
  solid: Solid,
  print: Footprint,
  at: { x: number; feet: number; z: number; yaw: number },
  clear: number,
) {
  const cut = slab(solid.corners, at.feet + clear, at.feet + print.high);
  if (!cut.length) return false;
  if (!print.rect) return distance(cut, at.x, at.z) < print.radius - 0.01;
  const [minX, minZ, maxX, maxZ] = print.rect,
    [cos, sin] = [Math.cos(at.yaw), Math.sin(at.yaw)];
  const corner = ([u, v]: Point): Point => [at.x + u * cos + v * sin, at.z - u * sin + v * cos];
  const rect = (
    [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
    ] as const
  ).map(corner);
  return overlap(cut, rect);
}
