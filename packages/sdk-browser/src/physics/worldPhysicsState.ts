/**
 * The world's physics state (`worldPhysics.ts`): its scene and envelopes, its gravity, clock and
 * water, and the session's life — fetched on enable, ended on disable or on a fatal error.
 */
import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { WaterSpec } from '../../../sdk-core/src/fluids/buoyancy.ts'
import type { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'
import { GRAVITY_PRESETS, physicsBudgetOf } from '../../../sdk-core/src/physics/options.ts'
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { families } from '../host/families.ts'
import { createJointList } from './jointList.ts'
import { createWaterCarry } from './waterCarry.ts'
import type { PhysicsSession } from './session/session.ts'
import {
  simulationRangeOf,
  type GravityInput,
  type WorldPhysicsOptions,
} from './worldPhysicsOptions.ts'
import { log } from '../diagnostic/log.ts'

/** What the world's physics holds: its scene and envelopes, its gravity, joints and carried
 *  meshes, the session running — if any — and what the handle set. */
export type PhysicsState = {
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

export function physicsState(
  invalidate: () => void,
  root: Object3D,
  settings: WorldPhysicsOptions,
) {
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
export const clocked = (s: PhysicsState) =>
  s.water ? s.surface!.setTime(s.session?.waterTime() ?? 0) : null

export function clock(s: PhysicsState) {
  s.session?.setClock(s.paused, s.timeScale)
  s.invalidate()
}

export const setGravity = ({ gravity }: PhysicsState, g: GravityInput) =>
  typeof g === 'string' ? gravity.set(0, -GRAVITY_PRESETS[g], 0) : gravity.set(g.x, g.y, g.z)

function failed(s: PhysicsState, cause: EngineError, fatal = false) {
  s.error = cause
  log.error('physics failed', cause)
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

export function enable(s: PhysicsState, on: boolean) {
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
