import {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
} from '../../math/matrix/quaternion.ts';
import { hypot3 } from '../../math/primitives/hypot.ts';
import { crossVector3, dotVector3, subVector3 } from '../../math/primitives/vector.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Vector3 } from '../math/vector3.ts';
import type { Object3D } from '../object/object3d.ts';

import type { XYZLike } from '../math/likes.ts';

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
  toPole: new Float64Array(3),
  plane: new Float64Array(3),
  axis: new Float64Array(3),
  q: new Float64Array(4),
  turn: new Float64Array(4),
  global: new Float64Array(4),
  inverse: new Float64Array(4),
  local: new Float64Array(4),
  point: new Vector3(),
  world: new Quaternion(),
  keptRoot: new Quaternion(),
  keptMid: new Quaternion(),
};
const X = [1, 0, 0],
  Y = [0, 1, 0];
const length = (v: ArrayLike<number>) => hypot3(v[0], v[1], v[2]);
const clampedAcos = (x: number) => Math.acos(Math.min(1, Math.max(-1, x)));
const angle = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  clampedAcos(dotVector3(a, b) / (length(a) * length(b) || 1));

/** Writes a node's world position into `out`. */
function worldPoint(node: Object3D, out: Float64Array) {
  const p = node.getWorldPosition(scratch.point);
  out[0] = p.x;
  out[1] = p.y;
  out[2] = p.z;
  return out;
}

/** Turns `node` by the world rotation `turn` (axis, angle), its local pose rewritten: the turn is
 *  brought into its frame, `local · global⁻¹ · turn · global`. `settle`, its subtree's world
 *  matrices brought up to date after. */
function turnInWorld(node: Object3D, axis: ArrayLike<number>, radians: number, settle = true) {
  const { q, turn, global, inverse, local } = scratch,
    n = length(axis);
  if (!(n > 0) || !radians) return;
  const unit = scratch.axis;
  unit[0] = axis[0] / n;
  unit[1] = axis[1] / n;
  unit[2] = axis[2] / n;
  axisAngleQuaternion(turn, unit, radians);
  const g = node.getWorldQuaternion(scratch.world);
  global[0] = g.x;
  global[1] = g.y;
  global[2] = g.z;
  global[3] = g.w;
  inverse[0] = -g.x;
  inverse[1] = -g.y;
  inverse[2] = -g.z;
  inverse[3] = g.w;
  multiplyQuaternion(q, inverse, turn);
  multiplyQuaternion(q, q, global);
  const l = node.quaternion;
  local[0] = l.x;
  local[1] = l.y;
  local[2] = l.z;
  local[3] = l.w;
  multiplyQuaternion(q, local, q);
  normalizeQuaternion(q);
  node.quaternion.set(q[0], q[1], q[2], q[3]);
  if (settle) node.updateMatrixWorld(true);
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
  target: XYZLike,
  pole?: XYZLike,
  weight = 1,
) {
  const { a, b, c, t, ab, cb, ac, at, ba, toPole, plane } = scratch;
  root.updateMatrixWorld(true);
  // Only a partial solve blends back to the pose it had.
  const partial = !(weight >= 1);
  if (partial) {
    scratch.keptRoot.copy(root.quaternion);
    scratch.keptMid.copy(mid.quaternion);
  }
  worldPoint(root, a);
  worldPoint(mid, b);
  worldPoint(end, c);
  t[0] = target.x;
  t[1] = target.y;
  t[2] = target.z;
  subVector3(ab, b, a);
  subVector3(cb, c, b);
  subVector3(ac, c, a);
  subVector3(at, t, a);
  const lab = length(ab),
    lcb = length(cb),
    lat = Math.min(Math.max(length(at), 1e-6), (lab + lcb) * (1 - 1e-6));
  const bend0 = angle(ac, ab),
    knee0 = angle(subVector3(ba, a, b), cb),
    bend1 = clampedAcos((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)),
    knee1 = clampedAcos((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));
  // A fully folded chain has no root-to-end direction; its first bone still defines one.
  const direction = length(ac) ? ac : ab;
  // A straight chain has no bend of its own: it bends toward the target, or across it.
  if (pole) {
    toPole[0] = pole.x - a[0];
    toPole[1] = pole.y - a[1];
    toPole[2] = pole.z - a[2];
    crossVector3(plane, direction, toPole);
  } else crossVector3(plane, direction, ab);
  if (!(length(plane) > 1e-9 * lab * lcb)) crossVector3(plane, direction, at);
  if (!(length(plane) > 1e-9 * lab * lcb))
    crossVector3(plane, direction, Math.abs(direction[0]) < 0.9 * length(direction) ? X : Y);
  // Bring an existing bend into the pole's plane before changing its angle.
  if (pole && length(ac) && length(crossVector3(ba, ac, ab)) > 1e-9 * lab * lcb) {
    const roll = Math.atan2(
      dotVector3(ac, crossVector3(toPole, ba, plane)) / length(ac),
      dotVector3(ba, plane),
    );
    turnInWorld(root, ac, roll);
  }
  turnInWorld(root, plane, bend1 - bend0);
  turnInWorld(mid, plane, knee1 - knee0);
  worldPoint(end, c);
  subVector3(ac, c, a);
  // A partial solve settles the subtree once, after the blend back.
  crossVector3(plane, ac, at);
  // Opposite collinear directions need a half-turn around any perpendicular axis.
  if (!length(plane) && dotVector3(ac, at) < 0)
    crossVector3(plane, ac, Math.abs(ac[0]) < 0.9 * length(ac) ? X : Y);
  turnInWorld(root, plane, angle(ac, at), !partial);
  // Align the solved elbow with the pole around the target axis, preserving the endpoint.
  if (pole && length(at)) {
    worldPoint(mid, b);
    subVector3(ab, b, a);
    toPole[0] = pole.x - a[0];
    toPole[1] = pole.y - a[1];
    toPole[2] = pole.z - a[2];
    crossVector3(ba, at, ab);
    crossVector3(plane, at, toPole);
    if (length(ba) && length(plane)) {
      const roll = Math.atan2(
        dotVector3(at, crossVector3(toPole, ba, plane)) / length(at),
        dotVector3(ba, plane),
      );
      turnInWorld(root, at, roll, !partial);
    }
  }
  if (!partial) return;
  root.quaternion.slerp(scratch.keptRoot, 1 - Math.max(0, weight));
  mid.quaternion.slerp(scratch.keptMid, 1 - Math.max(0, weight));
  root.updateMatrixWorld(true);
}
