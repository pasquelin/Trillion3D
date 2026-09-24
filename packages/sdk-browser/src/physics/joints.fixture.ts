import {
  ASLEEP_BIT,
  BODY_INDEX,
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  POSE_WORDS,
  type Joint,
  type PhysicsHost,
  type PhysicsType,
} from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies } from './bodies.ts';
import { createPhysicsJoints } from './joints.ts';
import { startModule } from './module.fixture.ts';
import { physicsLink } from './physicsLink.ts';
import { createPhysicsPoses } from './poses.ts';

/**
 * A scene, its bodies and joints as a session keeps them, stepped on the committed module in
 * place of the worker: the page's commands, the module's poses and broken joints, nothing else.
 */
export async function jointRig(gravity: [number, number, number] = [0, -9.81, 0]) {
  const scene = new Group();
  // Linked as a world's scene is, so a body taken out of it leaves the simulation.
  scene._link = physicsLink(null, { pose() {}, structure() {}, content() {} });
  const writer = new CommandWriter();
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 64 };
  const state = createPhysicsPoses(budget.bodies, scene).state;
  const bodies = createPhysicsBodies(writer, budget, {} as PhysicsHost, scene, state);
  const joints = createPhysicsJoints(writer, bodies, () => {});
  const jolt = await startModule(budget);
  const wanted = new Set<Joint>();
  /** Each body's last pose, by slot: `px, py, pz, qx, qy, qz, qw`. */
  const poses = new Map<number, number[]>();
  writer.gravity(gravity);
  return {
    scene,
    wanted,
    writer,
    /** A dynamic unit cube (or of `type`) at `x, y, z`, in the scene. */
    cube(x: number, y: number, z: number, type: PhysicsType = 'dynamic') {
      const mesh = new Mesh(box(1, 1, 1), new Material('meshStandard'));
      mesh.position.set(x, y, z);
      mesh.physics = type;
      scene.add(mesh);
      return mesh;
    },
    /** Reconciles the bodies and joints, then steps `steps` times at 60 Hz. */
    run(steps: number) {
      bodies.reconcile(new Set(), (error) => {
        throw error;
      });
      joints.reconcile(wanted);
      for (let s = 0; s < steps; s++) {
        const count = jolt.step(writer.length ? writer.take() : null, 1 / 60);
        const words = jolt.poses(count);
        const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
        for (let r = 0; r < count; r++) {
          const at = r * POSE_WORDS;
          poses.set(
            words[at] & ~ASLEEP_BIT & BODY_INDEX,
            Array.from(floats.subarray(at + 1, at + 8)),
          );
        }
        const broken = jolt.broken();
        if (broken.length) joints.broke(broken);
      }
    },
    /** A body's position after the last step. */
    at(mesh: Mesh) {
      const pose = poses.get(mesh.physics!._index);
      return pose ? pose.slice(0, 3) : [mesh.position.x, mesh.position.y, mesh.position.z];
    },
    /** A body's turn about y after the last step, radians. */
    yaw(mesh: Mesh) {
      const pose = poses.get(mesh.physics!._index)!;
      return 2 * Math.atan2(pose[4], pose[6]);
    },
  };
}

/** The distance between two points. */
export const gap = (p: ArrayLike<number>, q: ArrayLike<number>) =>
  Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
