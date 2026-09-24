import {
  CHARACTER_MOVE_WORDS,
  CHARACTER_WORDS,
  GROUND,
  OP,
} from '../../../sdk-core/src/physics/index.ts';
import { arc } from '../../../sdk-core/src/collision/characterMove.ts';
import {
  createDrive,
  driveAtRest,
  driveTick,
} from '../../../sdk-core/src/collision/characterDrive.ts';
import {
  RESHAPING,
  type CharacterInput,
  type CharacterSettings,
} from '../../../sdk-core/src/collision/characterSettings.ts';

/** What the page hears of the character after a tick (`PhysicsResults.character`). */
export interface CharacterReport {
  feet: [number, number, number];
  /** Metres per second relative to what the body stands on, and in the world (for drawing). */
  velocity: [number, number, number];
  motion: [number, number, number];
  grounded: boolean;
  /** The downward speed of the tick's landing, m/s; -1 when it did not land. */
  landed: number;
  /** Jumps the tick took. */
  jumps: number;
}

/**
 * THE CHARACTER IN THE PHYSICS WORKER. Each fixed step, the drive shared with the triangle
 * backend (`sdk-core/src/collision/characterDrive.ts`) turns the page's last input into the
 * velocity of the step — the speed gathered, the jump, the arc of gravity in closed form, sent as
 * the step's mean velocity so a jump reaches the same apex — and Jolt's virtual character moves
 * the capsule by it (`physics-jolt-wasm/src/character.cpp`). The state it hands back decides the
 * landings, a floor walked off, a ceiling met. The page's input reaches the next step: at most one
 * step late. A body standing still in a world at rest asks for no step at all.
 */
export function createCharacterDriver() {
  const drive = createDrive(),
    step = { dx: 0, dz: 0, jumped: false },
    input: CharacterInput = { wishX: 0, wishZ: 0, sprint: false },
    feet = new Float64Array(3),
    ground = new Float64Array(3),
    velocity = new Float64Array(3),
    motion = new Float64Array(3),
    events = { onJump: () => jumps++ },
    // The step's CHARACTER_MOVE, written in place: the worker copies it before the next.
    move = new Uint32Array(CHARACTER_MOVE_WORDS),
    moveFloats = new Float32Array(move.buffer);
  let settings: CharacterSettings | null = null,
    presses = 0,
    landed = -1,
    jumps = 0,
    settling = false,
    reported = true;

  const create = (at: ArrayLike<number>) => {
    const s = settings!,
      words = new Uint32Array(CHARACTER_WORDS),
      floats = new Float32Array(words.buffer);
    words[0] = OP.character;
    floats.set([s.capsuleRadius, s.capsuleHeight, s.maxSlope, s.stepHeight, s.mass], 1);
    floats.set([s.pushStrength, at[0], at[1], at[2]], 6);
    feet.set(at);
    [drive.grounded, drive.sinceGround, settling] = [false, Infinity, true];
    drive.velocity.fill(0);
    return words;
  };
  const still = () =>
    driveAtRest(drive, input) &&
    ground.every((v) => v === 0) &&
    drive.sinceJump > settings!.jumpBuffer;

  return {
    /** The page's body: `next` settings (null removes it), `at` its feet when it is put there.
     *  Returns the words to run before the next step, or null when nothing changes in the module. */
    configure(next: CharacterSettings | null, at: ArrayLike<number> | null) {
      const reshaped =
        !next || !settings || RESHAPING.some((name) => next[name] !== settings![name]);
      settings = next;
      if (!next) {
        // The next body counts its jump presses from zero.
        presses = 0;
        const words = new Uint32Array(CHARACTER_WORDS);
        words[0] = OP.character;
        return words;
      }
      return at || reshaped ? create(at ?? feet) : null;
    },
    /** The page's keys: the wish, sprint, and how many times jump was pressed since it began. */
    press(next: CharacterInput, pressed: number) {
      Object.assign(input, next);
      if (pressed > presses) drive.sinceJump = 0;
      presses = pressed;
    },
    /** Whether the body asks for steps: moving, wishing, a jump pending or its floor moving. */
    moving: () => settings !== null && !still(),
    /** The CHARACTER_MOVE of a step of `h` seconds, or null when the body is still and nothing
     *  else moves (`awake` false). */
    command(h: number, awake: boolean): Uint32Array | null {
      if (!settings) return null;
      const moves = driveTick(drive, settings, input, h, true, events, step);
      if (!moves && !awake && still()) return null;
      const v = drive.velocity;
      // A jump leaves with the floor's velocity: momentum from a platform is kept in the air.
      if (step.jumped) for (let k = 0; k < 3; k++) v[k] += ground[k];
      const carried = drive.grounded ? ground : null;
      let vy = carried ? carried[1] : v[1];
      if (!drive.grounded) {
        const [dy, end] = arc(v[1], h, settings.gravity, settings.fallGravity);
        [vy, v[1]] = [dy / h, end];
      }
      move[0] = OP.characterMove;
      moveFloats[1] = (moves ? step.dx / h : 0) + (carried?.[0] ?? (step.jumped ? ground[0] : 0));
      moveFloats[2] = vy;
      moveFloats[3] = (moves ? step.dz / h : 0) + (carried?.[2] ?? (step.jumped ? ground[2] : 0));
      move[4] = drive.grounded ? 1 : 0;
      return move;
    },
    /** Reads the module's state after a step of `h` seconds (`jolt_character`). */
    read(state: Float32Array, h: number) {
      if (!settings || !state[0]) return;
      const floor = state[4] === GROUND.floor;
      for (let k = 0; k < 3; k++) {
        motion[k] = h > 0 ? (state[1 + k] - feet[k]) / h : 0;
        velocity[k] = motion[k] - (drive.grounded ? ground[k] : 0);
      }
      feet.set(state.subarray(1, 4));
      const v = drive.velocity;
      if (!drive.grounded && floor && v[1] <= 0) {
        // Landed: the velocity is the floor's own from now on.
        if (!settling) landed = Math.max(landed, -v[1]);
        [drive.grounded, v[1], settling] = [true, 0, false];
        for (let k = 0; k < 3; k += 2) v[k] -= state[5 + k];
      } else if (drive.grounded && !floor) {
        // Walked off: the floor's velocity carries the body into the air.
        drive.grounded = false;
        for (let k = 0; k < 3; k++) v[k] += ground[k];
      } else if (!drive.grounded && h > 0) v[1] = Math.min(v[1], motion[1]);
      ground.set(state.subarray(5, 8));
      reported = false;
    },
    /** What the page hears after a tick, once per state read; null when nothing new. */
    report(): CharacterReport | null {
      if (!settings || reported) return null;
      reported = true;
      const out: CharacterReport = {
        feet: [feet[0], feet[1], feet[2]],
        velocity: [velocity[0], velocity[1], velocity[2]],
        motion: [motion[0], motion[1], motion[2]],
        grounded: drive.grounded,
        landed,
        jumps,
      };
      [landed, jumps] = [-1, 0];
      return out;
    },
  };
}
