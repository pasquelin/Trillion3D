import {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
} from '../../math/matrix/quaternion.ts';
import type { Object3D } from '../object/object3d.ts';

type Point = { x: number; y: number; z: number };

const scratch = {
  a: new Float64Array(3),
  b: new Float64Array(3),
  c: new Float64Array(3),
  t: new Float64Array(3),
  ab: new Float64Array(3),
  cb: new Float64Array(3),
  ac: new Float64Array(3),
  at: new Float64Array(3),
  ba: new Float64Array(3),
  q: new Float64Array(4),
  turn: new Float64Array(4),
  global: new Float64Array(4),
  inverse: new Float64Array(4),
};
const sub = (out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let c = 0; c < 3; c++) out[c] = a[c] - b[c];
  return out;
};
const length = (v: ArrayLike<number>) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const angle = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (length(a) * length(b) || 1))));
const clampedAcos = (x: number) => Math.acos(Math.min(1, Math.max(-1, x)));

/** Writes a node's world position into `out`. */
function worldPoint(node: Object3D, out: Float64Array) {
  const p = node.getWorldPosition();
  out[0] = p.x;
  out[1] = p.y;
  out[2] = p.z;
  return out;
}

/** Turns `node` by the world rotation `turn` (axis, angle), its local pose rewritten: the turn is
 *  brought into its frame, `local · global⁻¹ · turn · global`. */
function turnInWorld(node: Object3D, axis: ArrayLike<number>, radians: number) {
  const { q, turn, global, inverse } = scratch,
    n = length(axis);
  if (!(n > 0) || !radians) return;
  axisAngleQuaternion(turn, [axis[0] / n, axis[1] / n, axis[2] / n], radians);
  const g = node.getWorldQuaternion();
  global.set([g.x, g.y, g.z, g.w]);
  inverse.set([-g.x, -g.y, -g.z, g.w]);
  multiplyQuaternion(q, inverse, turn);
  multiplyQuaternion(q, q, global);
  const l = node.quaternion;
  multiplyQuaternion(q, [l.x, l.y, l.z, l.w], q);
  normalizeQuaternion(q);
  node.quaternion.set(q[0], q[1], q[2], q[3]);
  node.updateMatrixWorld(true);
}

/**
 * A two-bone chain — `root`, `mid`, and `end` hanging from `mid` — bent so that `end` reaches
 * `target`, or as near as the two bones reach, by the law of cosines: `root` and `mid` turn in the
 * plane the chain makes with `pole` (its current bend when none is given), then the whole chain
 * swings onto the target. `weight` blends from the pose it had to the solved one. Only the two
 * rotations are written; a mixer that plays after it writes over them, so it runs after the clips.
 */
export function solveTwoBoneIK(
  root: Object3D,
  mid: Object3D,
  end: Object3D,
  target: Point,
  pole?: Point,
  weight = 1,
) {
  const { a, b, c, t, ab: toMid, cb: toEnd, ac: reach, at: aim, ba: back } = scratch;
  root.updateMatrixWorld(true);
  const kept = [root.quaternion.clone(), mid.quaternion.clone()];
  worldPoint(root, a);
  worldPoint(mid, b);
  worldPoint(end, c);
  t.set([target.x, target.y, target.z]);
  const ab = sub(toMid, b, a),
    cb = sub(toEnd, c, b),
    ac = sub(reach, c, a),
    at = sub(aim, t, a);
  const lab = length(ab),
    lcb = length(cb),
    lat = Math.min(Math.max(length(at), 1e-6), (lab + lcb) * (1 - 1e-6));
  const bend0 = angle(ac, ab),
    knee0 = angle(sub(back, a, b), cb),
    bend1 = clampedAcos((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)),
    knee1 = clampedAcos((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));
  // A straight chain has no bend of its own: it bends toward the target, or across it.
  let plane = pole ? cross(ac, [pole.x - a[0], pole.y - a[1], pole.z - a[2]]) : cross(ac, ab);
  if (!(length(plane) > 1e-9 * lab * lcb)) plane = cross(ac, at);
  if (!(length(plane) > 1e-9 * lab * lcb))
    plane = cross(ac, Math.abs(ac[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  turnInWorld(root, plane, bend1 - bend0);
  turnInWorld(mid, plane, knee1 - knee0);
  worldPoint(end, c);
  sub(ac, c, a);
  turnInWorld(root, cross(ac, at), angle(ac, at));
  if (weight >= 1) return;
  root.quaternion.slerp(kept[0], 1 - Math.max(0, weight));
  mid.quaternion.slerp(kept[1], 1 - Math.max(0, weight));
  root.updateMatrixWorld(true);
}
