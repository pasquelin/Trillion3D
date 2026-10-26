import {
  flyTick,
  immersionOf,
  modeOf,
  swimTick,
  type CharacterMode,
} from '../../../../sdk-core/src/collision/characterModes.ts'
import {
  CHARACTER_MOVE_WORDS,
  BUILT_IN_FILTER,
  CHARACTER_WORDS,
  GROUND,
  OP,
} from '../../../../sdk-core/src/physics/layout.ts'
import {
  createDrive,
  driveAtRest,
  driveTick,
  pressJump,
  resetJump,
  type CharacterDrive,
  type CharacterInput,
  type DriveStep,
} from '../../../../sdk-core/src/collision/characterDrive.ts'
import {
  RESHAPING,
  type CharacterSettings,
} from '../../../../sdk-core/src/collision/characterSettings.ts'
import type { CharacterReport } from './characterDriver.ts'

/** Everything the character driver keeps between ticks (`createCharacterDriver`). */
export interface DriverState {
  /** The height of the water's surface over `(x, z)` now, or null with no water. */
  surface: (x: number, z: number) => number | null
  drive: CharacterDrive
  step: DriveStep
  input: Required<CharacterInput>
  wish: [number, number, number]
  feet: Float64Array
  ground: Float64Array
  velocity: Float64Array
  motion: Float64Array
  events: { onJump: () => void }
  /** The step's CHARACTER_MOVE, written in place: the worker copies it before the next. */
  move: Uint32Array
  moveFloats: Float32Array
  settings: CharacterSettings | null
  presses: number
  landed: number
  jumps: number
  settling: boolean
  reported: boolean
  mode: CharacterMode
}

/** A driver's state at rest: no body, falling, nothing to report. */
export function createDriverState(surface: DriverState['surface']): DriverState {
  const move = new Uint32Array(CHARACTER_MOVE_WORDS)
  const state: DriverState = {
    surface,
    drive: createDrive(),
    step: { dx: 0, dy: 0, dz: 0, jumped: false },
    input: { wishX: 0, wishY: 0, wishZ: 0, jump: false, crouch: false },
    wish: [0, 0, 0],
    feet: new Float64Array(3),
    ground: new Float64Array(3),
    velocity: new Float64Array(3),
    motion: new Float64Array(3),
    events: { onJump: () => void state.jumps++ },
    move,
    moveFloats: new Float32Array(move.buffer),
    settings: null,
    presses: 0,
    landed: -1,
    jumps: 0,
    settling: false,
    reported: true,
    mode: 'falling',
  }
  return state
}

/** The CHARACTER words of the module, the op alone written. */
function characterWords() {
  const words = new Uint32Array(CHARACTER_WORDS)
  words[0] = OP.character
  return words
}

/** Writes the step's CHARACTER_MOVE: the velocity it moves at, whether it walks, whether it wishes
 *  to be crouched. */
function writeMove(
  { move, moveFloats }: DriverState,
  x: number,
  y: number,
  z: number,
  walks: boolean,
  crouch: boolean,
) {
  move[0] = OP.characterMove
  moveFloats[1] = x
  moveFloats[2] = y
  moveFloats[3] = z
  move[4] = walks ? 1 : 0
  move[5] = crouch ? 1 : 0
  return move
}

/** Puts the body at `at` and returns the CHARACTER words that create it. */
function createBody(state: DriverState, at: ArrayLike<number>) {
  const { drive } = state,
    s = state.settings!,
    words = characterWords(),
    floats = new Float32Array(words.buffer)
  floats.set([s.capsuleRadius, s.capsuleHeight, s.maxSlope, s.stepHeight, s.mass], 1)
  floats.set([s.pushStrength, at[0], at[1], at[2]], 6)
  words[10] = BUILT_IN_FILTER.pawn
  floats[11] = s.canCrouch ? s.crouchedHeight : s.capsuleHeight
  words[12] = s.crouchKeepsBase ? 1 : 0
  state.feet.set(at)
  ;[drive.grounded, state.settling] = [false, true]
  resetJump(drive)
  drive.velocity.fill(0)
  drive.crouched = false
  return words
}

/** The mode of the body now: where it stands in the water, if any, and on its floor. */
function modeNow({ settings, surface, feet, drive }: DriverState): CharacterMode {
  const s = settings!
  const top = surface(feet[0], feet[2])
  const height = drive.crouched ? s.crouchedHeight : s.capsuleHeight
  return modeOf(s, top !== null && feet[1] + height / 2 < top, drive.grounded)
}

/** Whether the body asks to be crouched: allowed, the key held, on a floor or in the air. */
function crouchWish({ settings, input, mode }: DriverState) {
  return settings!.canCrouch && input.crouch && (mode === 'walking' || mode === 'falling')
}

/** Whether the body is still: nothing moves it, nothing is asked of it. */
export function isStill(state: DriverState) {
  const { mode, drive, input, ground } = state
  return (
    mode !== 'swimming' &&
    mode !== 'flying' &&
    crouchWish(state) === drive.crouched &&
    driveAtRest(drive, input) &&
    ground.every((v) => v === 0) &&
    !drive.jumpPressed
  )
}

/** The CHARACTER_MOVE of a body in a fluid: swimming or flying, its velocity in the world's frame
 *  (the floor carries nothing), the wish in three axes; it stands, never crouched. */
function fluidCommand(state: DriverState, h: number, before: CharacterMode) {
  const { drive, ground, wish, input, feet } = state,
    s = state.settings!,
    v = drive.velocity
  // Entering from a floor or the air: the body goes on with the speed it had, the floor's included.
  if (before === 'walking') for (let k = 0; k < 3; k++) v[k] += ground[k]
  drive.grounded = false
  wish[0] = input.wishX
  wish[1] = input.wishY
  wish[2] = input.wishZ
  if (state.mode === 'flying') flyTick(v, wish, s, h)
  else {
    const top = state.surface(feet[0], feet[2]) ?? feet[1]
    swimTick(v, wish, s, immersionOf(feet[1], s.capsuleHeight, top), drive.gravity, h)
  }
  return writeMove(state, v[0], v[1], v[2], false, false)
}

/** The CHARACTER_MOVE of a walking or falling step: the drive's move over the step, the floor's
 *  velocity added, and a jump leaving with it. */
function walkCommand(state: DriverState, h: number, moves: boolean) {
  const { drive, step, ground } = state
  const v = drive.velocity
  // A jump leaves with the floor's velocity: momentum from a platform is kept in the air.
  if (step.jumped) for (let k = 0; k < 3; k++) v[k] += ground[k]
  const carried = drive.grounded ? ground : null
  // The step's mean velocity: the move the drive made over the step, the floor's added.
  return writeMove(
    state,
    (moves ? step.dx / h : 0) + (carried?.[0] ?? (step.jumped ? ground[0] : 0)),
    carried ? carried[1] : moves ? step.dy / h : 0,
    (moves ? step.dz / h : 0) + (carried?.[2] ?? (step.jumped ? ground[2] : 0)),
    drive.grounded,
    crouchWish(state),
  )
}

/** The CHARACTER_MOVE of a step of `h` seconds, or null when the body is still and nothing else
 *  moves (`awake` false). */
export function commandOf(state: DriverState, h: number, awake: boolean): Uint32Array | null {
  const { settings, drive, input, step, events } = state
  if (!settings) return null
  const before = state.mode
  state.mode = modeNow(state)
  if (state.mode === 'swimming' || state.mode === 'flying') return fluidCommand(state, h, before)
  const moves = driveTick(drive, settings, input, h, events, step)
  if (!moves && !awake && isStill(state)) return null
  return walkCommand(state, h, moves)
}

/** The page's body: `next` settings (null removes it) under the downward pull `gravity` gives it,
 *  `at` its feet when it is put there. Returns the words to run before the next step, or null when
 *  nothing changes in the module. */
export function configureBody(
  state: DriverState,
  next: CharacterSettings | null,
  gravity: number,
  at: ArrayLike<number> | null,
) {
  const reshaped =
    !next || !state.settings || RESHAPING.some((name) => next[name] !== state.settings![name])
  state.settings = next
  state.drive.gravity = gravity
  if (!next) {
    // The next body counts its jump presses from zero.
    state.presses = 0
    return characterWords()
  }
  return at || reshaped ? createBody(state, at ?? state.feet) : null
}

/** The page's keys: the wish, jump held, and how many times jump was pressed since it began. */
export function pressKeys(state: DriverState, next: CharacterInput, pressed: number) {
  const { input, drive } = state
  const held = input.jump
  Object.assign(input, next)
  if (pressed > state.presses) pressJump(drive)
  // The key up forgets the jump, as the engine's stop-jumping does.
  else if (held && !input.jump) resetJump(drive)
  state.presses = pressed
}

/** Settles the body's contact with its floor after a step, from the module's state. */
function settleContact(state: DriverState, floor: boolean, h: number, body: Float32Array) {
  const { drive, motion, ground } = state
  const v = drive.velocity
  if (state.mode === 'swimming' || state.mode === 'flying') {
    // The body went where it got to: that is its velocity now.
    v.set(motion)
  } else if (!drive.grounded && floor && v[1] <= 0) {
    // Landed: the velocity is the floor's own from now on.
    if (!state.settling) state.landed = Math.max(state.landed, -v[1])
    ;[drive.grounded, v[1], state.settling] = [true, 0, false]
    resetJump(drive)
    for (let k = 0; k < 3; k += 2) v[k] -= body[5 + k]
  } else if (drive.grounded && !floor) {
    // Walked off: the floor's velocity carries the body into the air.
    drive.grounded = false
    if (!drive.jumpPressed) resetJump(drive)
    for (let k = 0; k < 3; k++) v[k] += ground[k]
  } else if (!drive.grounded && h > 0) v[1] = Math.min(v[1], motion[1])
}

/** Reads the module's state after a step of `h` seconds (`jolt_character`). */
export function readState(state: DriverState, module: Float32Array, h: number) {
  const { settings, motion, velocity, feet, drive, ground } = state
  if (!settings || !module[0]) return
  const floor = module[4] === GROUND.floor
  for (let k = 0; k < 3; k++) {
    motion[k] = h > 0 ? (module[1 + k] - feet[k]) / h : 0
    velocity[k] = motion[k] - (drive.grounded ? ground[k] : 0)
  }
  feet.set(module.subarray(1, 4))
  drive.crouched = module[8] === 1
  settleContact(state, floor, h, module)
  ground.set(module.subarray(5, 8))
  state.reported = false
}

/** What the page hears after a tick, once per state read; null when nothing new. */
export function reportOf(state: DriverState): CharacterReport | null {
  const { settings, velocity, drive } = state
  if (!settings || state.reported) return null
  state.reported = true
  const out: CharacterReport = {
    velocity: [velocity[0], velocity[1], velocity[2]],
    grounded: drive.grounded,
    mode: state.mode,
    crouched: drive.crouched,
    landed: state.landed,
    jumps: state.jumps,
  }
  ;[state.landed, state.jumps] = [-1, 0]
  return out
}
