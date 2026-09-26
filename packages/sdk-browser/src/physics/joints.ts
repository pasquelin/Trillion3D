import {
  JOINT,
  MOTOR,
  type CommandWriter,
  type Joint,
  type JointMotor,
} from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { hasBody, type Bodied, type createPhysicsBodies } from './bodies.ts';
import { framesOf, sixDofAxis } from './jointFrames.ts';
import { createSimulatedIds, engineIdOf } from './simulatedIds.ts';

const motorOf = (motor: JointMotor | null) => ({
  mode: motor ? MOTOR[motor.mode] : MOTOR.off,
  target: motor?.target ?? 0,
  maxForce: motor?.maxForce ?? 0,
  axis: sixDofAxis(motor?.axis),
});

/**
 * The joints of a session: which are made in the simulation, under which id (a slot and its
 * generation, as a body's engine id). A joint is made once both its bodies are simulated, and
 * taken out when one leaves, is rebuilt, or the joint is removed or breaks — as it does when a
 * body leaves for good.
 */
export function createPhysicsJoints(
  writer: CommandWriter,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
) {
  /** The engine ids each made joint connects. */
  const made = new Map<Joint, { a: number; b: number }>();
  const slots = createSimulatedIds<Joint>();
  const host: NonNullable<Joint['_host']> = {
    motor(joint) {
      writer.motor(joint._id, motorOf(joint.motor));
      invalidate();
    },
  };
  /** The engine id of a joint end: `MISS` for the world, -1 while its body is not simulated. */
  const idOf = (node: Object3D | null) => engineIdOf(bodies, node);
  const drop = (joint: Joint) => {
    writer.unjoint(joint._id);
    slots.release(joint._id);
    made.delete(joint);
    joint._host = null;
    joint._id = -1;
  };
  /** The `physics` of the bodies out for good (asleep decorative), until set anew: a joint on one
   *  breaks. */
  const gone = new WeakSet<object>();
  const out = (node: Object3D | null) => !!node && hasBody(node) && gone.has(node.physics);
  /** Out of the simulation, and told it broke. */
  const snap = (joint: Joint) => {
    drop(joint);
    joint._break();
  };
  const connect = (joint: Joint) => {
    const a = idOf(joint.a),
      b = idOf(joint.b);
    if (a < 0 || b < 0 || joint._host) return;
    const frames = (joint._frames ??= framesOf(joint));
    const id = slots.take(joint);
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
      extra: frames.extra,
    });
    made.set(joint, { a, b });
    joint._host = host;
    joint._id = id;
  };
  return {
    /** Brings the made joints in line with `joints` and with the bodies, after the bodies are;
     *  a joint on a body out for good (`retired`) breaks rather than waits for it. */
    reconcile(joints: ReadonlySet<Joint>) {
      for (const [joint, ends] of made)
        if (!joints.has(joint) || idOf(joint.a) !== ends.a || idOf(joint.b) !== ends.b) drop(joint);
      for (const joint of joints) {
        if (joint.broken || made.has(joint)) continue;
        if (out(joint.a) || out(joint.b)) joint._break();
        else connect(joint);
      }
    },
    /** The body made with `physics` (not one the page set since) leaves the simulation for good,
     *  asleep decorative: each joint of `joints` made on it breaks now, one added later at
     *  `reconcile`; one the page removed since only leaves. */
    retired(physics: Bodied['physics'] | null, joints: ReadonlySet<Joint>) {
      if (!physics) return;
      gone.add(physics);
      for (const joint of made.keys())
        if (out(joint.a) || out(joint.b)) (joints.has(joint) ? snap : drop)(joint);
    },
    /** The joints the simulation broke, by id: out, and told. */
    broke(ids: readonly number[]) {
      for (const id of ids) {
        const joint = slots.of(id);
        if (joint) snap(joint);
      }
      invalidate();
    },
    clear() {
      for (const joint of [...made.keys()]) drop(joint);
    },
  };
}
