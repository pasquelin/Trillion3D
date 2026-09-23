/** Ear clipping of a simple polygon: enough for footprints, signs and slabs of a few dozen points. */

/** A 2D point: (x, z) for an outline on the ground. */
export type Point2 = readonly [number, number];

/** Twice the signed area of an outline: positive when it turns from +first axis to +second. */
export function signedArea(points: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i],
      [bx, by] = points[(i + 1) % points.length];
    sum += ax * by - bx * ay;
  }
  return sum;
}

const cross = (a: Point2, b: Point2, c: Point2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * Triangles (indices into `points`) of a simple polygon, each wound like the polygon itself.
 * A degenerate or self-crossing outline stops clipping early and throws: a shape never ships
 * with a hole in its cap.
 */
export function triangulate(points: readonly Point2[]): number[] {
  const sign = Math.sign(signedArea(points)),
    remaining = points.map((_, i) => i),
    out: number[] = [];
  if (sign === 0) throw new Error('triangulate: the outline has no area');
  while (remaining.length > 3) {
    let clipped = false;
    for (let k = 0; k < remaining.length; k++) {
      const ia = remaining[(k + remaining.length - 1) % remaining.length],
        ib = remaining[k],
        ic = remaining[(k + 1) % remaining.length],
        [a, b, c] = [points[ia], points[ib], points[ic]];
      const turn = cross(a, b, c) * sign;
      if (turn === 0) {
        // A straight-through vertex adds no area: drop it without a triangle.
        remaining.splice(k, 1);
        clipped = true;
        break;
      }
      if (turn < 0) continue;
      const inside = remaining.some(
        (j) =>
          j !== ia &&
          j !== ib &&
          j !== ic &&
          cross(a, b, points[j]) * sign >= 0 &&
          cross(b, c, points[j]) * sign >= 0 &&
          cross(c, a, points[j]) * sign >= 0,
      );
      if (inside) continue;
      out.push(ia, ib, ic);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('triangulate: the outline crosses itself');
  }
  out.push(...remaining);
  return out;
}
