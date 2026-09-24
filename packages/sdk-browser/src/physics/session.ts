import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  CommandWriter,
  POSE_WORDS,
  type PhysicsBudget,
  type PhysicsHost,
  physicsMatterOf,
} from '../../../sdk-core/src/physics/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, flagsOf, hasBody } from './bodies.ts';
import { emitContacts } from './contacts.ts';
import { createPhysicsPoses } from './poses.ts';
import {
  PHYSICS_PROTOCOL,
  resultBytes,
  type FromPhysics,
  type PhysicsResults,
  type PhysicsStats,
} from './protocol.ts';
import { createPhysicsView } from './view.ts';

/** The URL of a resource beside this module: `.ts` in a source tree served as is, `.js` built. */
const beside = (name: string) =>
  new URL(import.meta.url.endsWith('.ts') ? `./${name}.ts` : `./${name}.js`, import.meta.url);

/**
 * Threads the step gets: the budget's, capped by the logical cores minus the page's own, and one
 * where memory cannot be shared (a page that is not cross-origin isolated).
 */
const stepThreads = (wanted: number) =>
  globalThis.crossOriginIsolated
    ? Math.max(1, Math.min(Math.floor(wanted), (navigator.hardwareConcurrency || 2) - 1))
    : 1;

/**
 * One running simulation: the worker, the bodies, the drawn poses. It exists only once physics is
 * enabled — a world without physics creates none, and fetches no byte of Jolt.
 */
export function createPhysicsSession(
  root: Object3D,
  budget: PhysicsBudget,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  const writer = new CommandWriter();
  const stale = new Set<Object3D>();
  let dirty = true,
    ready = false;
  const host: PhysicsHost = {
    rebuild(body) {
      const mesh = bodies.meshes[body._index];
      if (mesh) stale.add(mesh);
      dirty = true;
      invalidate();
    },
    tune(body) {
      const mesh = bodies.meshes[body._index];
      if (!mesh) return;
      const matter = physicsMatterOf(mesh.material);
      writer.gravityScale(body._index, body.gravityScale);
      writer.material(
        body._index,
        body.friction ?? matter.friction,
        body.restitution ?? matter.restitution,
      );
      invalidate();
    },
    velocity(body) {
      writer.velocity(body._index, body.velocity.elements);
      invalidate();
    },
    impulse(body, x, y, z) {
      writer.impulse(body._index, [x, y, z]);
      invalidate();
    },
    wake(body) {
      writer.wake(body._index);
      invalidate();
    },
    listened(body) {
      const mesh = bodies.meshes[body._index];
      if (mesh) writer.flags(body._index, flagsOf(mesh));
      invalidate();
    },
  };
  const bodies = createPhysicsBodies(writer, budget, host, root);
  const poses = createPhysicsPoses(budget.bodies, root);
  const view = createPhysicsView();
  const stats: PhysicsStats = { bodies: 0, active: 0, stepMs: 0, mainMs: 0, poses: 0, events: 0 };
  const worker = new Worker(beside('physicsWorker'), { type: 'module' });
  const threads = stepThreads(budget.threads);
  const buffers = [new ArrayBuffer(resultBytes(budget)), new ArrayBuffer(resultBytes(budget))];
  worker.postMessage(
    {
      type: 'start',
      protocol: PHYSICS_PROTOCOL,
      wasm: new URL(
        threads > 1 ? './joltPhysicsThreads.wasm' : './joltPhysics.wasm',
        import.meta.url,
      ).href,
      budget,
      threads,
      buffers,
    },
    buffers,
  );
  /** Page milliseconds spent on ticks since the last frame: they count in its `physics` stage. */
  let received = 0;
  const results = (m: PhysicsResults) => {
    const began = performance.now();
    const words = new Uint32Array(m.buffer);
    const moved = poses.receive(
      words,
      m.poses,
      bodies.meshes,
      (m.seconds * 1000) / clock.timeScale,
      bodies.retire,
    );
    emitContacts(words, m.poses * POSE_WORDS, m.events, bodies.meshes);
    // The last tick before sleep changes the count even when it moves nothing: a frame shows it.
    const changed = moved > 0 || m.active !== stats.active;
    Object.assign(stats, { active: m.active, poses: m.poses, events: m.events });
    stats.bodies = bodies.count.bodies;
    stats.stepMs = m.steps ? m.stepMs / m.steps : stats.stepMs;
    worker.postMessage({ type: 'buffer', buffer: m.buffer }, [m.buffer]);
    received += performance.now() - began;
    if (changed) invalidate();
  };
  worker.onmessage = ({ data }: MessageEvent<FromPhysics>) => {
    if (data.type === 'ready') {
      ready = true;
      invalidate();
    } else if (data.type === 'results') results(data);
    else failed(new EngineError(data.code, `Physics: ${data.message}`));
  };
  worker.onerror = (event) =>
    failed(new EngineError('PHYSICS_FAILED', `Physics worker: ${event.message}`));
  const clock = { paused: false, timeScale: 1 };
  return {
    stats,
    writer,
    /** Pauses or scales the simulation's time. */
    setClock(paused: boolean, timeScale: number) {
      Object.assign(clock, { paused, timeScale });
      worker.postMessage({ type: 'clock', paused, timeScale });
    },
    /** The scene's tree changed: bodies are reconciled before the next frame. */
    structure() {
      dirty = true;
    },
    /** A mesh's geometry, material or `physics` changed. */
    content(node: Object3D) {
      if (hasBody(node)) stale.add(node);
      dirty = true;
    },
    /** The page moved or hid a node: a body under it is placed where the page put it, and a
     *  hidden one sends no pose. */
    pose(node: Object3D) {
      node.traverse((child) => {
        if (!hasBody(child) || child.physics._host !== host) return;
        child.updateWorldMatrix(true, false);
        const q = child.getWorldQuaternion();
        const p = child.getWorldPosition();
        const move = child.physics.type === 'kinematic' ? 'moveKinematic' : 'teleport';
        writer[move](child.physics._index, p.elements, [q.x, q.y, q.z, q.w]);
        writer.flags(child.physics._index, flagsOf(child));
      });
    },
    /** The frame's physics: bodies reconciled, poses drawn, the view and the commands sent. */
    frame(camera: Camera) {
      if (dirty) {
        bodies.reconcile(stale, (error) => failed(error as EngineError));
        stale.clear();
        dirty = false;
        stats.bodies = bodies.count.bodies;
      }
      const moving = poses.apply(bodies.meshes);
      stats.mainMs = received;
      received = 0;
      view(camera, writer);
      if (ready && writer.length) {
        const words = writer.take();
        worker.postMessage({ type: 'commands', words }, [words.buffer]);
      }
      return moving;
    },
    dispose() {
      bodies.clear();
      writer.take();
      worker.terminate();
    },
  };
}

/** What `createPhysicsSession` returns. */
export type PhysicsSession = ReturnType<typeof createPhysicsSession>;
