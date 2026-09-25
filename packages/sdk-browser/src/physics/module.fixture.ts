import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import {
  CAST,
  CAST_WORDS,
  DEFAULT_PHYSICS_BUDGET,
  MISS,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { Ray } from '../../../sdk-core/src/world/math/volumes.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { createPhysicsBodies } from './bodies.ts';
import { openJolt, startJolt } from './joltModule.ts';
import { physicsRaycast, type PhysicsRaycastOptions } from './raycast.ts';
import type { PhysicsSession } from './session.ts';
import { engineIdOf } from './simulatedIds.ts';
import type { JoltThreadStart, SpawnJoltThread } from './joltThreads.ts';

/** A committed module started for the tests: 64 bodies and 64 MB unless told otherwise. */
export async function startModule(
  budget: Partial<PhysicsBudget> = {},
  pool: { count: number; spawn: SpawnJoltThread } | null = null,
) {
  const file = pool ? './joltPhysicsThreads.wasm' : './joltPhysics.wasm';
  const bytes = await readFile(new URL(file, import.meta.url));
  const full = { ...DEFAULT_PHYSICS_BUDGET, bodies: 64, memoryBytes: 64 << 20, ...budget };
  const opened = await openJolt(bytes, full.memoryBytes, pool);
  const jolt = startJolt(opened, full, pool?.count ?? 1);
  /** The joints the module's gear linking has visited since it started (`jolt_link_visits`). */
  const linkVisits = () => (opened.exports.jolt_link_visits as () => number)();
  return { ...jolt, linkVisits };
}

/** The threaded module stepped by `count` threads (Node workers); `close` stops them. */
export async function startThreaded(count: number, budget: Partial<PhysicsBudget> = {}) {
  const threads: NodeWorker[] = [];
  const loader = new URL('./joltThreads.ts', import.meta.url).href;
  const spawn = (start: JoltThreadStart) =>
    threads.push(
      new NodeWorker(
        `import(${JSON.stringify(loader)}).then((m) => m.runJoltThread(require('node:worker_threads').workerData))`,
        { eval: true, workerData: start },
      ),
    );
  const jolt = await startModule(budget, { count, spawn });
  return { jolt, threads, close: () => Promise.all(threads.map((thread) => thread.terminate())) };
}

/** A started test module. */
export type Module = Awaited<ReturnType<typeof startModule>>;

/** A box body for the ADD command: engine id `id`, a motion, its height and half size. */
export const body = (id: number, motion: number, y: number, half: number, flags = 0) => ({
  id,
  motion,
  layer: motion === 0 ? 0 : 1,
  shape: 0 as const,
  flags,
  position: [0, y, 0],
  quaternion: [0, 0, 0, 1],
  size: [half, half, half] as const,
  mass: 0,
  density: 600,
  friction: 0.5,
  restitution: 0,
  gravityScale: 1,
});

/** A ray down at `x` through the module, straight: its hit words. */
export function castDown(jolt: Module, x: number) {
  const query = new Uint32Array(CAST_WORDS);
  query[0] = CAST.ray;
  query[10] = MISS;
  new Float32Array(query.buffer).set([x, 5, 0, 0, -10, 0], 1);
  return jolt.cast(query);
}

/** `world.raycast(ray, options)` asked of `jolt`, its bodies those of `bodies`: the hit named. */
export function moduleRaycast(jolt: Module, bodies: ReturnType<typeof createPhysicsBodies>) {
  const session = {
    cast: async (queries: Uint32Array) => jolt.cast(queries),
    objectOf: bodies.meshOf,
    engineIdOf: (node: Object3D) => engineIdOf(bodies, node),
    materialOf: () => -1,
  };
  return (ray: Ray, options: PhysicsRaycastOptions) =>
    physicsRaycast(session as unknown as PhysicsSession, ray, options, 1000);
}
