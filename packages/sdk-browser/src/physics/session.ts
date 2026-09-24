import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  CommandWriter,
  type PhysicsBudget,
  type PhysicsHost,
  physicsMatterOf,
} from '../../../sdk-core/src/physics/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { besideModule } from '../host/besideModule.ts';
import { createPhysicsBodies, flagsOf, hasBody, worldPoseOf } from './bodies.ts';
import { emitContacts } from './contacts.ts';
import { createPhysicsPoses } from './poses.ts';
import {
  emptyPhysicsStats,
  eventsAt,
  PHYSICS_PROTOCOL,
  resultWords,
  type FromPhysics,
  type PhysicsResults,
} from './protocol.ts';
import { createPhysicsView } from './view.ts';
import { stepThreads } from './joltThreads.ts';
import { createCharacterPort, createPhysicsCharacter } from './physicsCharacter.ts';
import type { CharacterBodyFactory } from '../../../sdk-core/src/collision/characterBody.ts';

/**
 * One running simulation: the worker, the bodies, the drawn poses. It exists only once physics is
 * enabled — a world without physics creates none, and fetches no byte of Jolt.
 */
export function createPhysicsSession(
  root: Object3D,
  budget: Readonly<PhysicsBudget>,
  invalidate: () => void,
  failed: (error: EngineError, fatal?: boolean) => void,
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
  const poses = createPhysicsPoses(budget.bodies, root);
  const bodies = createPhysicsBodies(writer, budget, host, root, poses.state);
  const view = createPhysicsView();
  const stats = emptyPhysicsStats();
  /** The character's inner capsule is the slot past the page's; its contacts name the camera. */
  const touched: { id: number; eye: Object3D | null } = { id: budget.bodies, eye: null };
  const worker = new Worker(besideModule('physicsWorker', import.meta.url), { type: 'module' });
  const threads = stepThreads(budget.threads);
  const bytes = resultWords(budget) * 4;
  const buffers = [new ArrayBuffer(bytes), new ArrayBuffer(bytes)];
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
    // Simulated time in page time; a tick sent before a clock stopped at 0 is drawn at once.
    const ms = clock.timeScale > 0 ? (m.seconds * 1000) / clock.timeScale : 0;
    const moved = poses.receive(words, m.poses, bodies, ms);
    emitContacts(words, eventsAt(budget), m.events, bodies.meshOf, touched);
    if (m.character) character.hear?.(m.character);
    // The last tick before sleep changes the count even when it moves nothing: a frame shows it.
    const changed = moved > 0 || m.active !== stats.active || m.character !== null;
    Object.assign(stats, { active: m.active, poses: m.poses, events: m.events });
    stats.droppedEvents += m.dropped;
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
    else {
      // Bodies whose shape the module refused leave the simulation; the world runs on, unless the
      // error is fatal: then the simulation stopped, and the world ends this session.
      const refused = (data.bodies ?? []).map(bodies.meshOf).filter((mesh) => mesh !== null);
      for (const mesh of refused) bodies.retire(mesh.physics._index);
      const names = refused.map((mesh) => mesh.name);
      failed(new EngineError(data.code, data.message, names.length ? { names } : {}), data.fatal);
    }
  };
  worker.onerror = (event) =>
    failed(new EngineError('PHYSICS_FAILED', `Physics worker: ${event.message}`), true);
  const clock = { paused: false, timeScale: 1 };
  const character = createCharacterPort((message) => worker.postMessage(message));
  const characterBody: CharacterBodyFactory = (s) => createPhysicsCharacter(character, s);
  return {
    stats,
    writer,
    /** The character's body in this session's worker, for `world.controls`. */ characterBody,
    /** Pauses or scales the simulation's time; a scale of 0 stands still, like a pause. */
    setClock(paused: boolean, timeScale: number) {
      Object.assign(clock, { paused, timeScale });
      worker.postMessage({ type: 'clock', paused: paused || timeScale === 0, timeScale });
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
        const { position, quaternion } = worldPoseOf(child);
        const move = child.physics.type === 'kinematic' ? 'moveKinematic' : 'teleport';
        writer[move](child.physics._index, position, quaternion);
        writer.flags(child.physics._index, flagsOf(child));
      });
    },
    /** The frame's physics: bodies reconciled, poses drawn, the view and the commands sent. */
    frame(camera: Camera) {
      touched.eye = camera;
      if (dirty) {
        bodies.reconcile(stale, (error) => failed(error as EngineError));
        stale.clear();
        dirty = false;
        stats.bodies = bodies.count.bodies;
      }
      const moving = poses.apply(bodies);
      stats.mainMs = received;
      received = 0;
      view(camera, writer);
      if (ready && writer.length) {
        const words = writer.take();
        worker.postMessage({ type: 'commands', words }, [words.buffer]);
      }
      if (ready) character.flush();
      return moving;
    },
    dispose() {
      bodies.clear();
      poses.clear();
      writer.take();
      worker.terminate();
    },
  };
}

/** What `createPhysicsSession` returns. */
export type PhysicsSession = ReturnType<typeof createPhysicsSession>;
