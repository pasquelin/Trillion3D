/**
 * Ground footprints: what a placed prop covers on the ground, as an oriented rectangle. A prop's
 * footprint is read from its own geometry — the vertices within `BASE` of its lowest point
 * (trunks, walls, plinths, piers) — except ground cover (a draped field), which covers all it
 * spans, and a forest patch, which claims the square its stems stand in. The generator refuses a placement that overlaps another; the test checks the output.
 */
import type { Instance, PropMesh } from '../../plan/contract.ts';
import { standExtent } from '../../props/index.ts';

/** An oriented rectangle on the ground: centre, half extents along its own axes, yaw. */
export type Rect = { x: number; z: number; hx: number; hz: number; yaw: number };
/** A footprint in its prop's frame: centre offset and half extents. */
export type Local = { cx: number; cz: number; hx: number; hz: number };

/** Height above a prop's lowest vertex that still counts as touching the ground, metres. */
const BASE = 1.5;
/** The id marker of ground cover props, whose footprint is their whole extent. */
export const GROUND_COVER = '/field-';

export function localFootprint(prop: PropMesh): Local {
  const stand = standExtent(prop.id);
  if (stand) return { cx: 0, cz: 0, hx: stand[2], hz: stand[3] };
  let low = Infinity;
  for (const { positions } of prop.parts)
    for (let v = 1; v < positions.length; v += 3) low = Math.min(low, positions[v]);
  const cover = prop.id.includes(GROUND_COVER),
    min = [Infinity, Infinity],
    max = [-Infinity, -Infinity];
  for (const { positions } of prop.parts)
    for (let v = 0; v < positions.length; v += 3) {
      if (!cover && positions[v + 1] > low + BASE) continue;
      min[0] = Math.min(min[0], positions[v]);
      max[0] = Math.max(max[0], positions[v]);
      min[1] = Math.min(min[1], positions[v + 2]);
      max[1] = Math.max(max[1], positions[v + 2]);
    }
  return {
    cx: (min[0] + max[0]) / 2,
    cz: (min[1] + max[1]) / 2,
    hx: (max[0] - min[0]) / 2,
    hz: (max[1] - min[1]) / 2,
  };
}

/** A footprint placed like `instance`: scaled, turned by its yaw, moved to its position. */
export function placedRect(local: Local, instance: Pick<Instance, 'position' | 'yaw' | 'scale'>) {
  const [sx, , sz] =
      typeof instance.scale === 'number'
        ? [instance.scale, 1, instance.scale]
        : (instance.scale ?? [1, 1, 1]),
    c = Math.cos(instance.yaw),
    s = Math.sin(instance.yaw),
    ox = local.cx * sx,
    oz = local.cz * sz;
  // Yaw about +Y maps local (x, z) to (x cos + z sin, -x sin + z cos).
  return {
    x: instance.position[0] + ox * c + oz * s,
    z: instance.position[2] - ox * s + oz * c,
    hx: local.hx * Math.abs(sx),
    hz: local.hz * Math.abs(sz),
    yaw: instance.yaw,
  };
}

/** The rectangle's two unit axes in world (x, z). */
const axes = (r: Rect) => {
  const c = Math.cos(r.yaw),
    s = Math.sin(r.yaw);
  return [
    [c, -s],
    [s, c],
  ] as const;
};

/** The four corners of a rectangle, world (x, z). */
export function corners(r: Rect): [number, number][] {
  const [u, v] = axes(r);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [
    r.x + u[0] * r.hx * a + v[0] * r.hz * b,
    r.z + u[1] * r.hx * a + v[1] * r.hz * b,
  ]);
}

/** Radius of the circle around a rectangle. */
export const reach = (r: Rect) => Math.hypot(r.hx, r.hz);

/** True when two rectangles share more than `slack` metres (separating axis test). */
export function overlaps(a: Rect, b: Rect, slack = 1e-3): boolean {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  if (Math.hypot(dx, dz) > reach(a) + reach(b)) return false;
  const [au, av] = axes(a),
    [bu, bv] = axes(b);
  for (const [x, z] of [au, av, bu, bv]) {
    const project = (r: Rect, u: readonly number[], v: readonly number[]) =>
      r.hx * Math.abs(u[0] * x + u[1] * z) + r.hz * Math.abs(v[0] * x + v[1] * z);
    if (Math.abs(dx * x + dz * z) >= project(a, au, av) + project(b, bu, bv) - slack) return false;
  }
  return true;
}

/** Distance from a point to a segment, (x, z). */
function pointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const ux = bx - ax,
    uz = bz - az,
    t = Math.max(0, Math.min(1, ((px - ax) * ux + (pz - az) * uz) / (ux * ux + uz * uz || 1)));
  return Math.hypot(px - ax - ux * t, pz - az - uz * t);
}

/** Distance from a segment to a rectangle, 0 when they touch. */
export function segmentRect(ax: number, az: number, bx: number, bz: number, r: Rect): number {
  // In the rectangle's frame the rectangle is a box; clip the segment against it.
  const [u, v] = axes(r),
    local = (x: number, z: number) => [
      (x - r.x) * u[0] + (z - r.z) * u[1],
      (x - r.x) * v[0] + (z - r.z) * v[1],
    ],
    [p0, q0] = local(ax, az),
    [p1, q1] = local(bx, bz);
  let t0 = 0,
    t1 = 1;
  for (const [p, d, h] of [
    [p0, p1 - p0, r.hx],
    [q0, q1 - q0, r.hz],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(p) > h) t0 = 2;
      continue;
    }
    const e0 = (-h - p) / d,
      e1 = (h - p) / d;
    t0 = Math.max(t0, Math.min(e0, e1));
    t1 = Math.min(t1, Math.max(e0, e1));
  }
  if (t0 <= t1) return 0;
  const box = (p: number, q: number) =>
    Math.hypot(Math.max(0, Math.abs(p) - r.hx), Math.max(0, Math.abs(q) - r.hz));
  return Math.min(
    box(p0, q0),
    box(p1, q1),
    ...corners(r).map(([x, z]) => pointSegment(x, z, ax, az, bx, bz)),
  );
}
