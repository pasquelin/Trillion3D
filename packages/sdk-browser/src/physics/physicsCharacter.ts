import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import type { CharacterBody } from '../../../sdk-core/src/collision/characterBody.ts';
import {
  HUMAN_BODY,
  type CharacterEvents,
  type CharacterInput,
  type CharacterSettings,
} from '../../../sdk-core/src/collision/characterSettings.ts';
import type { CharacterReport } from './characterDriver.ts';
import type { ToPhysics } from './protocol.ts';

/** The session's end of the character (`PhysicsSession.character`). */
export interface CharacterPort {
  send(message: ToPhysics): void;
  hear: ((report: CharacterReport) => void) | null;
}

const NAMES = Object.keys(HUMAN_BODY) as (keyof CharacterSettings)[];

/**
 * A CHARACTER WHOSE BODY IS JOLT'S, in the world's physics worker (`characterDriver.ts`): the
 * same `CharacterBody` the controller drives, with the same settings, but the capsule meets every
 * body of the simulation — it climbs steps and slopes, rides what it stands on, pushes crates with
 * `pushStrength` and is pushed back. The page sends its keys when they change and draws the feet
 * the worker last reported, moved on by their velocity for the time since — never more than one
 * step ahead — so the drawn body is neither late nor jumping between reports.
 */
export function createPhysicsCharacter(
  port: CharacterPort,
  settings: CharacterSettings,
): CharacterBody {
  const feet = new Float64Array(3),
    velocity = new Float64Array(3),
    motion = new Float64Array(3),
    drawn = new Float64Array(3),
    sent: Partial<CharacterSettings> = {},
    keys: CharacterInput = { wishX: 0, wishZ: 0, sprint: false };
  let grounded = false,
    heard = 0,
    presses = 0,
    landed = -1,
    jumps = 0;
  /** The settings as numbers, copied: what the worker is told. */
  const current = () => {
    const out = {} as CharacterSettings;
    for (const name of NAMES) out[name] = settings[name];
    return out;
  };
  const changed = () => NAMES.some((name) => sent[name] !== settings[name]);
  const configure = (at: number[] | null) => {
    const next = current();
    Object.assign(sent, next);
    port.send({ type: 'character', settings: next, feet: at });
  };
  port.hear = (report) => {
    feet.set(report.feet);
    velocity.set(report.velocity);
    motion.set(report.motion);
    grounded = report.grounded;
    landed = Math.max(landed, report.landed);
    jumps += report.jumps;
    heard = performance.now();
  };
  return {
    feet,
    velocity,
    get onGround() {
      return grounded;
    },
    place(x, y, z) {
      [feet[0], feet[1], feet[2]] = [x, y, z];
      velocity.fill(0);
      motion.fill(0);
      configure([x, y, z]);
    },
    pressJump() {
      port.send({ type: 'input', input: { ...keys }, jumps: ++presses });
    },
    advance(_delta, input, events: CharacterEvents = {}) {
      if (changed()) configure(null);
      if (
        input.wishX !== keys.wishX ||
        input.wishZ !== keys.wishZ ||
        input.sprint !== keys.sprint
      ) {
        Object.assign(keys, input);
        port.send({ type: 'input', input: { ...keys }, jumps: presses });
      }
      for (; jumps > 0; jumps--) events.onJump?.();
      if (landed >= 0) events.onLand?.(landed);
      landed = -1;
      const ahead = Math.min(Math.max(0, (performance.now() - heard) / 1000), PHYSICS_STEP);
      for (let k = 0; k < 3; k++) drawn[k] = feet[k] + motion[k] * ahead;
      return drawn;
    },
    dispose() {
      port.hear = null;
      port.send({ type: 'character', settings: null, feet: null });
    },
  };
}
