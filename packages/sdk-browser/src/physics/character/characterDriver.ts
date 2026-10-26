import type { CharacterMode } from '../../../../sdk-core/src/collision/characterModes.ts'
import type { CharacterInput } from '../../../../sdk-core/src/collision/characterDrive.ts'
import type { CharacterSettings } from '../../../../sdk-core/src/collision/characterSettings.ts'
import {
  commandOf,
  configureBody,
  createDriverState,
  isStill,
  pressKeys,
  readState,
  reportOf,
} from './driverState.ts'

/** What the page hears of the character after a tick (`PhysicsResults.character`). */
export interface CharacterReport {
  /** Metres per second relative to what the body stands on. Its feet come apart, as a record
   *  drawn as the bodies are (`PhysicsResults.feet`). */
  velocity: [number, number, number]
  grounded: boolean
  /** How the body moves now. */
  mode: CharacterMode
  /** Whether the capsule is the crouched one. */
  crouched: boolean
  /** The downward speed of the tick's landing, m/s; -1 when it did not land. */
  landed: number
  /** Jumps the tick took. */
  jumps: number
}

/**
 * THE CHARACTER IN THE PHYSICS WORKER. Each fixed step, the drive
 * (`sdk-core/src/collision/characterDrive.ts`) turns the page's last input into the
 * velocity of the step — the speed gathered under the movement model, the jump, the fall, sent as
 * the step's mean velocity so a jump reaches the same apex — and the module's virtual character moves
 * the capsule by it (`physics-jolt-wasm/src/character.cpp`). The state it hands back decides the
 * landings, a floor walked off and a ceiling met. The page's input reaches the next step: at most one
 * step late. A body standing still in a world at rest asks for no step at all.
 */
export function createCharacterDriver(
  /** The height of the water's surface over `(x, z)` now, or null with no water. */
  surface: (x: number, z: number) => number | null = () => null,
) {
  const state = createDriverState(surface)
  return {
    /** The page's body: `next` settings (null removes it) under the downward pull `gravity`
     *  gives it (`characterGravity`), `at` its feet when it is put there. Returns the words to
     *  run before the next step, or null when nothing changes in the module. */
    configure: (next: CharacterSettings | null, gravity: number, at: ArrayLike<number> | null) =>
      configureBody(state, next, gravity, at),
    /** The page's keys: the wish, jump held, and how many times jump was pressed since it began. */
    press: (next: CharacterInput, pressed: number) => pressKeys(state, next, pressed),
    /** Whether the body asks for steps: moving, wishing, a jump pending or its floor moving. */
    moving: () => state.settings !== null && !isStill(state),
    /** The CHARACTER_MOVE of a step of `h` seconds, or null when the body is still and nothing
     *  else moves (`awake` false). */
    command: (h: number, awake: boolean): Uint32Array | null => commandOf(state, h, awake),
    /** Reads the module's state after a step of `h` seconds (`jolt_character`). */
    read: (module: Float32Array, h: number) => readState(state, module, h),
    /** What the page hears after a tick, once per state read; null when nothing new. */
    report: (): CharacterReport | null => reportOf(state),
  }
}
