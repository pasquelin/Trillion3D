import {
  BODY_INDEX,
  GENERATION_SHIFT,
  GENERATIONS,
  JOINT,
  MISS,
  MOTOR,
  type CommandWriter,
  type Joint,
  type JointMotor,
} from '../../../sdk-core/src/physics/index.ts';
import type { JointHost } from '../../../sdk-core/src/physics/joint.ts';
import { rotateByQuaternion } from '../../../sdk-core/src/math/matrix/quaternion.ts';
import { normalizeVector3 } from '../../../sdk-core/src/math/primitives/vector.ts';
import { readVec3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { hasBody, worldPoseOf, type createPhysicsBodies } from './bodies.ts';

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
/** A unit vector square to `axis`: the direction a joint's angle 0 is read from. */
const normalTo = ([x, y, z]: Vec): Vec => unit(Math.abs(x) < 0.9 ? [0, z, -y] : [-z, 0, x]);

/** A world frame (`point, axis, normal`) in the frame of `node`'s body; the world's as it is. */
function frameIn(node: Object3D | null, point: Vec, axis: Vec, normal: Vec) {
  if (!node) return [...point, ...axis, ...normal];
  const { position: p, quaternion: q } = worldPoseOf(node);
  const back = [-q[0], -q[1], -q[2], q[3]];
  const local = turn(back, [point[0] - p[0], point[1] - p[1], point[2] - p[2]]);
  return [...local, ...turn(back, axis), ...turn(back, normal)];
}

/** Each end's frame, from the options, read in the world as the bodies stand now. */
function framesOf(joint: Joint) {
  const { a, b, options: o } = joint;
  const origin = (node: Object3D) => Array.from(worldPoseOf(node).position) as Vec;
  const anchor = o.anchor ? readVec3(o.anchor) : origin(a);
  const other =
    joint.kind !== 'distance' ? anchor : o.anchorB ? readVec3(o.anchorB) : b ? origin(b) : anchor;
  const axis = unit(o.axis ? readVec3(o.axis) : [0, 1, 0]);
  const normal = normalTo(axis);
  const length = Math.hypot(other[0] - anchor[0], other[1] - anchor[1], other[2] - anchor[2]);
  return { a: frameIn(a, anchor, axis, normal), b: frameIn(b, other, axis, normal), length };
}

const motorOf = (motor: JointMotor | null) => ({
  mode: motor ? MOTOR[motor.mode] : MOTOR.off,
  target: motor?.target ?? 0,
  maxForce: motor?.maxForce ?? 0,
});

/**
 * The joints of a session: which are made in the simulation, under which id (a slot and its
 * generation, as a body's engine id). A joint is made once both its bodies are simulated, and
 * taken out when one leaves, is rebuilt, or the joint is removed or breaks.
 */
export function createPhysicsJoints(
  writer: CommandWriter,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
) {
  /** The engine ids each made joint connects. */
  const made = new Map<Joint, { a: number; b: number }>();
  const slots: (Joint | null)[] = [];
  const generation: number[] = [];
  const free: number[] = [];
  const host: JointHost = {
    motor(joint) {
      const { mode, target, maxForce } = motorOf(joint.motor);
      writer.motor(joint._id, mode, target, maxForce);
      invalidate();
    },
  };
  /** The engine id of a joint end: `MISS` for the world, -1 while its body is not simulated. */
  const idOf = (node: Object3D | null) => {
    if (!node) return MISS;
    const index = hasBody(node) ? node.physics._index : -1;
    if (index < 0) return -1;
    const id = index | (bodies.generation[index] << GENERATION_SHIFT);
    return bodies.meshOf(id) === node ? id : -1;
  };
  const drop = (joint: Joint) => {
    writer.unjoint(joint._id);
    const index = joint._id & BODY_INDEX;
    slots[index] = null;
    free.push(index);
    made.delete(joint);
    joint._host = null;
    joint._id = -1;
  };
  const connect = (joint: Joint) => {
    const a = idOf(joint.a),
      b = idOf(joint.b);
    if (a < 0 || b < 0 || joint._host) return;
    const frames = (joint._frames ??= framesOf(joint));
    const index = free.pop() ?? slots.push(null) - 1;
    generation[index] = ((generation[index] ?? 0) + 1) % GENERATIONS;
    const id = index | (generation[index] << GENERATION_SHIFT);
    const { limits, spring } = joint.options;
    // A distance keeps its length, or stays within the limits from 0 up to its length, or up to
    // the minimum when that is further; the others have none.
    const distance = joint.kind === 'distance';
    const min = limits?.min ?? (!distance ? -Infinity : limits ? 0 : frames.length);
    const max = limits?.max ?? (distance ? Math.max(min, frames.length) : Infinity);
    writer.joint({
      id,
      kind: JOINT[joint.kind],
      a,
      b,
      frameA: frames.a,
      frameB: frames.b,
      limits: [min, max, spring?.frequency ?? 0, spring?.damping ?? 0],
      motor: motorOf(joint.motor),
      breakForce: joint.options.breakForce ?? 0,
    });
    slots[index] = joint;
    made.set(joint, { a, b });
    joint._host = host;
    joint._id = id;
  };
  return {
    /** Brings the made joints in line with `joints` and with the bodies, after the bodies are. */
    reconcile(joints: ReadonlySet<Joint>) {
      for (const [joint, ends] of made)
        if (!joints.has(joint) || idOf(joint.a) !== ends.a || idOf(joint.b) !== ends.b) drop(joint);
      for (const joint of joints) if (!joint.broken && !made.has(joint)) connect(joint);
    },
    /** The joints the simulation broke, by id: out, and told. */
    broke(ids: readonly number[]) {
      for (const id of ids) {
        const joint = slots[id & BODY_INDEX];
        if (!joint || joint._id !== id) continue;
        drop(joint);
        joint._break();
      }
      invalidate();
    },
    clear() {
      for (const joint of [...made.keys()]) drop(joint);
    },
  };
}
