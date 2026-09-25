import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { CommandWriter, type PhysicsBudget } from '../../../sdk-core/src/physics/index.ts';
import type { WaterSpec } from '../../../sdk-core/src/fluids/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, hasBody } from './bodies.ts';
import { placeBodies } from './placeBodies.ts';
import { emitContacts } from './contacts.ts';
import { createPhysicsPoses } from './poses.ts';
import { emptyPhysicsStats, eventsAt, type FromPhysics, type PhysicsResults } from './protocol.ts';
import { createSessionHost } from './sessionHost.ts';
import { startPhysicsWorker } from './sessionWorker.ts';
import { createPhysicsJoints } from './joints.ts';
import type { createJointList } from './jointList.ts';
import { createPhysicsVehicles } from './vehicles.ts';
import { engineIdOf } from './simulatedIds.ts';
import { receiveSoft } from './softBodies.ts';
import { createTileStreamer } from './tiles.ts';
import { createPhysicsView } from './view.ts';
import { resolveCameraWorld } from '../camera/world.ts';
import { createCharacterPort, createPhysicsCharacter } from './physicsCharacter.ts';
import { createWaterClock } from './waterClock.ts';

/**
 * One running simulation: the worker, the bodies, the drawn poses. It exists only once physics is
 * enabled — a world without physics creates none, and fetches no byte of Jolt.
 */
export function createPhysicsSession(
  root: Object3D,
  budget: Readonly<PhysicsBudget>,
  invalidate: () => void,
  failed: (error: EngineError, fatal?: boolean) => void,
  /** The joints and vehicles `world.physics.add` holds: made once their bodies are simulated. */
  wanted: Pick<ReturnType<typeof createJointList>, 'joints' | 'vehicles'>,
) {
  const writer = new CommandWriter();
  const stale = new Set<Object3D>();
  let [dirty, ready] = [true, false];
  const host = createSessionHost(
    writer,
    () => bodies.meshes,
    (mesh) => {
      if (mesh) stale.add(mesh);
      dirty = true;
    },
    invalidate,
  );
  const poses = createPhysicsPoses(budget.bodies, root);
  const bodies = createPhysicsBodies(writer, budget, host, root, poses.state);
  const joints = createPhysicsJoints(writer, bodies, invalidate);
  const vehicles = createPhysicsVehicles(writer, bodies, invalidate);
  /** A body leaving the simulation (asleep decorative, refused) takes its joints and vehicles. */
  const retire = (index: number) => {
    bodies.retire(index);
    dirty = true;
  };
  const posed = { meshes: bodies.meshes, generation: bodies.generation, retire };
  const view = createPhysicsView();
  const stats = emptyPhysicsStats();
  /** The character's inner capsule is the slot past the page's; its contacts name the camera. */
  const touched: { id: number; eye: Object3D | null } = { id: budget.bodies, eye: null };
  const worker = startPhysicsWorker(budget);
  const tiles = createTileStreamer(writer, budget, bodies, invalidate, (error) => failed(error));
  const casts = new Map<number, (hits: Uint32Array) => void>();
  let asked = 0,
    onReady = () => {};
  const started = new Promise<void>((resolve) => (onReady = resolve));
  const flush = () => {
    if (!ready || !writer.length) return;
    const words = writer.take();
    worker.postMessage({ type: 'commands', words }, [words.buffer]);
  };
  /** Page milliseconds spent on ticks since the last frame: they count in its `physics` stage. */
  let received = 0;
  const results = (m: PhysicsResults) => {
    const began = performance.now();
    const words = new Uint32Array(m.buffer);
    // Simulated time in page time; a tick sent before a clock stopped at 0 is drawn at once.
    const ms = clock.timeScale > 0 ? (m.seconds * 1000) / clock.timeScale : 0;
    const moved = poses.receive(words, m.poses, posed, ms) + receiveSoft(m.soft, bodies).length;
    emitContacts(words, eventsAt(budget), m.events, bodies.meshOf, touched);
    waves.received(m.water, m.active, began, m.waterEpoch);
    if (m.character) character.hear?.(m.character);
    vehicles.receive(m.vehicles);
    // The last tick before sleep changes the count even when it moves nothing: a frame shows it.
    const changed = moved > 0 || m.active !== stats.active || !!m.character || !!m.vehicles;
    Object.assign(stats, { active: m.active, poses: m.poses, events: m.events });
    stats.droppedEvents += m.dropped;
    stats.bodies = bodies.count.bodies;
    if (m.steps) Object.assign(stats, { stepMs: m.stepMs / m.steps, stepMaxMs: m.stepMaxMs });
    worker.postMessage({ type: 'buffer', buffer: m.buffer }, [m.buffer]);
    received += performance.now() - began;
    if (changed) invalidate();
  };
  worker.onmessage = ({ data }: MessageEvent<FromPhysics>) => {
    if (data.type === 'ready') {
      ready = true;
      onReady();
      invalidate();
    } else if (data.type === 'results') results(data);
    else if (data.type === 'broken') joints.broke(data.joints);
    else if (data.type === 'cast') {
      casts.get(data.id)?.(data.hits);
      casts.delete(data.id);
    } else {
      // Bodies whose shape the module refused leave the simulation, tiles and cooked soft bodies
      // too; the world runs on, unless the error is fatal: then the world ends this session.
      for (const id of data.bodies ?? []) tiles.refused(id);
      const refused = (data.bodies ?? []).map(bodies.meshOf).filter((mesh) => mesh !== null);
      for (const mesh of refused) retire(mesh.physics._index);
      const names = refused.map((mesh) => mesh.name);
      failed(new EngineError(data.code, data.message, names.length ? { names } : {}), data.fatal);
    }
  };
  worker.onerror = (event) =>
    failed(new EngineError('PHYSICS_FAILED', `Physics worker: ${event.message}`), true);
  const clock = { paused: false, timeScale: 1 };
  const waves = createWaterClock(clock);
  const character = createCharacterPort((message) => worker.postMessage(message));
  return {
    stats,
    writer,
    /** The character's body in this session's worker, for `world.controls`. */
    characterBody: createPhysicsCharacter.bind(null, character),
    /** Pauses or scales the simulation's time; a scale of 0 stands still, like a pause. */
    setClock(paused: boolean, timeScale: number) {
      waves.retime();
      Object.assign(clock, { paused, timeScale });
      worker.postMessage({ type: 'clock', paused: paused || timeScale === 0, timeScale });
    },
    /** The water the bodies float in, or none: buoyancy runs in the worker, before each step, on
     *  the awake bodies; every dynamic body is woken, so one at rest floats or falls. */
    setWater(water: WaterSpec | null) {
      worker.postMessage({ type: 'water', water, epoch: waves.reset() });
      for (const mesh of bodies.meshes)
        if (mesh?.physics.type === 'dynamic') writer.wake(mesh.physics._index);
    },
    /** Simulated seconds the water's waves have run, for a frame drawn now. */
    waterTime: () => waves.time(),
    /** The scene's tree changed: bodies are reconciled before the next frame. */
    structure: () => void (dirty = true),
    /** A mesh's geometry, material or `physics` changed. */
    content(node: Object3D) {
      if (hasBody(node)) stale.add(node);
      dirty = true;
    },
    /** The page moved or hid a node: its bodies go where the page put them; hidden, no pose. */
    pose(node: Object3D) {
      placeBodies(node, host, writer);
      tiles.moved(node);
    },
    /** The frame's physics: bodies reconciled, poses drawn, the view and the commands sent. */
    frame(camera: Camera) {
      touched.eye = camera;
      if (dirty) {
        bodies.reconcile(stale, (error) => failed(error as EngineError));
        joints.reconcile(wanted.joints);
        vehicles.reconcile(wanted.vehicles);
        tiles.scan(root);
        stale.clear();
        dirty = false;
        stats.bodies = bodies.count.bodies;
      }
      const moving = poses.apply(bodies);
      stats.mainMs = received;
      received = 0;
      view(camera, writer);
      tiles.update(resolveCameraWorld(camera).matrixWorld.elements.slice(12, 15), camera.far);
      flush();
      if (ready) character.flush();
      return moving;
    },
    /** Scene queries (`CAST_WORDS` each), answered after the frame's commands: hits in order. */
    async cast(queries: Uint32Array) {
      await started;
      flush();
      const id = ++asked;
      worker.postMessage({ type: 'cast', id, queries }, [queries.buffer]);
      return new Promise<Uint32Array>((resolve) => casts.set(id, resolve));
    },
    /** The model a tile body's engine id belongs to, or the mesh a body's names, or `null`. */
    objectOf: (id: number) => tiles.modelOf(id) ?? bodies.meshOf(id),
    /** The engine id of `node`'s body; -1 while it is not simulated. */
    engineIdOf: (node: Object3D) => engineIdOf(bodies, node),
    /** The glTF material of a tile body's triangles, `-1` for any other body. */
    materialOf: tiles.materialOf,
    dispose() {
      tiles.clear();
      joints.clear();
      vehicles.clear();
      bodies.clear();
      poses.clear();
      writer.take();
      worker.terminate();
    },
  };
}

/** What `createPhysicsSession` returns. */
export type PhysicsSession = ReturnType<typeof createPhysicsSession>;
