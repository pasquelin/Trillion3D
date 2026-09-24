import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  CommandWriter,
  EVENT,
  EVENT_WORDS,
  POSE_WORDS,
  type ContactEventName,
  type PhysicsBudget,
  type PhysicsHost,
  physicsMatterOf,
} from '../../../sdk-core/src/physics/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, flagsOf, hasBody, type Bodied } from './bodies.ts';
import { createPhysicsPoses } from './poses.ts';
import {
  PHYSICS_PROTOCOL,
  resultBytes,
  type FromPhysics,
  type PhysicsResults,
} from './protocol.ts';
import { createPhysicsView } from './view.ts';

/** What the world's physics reports: counts from the last tick, and both clocks apart. */
export interface PhysicsStats {
  /** Bodies the simulation holds. */ bodies: number;
  /** Bodies awake after the last tick. */ active: number;
  /** Worker milliseconds per fixed step, last tick: the worker's clock, never added to the page's. */
  stepMs: number;
  /** Page milliseconds the physics took in the last frame (the `physics` CPU stage). */
  mainMs: number;
  /** Poses the last tick sent back. */ poses: number;
  /** Contact events the last tick sent back. */ events: number;
}

/** The URL of a resource beside this module: `.ts` in a source tree served as is, `.js` built. */
const beside = (name: string) =>
  new URL(import.meta.url.endsWith('.ts') ? `./${name}.ts` : `./${name}.js`, import.meta.url);

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
  const poses = createPhysicsPoses(budget.bodies);
  const view = createPhysicsView();
  const stats: PhysicsStats = { bodies: 0, active: 0, stepMs: 0, mainMs: 0, poses: 0, events: 0 };
  const worker = new Worker(beside('physicsWorker'), { type: 'module' });
  const buffers = [new ArrayBuffer(resultBytes(budget)), new ArrayBuffer(resultBytes(budget))];
  worker.postMessage(
    {
      type: 'start',
      protocol: PHYSICS_PROTOCOL,
      wasm: new URL('./joltPhysics.wasm', import.meta.url).href,
      budget,
      buffers,
    },
    buffers,
  );
  const emit = (self: Bodied | null, other: Bodied | null, name: ContactEventName, e: number[]) =>
    self?.physics._emit(name, { other, impulse: e[0], point: { x: e[1], y: e[2], z: e[3] } });
  const results = (m: PhysicsResults) => {
    const words = new Uint32Array(m.buffer);
    const moved = poses.receive(
      words,
      m.poses,
      bodies.meshes,
      (m.seconds * 1000) / clock.timeScale,
    );
    const floats = new Float32Array(m.buffer);
    for (let r = 0; r < m.events; r++) {
      const at = (m.poses * POSE_WORDS + r * EVENT_WORDS) >>> 0;
      const a = bodies.meshes[words[at + 1]] ?? null,
        b = bodies.meshes[words[at + 2]] ?? null;
      const e = [floats[at + 3], floats[at + 4], floats[at + 5], floats[at + 6]];
      const name = words[at] === EVENT.begin ? 'enter' : 'leave';
      (emit(a, b, name, e), emit(b, a, name, e));
      if (name === 'enter' && !a?.physics.sensor && !b?.physics.sensor)
        (emit(a, b, 'contact', e), emit(b, a, 'contact', e));
    }
    // The last tick before sleep changes the count even when it moves nothing: a frame shows it.
    const changed = moved > 0 || m.active !== stats.active;
    Object.assign(stats, { active: m.active, poses: m.poses, events: m.events });
    stats.stepMs = m.steps ? m.stepMs / m.steps : stats.stepMs;
    worker.postMessage({ type: 'buffer', buffer: m.buffer }, [m.buffer]);
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
      if (poses.writing) return;
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
