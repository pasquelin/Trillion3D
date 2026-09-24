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
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { hasBody, type createPhysicsBodies } from './bodies.ts';
import { extraOf, framesOf, sixDofAxis } from './jointFrames.ts';

const motorOf = (motor: JointMotor | null) => ({
  mode: motor ? MOTOR[motor.mode] : MOTOR.off,
  target: motor?.target ?? 0,
  maxForce: motor?.maxForce ?? 0,
  axis: sixDofAxis(motor?.axis),
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
  const host: NonNullable<Joint['_host']> = {
    motor(joint) {
      writer.motor(joint._id, motorOf(joint.motor));
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
    // the minimum when that is further; a pulley's rope slackens down to 0; the others have none.
    const distance = joint.kind === 'distance',
      rope = distance || joint.kind === 'pulley';
    const min = limits?.min ?? (!rope ? -Infinity : distance && !limits ? frames.length : 0);
    const max = limits?.max ?? (rope ? Math.max(min, frames.length) : Infinity);
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
      extra: extraOf(joint),
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
