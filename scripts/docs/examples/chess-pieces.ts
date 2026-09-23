import { facing, lathe, merge, moved, pairs, solid, type Mesh } from './mesh.ts';
import { box, spline } from './solids.ts';

/**
 * The six chess pieces of the USDZ example, in centimetres, Y up: turned from a few
 * `(radius, height)` control points, with a rook's merlons, a king's cross and a knight's head
 * drawn in profile and given a bevelled thickness.
 */
type Profile = readonly (readonly [number, number])[];

/** How finely a piece is turned: sides round the axis, profile samples per control point. */
type Turning = { segments: number; density: number };

/** A smooth turned piece: the profile densified along a spline, then revolved. */
function turned(points: Profile, { segments, density }: Turning) {
  const profile = spline(points, (points.length - 1) * density).map(([r, y]): [number, number] => [
    Math.max(r, 0),
    y,
  ]);
  return lathe(profile, segments, { caps: false });
}

const BASE = [0, 0, 1.75, 0, 1.8, 0.25, 1.7, 0.5, 1.45, 0.65, 1.3, 0.8];
const PAWN = pairs(
  BASE,
  [
    0.8, 1.3, 0.62, 2.3, 0.95, 2.5, 0.9, 2.65, 0.55, 2.8, 0.8, 3.2, 0.88, 3.7, 0.7, 4.2, 0.35, 4.45,
    0, 4.5,
  ],
);
const ROOK = pairs(
  BASE,
  [1.1, 1.3, 0.95, 3.4, 1.25, 3.7, 1.3, 4.6, 1.3, 5.3, 1.05, 5.3, 1, 4.9, 0, 4.9],
);
const BISHOP = pairs(
  BASE,
  [
    0.85, 1.4, 0.6, 3.4, 1, 3.6, 0.95, 3.8, 0.6, 3.95, 0.85, 4.6, 0.85, 5.2, 0.55, 5.8, 0.2, 6.1,
    0.28, 6.3, 0.2, 6.5, 0, 6.55,
  ],
);
const QUEEN = pairs(
  BASE,
  [
    1, 1.4, 0.7, 4.2, 1.15, 4.45, 1.1, 4.65, 0.75, 4.8, 0.85, 5.8, 1.15, 6.6, 1, 6.9, 0.5, 7.1, 0.3,
    7.4, 0.38, 7.65, 0, 7.8,
  ],
);
const KING = pairs(
  BASE,
  [
    1, 1.4, 0.72, 4.5, 1.15, 4.75, 1.1, 4.95, 0.78, 5.1, 0.9, 6.2, 1.08, 6.9, 0.95, 7.2, 0.3, 7.4,
    0.3, 7.5, 0, 7.5,
  ],
);
/** The horse's head in profile, counter-clockwise. */
const HEAD = pairs([
  -0.9, 0, 0.9, 0, 1.1, 1.2, 0.8, 2.2, 1, 2.9, 0.6, 3.4, -0.2, 3.9, -0.35, 4.3, -0.55, 3.95, -0.9,
  3.7, -1.6, 2.7, -2, 2.2, -2, 1.85, -1.7, 1.7, -1, 2, -0.8, 1.6, -1.15, 0.8,
]);

/** The turned rook, four merlons on its rim, each turned to face out along its radius. */
function rook(turning: Turning) {
  const merlons = [0, 1, 2, 3].map((k) => {
    const angle = (k * Math.PI) / 2 + Math.PI / 4,
      [cx, cz] = [1.13 * Math.cos(angle), 1.13 * Math.sin(angle)],
      merlon = moved(box(0.8, 0.6, 0.5), [cx, 5.55, cz]),
      [c, s] = [Math.cos(-angle), Math.sin(-angle)],
      positions = [...merlon.positions];
    for (let v = 0; v < positions.length; v += 3) {
      const [x, z] = [positions[v] - cx, positions[v + 2] - cz];
      positions[v] = x * s + z * c + cx;
      positions[v + 2] = -x * c + z * s + cz;
    }
    return solid(positions, merlon.indices);
  });
  return merge([turned(ROOK, turning), ...merlons]);
}

function king(turning: Turning) {
  return merge([
    turned(KING, turning),
    moved(box(0.36, 1.3, 0.36), [0, 8.1, 0]),
    moved(box(1, 0.36, 0.36), [0, 8.25, 0]),
  ]);
}

/** The triangles of a simple counter-clockwise polygon, one ear clipped at a time. */
function earClip(polygon: Profile) {
  const left = polygon.map((_, i) => i),
    triangles: number[] = [],
    cross = (o: readonly number[], a: readonly number[], b: readonly number[]) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  while (left.length > 3) {
    const ear = left.findIndex((i1, k) => {
      const [i0, i2] = [left.at(k - 1)!, left[(k + 1) % left.length]],
        [a, b, d] = [polygon[i0], polygon[i1], polygon[i2]];
      if (cross(a, b, d) <= 0) return false;
      return !left.some(
        (j) =>
          ![i0, i1, i2].includes(j) &&
          cross(a, b, polygon[j]) >= 0 &&
          cross(b, d, polygon[j]) >= 0 &&
          cross(d, a, polygon[j]) >= 0,
      );
    });
    if (ear < 0) throw new Error('The polygon is not simple');
    triangles.push(left.at(ear - 1)!, left[ear], left[(ear + 1) % left.length]);
    left.splice(ear, 1);
  }
  return [...triangles, ...left];
}

/** The turned foot, and the horse's head in profile, 1.5 cm thick, its rim bevelled. */
function knight(turning: Turning) {
  const foot = turned(pairs(BASE, [1.1, 1.1, 0.9, 1.3, 0, 1.3]), turning),
    n = HEAD.length,
    [half, bevel] = [0.75, 0.22];
  // The outline inset along each corner's bisector, for the bevelled faces.
  const inset = HEAD.map((b, i) => {
    const [a, d] = [HEAD.at(i - 1)!, HEAD[(i + 1) % n]],
      unit = (p: readonly number[], q: readonly number[]) => {
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        return [(q[1] - p[1]) / length, -(q[0] - p[0]) / length];
      },
      [n1, n2] = [unit(a, b), unit(b, d)],
      mitre = [n1[0] + n2[0], n1[1] + n2[1]],
      length = Math.hypot(...mitre),
      [mx, my] = [mitre[0] / length, mitre[1] / length],
      reach = bevel / Math.max(0.4, mx * n1[0] + my * n1[1]);
    return [b[0] - mx * reach, b[1] - my * reach] as const;
  });
  const rings = [
      [HEAD, -half + bevel],
      [HEAD, half - bevel],
      [inset, half],
      [inset, -half],
    ] as const,
    positions = rings.flatMap(([ring, z]) => ring.flatMap(([x, y]) => [x, y + 1.25, z])),
    indices: number[] = [];
  const band = (ra: number, rb: number, i: number) => {
    const j = (i + 1) % n,
      [a, b, c, d] = [ra * n + i, ra * n + j, rb * n + j, rb * n + i];
    indices.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < n; i++) {
    band(0, 1, i); // the rim
    band(1, 2, i); // the front bevel
    band(3, 0, i); // the back bevel
  }
  const caps = earClip(HEAD);
  for (let t = 0; t < caps.length; t += 3) {
    indices.push(2 * n + caps[t], 2 * n + caps[t + 1], 2 * n + caps[t + 2]);
    indices.push(3 * n + caps[t], 3 * n + caps[t + 2], 3 * n + caps[t + 1]);
  }
  const centre = [
      HEAD.reduce((sum, [x]) => sum + x, 0) / n,
      HEAD.reduce((sum, [, y]) => sum + y, 0) / n + 1.25,
      0,
    ],
    head = facing(solid(positions, indices), (v) => [
      positions[v * 3] - centre[0],
      positions[v * 3 + 1] - centre[1],
      positions[v * 3 + 2] - centre[2],
    ]);
  // Flat faces read as carved: every triangle gets its own three vertices.
  const flat = head.indices.flatMap((index) => head.positions.slice(index * 3, index * 3 + 3));
  return merge([
    foot,
    solid(
      flat,
      Array.from({ length: flat.length / 3 }, (_, i) => i),
    ),
  ]);
}

/** The six shapes, by the name the USD layer gives them, turned as finely as `turning` says. */
export function chessPieces(turning: Turning = { segments: 48, density: 4 }): Record<string, Mesh> {
  return {
    Pawn: turned(PAWN, turning),
    Rook: rook(turning),
    Knight: knight(turning),
    Bishop: turned(BISHOP, turning),
    Queen: turned(QUEEN, turning),
    King: king(turning),
  };
}
