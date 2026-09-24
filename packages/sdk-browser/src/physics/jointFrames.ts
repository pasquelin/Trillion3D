import type { Joint, SixDofAxis } from '../../../sdk-core/src/physics/index.ts';
import { rotateByQuaternion } from '../../../sdk-core/src/math/matrix/quaternion.ts';
import { normalizeVector3 } from '../../../sdk-core/src/math/primitives/vector.ts';
import { readVec3, type Vec3Input } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { worldPoseOf } from './bodies.ts';

type Vec = [number, number, number];
const turned = new Float64Array(3);
/** `v` turned by the quaternion `q`. */
const turn = (q: ArrayLike<number>, v: Vec): Vec => {
  rotateByQuaternion(turned, q, v[0], v[1], v[2]);
  return [turned[0], turned[1], turned[2]];
};
/** `v` made unit length, in place. */
const unit = (v: Vec): Vec => {
  normalizeVector3(v);
  return v;
};
const dot = (u: Vec, v: Vec) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const between = (p: Vec, q: Vec) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
/** A unit vector square to `axis`: the direction a joint's angle 0 is read from. */
const normalTo = ([x, y, z]: Vec): Vec => unit(Math.abs(x) < 0.9 ? [0, z, -y] : [-z, 0, x]);
/** `near` squared to the unit `axis`, or any square to it when the two are nearly one. */
function squared(near: Vec, axis: Vec): Vec {
  const along = dot(near, axis);
  if (Math.abs(along) > 0.99) return normalTo(axis);
  return unit([near[0] - along * axis[0], near[1] - along * axis[1], near[2] - along * axis[2]]);
}

/** A six-DOF's axes in the order of the JOINT command's words. */
const SIX_DOF_AXES: readonly SixDofAxis[] = ['x', 'y', 'z', 'turnX', 'turnY', 'turnZ'];
/** A six-DOF's axis as the MOTOR command names it. */
export const sixDofAxis = (axis: SixDofAxis | undefined) => SIX_DOF_AXES.indexOf(axis ?? 'x');

/** A world frame (`point, axis, normal`) in the frame of `node`'s body; the world's as it is. */
function frameIn(node: Object3D | null, point: Vec, axis: Vec, normal: Vec) {
  if (!node) return [...point, ...axis, ...normal];
  const { position: p, quaternion: q } = worldPoseOf(node);
  const back = [-q[0], -q[1], -q[2], q[3]];
  const local = turn(back, [point[0] - p[0], point[1] - p[1], point[2] - p[2]]);
  return [...local, ...turn(back, axis), ...turn(back, normal)];
}

/** Each end's frame, from the options, read in the world as the bodies stand now; `length`, a
 *  distance's or a pulley's rope. */
export function framesOf(joint: Joint) {
  const { a, b, kind, options: o } = joint;
  const origin = (node: Object3D) => Array.from(worldPoseOf(node).position) as Vec;
  const anchor = o.anchor ? readVec3(o.anchor) : origin(a);
  const ends = kind === 'distance' || kind === 'pulley';
  const other = !ends ? anchor : o.anchorB ? readVec3(o.anchorB) : b ? origin(b) : anchor;
  const axis = unit(o.axis ? readVec3(o.axis) : kind === 'sixDof' ? [1, 0, 0] : [0, 1, 0]);
  const axisB = o.axisB ? unit(readVec3(o.axisB)) : axis;
  // A six-DOF's `y` stays as near the world's up as it can, so its axes read as the world's.
  const normal = kind === 'sixDof' ? squared([0, 1, 0], axis) : normalTo(axis);
  const wheels = o.over?.map(readVec3);
  const length = wheels
    ? between(anchor, wheels[0]) * (o.ratio ?? 1) + between(other, wheels[1])
    : between(anchor, other);
  const normalB = axisB === axis ? normal : normalTo(axisB);
  return { a: frameIn(a, anchor, axis, normal), b: frameIn(b, other, axisB, normalB), length };
}

/** A path's points in `node`'s frame: each `position, tangent, normal`, the tangents those of a
 *  smooth curve through them, the normals carried along from the world's up. */
function trackIn(node: Object3D | null, path: readonly Vec3Input[], loop: boolean) {
  const points = path.map(readVec3);
  const n = points.length;
  let normal: Vec = [0, 1, 0];
  return points.flatMap((point, i) => {
    const [before, after] = loop
      ? [(i + n - 1) % n, (i + 1) % n]
      : [Math.max(i - 1, 0), Math.min(i + 1, n - 1)];
    const span = loop ? 2 : after - before;
    const p = points[before],
      q = points[after];
    const tangent: Vec = [(q[0] - p[0]) / span, (q[1] - p[1]) / span, (q[2] - p[2]) / span];
    normal = squared(normal, unit([...tangent] as Vec));
    return frameIn(node, point, tangent, normal);
  });
}

/** The kind's own words of the JOINT command (`layout.ts` JOINT); none for the core kinds. */
export function extraOf(joint: Joint): number[] {
  const o = joint.options;
  switch (joint.kind) {
    case 'swingTwist':
      return [o.limits?.swing ?? Math.PI];
    case 'sixDof':
      return SIX_DOF_AXES.flatMap((axis) => {
        const limits = o.axes?.[axis];
        if (!limits) return [Infinity, -Infinity];
        return limits === 'free'
          ? [-Infinity, Infinity]
          : [limits.min ?? -Infinity, limits.max ?? Infinity];
      });
    case 'path': {
      const path = o.path ?? [];
      const track = trackIn(joint.b, path, !!o.loop);
      return [o.loop ? 1 : 0, o.follow === false ? 0 : 1, path.length, ...track];
    }
    case 'pulley':
      return [o.ratio ?? 1, ...o.over!.flatMap(readVec3)];
    case 'gear':
    case 'rackAndPinion':
      return [o.ratio ?? 1];
    default:
      return [];
  }
}
