import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { WaterSurface, type WaterSpec } from '../../../sdk-core/src/fluids/index.ts';
import { GRAVITY_PRESETS, physicsBudgetOf } from '../../../sdk-core/src/physics/options.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { listen } from '../../../sdk-core/src/world/math/observed.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { HostCpuProfile } from '../host/cpuProfile.ts';
import { families } from '../host/families.ts';
import { createJointList } from './jointList.ts';
import { physicsLink } from './physicsLink.ts';
import { createWaterCarry } from './waterCarry.ts';
import type { PhysicsSession } from './session/session.ts';
import { emptyPhysicsStats, type PhysicsStats } from './protocol.ts';
import {
  simulationRangeOf,
  type GravityInput,
  type WorldPhysicsOptions,
} from './worldPhysicsOptions.ts';

/**
 * The world's physics, `world.physics`: off until enabled, and then the physics engine in a worker. The
 * worker and its WebAssembly are fetched on first use; bodies set before are queued. Every body
 * is an ordinary mesh with `physics` set (`mesh.physics`).
 */
export function createWorldPhysics(
  runtime: { invalidate(): void; readonly explorer: unknown },
  root: Object3D,
  camera: () => Camera,
  options: boolean | WorldPhysicsOptions = false,
) {
  const invalidate = () => runtime.invalidate();
  const settings = typeof options === 'object' ? options : {};
  const budget = physicsBudgetOf(settings.budget);
  const gravity = new Vector3();
  let session: PhysicsSession | null = null,
    wanted = false,
    paused = false,
    timeScale = 1,
    range = simulationRangeOf(settings.simulationRange ?? null),
    water: WaterSpec | null = null,
    surface: WaterSurface | null = null,
    error: EngineError | null = null,
    watcher: (() => void) | null = null; // told when a session starts or ends (the character)
  const stopped = emptyPhysicsStats();
  const carry = createWaterCarry(root);
  /** The surface clocked at the simulation's time: still without a session, as the worker's. */
  const clocked = () => (water ? surface!.setTime(session?.waterTime() ?? 0) : null);
  const joints = createJointList(() => {
    session?.structure();
    invalidate();
  });
  const clock = () => {
    session?.setClock(paused, timeScale);
    invalidate();
  };
  listen(gravity, () => {
    session?.writer.gravity(gravity.elements);
    invalidate();
  });
  const setGravity = (g: GravityInput) =>
    typeof g === 'string' ? gravity.set(0, -GRAVITY_PRESETS[g], 0) : gravity.set(g.x, g.y, g.z);
  const failed = (cause: EngineError, fatal = false) => {
    error = cause;
    console.error(cause);
    // The simulation stopped: its session ends and sends nothing more; `enabled` reads false.
    if (fatal) handle.enabled = false;
  };
  /** The session's code is a family on demand (`../host/families.ts`): a world without physics
   *  loads none of it; one that could not load is `FAMILY_LOAD_FAILED`, asked again next time. */
  const start = () =>
    families.physics.load().then(
      ({ createPhysicsSession }) => {
        if (!wanted || session) return;
        const frozen = Object.freeze({ ...budget }); // sizes the session's arrays for its life
        session = createPhysicsSession(root, frozen, invalidate, failed, joints);
        session.writer.gravity(gravity.elements);
        if (water) session.setWater(water);
        clock();
        watcher?.();
      },
      (cause: EngineError) => failed(cause, true),
    );
  const handle = {
    ...joints.methods,
    /** Whether bodies are simulated. Turning it on fetches the physics the first time.
     *  @defaultValue false, or true with `createWorld(…, { physics })` */
    get enabled() {
      return wanted;
    },
    set enabled(on: boolean) {
      if (on === wanted) return;
      wanted = on;
      if (on) void start();
      else {
        session?.dispose();
        session = null;
        watcher?.();
      }
      invalidate();
    },
    /** Gravity in m/s², a live vector; set a preset (`'earth'`, `'moon'`, `'mars'`, `'none'`)
     *  or a vector. @defaultValue 'earth' (0, −9.81, 0) */
    get gravity(): Vector3 {
      return gravity;
    },
    set gravity(g: GravityInput) {
      setGravity(g);
    },
    /** Whether time stands still; writes still reach the bodies. @defaultValue false */
    get paused() {
      return paused;
    },
    set paused(on: boolean) {
      paused = on;
      clock();
    },
    /** Simulated seconds per real second: 0.25 is slow motion, 0 stands still like `paused`.
     *  @defaultValue 1 */
    get timeScale() {
      return timeScale;
    },
    set timeScale(scale: number) {
      if (!(scale >= 0 && scale < Infinity))
        throw new RangeError(`physics.timeScale must be a finite number ≥ 0, not ${scale}.`);
      timeScale = scale;
      clock();
    },
    /** Metres around the camera within which bodies are simulated (frozen past it, as they were,
     *  and no collision tile fetched); `null` follows `camera.far`. @defaultValue null */
    get simulationRange(): number | null {
      return range;
    },
    set simulationRange(metres: number | null) {
      range = simulationRangeOf(metres);
      invalidate();
    },
    /** The water the bodies float in: its level, its waves, its density and drags. A body
     *  lighter than the water floats, pushed by the weight of the water it displaces.
     *  @defaultValue null (no water) */
    get water(): WaterSpec | null {
      return water;
    },
    set water(spec: WaterSpec | null) {
      // Resolved here once, so a wrong wave throws on the page, not in the worker. The surface is
      // the same one set again: what holds it (`mesh.waves`) is carried by the new waves.
      if (spec) surface = surface?._declare(spec) ?? new WaterSurface(spec);
      water = spec;
      carry.water();
      session?.setWater(spec);
      invalidate();
    },
    /** The water's surface at the simulation's time: the waves buoyancy reads, the same numbers
     *  (`height`, `point`, `normal`). A mesh that lies on its rest plane, or whose `mesh.waves` is
     *  this surface, is drawn carried by it, on the GPU. @defaultValue null (no water) */
    get waterSurface(): WaterSurface | null {
      return clocked();
    },
    /** Counts and both clocks: worker milliseconds per step, page milliseconds per frame. */
    get stats(): Readonly<PhysicsStats> {
      return session?.stats ?? stopped;
    },
    /** The last error the physics raised (`PHYSICS_BUDGET`, `PHYSICS_NESTED`, `PHYSICS_FAILED`,
     *  `PHYSICS_DIVERGED`, `RESOURCE_HTTP_ERROR`, `FAMILY_LOAD_FAILED`), or `null`. One that stopped the simulation turns `enabled` off. */
    get error() {
      return error;
    },
  };
  setGravity(settings.gravity ?? 'earth');
  if (options) handle.enabled = true;
  // Without water, nothing is carried: a change is no mesh to read again.
  const hear = (node: Object3D) => water && carry.heard(node);
  root._link = physicsLink(root._link, {
    structure: (node) => (hear(node), session?.structure()),
    content: (node) => (hear(node), session?.content(node)),
    pose: (node) => (hear(node), session?.pose(node)),
  });
  return {
    handle,
    /** The fixed envelopes, `world.budget.physics`: read once when the physics starts. */
    budget,
    /** Sets the frame's time, `seconds` of the world's time after the last frame
     *  (`FrameInfo.delta`), at its start: what the frame draws reads it (`worldFrames.ts`). */
    time(seconds: number) {
      session?.time(seconds);
    },
    /** Runs the frame's physics, timed into the `physics` CPU stage, then clocks the water's
     *  surface and finds the meshes it carries (`waterCarry.ts`); returns whether a body is still
     *  on its way, or waves still move a mesh that holds the surface. */
    frame() {
      let moving = false;
      if (session) {
        const start = performance.now();
        moving = session.frame(camera(), range);
        // The frame's own work, plus the ticks received since the last one (`session.frame`).
        session.stats.mainMs += performance.now() - start;
        (runtime.explorer as HostCpuProfile | null)?.cpuStep?.('physicsMs', session.stats.mainMs);
      }
      const drawn = clocked(),
        held = carry.frame(drawn);
      return moving || (held && !!session && !paused && timeScale > 0 && drawn!.crest > 0);
    },
    /** The character's body in the running session, for `world.controls`; `watch` is told
     *  each time a session starts or ends. */
    character: {
      body: () => session?.characterBody ?? null,
      watch(listener: () => void) {
        watcher = listener;
      },
    },
    dispose: () => (handle.enabled = false),
    /** The running session, for the queries asked of it (`physicsRaycast`). */
    session: () => session,
  };
}

/** `world.physics`. */
export type WorldPhysics = ReturnType<typeof createWorldPhysics>['handle'];
