import { closestSegmentTriangle, insideTriangle, touched, triangleNormal } from './closest.ts';
import { SLACK } from './characterSettings.ts';
import { forEachTriangleInBox } from './triangleQuery.ts';
import type { TriangleTree } from './triangleTree.ts';

/**
 * ACTIVE EDGES, the rule of Jolt Physics' mesh shapes (`ActiveEdges::IsEdgeActive`,
 * `MeshShapeSettings::mActiveEdgeCosThresholdAngle`, 5°). A surface made of triangles has edges
 * of two kinds: creases, where the surface turns, and the seams inside a flat surface, where two
 * triangles of one plane meet — the diagonal of a box's face. A body touching a seam touches the
 * plane, not an edge: its way out is the face's normal, never the slant from the seam's line,
 * which would push it sideways along a flat wall. A seam is found when it is asked about,
 * through the tree itself: no table is built or kept.
 *
 * An edge is a crease unless exactly one other triangle shares both its corners and lies within
 * 5° of its plane. A corner is a crease unless both of the triangle's edges through it are seams.
 * How a capsule reads a seam is `capsule.ts`'s: over the face, the face's normal; beside it, the
 * triangle across the seam answers; through the surface, inside a solid, the edge as drawn.
 */

/** Two triangles whose planes are closer than this cosine are one flat surface: 5°. */
const SEAM_COS = Math.cos((5 * Math.PI) / 180);

const low = new Float64Array(3),
  high = new Float64Array(3),
  mine = new Float64Array(3),
  plane = new Float64Array(3),
  over = new Float64Array(3),
  pair = new Float64Array(6),
  theirs = new Float64Array(3);

/** The corner of triangle `at` of `v` at the very point `v[p..p+3]`, or -1. */
function cornerAt(v: Float32Array, at: number, p: number) {
  for (let c = 0; c < 3; c++)
    if (v[at + 3 * c] === v[p] && v[at + 3 * c + 1] === v[p + 1] && v[at + 3 * c + 2] === v[p + 2])
      return c;
  return -1;
}

/** The triangle across edge `e` of triangle `at` — from its corner `e` to corner `e + 1` — when
 *  the edge is a seam, else -1. */
function seam(tree: TriangleTree, at: number, e: number) {
  const v = tree.triangles,
    p = at + 3 * e,
    q = at + 3 * ((e + 1) % 3);
  for (let k = 0; k < 3; k++) {
    low[k] = Math.min(v[p + k], v[q + k]);
    high[k] = Math.max(v[p + k], v[q + k]);
  }
  const own = triangleNormal(mine, v, at);
  let shared = 0,
    flat = -1;
  forEachTriangleInBox(tree, low, high, (other) => {
    const a = other === at ? -1 : cornerAt(v, other, p),
      b = a < 0 ? -1 : cornerAt(v, other, q);
    if (b < 0) return;
    shared++;
    // Wound as this one, the other runs the edge the other way; the same way, it faces back.
    const turn = (a + 1) % 3 === b ? -1 : 1;
    const lengths = Math.sqrt(own * triangleNormal(theirs, v, other));
    const dot = mine[0] * theirs[0] + mine[1] * theirs[1] + mine[2] * theirs[2];
    flat = lengths > 0 && turn * dot >= SEAM_COS * lengths ? other : -1;
  });
  return shared === 1 ? flat : -1;
}

/** The triangles of one flat surface around the point `closestSegmentTriangle` last found on
 *  triangle `at` (`touched`): `at`, then those across the seams the point lies on. */
const around = new Int32Array(3);

/** Whether that point lies on a seam — on an edge inside a flat surface, or on a corner both of
 *  whose edges are — writing the surface's triangles around it to `around`; returns their count,
 *  0 when it does not. */
export function onSeam(tree: TriangleTree, at: number) {
  const { edge, along } = touched;
  if (edge < 0) return 0;
  around[0] = at;
  around[1] = seam(tree, at, edge);
  if (around[1] < 0) return 0;
  if (along !== 0 && along !== 1) return 2;
  around[2] = seam(tree, at, (edge + (along === 0 ? 2 : 1)) % 3);
  return around[2] < 0 ? 0 : 3;
}

/** Whether `point`, on the plane of the surface `around`, lies on one of its `count` triangles. */
export function onSurface(tree: TriangleTree, count: number, point: ArrayLike<number>) {
  const v = tree.triangles;
  for (let i = 0; i < count; i++) {
    triangleNormal(plane, v, around[i]);
    if (insideTriangle(point[0], point[1], point[2], v, around[i], plane)) return true;
  }
  return false;
}

/** Whether a triangle across the seam answers for the one first in `around`: the segment's
 *  closest point `point` is over it, or `segment` comes nearer it than the seam's `squared`
 *  distance, by more than `SLACK`. Neither, as above a ridge folded by less than a seam's angle,
 *  every triangle's pair is the seam itself. */
export function answeredAcross(
  tree: TriangleTree,
  count: number,
  point: ArrayLike<number>,
  segment: ArrayLike<number>,
  squared: number,
) {
  const v = tree.triangles;
  for (let i = 1; i < count; i++) {
    const at = around[i],
      area = triangleNormal(plane, v, at);
    if (area === 0) continue;
    let height = 0;
    for (let k = 0; k < 3; k++) height += (point[k] - v[at + k]) * plane[k];
    for (let k = 0; k < 3; k++) over[k] = point[k] - (height * plane[k]) / area;
    if (insideTriangle(over[0], over[1], over[2], v, at, plane)) return true;
    const nearer = Math.sqrt(closestSegmentTriangle(pair, segment, v, at));
    if (nearer + SLACK < Math.sqrt(squared)) return true;
  }
  return false;
}
