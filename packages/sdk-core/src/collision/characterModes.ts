import type { CharacterSettings } from './characterSettings.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { length3 } from '../../../math/src/vector/vector.ts'

/** The movement rules a velocity step reads: the body's push, and how braking is cut and weighed. */
export type VelocityRules = Pick<
  CharacterSettings,
  'maxAcceleration' | 'brakingFrictionFactor' | 'brakingSubStepTime'
>

/** How the body moves: on a floor, in the air, in water, or flying free of gravity. */
export type CharacterMode = 'walking' | 'falling' | 'swimming' | 'flying'

/**
 * WHAT A FLUID MOVES A BODY BY, tick by tick: the body's own acceleration toward a wish, braked by
 * the friction of the fluid and by a deceleration of its own. The same routine moves a body that
 * swims and one that flies; they differ in the numbers (`swimTick`, `flyTick`).
 */
export interface FluidMove {
  /** Per second, the share of the speed the fluid holds back. */
  friction: number
  /** Whether the fluid also slows what it carries (swimming and flying do). */
  fluid: boolean
  /** Metres per second squared a body brakes by with no wish. */
  braking: number
  /** Metres per second the wish reaches at most, before the analog scale. */
  maxSpeed: number
  /** Metres per second the weakest push still reaches, on a floor and in the air; 0 else. */
  minSpeed?: number
}

/** Speed over which a body counts as past its top speed: a one-percent tolerance on the squares. */
const OVER_SQUARED = 1.01

/** Shortest and longest sub-step braking is cut into, seconds. */
const BRAKING_STEP_RANGE = [1 / 75, 1 / 20] as const
/** Speed under which a braking body stops dead, m/s. */
const BRAKE_TO_STOP = 0.1
/** Under which a vector counts as nothing. */
const SMALL = 1e-8
/** Shortest time a step is run for, seconds. */
export const MIN_TICK = 1e-6

const length = (v: Float64Array) => length3(v[0], v[1], v[2])

/** Brakes `velocity` for `dt` seconds by `friction` and a constant `deceleration`, in sub-steps. */
function brake(
  velocity: Float64Array,
  friction: number,
  deceleration: number,
  dt: number,
  { brakingFrictionFactor, brakingSubStepTime }: VelocityRules,
) {
  const speed = length(velocity)
  if (speed === 0 || dt < MIN_TICK) return
  friction = Math.max(0, friction * Math.max(0, brakingFrictionFactor))
  deceleration = Math.max(0, deceleration)
  if (friction === 0 && deceleration === 0) return
  const old = Float64Array.from(velocity)
  const reverse = deceleration === 0 ? [0, 0, 0] : velocity.map((v) => (-deceleration * v) / speed)
  const step = clamp(brakingSubStepTime, BRAKING_STEP_RANGE[0], BRAKING_STEP_RANGE[1])
  for (let left = dt; left >= MIN_TICK;) {
    // Zero friction brakes at a constant rate: no sub-step needed.
    const slice = left > step && friction !== 0 ? Math.min(step, left * 0.5) : left
    left -= slice
    for (let k = 0; k < 3; k++) velocity[k] += (-friction * velocity[k] + reverse[k]) * slice
    // Braking never turns the body round.
    if (velocity[0] * old[0] + velocity[1] * old[1] + velocity[2] * old[2] <= 0) {
      velocity.fill(0)
      return
    }
  }
  const squared = velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2
  if (squared <= SMALL || (deceleration !== 0 && squared <= BRAKE_TO_STOP ** 2)) velocity.fill(0)
}

/**
 * Moves `velocity` one tick of `dt` seconds toward the wish `(wishX, wishY, wishZ)` (each of
 * length at most 1 together): with no wish, or over the top speed, the fluid and the body's braking
 * slow it; with a wish, friction turns the velocity toward it, the fluid holds it back, and the
 * body's acceleration (`maxAcceleration`) adds, never past the top speed (a speed already over it
 * is not raised). `control` is the share of the push the body has: a body in the air has
 * `airControl` of it, the top speed still that of the whole wish.
 */
export function stepVelocity(
  velocity: Float64Array,
  wish: readonly [number, number, number],
  move: FluidMove,
  rules: VelocityRules,
  dt: number,
  control = 1,
) {
  if (dt < MIN_TICK) return
  const friction = Math.max(0, move.friction)
  const analog = Math.min(1, length3(wish[0], wish[1], wish[2]))
  const top = Math.max(move.maxSpeed * analog, move.minSpeed ?? 0)
  const accel = wish.map((w) => w * rules.maxAcceleration * control)
  const noWish = length3(accel[0], accel[1], accel[2]) === 0
  const exceeds = (limit: number) =>
    velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2 > limit * limit * OVER_SQUARED
  const over = exceeds(top)
  if (noWish || over) {
    const before = Float64Array.from(velocity)
    brake(velocity, friction, move.braking, dt, rules)
    // Braking does not take a body that began over the top speed under it.
    if (
      over &&
      length(velocity) < top &&
      accel[0] * before[0] + accel[1] * before[1] + accel[2] * before[2] > 0
    ) {
      const scale = top / (length(before) || 1)
      for (let k = 0; k < 3; k++) velocity[k] = before[k] * scale
    }
  } else {
    // Friction turns the body toward the wish without changing its speed.
    const speed = length(velocity),
      along = length3(accel[0], accel[1], accel[2]),
      turn = Math.min(dt * friction, 1)
    for (let k = 0; k < 3; k++) velocity[k] -= (velocity[k] - (accel[k] / along) * speed) * turn
  }
  if (move.fluid) {
    const hold = 1 - Math.min(friction * dt, 1)
    for (let k = 0; k < 3; k++) velocity[k] *= hold
  }
  if (!noWish) {
    const limit = exceeds(top) ? length(velocity) : top
    for (let k = 0; k < 3; k++) velocity[k] += accel[k] * dt
    const speed = length(velocity)
    if (speed > limit) for (let k = 0; k < 3; k++) velocity[k] *= limit / speed
  }
}

/** Under this share of its height in the water, a body gets no lift from its own wish. */
const SURFACE_DEPTH = 0.65
/** The acceleration upward, m/s², a body near the surface is left: next to none. */
const UP_AT_SURFACE = 0.001
/** Share of the top swim speed above which a body rising out of the water is slowed. */
const RISE_LIMIT = 0.33

/**
 * Lives one tick of a body swimming `depth` of its height deep: the water holds it back by half its
 * fluid friction times the depth, buoyancy (the share `buoyancy · depth` of its weight) lifts it,
 * and a body coming out of the water is slowed as it rises and given almost no wish upward while
 * the surface is near. `gravity` is the pull in m/s², downward.
 */
export function swimTick(
  velocity: Float64Array,
  wish: [number, number, number],
  settings: CharacterSettings,
  depth: number,
  gravity: number,
  dt: number,
) {
  const lift = settings.buoyancy * depth
  const top = settings.swimSpeed
  if (velocity[1] > RISE_LIMIT * top && lift !== 0)
    velocity[1] = Math.max(RISE_LIMIT * top, velocity[1] * depth * depth)
  else if (depth < SURFACE_DEPTH)
    wish[1] = Math.min(UP_AT_SURFACE / settings.maxAcceleration, wish[1])
  stepVelocity(
    velocity,
    wish,
    {
      friction: 0.5 * settings.fluidFriction * depth,
      fluid: true,
      braking: settings.swimBraking,
      maxSpeed: top,
    },
    settings,
    dt,
  )
  velocity[1] -= gravity * dt * (1 - lift)
}

/** Lives one tick of a body flying: no gravity, half the fluid's friction, the wish in three axes. */
export function flyTick(
  velocity: Float64Array,
  wish: readonly [number, number, number],
  settings: CharacterSettings,
  dt: number,
) {
  stepVelocity(
    velocity,
    wish,
    {
      friction: 0.5 * settings.fluidFriction,
      fluid: true,
      braking: settings.flyBraking,
      maxSpeed: settings.flySpeed,
    },
    settings,
    dt,
  )
}

/** The mode of a body this tick: flying when it is set to, swimming in water it may swim in, else on a floor or in the air. */
export function modeOf(
  settings: Pick<CharacterSettings, 'flying' | 'canSwim'>,
  inWater: boolean,
  grounded: boolean,
): CharacterMode {
  if (settings.flying) return 'flying'
  if (inWater && settings.canSwim) return 'swimming'
  return grounded ? 'walking' : 'falling'
}

/** How deep a body of `height` standing at `feet` is in water whose surface is at `surface`, 0 to 1. */
export const immersionOf = (feet: number, height: number, surface: number) =>
  clamp((surface - feet) / height, 0, 1)
