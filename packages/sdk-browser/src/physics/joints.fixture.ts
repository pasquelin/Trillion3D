import {
  ASLEEP_BIT,
  BODY_INDEX,
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  joint,
  POSE_WORDS,
  type Joint,
  type PhysicsHost,
  type Vehicle,
  type PhysicsType,
} from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies } from './bodies.ts';
import { createPhysicsJoints } from './joints.ts';
import { moduleRaycast, startModule } from './module.fixture.ts';
import { physicsLink } from './physicsLink.ts';
import { createPhysicsPoses } from './poses.ts';
import { createPhysicsVehicles } from './vehicles.ts';

/**
 * A scene, its bodies, joints and vehicles as a session keeps them, stepped on the committed
 * module in place of the worker: the page's commands, the module's poses, broken joints and
 * vehicle states, nothing else.
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
  const vehicles = createPhysicsVehicles(writer, bodies, () => {});
  const jolt = await startModule(budget);
  const wanted = new Set<Joint>();
  const driven = new Set<Vehicle>();
  /** Each body's last pose, by slot: `px, py, pz, qx, qy, qz, qw`. */
  const poses = new Map<number, number[]>();
  writer.gravity(gravity);
  return {
    scene,
    wanted,
    /** The vehicles held, as `world.physics.add` holds them. */
    driven,
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
      vehicles.reconcile(driven);
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
        vehicles.receive(jolt.vehicles().slice());
      }
    },
    /** `world.raycast(ray, options)` against the bodies of the last step. */
    raycast: moduleRaycast(jolt, bodies),
    /** A body's position after the last step. */
    at(mesh: Mesh) {
      const pose = poses.get(mesh.physics!._index);
      return pose ? pose.slice(0, 3) : [mesh.position.x, mesh.position.y, mesh.position.z];
    },
    /** A body's quaternion after the last step. */
    turn: (mesh: Mesh) => poses.get(mesh.physics!._index)!.slice(3, 7),
    /** The joints the module's gear linking has visited so far: its cost, not its time. */
    linkVisits: () => jolt.linkVisits(),
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

/** Twelve points round a 3 m circle about the y axis, at height `y`. */
export const circle = (y = 0) =>
  Array.from({ length: 12 }, (_, i) => {
    const angle = (2 * Math.PI * i) / 12;
    return [3 * Math.cos(angle), y, 3 * Math.sin(angle)] as const;
  });

/** A pull no joint in these tests holds: a 1000 kg cube weighs about 9810 N. */
export const WEAK = 500;

export type Rig = Awaited<ReturnType<typeof jointRig>>;

/**
 * Pushes two cubes hung 2 m below their anchors at x 0 and 4 sideways, and returns the widest
 * swing from the vertical each reached over 40 steps, radians.
 */
export function widestSwings(rig: Rig, coned: Mesh, free: Mesh): [number, number] {
  rig.run(1);
  rig.writer.velocity(coned.physics!._index, [4, 0, 0]);
  rig.writer.velocity(free.physics!._index, [4, 0, 0]);
  let widest = 0,
    freest = 0;
  for (let s = 0; s < 40; s++) {
    rig.run(1);
    const swing = (p: number[], x: number) => Math.atan2(Math.abs(p[0] - x), 2 - p[1]);
    widest = Math.max(widest, swing(rig.at(coned), 0));
    freest = Math.max(freest, swing(rig.at(free), 4));
  }
  return [widest, freest];
}

/**
 * Makes each kind twice on a cube at `x, 1, z` — breaking at `WEAK`, then at 1e6 N — steps 20
 * times and returns which broke, in that order.
 */
export function brokenPastForce<K extends keyof typeof joint>(
  rig: Rig,
  kinds: readonly K[],
  options: (kind: K, x: number, z: number) => object,
) {
  const made = kinds.flatMap((kind, i) =>
    [WEAK, 1e6].map((breakForce, k) => {
      const [x, z] = [i * 3, k * 3];
      const cube = rig.cube(x, 1, z);
      const made = (joint[kind] as (a: Mesh, b: null, o: object) => Joint)(cube, null, {
        ...options(kind, x, z),
        breakForce,
      });
      rig.wanted.add(made);
      return made;
    }),
  );
  rig.run(20);
  return made.map((j) => j.broken);
}

/** Gravity in the rigs, m/s², and their step, s. */
export const G = 9.81;
const DT = 1 / 60;

/**
 * A body with no damping launched at `speed` along a closed path, gravity alone driving it: its
 * energy per kilogram after each step (½v² + g·y, v the chord between two steps' points over the
 * step, y their middle's height) until it is back where it began, or a minute has gone: the
 * most it drifted from the first, J/kg, and its fastest speed.
 */
export async function energiesOverALap(path: [number, number, number][], speed: number) {
  const rig = await jointRig([0, -G, 0]);
  const body = rig.cube(...path[0]);
  body.physics = { type: 'dynamic', damping: { linear: 0, angular: 0 } };
  rig.wanted.add(joint.path(body, null, { path, loop: true, follow: false }));
  rig.run(1);
  const ahead = path[1].map((v, i) => v - path[0][i]);
  const length = Math.hypot(...ahead);
  rig.writer.velocity(
    body.physics!._index,
    ahead.map((v) => (v / length) * speed),
  );
  let before = rig.at(body),
    travelled = 0,
    fastest = 0;
  const energies: number[] = [];
  const perimeter = path.reduce((sum, p, i) => sum + gap(p, path[(i + 1) % path.length]), 0);
  while (travelled < perimeter && energies.length < 60 * 60) {
    rig.run(1);
    const at = rig.at(body),
      step = gap(at, before);
    travelled += step;
    fastest = Math.max(fastest, step / DT);
    energies.push(0.5 * (step / DT) ** 2 + (G * (at[1] + before[1])) / 2);
    before = at;
  }
  const drift = Math.max(...energies.map((e) => Math.abs(e - energies[0])));
  return { drift, fastest, lapped: travelled >= perimeter };
}
