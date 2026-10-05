import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  CommandWriter,
  MAX_CATCH_UP_STEPS,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { WaterSpec } from '../../../sdk-core/src/fluids/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, hasBody } from './bodies.ts';
import { placeBodies } from './placeBodies.ts';
import { emitContacts } from './contacts.ts';
import { createPhysicsPoses } from './poses.ts';
import {
  emptyPhysicsStats,
  eventsAt,
  type FromPhysics,
  type PhysicsResults,
  type ToPhysics,
} from './protocol.ts';
import { createSessionHost } from './sessionHost.ts';
import { startPhysicsWorker } from './sessionWorker.ts';
import { createPhysicsJoints } from './joints.ts';
import type { createJointList } from './jointList.ts';
import { createPhysicsVehicles } from './vehicles.ts';
import { engineIdOf } from './simulatedIds.ts';
import { createSoftVertices, drawnBySoft } from './softBodies.ts';
import { createTileStreamer } from './tiles.ts';
import { followMove } from './nodePose.ts';
import { createPhysicsView } from './view.ts';
import { resolveCameraWorld } from '../camera/world.ts';
import { createCharacterPort, createPhysicsCharacter } from './physicsCharacter.ts';
import { along, createStepClock, physicsStep } from './stepClock.ts';

/**
 * One running simulation: the worker, the bodies, the drawn poses. It exists only once physics is
 * enabled — a world without physics creates none, and fetches no byte of the physics module. Its time is the
 * frames' (`stepClock.ts`): each frame's time is set at its start (`time`), the bodies, the
 * wheels, the soft bodies and the character all drawn at it, between their two states
 * (`twoSteps.ts`) at the one fraction `along` reads; then the frame sends its commands and the
 * steps it owes while the world is awake. A world at rest is sent nothing.
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
  const step = physicsStep();
  const clock = createStepClock(step);
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
  const poses = createPhysicsPoses(budget.bodies, root, step);
  const bodies = createPhysicsBodies(writer, budget, host, root, poses.state, step);
  const joints = createPhysicsJoints(writer, bodies, invalidate);
  const vehicles = createPhysicsVehicles(writer, bodies, invalidate);
  const soft = createSoftVertices(bodies, budget.bodies);
  /** A body leaving takes its joints and vehicles; out for good (asleep, diverged), they break. */
  const retire = (index: number, forGood = false) => {
    if (forGood) joints.retired(bodies.slots.physicsAt(index), wanted.joints);
    bodies.retire(index);
    dirty = true;
  };
  const posed = { ...bodies, retire: (index: number) => retire(index, true) };
  const view = createPhysicsView();
  const stats = emptyPhysicsStats();
  /** The character's inner capsule is the slot past the page's; its contacts name the camera. */
  const touched: { id: number; eye: Object3D | null } = { id: budget.bodies, eye: null };
  const worker = startPhysicsWorker(budget, step);
  const tiles = createTileStreamer(writer, budget, bodies, invalidate, (error) => failed(error));
  const casts = new Map<number, (hits: Uint32Array) => void>();
  let [asked, onReady] = [0, () => {}];
  const started = new Promise<void>((resolve) => (onReady = resolve));
  /** Whether the worker asks for steps, as the page last heard; the messages that may wake the
   *  world sent so far (`PhysicsResults.heard`: only a rest after all of them says the world
   *  rests); whether one went since the last advance (an advance of no step runs it). */
  let live = false,
    wakes = 0,
    sent = false;
  /** The page's step the newest states the worker delivered stand at, and the steps the frame's
   *  time owes, not sent yet. Whether what the drawing reads changed since the last frame drew
   *  (a tick, the world woken or at rest), the time it drew and what it answered: a frame at
   *  that time with nothing new draws nothing again (a paused clock). */
  let reached = 0,
    owed = 0,
    redraw = false,
    drawnStep = NaN,
    drawnOwed = NaN,
    moving = false;
  const wake = () => {
    // Woken from rest, the simulation stands where the frames' clock does: nothing moved since.
    if (!live) reached = clock.steps;
    [live, sent, redraw] = [true, true, true];
    wakes++;
  };
  /** The worker stands at the page's step `at`, at rest after the first `heard` waking messages. */
  const rested = (heard: number, at: number) => {
    reached = Math.max(reached, at);
    if (heard === wakes) [live, redraw] = [false, true];
  };
  /** The fraction of a step the frame's time stands at (`along`), as everything is drawn. */
  const at = () => along(clock.drawn, reached, step, live);
  /** The steps of the frame's time `steps` (none: the clock stands still), its clock now at
   *  `clock.steps`. */
  const advance = (steps: number) => {
    worker.postMessage({ type: 'advance', to: clock.steps, steps });
    sent = false;
  };
  const send = (message: ToPhysics, transfer: Transferable[] = []) => {
    worker.postMessage(message, transfer);
    wake();
  };
  const flush = () => {
    const words = ready && writer.length ? writer.take() : null;
    if (words) send({ type: 'commands', words }, [words.buffer]);
  };
  let received = 0; // Page ms spent on ticks since the last frame: its `physics` stage's.
  let namedAt = -Infinity; // Page ms the last soft bodies brought back were named at.
  const results = (m: PhysicsResults) => {
    const began = performance.now();
    const words = new Uint32Array(m.buffer);
    reached = Math.max(reached, m.step);
    const moved = poses.receive(words, m.poses, posed, m.steps) + soft.receive(m.soft, m.steps);
    emitContacts(words, eventsAt(budget), m.events, bodies.meshOf, touched);
    character.hear?.(m.character, m.feet, m.steps);
    vehicles.receive(m.vehicles, m.steps);
    redraw = true;
    if (m.resting) rested(m.heard, m.step);
    // The last tick before sleep changes the count even when it moves nothing: a frame shows it.
    const changed =
      moved > 0 || m.active !== stats.active || !!m.character || !!m.feet || !!m.vehicles;
    Object.assign(stats, { active: m.active, poses: m.poses, events: m.events });
    stats.droppedEvents += m.dropped;
    stats.bodies = bodies.count.bodies;
    if (m.steps) Object.assign(stats, { stepMs: m.stepMs / m.steps, stepMaxMs: m.stepMaxMs });
    worker.postMessage({ type: 'buffer', buffer: m.buffer }, [m.buffer]);
    writer.recycle(m.spent);
    received += performance.now() - began;
    if (changed) invalidate();
  };
  worker.onmessage = ({ data }: MessageEvent<FromPhysics>) => {
    if (data.type === 'ready') {
      ready = true;
      onReady();
      invalidate();
    } else if (data.type === 'results') results(data);
    else if (data.type === 'rest') rested(data.heard, data.step);
    else if (data.type === 'broken') joints.broke(data.joints);
    else if (data.type === 'recovered') {
      // Brought back to a good state, they stay: counted, and named in an error that stops
      // nothing, once a second at most (one brought back at every step would flood the console).
      stats.softRecoveries += data.bodies.length;
      const now = performance.now();
      if (now - namedAt < 1000) return;
      namedAt = now;
      const names = data.bodies.flatMap((id) => bodies.meshOf(id)?.name ?? []);
      const message = `Physics: ${data.bodies.length} soft body(ies) diverged and were brought back to their last good state.`;
      failed(new EngineError('PHYSICS_DIVERGED', message, names.length ? { names } : {}), false);
    } else if (data.type === 'cast') {
      casts.get(data.id)?.(data.hits);
      casts.delete(data.id);
    } else {
      // Refused shapes leave, tiles and cooked soft bodies by their owner; diverged, joints break.
      for (const id of data.bodies ?? []) tiles.refused(id);
      const refused = (data.bodies ?? []).map(bodies.meshOf).filter((mesh) => mesh !== null);
      for (const mesh of refused) retire(mesh.physics._index, data.code === 'PHYSICS_DIVERGED');
      const names = refused.map((mesh) => mesh.name);
      failed(new EngineError(data.code, data.message, names.length ? { names } : {}), data.fatal);
    }
  };
  worker.onerror = (event) =>
    failed(new EngineError('PHYSICS_FAILED', `Physics worker: ${event.message}`), true);
  /** The page's step the water's waves start at (`setWater`). */
  let waterAt = 0;
  const character = createCharacterPort(send, at);
  return {
    stats,
    writer,
    /** The character's body in this session's worker, for `world.controls`. */
    characterBody: createPhysicsCharacter.bind(null, character),
    /** Pauses or scales the simulation's time; a scale of 0 stands still, like a pause. */
    setClock(paused: boolean, timeScale: number) {
      Object.assign(clock, { paused: paused || timeScale === 0, timeScale });
    },
    /** The water, or none (buoyancy in the worker): each dynamic body woken, to float or fall.
     *  Its waves start at 0 s at the page's step now. */
    setWater(water: WaterSpec | null) {
      // The step the worker stands at when it reads this: the steps this frame owes come after.
      waterAt = clock.steps - owed;
      worker.postMessage({ type: 'water', water, at: waterAt });
      for (const mesh of bodies.meshes)
        if (mesh?.physics.type === 'dynamic') writer.wake(mesh.physics._index);
      for (const slot of bodies.nested.keys()) writer.wake(slot);
    },
    /** Simulated seconds the water's waves have run at the time the last frame drew: the
     *  waves buoyancy met there. */
    waterTime: () => clock.since(waterAt),
    /** The scene's tree changed: bodies are reconciled before the next frame. */
    structure: () => void (dirty = true),
    /** A mesh's geometry, material or `physics` changed: not a soft body drawn where it is. */
    content(node: Object3D) {
      if (drawnBySoft(node)) return;
      if (hasBody(node)) stale.add(node);
      dirty = true;
    },
    /** The page moved or hid a node: its bodies go where the page put them; hidden, no pose. */
    pose(node: Object3D) {
      dirty = placeBodies(node, bodies, writer, failed) || dirty;
      tiles.moved(node);
      followMove(node, bodies.nested, writer, poses.follow);
    },
    /** The frame's time, `seconds` after the last (`FrameInfo.delta`), set at its start: all it
     *  draws reads it, the character the controller moves first included (`worldFrames.ts`). */
    time(seconds: number) {
      // Waiting on the worker, the clock leads its newest state by the steps a frame can draw
      // past it at most (`along`): a slower worker shows slow motion, never a growing backlog.
      owed += clock.frame(seconds, live ? reached + MAX_CATCH_UP_STEPS + 1 : Infinity);
    },
    /** The frame's physics: bodies reconciled, everything drawn at its time, the view (`range`),
     *  commands sent, then the steps it owes. Whether a body is still on its way or the worker
     *  steps on (and asks for the next frame). */
    frame(camera: Camera, range: number | null) {
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
      const { drawn } = clock;
      if (redraw || drawn.step !== drawnStep || drawn.owed !== drawnOwed) {
        // Everything at the frame's time: the bodies, the wheels, the soft bodies.
        const t = at();
        moving = poses.apply(bodies, t, live);
        moving = vehicles.apply(t, live) || moving;
        moving = soft.apply(t, live) || moving;
        [redraw, drawnStep, drawnOwed] = [false, drawn.step, drawn.owed];
      }
      [stats.mainMs, received] = [received, 0];
      const reach = view(camera, writer, range);
      tiles.update(resolveCameraWorld(camera).matrixWorld.elements.slice(12, 15), reach);
      flush();
      if (ready) character.flush();
      // After the frame's commands and keys: the steps they reach while the world is awake; the
      // clock standing still, what was sent runs in place.
      if (ready && (owed > 0 ? live : clock.paused && sent)) advance(owed);
      owed = 0;
      // Paused, the time drawn stands still: no frame draws anything new.
      return !clock.paused && (moving || live);
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
    objectOf: bodies.slots.objectOf,
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
