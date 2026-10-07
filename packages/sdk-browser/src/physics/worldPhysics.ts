import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { WaterSurface, type WaterSpec } from '../../../sdk-core/src/fluids/index.ts'
import { GRAVITY_PRESETS, physicsBudgetOf } from '../../../sdk-core/src/physics/options.ts'
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts'
import { listen } from '../../../sdk-core/src/world/math/observed.ts'
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { Engine } from '../engine/types.ts'
import { families } from '../host/families.ts'
import { createJointList } from './jointList.ts'
import { physicsLink } from './physicsLink.ts'
import { createWaterCarry } from './waterCarry.ts'
import type { PhysicsSession } from './session/session.ts'
import { emptyPhysicsStats, type PhysicsStats } from './protocol.ts'
import {
  simulationRangeOf,
  type GravityInput,
  type WorldPhysicsOptions,
} from './worldPhysicsOptions.ts'

/** What the world's physics holds: its scene and envelopes, its gravity, joints and carried
 *  meshes, the session running — if any — and what the handle set. */
type PhysicsState = {
  root: Object3D
  invalidate: () => void
  budget: ReturnType<typeof physicsBudgetOf>
  gravity: Vector3
  carry: ReturnType<typeof createWaterCarry>
  joints: ReturnType<typeof createJointList>
  session: PhysicsSession | null
  wanted: boolean
  paused: boolean
  timeScale: number
  range: ReturnType<typeof simulationRangeOf>
  water: WaterSpec | null
  surface: WaterSurface | null
  error: EngineError | null
  /** Told when a session starts or ends (the character). */
  watcher: (() => void) | null
}

function physicsState(invalidate: () => void, root: Object3D, settings: WorldPhysicsOptions) {
  const state: PhysicsState = {
    root,
    invalidate,
    budget: physicsBudgetOf(settings.budget),
    gravity: new Vector3(),
    carry: createWaterCarry(root),
    joints: createJointList(() => {
      state.session?.structure()
      invalidate()
    }),
    session: null,
    wanted: false,
    paused: false,
    timeScale: 1,
    range: simulationRangeOf(settings.simulationRange ?? null),
    water: null,
    surface: null,
    error: null,
    watcher: null,
  }
  return state
}

/** The surface clocked at the simulation's time: still without a session, as the worker's. */
const clocked = (s: PhysicsState) =>
  s.water ? s.surface!.setTime(s.session?.waterTime() ?? 0) : null

function clock(s: PhysicsState) {
  s.session?.setClock(s.paused, s.timeScale)
  s.invalidate()
}

const setGravity = ({ gravity }: PhysicsState, g: GravityInput) =>
  typeof g === 'string' ? gravity.set(0, -GRAVITY_PRESETS[g], 0) : gravity.set(g.x, g.y, g.z)

function failed(s: PhysicsState, cause: EngineError, fatal = false) {
  s.error = cause
  console.error(cause)
  // The simulation stopped: its session ends and sends nothing more; `enabled` reads false.
  if (fatal) enable(s, false)
}

/** The session's code is a family on demand (`../host/families.ts`): a world without physics
 *  loads none of it; one that could not load is `FAMILY_LOAD_FAILED`, asked again next time. */
const start = (s: PhysicsState) =>
  families.physics.load().then(
    ({ createPhysicsSession }) => {
      if (!s.wanted || s.session) return
      const frozen = Object.freeze({ ...s.budget }) // sizes the session's arrays for its life
      const session = createPhysicsSession(
        s.root,
        frozen,
        s.invalidate,
        (cause: EngineError, fatal?: boolean) => failed(s, cause, fatal),
        s.joints,
      )
      s.session = session
      session.writer.gravity(s.gravity.elements)
      if (s.water) session.setWater(s.water)
      clock(s)
      s.watcher?.()
    },
    (cause: EngineError) => failed(s, cause, true),
  )

function enable(s: PhysicsState, on: boolean) {
  if (on === s.wanted) return
  s.wanted = on
  if (on) void start(s)
  else {
    s.session?.dispose()
    s.session = null
    s.watcher?.()
  }
  s.invalidate()
}

/** The handle's simulation controls: whether bodies are simulated, gravity and the clock. */
const simulationControls = (s: PhysicsState) => ({
  /** Whether bodies are simulated. Turning it on fetches the physics the first time.
   *  @defaultValue false, or true with `createWorld(…, { physics })` */
  get enabled() {
    return s.wanted
  },
  set enabled(on: boolean) {
    enable(s, on)
  },
  /** Gravity in m/s², a live vector; set a preset (`'earth'`, `'moon'`, `'mars'`, `'none'`)
   *  or a vector. @defaultValue 'earth' (0, −9.81, 0) */
  get gravity(): Vector3 {
    return s.gravity
  },
  set gravity(g: GravityInput) {
    setGravity(s, g)
  },
  /** Whether time stands still; writes still reach the bodies. @defaultValue false */
  get paused() {
    return s.paused
  },
  set paused(on: boolean) {
    s.paused = on
    clock(s)
  },
  /** Simulated seconds per real second: 0.25 is slow motion, 0 stands still like `paused`.
   *  @defaultValue 1 */
  get timeScale() {
    return s.timeScale
  },
  set timeScale(scale: number) {
    if (!(scale >= 0 && scale < Infinity))
      throw new RangeError(`physics.timeScale must be a finite number ≥ 0, not ${scale}.`)
    s.timeScale = scale
    clock(s)
  },
})

/** The handle's world: the simulated range, the water, the counts and the last error. */
function worldControls(s: PhysicsState) {
  const stopped = emptyPhysicsStats()
  return {
    /** Metres around the camera within which bodies are simulated (frozen past it, as they were,
     *  and no collision tile fetched); `null` follows `camera.far`. @defaultValue null */
    get simulationRange(): number | null {
      return s.range
    },
    set simulationRange(metres: number | null) {
      s.range = simulationRangeOf(metres)
      s.invalidate()
    },
    /** The water the bodies float in: its level, its waves, its density and drags. A body
     *  lighter than the water floats, pushed by the weight of the water it displaces.
     *  @defaultValue null (no water) */
    get water(): WaterSpec | null {
      return s.water
    },
    set water(spec: WaterSpec | null) {
      // Resolved here once, so a wrong wave throws on the page, not in the worker. The surface is
      // the same one set again: what holds it (`mesh.waves`) is carried by the new waves.
      if (spec) s.surface = s.surface?._declare(spec) ?? new WaterSurface(spec)
      s.water = spec
      s.carry.water()
      s.session?.setWater(spec)
      s.invalidate()
    },
    /** The water's surface at the simulation's time: the waves buoyancy reads, the same numbers
     *  (`height`, `point`, `normal`). A mesh that lies on its rest plane, or whose `mesh.waves` is
     *  this surface, is drawn carried by it, on the GPU. @defaultValue null (no water) */
    get waterSurface(): WaterSurface | null {
      return clocked(s)
    },
    /** Counts and both clocks: worker milliseconds per step, page milliseconds per frame. */
    get stats(): Readonly<PhysicsStats> {
      return s.session?.stats ?? stopped
    },
    /** The last error the physics raised (`PHYSICS_BUDGET`, `PHYSICS_NESTED`, `PHYSICS_FAILED`,
     *  `PHYSICS_DIVERGED`, `RESOURCE_HTTP_ERROR`, `FAMILY_LOAD_FAILED`), or `null`. One that stopped the simulation turns `enabled` off. */
    get error() {
      return s.error
    },
  }
}

/** `target` with `source`'s properties, its accessors kept as accessors. */
const joined = <A extends object, B extends object>(target: A, source: B) =>
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) as A & B

/** Hears the scene's changes for the session; without water, nothing is carried: a change is no
 *  mesh to read again. */
function linkPhysics(s: PhysicsState) {
  const hear = (node: Object3D) => s.water && s.carry.heard(node)
  s.root._link = physicsLink(s.root._link, {
    structure: (node) => (hear(node), s.session?.structure()),
    content: (node) => (hear(node), s.session?.content(node)),
    pose: (node) => (hear(node), s.session?.pose(node)),
  })
}

/** Runs the frame's physics, timed into the `physics` CPU stage of `engine`, then clocks the
 *  water's surface and finds the meshes it carries (`waterCarry.ts`); returns whether a body is
 *  still on its way, or waves still move a mesh that holds the surface. */
function physicsFrame(
  s: PhysicsState,
  camera: Camera,
  engine: Pick<Engine, 'cpuStep'> | undefined,
) {
  const { session } = s
  let moving = false
  if (session) {
    const start = performance.now()
    moving = session.frame(camera, s.range)
    // The frame's own work, plus the ticks received since the last one (`session.frame`).
    session.stats.mainMs += performance.now() - start
    engine?.cpuStep('physicsMs', session.stats.mainMs)
  }
  const drawn = clocked(s),
    held = s.carry.frame(drawn)
  return moving || (held && !!session && !s.paused && s.timeScale > 0 && drawn!.crest > 0)
}

/**
 * The world's physics, `world.physics`: off until enabled, and then the physics engine in a worker. The
 * worker and its WebAssembly are fetched on first use; bodies set before are queued. Every body
 * is an ordinary mesh with `physics` set (`mesh.physics`).
 */
export function createWorldPhysics(
  runtime: {
    invalidate(): void
    /** The session drawing now: its engine takes the physics step's CPU bound. */
    readonly explorer: { readonly engine: Pick<Engine, 'cpuStep'> } | null
  },
  root: Object3D,
  camera: () => Camera,
  options: boolean | WorldPhysicsOptions = false,
) {
  const settings = typeof options === 'object' ? options : {}
  const s = physicsState(() => runtime.invalidate(), root, settings)
  listen(s.gravity, () => {
    s.session?.writer.gravity(s.gravity.elements)
    s.invalidate()
  })
  const handle = joined(joined({ ...s.joints.methods }, simulationControls(s)), worldControls(s))
  setGravity(s, settings.gravity ?? 'earth')
  if (options) handle.enabled = true
  linkPhysics(s)
  return {
    handle,
    /** The fixed envelopes, `world.budget.physics`: read once when the physics starts. */
    budget: s.budget,
    /** Sets the frame's time, `seconds` of the world's time after the last frame
     *  (`FrameInfo.delta`), at its start: what the frame draws reads it (`worldFrames.ts`). */
    time(seconds: number) {
      s.session?.time(seconds)
    },
    /** Runs the frame's physics (`physicsFrame`): whether a body is still on its way, or waves
     *  still move a mesh that holds the surface. */
    frame: () => physicsFrame(s, camera(), runtime.explorer?.engine),
    /** The character's body in the running session, for `world.controls`; `watch` is told
     *  each time a session starts or ends. */
    character: {
      body: () => s.session?.characterBody ?? null,
      watch(listener: () => void) {
        s.watcher = listener
      },
    },
    dispose: () => (handle.enabled = false),
    /** The running session, for the queries asked of it (`physicsRaycast`). */
    session: () => s.session,
  }
}

/** `world.physics`. */
export type WorldPhysics = ReturnType<typeof createWorldPhysics>['handle']
