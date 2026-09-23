/**
 * Plane geometry on the ground (x, z) for footprints: separating-axis overlap of two convex
 * quads, and the distance from a convex quad to a segment (0 when they cross).
 */
export type Point = readonly [number, number];

/** Footprints closer than this count as touching, not overlapping (float noise, shared edges). */
const TOUCH = 0.01;

function project(shape: readonly Point[], nx: number, nz: number): [number, number] {
  let min = Infinity,
    max = -Infinity;
  for (const [x, z] of shape) {
    const d = x * nx + z * nz;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return [min, max];
}

/** Whether two convex polygons overlap by more than `TOUCH`. */
export function overlaps(a: readonly Point[], b: readonly Point[]): boolean {
  for (const shape of [a, b])
    for (let i = 0; i < shape.length; i++) {
      const [x0, z0] = shape[i],
        [x1, z1] = shape[(i + 1) % shape.length],
        length = Math.hypot(x1 - x0, z1 - z0) || 1,
        nx = (z0 - z1) / length,
        nz = (x1 - x0) / length,
        [amin, amax] = project(a, nx, nz),
        [bmin, bmax] = project(b, nx, nz);
      if (amax - TOUCH <= bmin || bmax - TOUCH <= amin) return false;
    }
  return true;
}

/** Distance from point p to segment ab. */
function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    l2 = dx * dx + dz * dz,
    t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Whether a point lies inside a convex polygon (either winding). */
function inside(p: Point, shape: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < shape.length; i++) {
    const [x0, z0] = shape[i],
      [x1, z1] = shape[(i + 1) % shape.length],
      cross = (x1 - x0) * (p[1] - z0) - (z1 - z0) * (p[0] - x0);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** Distance between a convex polygon and segment ab; 0 when the segment touches or crosses it. */
export function segmentDistance(shape: readonly Point[], a: Point, b: Point): number {
  if (inside(a, shape) || inside(b, shape)) return 0;
  let best = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const p = shape[i],
      q = shape[(i + 1) % shape.length];
    // A crossing of two segments: both pairs of ends on opposite sides.
    const side = (o: Point, u: Point, v: Point) =>
      Math.sign((u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]));
    if (side(p, q, a) * side(p, q, b) < 0 && side(a, b, p) * side(a, b, q) < 0) return 0;
    best = Math.min(best, pointSegment(p, a, b), pointSegment(a, p, q), pointSegment(b, p, q));
  }
  return best;
}
