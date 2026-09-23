import type { Road, Vec3 } from './types.ts';

/**
 * Following a polyline by distance, and finding the road nearest a point. Traffic, the aircraft
 * circuit, boats and the car's surface all read the world through these two.
 */
export type Polyline = { points: readonly Vec3[]; along: Float64Array; length: number };

export function polyline(points: readonly Vec3[]): Polyline {
  const along = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    along[i] = along[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return { points, along, length: along[points.length - 1] ?? 0 };
}

export type Sample = { position: [number, number, number]; direction: [number, number, number] };

/** The point `distance` metres along the line (clamped to its ends), and the unit direction there. */
export function sampleAt(line: Polyline, distance: number): Sample {
  const { points, along } = line;
  const d = Math.min(line.length, Math.max(0, distance));
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (along[middle] <= d) low = middle;
    else high = middle;
  }
  const [a, b] = [points[low], points[high] ?? points[low]];
  const span = along[high] - along[low] || 1;
  const t = (d - along[low]) / span;
  const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const size = Math.hypot(delta[0], delta[1], delta[2]) || 1;
  return {
    position: [a[0] + delta[0] * t, a[1] + delta[1] * t, a[2] + delta[2] * t],
    direction: [delta[0] / size, delta[1] / size, delta[2] / size],
  };
}

/** A position along a closed loop or back and forth along an open line, after `travelled` metres. */
export function travel(line: Polyline, travelled: number, loop: boolean): Sample {
  if (line.length === 0) return sampleAt(line, 0);
  if (loop) return sampleAt(line, ((travelled % line.length) + line.length) % line.length);
  const cycle = ((travelled % (2 * line.length)) + 2 * line.length) % (2 * line.length);
  if (cycle <= line.length) return sampleAt(line, cycle);
  const back = sampleAt(line, 2 * line.length - cycle);
  back.direction = [-back.direction[0], -back.direction[1], -back.direction[2]];
  return back;
}

type Segment = { road: Road; index: number };

/** Road segments bucketed on a square grid of `cell` metres, for nearest-road queries. */
export type RoadIndex = { cell: number; buckets: Map<string, Segment[]> };

const bucket = (cell: number, x: number, z: number) =>
  `${Math.floor(x / cell)},${Math.floor(z / cell)}`;

export function roadIndex(roads: readonly Road[], cell = 250): RoadIndex {
  const buckets = new Map<string, Segment[]>();
  for (const road of roads)
    for (let index = 1; index < road.points.length; index++) {
      const [a, b] = [road.points[index - 1], road.points[index]];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / cell));
      const keys = new Set<string>();
      for (let s = 0; s <= steps; s++)
        keys.add(
          bucket(cell, a[0] + ((b[0] - a[0]) * s) / steps, a[2] + ((b[2] - a[2]) * s) / steps),
        );
      for (const key of keys) {
        const list = buckets.get(key) ?? [];
        list.push({ road, index });
        buckets.set(key, list);
      }
    }
  return { cell, buckets };
}

/** The nearest road, the distance to it, the point on it, and that point's segment and share. */
export type Nearest = {
  road: Road;
  distance: number;
  point: [number, number, number];
  segment: number;
  t: number;
};

/** The road whose centre line passes nearest (x, z) on the ground, looked for in the cells around. */
export function nearestRoad(index: RoadIndex, x: number, z: number): Nearest | null {
  let best: Nearest | null = null;
  const cx = Math.floor(x / index.cell);
  const cz = Math.floor(z / index.cell);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++)
      for (const { road, index: i } of index.buckets.get(`${cx + dx},${cz + dz}`) ?? []) {
        const [a, b] = [road.points[i - 1], road.points[i]];
        const ex = b[0] - a[0];
        const ez = b[2] - a[2];
        const t = Math.min(
          1,
          Math.max(0, ((x - a[0]) * ex + (z - a[2]) * ez) / (ex * ex + ez * ez || 1)),
        );
        const point: [number, number, number] = [
          a[0] + ex * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + ez * t,
        ];
        const distance = Math.hypot(x - point[0], z - point[2]);
        if (!best || distance < best.distance) best = { road, distance, point, segment: i, t };
      }
  return best;
}

/** Whether (x, z) is on a paved surface: within half the width of a road that is not a dirt track. */
export function onAsphalt(index: RoadIndex, x: number, z: number): boolean {
  const near = nearestRoad(index, x, z);
  return !!near && near.road.class !== 'dirt' && near.distance <= near.road.width / 2;
}
