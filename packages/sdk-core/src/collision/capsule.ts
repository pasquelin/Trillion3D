import { closestSegmentTriangle, triangleNormal } from './closest.ts';
import { forEachTriangleInBox } from './triangleQuery.ts';
import type { TriangleTree } from './triangleTree.ts';

/**
 * AN UPRIGHT CAPSULE against a triangle tree: the narrow phase of the character body. The
 * capsule stands on `feet` — the lowest point of its bottom sphere — and is every point within
 * `radius` of the vertical segment from `feet + radius` to `feet + height - radius`.
 *
 * A pass finds every triangle nearer than `radius` to that segment and hands each overlap to
 * `push` at once (`CapsuleContact`). The caller moves `feet`; the next triangle of the pass is
 * measured from the moved capsule, so two walls meeting in a corner are both left in one pass.
 */
export interface Capsule {
  /** The lowest point, world space; `push` moves it. */
  readonly feet: Float64Array;
  /** Radius of the body, metres. */
  radius: number;
  /** Height from the feet to the top of the head, metres; at least two radii. */
  height: number;
}

/**
 * One overlap of a capsule and a surface. The arrays are reused: a push reads them during the
 * call only.
 */
export interface CapsuleContact {
  /** Unit direction out of the surface into the capsule: the way out. */
  readonly normal: Float64Array;
  /**
   * Unit normal of the surface itself, on the capsule's side. It differs from `normal` when
   * the capsule touches an edge or a corner: it says which face that edge belongs to.
   */
  readonly surface: Float64Array;
  /** The touched point of the surface, world space. */
  readonly point: Float64Array;
  /** How far the capsule is inside the surface along `normal`, > 0. */
  depth: number;
}

/** Answers one contact, typically by moving the capsule's `feet` out of it. */
export type CapsulePush = (contact: CapsuleContact) => void;

const segment = new Float64Array(6),
  closest = new Float64Array(6),
  normal = new Float64Array(3),
  contact: CapsuleContact = {
    normal,
    surface: new Float64Array(3),
    point: closest.subarray(3),
    depth: 0,
  },
  min = new Float64Array(3),
  max = new Float64Array(3);

function placeSegment(capsule: Capsule) {
  const { feet, radius } = capsule,
    reach = Math.max(capsule.height - radius, radius);
  segment[0] = segment[3] = feet[0];
  segment[2] = segment[5] = feet[2];
  segment[1] = feet[1] + radius;
  segment[4] = feet[1] + reach;
}

/**
 * One pass of `capsule` against `tree`; returns whether anything overlapped. The query box is
 * the capsule's at the start of the pass grown by one radius, the farthest a push of this pass
 * can carry it.
 */
export function capsulePass(tree: TriangleTree, capsule: Capsule, push: CapsulePush) {
  const { radius } = capsule;
  placeSegment(capsule);
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(segment[k], segment[3 + k]) - 2 * radius;
    max[k] = Math.max(segment[k], segment[3 + k]) + 2 * radius;
  }
  let touched = false;
  forEachTriangleInBox(tree, min, max, (at) => {
    placeSegment(capsule);
    const squared = closestSegmentTriangle(closest, segment, tree.triangles, at);
    if (squared >= radius * radius) return;
    const depth = squared > 0 ? separate(Math.sqrt(squared), radius) : pierced(tree, at, radius);
    if (!(depth > 0)) return;
    faceOf(tree, at);
    touched = true;
    contact.depth = depth;
    push(contact);
  });
  return touched;
}

/** The segment passes near the triangle: it leaves along the line between the two closest
 *  points, by what is missing to the radius. */
function separate(distance: number, radius: number) {
  for (let k = 0; k < 3; k++) normal[k] = (closest[k] - closest[3 + k]) / distance;
  return radius - distance;
}

/** The triangle's unit normal into `contact.surface`, turned to the capsule's side. */
function faceOf(tree: TriangleTree, at: number) {
  const face = contact.surface,
    length = Math.sqrt(triangleNormal(face, tree.triangles, at));
  if (length === 0) face.set(normal);
  else {
    const side = face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2] < 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) face[k] *= side / length;
  }
}

/**
 * The segment passes through the triangle: it leaves along the face normal, towards whichever
 * side needs the shorter push — the side its ends mostly lie on.
 */
function pierced(tree: TriangleTree, at: number, radius: number) {
  const v = tree.triangles;
  const length = Math.sqrt(triangleNormal(normal, v, at));
  if (length === 0) return 0;
  for (let k = 0; k < 3; k++) normal[k] /= length;
  const side = (s: number) =>
    (segment[s] - v[at]) * normal[0] +
    (segment[s + 1] - v[at + 1]) * normal[1] +
    (segment[s + 2] - v[at + 2]) * normal[2];
  const low = Math.min(side(0), side(3)),
    high = Math.max(side(0), side(3));
  if (radius - low <= radius + high) return radius - low;
  for (let k = 0; k < 3; k++) normal[k] = -normal[k];
  return radius + high;
}
