/**
 * Footprints: the ground rectangle a placed prop covers, taken from its mesh bounds, its yaw
 * and its scale. Two props overlap when their rectangles intersect by more than `TOUCH` (bays
 * of a pier or a quay share their edges); a prop sits on a road when its rectangle comes within
 * half the road's width of the road's centreline. The region's placement and its test both
 * read these rules.
 */
import type { Instance, PropMesh, Road, Vec3 } from '../../../plan/contract.ts';
import { partBounds, standExtent } from '../../../props/index.ts';

/** How far two footprints may interpenetrate and still count as touching, metres. */
const TOUCH = 0.2;

export type Rect = { x: number; z: number; hx: number; hz: number; cos: number; sin: number };

/** Local ground extents of a prop: [minX, minZ, maxX, maxZ]. */
export type Extent = readonly [number, number, number, number];

export function extentOf(prop: PropMesh): Extent {
  const stand = standExtent(prop.id);
  if (stand) return stand;
  const [min, max] = partBounds(prop.parts);
  return [min[0], min[2], max[0], max[2]];
}

/** The world rectangle of `extent` placed at (x, z), turned by `yaw`, scaled. */
export function rectOf(
  extent: Extent,
  x: number,
  z: number,
  yaw: number,
  scale: Instance['scale'] = 1,
): Rect {
  const [sx, , sz] = typeof scale === 'number' ? [scale, scale, scale] : scale,
    cx = ((extent[0] + extent[2]) / 2) * sx,
    cz = ((extent[1] + extent[3]) / 2) * sz,
    cos = Math.cos(yaw),
    sin = Math.sin(yaw);
  // A yaw turns local +Z toward +X: (x, z) → (x cos + z sin, -x sin + z cos).
  return {
    x: x + cx * cos + cz * sin,
    z: z - cx * sin + cz * cos,
    hx: ((extent[2] - extent[0]) / 2) * sx,
    hz: ((extent[3] - extent[1]) / 2) * sz,
    cos,
    sin,
  };
}

export const rectOfInstance = (extent: Extent, instance: Instance) =>
  rectOf(extent, instance.position[0], instance.position[2], instance.yaw, instance.scale);

/** The rectangle's four corners, in world (x, z). */
export function corners(r: Rect): [number, number][] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [
    r.x + a * r.hx * r.cos + b * r.hz * r.sin,
    r.z - a * r.hx * r.sin + b * r.hz * r.cos,
  ]);
}

/** Axes of a rectangle: its local X and Z in world (x, z). */
const axes = (r: Rect): [number, number][] => [
  [r.cos, -r.sin],
  [r.sin, r.cos],
];

/** Separating-axis test: do the two rectangles overlap by more than `TOUCH`? */
export function overlaps(a: Rect, b: Rect): boolean {
  for (const [ux, uz] of [...axes(a), ...axes(b)]) {
    const project = (r: Rect) => {
      const [[ax, az], [bx, bz]] = axes(r),
        centre = r.x * ux + r.z * uz,
        reach = r.hx * Math.abs(ax * ux + az * uz) + r.hz * Math.abs(bx * ux + bz * uz);
      return [centre - reach, centre + reach];
    };
    const [a0, a1] = project(a),
      [b0, b1] = project(b);
    if (Math.min(a1, b1) - Math.max(a0, b0) <= TOUCH) return false;
  }
  return true;
}

/** Distance from point p to segment ab, in the ground plane. */
function pointSegment(px: number, pz: number, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[2]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - a[0] - t * dx, pz - a[2] - t * dz);
}

/** Distance from a rectangle to the segment ab: zero when they cross. */
function rectSegment(r: Rect, a: Vec3, b: Vec3): number {
  const local = (p: Vec3) => {
    const dx = p[0] - r.x,
      dz = p[2] - r.z;
    return [dx * r.cos - dz * r.sin, dx * r.sin + dz * r.cos] as const;
  };
  const [ax, az] = local(a),
    [bx, bz] = local(b),
    inside = (x: number, z: number) => Math.abs(x) <= r.hx && Math.abs(z) <= r.hz;
  // Clip the segment to the rectangle: if any part lies inside, the distance is zero.
  let t0 = 0,
    t1 = 1;
  const dx = bx - ax,
    dz = bz - az;
  for (const [p, q] of [
    [-dx, ax + r.hx],
    [dx, r.hx - ax],
    [-dz, az + r.hz],
    [dz, r.hz - az],
  ]) {
    if (p === 0) {
      if (q < 0) t1 = -1;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  if (t0 <= t1 || inside(ax, az)) return 0;
  const toRect = (x: number, z: number) =>
    Math.hypot(Math.max(0, Math.abs(x) - r.hx), Math.max(0, Math.abs(z) - r.hz));
  const ends = Math.min(toRect(ax, az), toRect(bx, bz));
  return Math.min(ends, ...corners(r).map(([x, z]) => pointSegment(x, z, a, b)));
}

type Segment = { a: Vec3; b: Vec3; width: number };

/** Road segments bucketed on a coarse grid, to ask "is this rectangle clear of every road?". */
export function roadIndex(roads: readonly Road[], cell = 200) {
  const buckets = new Map<number, Segment[]>(),
    key = (i: number, k: number) => i * 1_000_003 + k;
  for (const road of roads)
    for (let p = 0; p + 1 < road.points.length; p++) {
      const segment = { a: road.points[p], b: road.points[p + 1], width: road.width },
        pad = road.width;
      for (
        let i = Math.floor((Math.min(segment.a[0], segment.b[0]) - pad) / cell);
        i <= Math.floor((Math.max(segment.a[0], segment.b[0]) + pad) / cell);
        i++
      )
        for (
          let k = Math.floor((Math.min(segment.a[2], segment.b[2]) - pad) / cell);
          k <= Math.floor((Math.max(segment.a[2], segment.b[2]) + pad) / cell);
          k++
        ) {
          const list = buckets.get(key(i, k));
          if (list) list.push(segment);
          else buckets.set(key(i, k), [segment]);
        }
    }
  /** Whether the rectangle keeps farther than half a road's width from every road's line. */
  return (r: Rect): boolean => {
    const reach = Math.hypot(r.hx, r.hz),
      seen = new Set<Segment>();
    for (let i = Math.floor((r.x - reach) / cell); i <= Math.floor((r.x + reach) / cell); i++)
      for (let k = Math.floor((r.z - reach) / cell); k <= Math.floor((r.z + reach) / cell); k++)
        for (const segment of buckets.get(key(i, k)) ?? []) {
          if (seen.has(segment)) continue;
          seen.add(segment);
          if (rectSegment(r, segment.a, segment.b) < segment.width / 2) return false;
        }
    return true;
  };
}
