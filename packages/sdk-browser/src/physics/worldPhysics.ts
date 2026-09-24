import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  DEFAULT_PHYSICS_BUDGET,
  GRAVITY_PRESETS,
  type GravityPreset,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { listen } from '../../../sdk-core/src/world/math/observed.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D, SceneLink } from '../../../sdk-core/src/world/object/object3d.ts';
import type { HostCpuProfile } from '../host/cpuProfile.ts';
import { createPhysicsSession, type PhysicsSession } from './session.ts';
import { emptyPhysicsStats, type PhysicsStats } from './protocol.ts';

/** A gravity: a preset's name, or a vector in m/s². */
export type GravityInput = GravityPreset | { x: number; y: number; z: number };

/** What `createWorld(canvas, { physics })` accepts beyond `true`. */
export interface WorldPhysicsOptions {
  /** The world's gravity: a preset or a vector. @defaultValue 'earth' */ gravity?: GravityInput;
  /** Fixed envelopes, read once when the physics starts. @defaultValue DEFAULT_PHYSICS_BUDGET */
  budget?: Partial<PhysicsBudget>;
}

/**
 * The world's physics, `world.physics`: off until enabled, and then Jolt Physics in a worker. The
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
  const budget: PhysicsBudget = { ...DEFAULT_PHYSICS_BUDGET, ...settings.budget };
  const gravity = new Vector3();
  let session: PhysicsSession | null = null,
    paused = false,
    timeScale = 1,
    error: EngineError | null = null;
  const stopped = emptyPhysicsStats();
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
  const handle = {
    /** Whether bodies are simulated. Turning it on fetches the physics the first time.
     *  @defaultValue false, or true with `createWorld(…, { physics })` */
    get enabled() {
      return session !== null;
    },
    set enabled(on: boolean) {
      if (on === (session !== null)) return;
      if (on) {
        session = createPhysicsSession(root, budget, invalidate, failed);
        session.writer.gravity(gravity.elements);
        clock();
      } else {
        session?.dispose();
        session = null;
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
    /** Counts and both clocks: worker milliseconds per step, page milliseconds per frame. */
    get stats(): Readonly<PhysicsStats> {
      return session?.stats ?? stopped;
    },
    /** The last error the physics raised (`PHYSICS_BUDGET`, `PHYSICS_NESTED`,
     *  `PHYSICS_FAILED`), or `null`. One that stopped the simulation turns `enabled` off. */
    get error() {
      return error;
    },
  };
  setGravity(settings.gravity ?? 'earth');
  if (options) handle.enabled = true;
  root._link = physicsLink(root._link, {
    structure: () => session?.structure(),
    content: (node) => session?.content(node),
    pose: (node) => session?.pose(node),
  });
  return {
    handle,
    /** The fixed envelopes, `world.budget.physics`: read once when the physics starts. */
    budget,
    /** Runs the frame's physics, timed into the `physics` CPU stage; returns whether a body is
     *  still on its way. */
    frame() {
      if (!session) return false;
      const start = performance.now();
      const moving = session.frame(camera());
      // The frame's own work, plus the ticks received since the last one (`session.frame`).
      session.stats.mainMs += performance.now() - start;
      (runtime.explorer as HostCpuProfile | null)?.cpuStep?.('physicsMs', session.stats.mainMs);
      return moving;
    },
    dispose: () => (handle.enabled = false),
  };
}

/** `world.physics`. */
export type WorldPhysics = ReturnType<typeof createWorldPhysics>['handle'];

/** The scene link a world's runtime set, with the physics told of every change too; what else
 *  that link answers (the scene's `background`) is kept. */
function physicsLink(link: SceneLink | null, physics: Omit<SceneLink, 'posed'>): SceneLink {
  return {
    ...link,
    pose(node) {
      link?.pose(node);
      physics.pose(node);
    },
    // Only the physics places nodes by the batch: nothing to tell it of its own writes.
    posed(nodes) {
      link?.posed(nodes);
    },
    structure(node) {
      link?.structure(node);
      physics.structure(node);
    },
    content(node) {
      link?.content(node);
      physics.content(node);
    },
  };
}
