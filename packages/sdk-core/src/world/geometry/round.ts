import { withRecipe } from './geometry.ts';
import { crossVector3 } from '../../math/primitives/vector.ts';
import { GeometryBuilder, normalize, pieces } from './builder.ts';
import type { Curve } from '../math/curves.ts';

type V3 = [number, number, number];
const TAU = Math.PI * 2;

/**
 * A ring of radius `radius` around the `z` axis, its tube `tube` thick, swept over `arc`.
 * @param radius - Distance from the centre to the middle of the tube.
 * @param tube - Radius of the tube.
 * @param radialSegments - Slices around the tube.
 * @param tubularSegments - Slices along the ring.
 * @param arc - How much of a full turn the ring covers, in radians.
 */
export function torus(
  radius = 1,
  tube = 0.4,
  radialSegments = 12,
  tubularSegments = 48,
  arc = TAU,
) {
  [radialSegments, tubularSegments] = [pieces(radialSegments, 2), pieces(tubularSegments, 3)];
  const b = new GeometryBuilder();
  b.grid(tubularSegments, radialSegments, (u, v) => {
    const a = u * arc,
      t = v * TAU;
    const n: V3 = [Math.cos(t) * Math.cos(a), Math.cos(t) * Math.sin(a), Math.sin(t)];
    const c: V3 = [radius * Math.cos(a), radius * Math.sin(a), 0];
    return { p: [c[0] + tube * n[0], c[1] + tube * n[1], c[2] + tube * n[2]], n, uv: [u, v] };
  });
  return withRecipe(b.build(), 'torus', [radius, tube, radialSegments, tubularSegments, arc]);
}

/**
 * The `(p, q)` torus knot: a tube along the curve winding `p` times around the axis, `q` through.
 * @param radius - Size of the knot.
 * @param tube - Radius of the tube.
 * @param tubularSegments - Slices along the knot.
 * @param radialSegments - Slices around the tube.
 * @param p - How many times it winds around its axis.
 * @param q - How many times it winds through the hole.
 */
export function torusKnot(
  radius = 1,
  tube = 0.4,
  tubularSegments = 64,
  radialSegments = 8,
  p = 2,
  q = 3,
) {
  const at = (s: number): V3 => {
    const u = s * p * TAU,
      r = radius * (2 + Math.cos((q / p) * u)) * 0.5;
    return [r * Math.cos(u), r * Math.sin(u), radius * Math.sin((q / p) * u) * 0.5];
  };
  [tubularSegments, radialSegments] = [pieces(tubularSegments, 2), pieces(radialSegments, 3)];
  const built = sweep(at, tubularSegments, radialSegments, () => tube, true);
  return withRecipe(built, 'torusKnot', [radius, tube, tubularSegments, radialSegments, p, q]);
}

/**
 * A tube of `radius` along a curve: rings carried by frames that turn with the curve without
 * twisting about it, closed on request.
 * @param path - The curve the tube follows.
 * @param tubularSegments - Slices along the curve.
 * @param radius - Radius of the tube.
 * @param radialSegments - Slices around the tube.
 * @param closed - Joins the end back to the start when true.
 */
export function tube(
  path: Curve,
  tubularSegments = 64,
  radius = 1,
  radialSegments = 8,
  closed = false,
) {
  return sweep(
    (s) => path.getPoint(s).toArray(),
    tubularSegments,
    radialSegments,
    () => radius,
    closed,
  );
}

/**
 * A profile of `(radius, height)` points turned about the `y` axis. Its normals are the profile's
 * own, turned with it, so the seam and the poles shade as the surface does.
 * @param points - The profile to spin, as 2D points.
 * @param segments - Slices around.
 * @param phiStart - Angle where the spin starts, in radians.
 * @param phiLength - How much of a full turn it spins, in radians.
 */
export function lathe(
  points: ReadonlyArray<readonly [number, number] | { x: number; y: number }>,
  segments = 12,
  phiStart = 0,
  phiLength = TAU,
) {
  const profile = points.map((point) => ('x' in point ? [point.x, point.y] : [point[0], point[1]]));
  const last = profile.length - 1;
  const b = new GeometryBuilder();
  b.grid(pieces(segments, 1), last, (u, v) => {
    const i = Math.round(v * last),
      phi = phiStart + u * phiLength;
    const [x, y] = profile[i],
      before = profile[Math.max(0, i - 1)],
      after = profile[Math.min(last, i + 1)];
    const [nx, ny] = [after[1] - before[1], before[0] - after[0]];
    const n = normalize(nx * Math.sin(phi), ny, nx * Math.cos(phi));
    return { p: [x * Math.sin(phi), y, x * Math.cos(phi)], n, uv: [u, v] };
  });
  return b.build();
}

/**
 * A cylinder of `length` capped by two half spheres of `radius`, the `y` axis through it.
 * @param radius - Radius of the round ends.
 * @param length - Length of the straight middle.
 * @param capSegments - Slices in each round end.
 * @param radialSegments - Straight pieces around.
 */
export function capsule(radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
  const profile: [number, number][] = [];
  const caps = (capSegments = pieces(capSegments, 1));
  radialSegments = pieces(radialSegments, 1);
  for (let i = 0; i <= caps; i++) {
    const a = -Math.PI / 2 + (i / caps) * (Math.PI / 2);
    profile.push([radius * Math.cos(a), -length / 2 + radius * Math.sin(a)]);
  }
  for (let i = 0; i <= caps; i++) {
    const a = (i / caps) * (Math.PI / 2);
    profile.push([radius * Math.cos(a), length / 2 + radius * Math.sin(a)]);
  }
  return withRecipe(lathe(profile, radialSegments), 'capsule', [
    radius,
    length,
    capSegments,
    radialSegments,
  ]);
}

/** Rings of radius `radiusAt(s)` along `centre(s)`, `s ∈ [0, 1]`, framed by parallel transport. */
function sweep(
  centre: (s: number) => V3 | number[],
  tubularSegments: number,
  radialSegments: number,
  radiusAt: (s: number) => number,
  closed: boolean,
) {
  const count = pieces(tubularSegments, 2);
  const points = Array.from({ length: count + 1 }, (_, i) =>
    centre(closed ? (i % count) / count : i / count),
  );
  const tangents = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)],
      c = points[Math.min(count, i + 1)];
    const t = closed && (i === 0 || i === count) ? sub(points[1], points[count - 1]) : sub(c, a);
    return normalize(t[0], t[1], t[2]);
  });
  // The first normal is any direction across the first tangent; each next one is the previous
  // turned by the least rotation that carries one tangent onto the next.
  const t0 = tangents[0];
  const seed: V3 = Math.abs(t0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const normals: V3[] = [normalize(...cross(cross(t0, seed), t0))];
  for (let i = 1; i <= count; i++) {
    const n = normals[i - 1],
      t = tangents[i];
    const along = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
    normals.push(normalize(n[0] - along * t[0], n[1] - along * t[1], n[2] - along * t[2]));
  }
  const b = new GeometryBuilder();
  b.grid(count, pieces(radialSegments, 3), (u, v) => {
    const i = Math.round(u * count),
      angle = v * TAU,
      r = radiusAt(u);
    const n0 = normals[i],
      n1 = cross(tangents[i], n0);
    const n = normalize(
      ...([0, 1, 2].map((k) => Math.cos(angle) * n0[k] + Math.sin(angle) * n1[k]) as V3),
    );
    const c = points[i];
    return { p: [c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2]], n, uv: [u, v] };
  });
  return b.build();
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const cross = (a: V3, b: V3): V3 => crossVector3([0, 0, 0] as V3, a, b);
