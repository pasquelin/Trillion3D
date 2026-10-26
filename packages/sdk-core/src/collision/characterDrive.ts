import type { CharacterSettings } from './characterSettings.ts'
import { MIN_TICK, stepVelocity } from './characterModes.ts'
import { GRAVITY_PRESETS } from '../physics/options.ts'

/** What the player asks for: a horizontal wish of length at most 1, and the keys. */
export interface CharacterInput {
  wishX: number
  wishZ: number
  /** The jump key held; it releases a jump kept by `jumpMaxHoldTime`. @defaultValue false */
  jump?: boolean
  /** Upward wish while swimming or flying, -1 to 1; the wish's three axes together are at most 1. @defaultValue 0 */
  wishY?: number
  /** The crouch key; it shrinks the body where `canCrouch` and the body stands on a floor or falls. @defaultValue false */
  crouch?: boolean
}

/** The moments a game answers with a sound or a shake. */
export interface CharacterEvents {
  /** Landed, `impact` being the downward speed in metres per second. */
  onLand?(impact: number): void
  /** Left the ground on a jump. */
  onJump?(): void
}

/**
 * WHAT A CHARACTER WISHES OVER ONE TICK, before it meets anything: the speed it gathers or loses,
 * the jump it takes, the fall. The virtual character of the physics worker reads it
 * (`sdk-browser/src/physics/character/characterDriver.ts`); only how the move meets the world is
 * the physics'.
 *
 * The tick is cut into sub-steps of at most `maxSimulationTimeStep` (`maxSimulationIterations` at
 * most). On a floor each sub-step moves the horizontal velocity as the movement model does
 * (`stepVelocity`): friction turns it toward the wish (`groundFriction`), the wish pushes with
 * `maxAcceleration` up to the top speed, and with no key friction and
 * `brakingDecelerationWalking` brake it. The body moves by that velocity. In the air the same step
 * runs on the sideways velocity with `fallingLateralFriction` and `brakingDecelerationFalling`,
 * the wish pushing with `airControl` of its force (boosted at a low sideways speed), then gravity
 * is added to the vertical velocity, held to `terminalVelocity`, and the body moves by the mean of
 * the velocity before and after. A sub-step that crosses the apex of a jump is cut short to end on
 * it, the rest of its time refunded, at most `maxJumpApexAttemptsPerSimulation` times a tick.
 */
export interface CharacterDrive {
  /** Metres per second, relative to what the body stands on. */
  readonly velocity: Float64Array
  /** Whether the feet are on a floor. */
  grounded: boolean
  /** The jump state: whether a press waits to be read, whether the last read jumped, the seconds
   *  the key has been held, the jumps made since the last landing and the seconds of a held jump
   *  left (`pressJump`, `resetJump`). */
  jumpPressed: boolean
  jumpWas: boolean
  jumpHeld: number
  jumpCount: number
  jumpForce: number
  /** The downward pull on the body, m/s², as last told (`characterGravity`). */
  gravity: number
  /** Whether the body is crouched, as the module last said. */
  crouched: boolean
}

/** A drive at rest on its feet, no jump pending. */
export const createDrive = (): CharacterDrive => ({
  velocity: new Float64Array(3),
  grounded: true,
  jumpPressed: false,
  jumpWas: false,
  jumpHeld: 0,
  jumpCount: 0,
  jumpForce: 0,
  gravity: GRAVITY_PRESETS.earth,
  crouched: false,
})

/** The move of one tick, metres, and whether it started with a jump. */
export interface DriveStep {
  dx: number
  dy: number
  dz: number
  jumped: boolean
}

/** Whether the drive stands on its feet with no speed and no key: a tick then moves nothing. */
export const driveAtRest = (drive: CharacterDrive, input: CharacterInput) =>
  drive.grounded &&
  input.wishX === 0 &&
  input.wishZ === 0 &&
  drive.velocity[0] === 0 &&
  drive.velocity[2] === 0

/** The wish and the velocity before a sub-step, kept between ticks: no tick allocates. */
const WISH: [number, number, number] = [0, 0, 0]
const BEFORE = new Float64Array(3)
/** Under which a vertical acceleration counts as none. */
const NEARLY_ZERO = 1e-8
/** Shortest time a jump apex may be cut a sub-step short for, seconds. */
const APEX_MINIMUM = 1e-4

/** The length of the next sub-step of `remaining` seconds, the `iteration`-th: cut at most
 *  `maxSimulationTimeStep`, in halves, the last iteration taking all that is left. */
function substepOf(remaining: number, iteration: number, settings: CharacterSettings) {
  const { maxSimulationTimeStep: longest, maxSimulationIterations: most } = settings
  const cut =
    remaining > longest && iteration < most ? Math.min(longest, remaining * 0.5) : remaining
  return Math.max(MIN_TICK, cut)
}

/** The share of the wish's push a body in the air has when its sideways speed is `sideways`. */
function airControlOf(velocity: Float64Array, settings: CharacterSettings) {
  const {
    airControl,
    airControlBoostMultiplier: boost,
    airControlBoostVelocityThreshold: low,
  } = settings
  if (airControl === 0) return 0
  const slow = velocity[0] ** 2 + velocity[2] ** 2 < low * low
  return boost > 0 && slow ? Math.min(1, boost * airControl) : airControl
}

/** Adds one sub-step of gravity `g` to the vertical velocity, held to the terminal velocity. */
function fall(velocity: Float64Array, g: number, dt: number, terminal: number) {
  velocity[1] -= g * dt
  const squared = velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2
  if (g > 0 && squared > terminal * terminal && -velocity[1] > terminal) velocity[1] = -terminal
}

/** The jump key goes down: a press waits for the next tick to read it. */
export function pressJump(drive: CharacterDrive) {
  drive.jumpPressed = true
  drive.jumpHeld = 0
}

/** The jump state forgotten: the press, the hold and the jump in force; the count too, unless the
 *  body is in the air. Also when the key goes up, and when the body lands or leaves a floor. */
export function resetJump(drive: CharacterDrive) {
  drive.jumpPressed = drive.jumpWas = false
  drive.jumpHeld = drive.jumpForce = 0
  if (drive.grounded) drive.jumpCount = 0
}

/** Whether a jump is allowed now: the body is not crouched, and under `jumpMaxCount` — a body
 *  falling with no jump made has none — or, a held jump, the key down within `jumpMaxHoldTime`. */
function jumpAllowed(drive: CharacterDrive, settings: CharacterSettings) {
  if (drive.crouched) return false
  const { jumpMaxCount: most, jumpMaxHoldTime: hold } = settings
  if (!drive.jumpWas || hold <= 0)
    return drive.jumpCount === 0 && !drive.grounded
      ? drive.jumpCount + 1 < most
      : drive.jumpCount < most
  const held = drive.jumpPressed && drive.jumpHeld < hold
  // A held jump was begun (`jumpWas`), so a count at the most still holds.
  return held && drive.jumpCount <= most
}

/** Reads the press at the start of a tick: the jump, if allowed, leaves with at least the jump
 *  speed, and counts once however long it is held. Whether a jump began. */
function checkJump(drive: CharacterDrive, settings: CharacterSettings, events: CharacterEvents) {
  if (!drive.jumpPressed) return false
  const first = drive.jumpCount === 0
  // A first jump from the air is denied: it goes straight to the second.
  if (first && !drive.grounded) drive.jumpCount++
  const jumped = jumpAllowed(drive, settings)
  let began = false
  if (jumped) {
    if (first || settings.dontFallBelowJumpZVelocityDuringJump)
      drive.velocity[1] = Math.max(drive.velocity[1], settings.jumpSpeed)
    drive.grounded = false
    if (!drive.jumpWas) {
      began = true
      drive.jumpCount++
      drive.jumpForce = settings.jumpMaxHoldTime
      events.onJump?.()
    }
  }
  drive.jumpWas = jumped
  return began
}

/** Ends a tick's read of the press: a press not held is spent, a held one counts its time. */
function clearJump(drive: CharacterDrive, settings: CharacterSettings, h: number) {
  if (drive.jumpPressed) {
    drive.jumpHeld += h
    if (drive.jumpHeld >= settings.jumpMaxHoldTime) drive.jumpPressed = false
  } else {
    drive.jumpForce = 0
    drive.jumpWas = false
  }
}

/**
 * Lives one tick of `h` seconds: reads the jump press, then moves the velocity under the movement
 * model, then spends the press. Writes the tick's move into `step`; returns false when the body is
 * still — grounded, no speed, no key — and nothing is to be done.
 */
export function driveTick(
  drive: CharacterDrive,
  settings: CharacterSettings,
  input: CharacterInput,
  h: number,
  events: CharacterEvents,
  step: DriveStep,
) {
  const velocity = drive.velocity
  step.dx = step.dy = step.dz = 0
  step.jumped = checkJump(drive, settings, events)
  const moves = !driveAtRest(drive, input)
  if (moves) {
    WISH[0] = input.wishX
    WISH[2] = input.wishZ
    const wish = WISH
    if (drive.grounded)
      walk(
        velocity,
        wish,
        drive.crouched ? settings.crouchedSpeed : settings.walkSpeed,
        settings,
        h,
        step,
      )
    else flight(drive, wish, settings, h, step)
  }
  clearJump(drive, settings, h)
  return moves
}

/** One tick on a floor: the horizontal velocity moved sub-step by sub-step, the body by it. */
function walk(
  velocity: Float64Array,
  wish: [number, number, number],
  speed: number,
  settings: CharacterSettings,
  h: number,
  step: DriveStep,
) {
  const move = {
    friction: settings.groundFriction,
    fluid: false,
    braking: settings.brakingDecelerationWalking,
    maxSpeed: speed,
    minSpeed: settings.minAnalogWalkSpeed,
  }
  velocity[1] = 0
  for (let left = h, i = 1; left >= MIN_TICK && i <= settings.maxSimulationIterations; i++) {
    const tick = substepOf(left, i, settings)
    left -= tick
    stepVelocity(velocity, wish, move, settings, tick)
    step.dx += velocity[0] * tick
    step.dz += velocity[2] * tick
  }
}

/** What a held jump left of a sub-step: the time gravity acts and whether the force ended in it. */
const FORCE = { gravityTime: 0, ending: false }

/** A held jump spends its force time in a sub-step of `tick`; gravity may skip it
 *  (`applyGravityWhileJumping`). Fills `FORCE`. */
function spendJumpForce(drive: CharacterDrive, settings: CharacterSettings, tick: number) {
  FORCE.gravityTime = tick
  FORCE.ending = false
  if (drive.jumpForce <= 0) return
  const force = Math.min(drive.jumpForce, tick)
  FORCE.gravityTime = settings.applyGravityWhileJumping ? tick : Math.max(0, tick - force)
  drive.jumpForce -= force
  if (drive.jumpForce <= 0) {
    resetJump(drive)
    FORCE.ending = true
  }
}

/** A sub-step of `tick` that crosses the apex ends on it: `velocity` is cut back to the apex and
 *  the time it reached is returned, or -1 when the sub-step is kept whole. */
function cutAtApex(velocity: Float64Array, before: Float64Array, tick: number) {
  const lift = (velocity[1] - before[1]) / tick
  const toApex = Math.abs(lift) > NEARLY_ZERO ? -before[1] / lift : -1
  if (toApex < APEX_MINIMUM || toApex >= tick) return -1
  for (let k = 0; k < 3; k++) velocity[k] = before[k] + ((velocity[k] - before[k]) / tick) * toApex
  velocity[1] = 0
  return toApex
}

/** One tick in the air: the sideways velocity moved by the movement model with the wish at
 *  `airControl`, gravity added, the body moved by the mean of the velocity before and after. */
function flight(
  drive: CharacterDrive,
  wish: [number, number, number],
  settings: CharacterSettings,
  h: number,
  step: DriveStep,
) {
  const { velocity, gravity: g } = drive
  const move = {
    friction: settings.fallingLateralFriction,
    fluid: false,
    braking: settings.brakingDecelerationFalling,
    maxSpeed: settings.walkSpeed,
    minSpeed: settings.minAnalogWalkSpeed,
  }
  const control = airControlOf(velocity, settings),
    before = BEFORE
  let iterations = 0,
    apexCuts = 0
  for (let left = h; left >= MIN_TICK && iterations < settings.maxSimulationIterations;) {
    iterations++
    let tick = substepOf(left, iterations, settings)
    left -= tick
    before.set(velocity)
    const up = velocity[1]
    velocity[1] = 0
    stepVelocity(velocity, wish, move, settings, tick, control)
    velocity[1] = up
    spendJumpForce(drive, settings, tick)
    const { gravityTime, ending } = FORCE
    fall(velocity, g, gravityTime, settings.terminalVelocity)
    // A sub-step that crosses the apex ends on it; the rest of its time is run again.
    const crossed =
      before[1] > 0 && velocity[1] <= 0 && apexCuts < settings.maxJumpApexAttemptsPerSimulation
    const toApex = crossed ? cutAtApex(velocity, before, tick) : -1
    if (toApex >= 0) {
      left += tick - toApex
      tick = toApex
      iterations--
      apexCuts++
    }
    // The time before gravity resumed went at the speed the tick began with.
    const still = ending && !settings.applyGravityWhileJumping ? Math.max(0, tick - gravityTime) : 0
    const moved = (k: number) =>
      before[k] * still + 0.5 * (before[k] + velocity[k]) * (tick - still)
    step.dx += moved(0)
    step.dy += moved(1)
    step.dz += moved(2)
  }
}
