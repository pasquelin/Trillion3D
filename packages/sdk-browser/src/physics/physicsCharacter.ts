import type { CharacterBody } from '../../../sdk-core/src/collision/characterBody.ts'
import {
  HUMAN_BODY,
  type CharacterEvents,
  type CharacterInput,
  type CharacterSettings,
} from '../../../sdk-core/src/collision/characterSettings.ts'
import type { CharacterReport } from './characterDriver.ts'
import type { TickRecords, ToPhysics } from './protocol.ts'
import { createTwoSteps, eachRecord } from './twoSteps.ts'
import { lerpArray } from '../../../math/src/scalar/reals.ts'

/** The session's end of the character (`PhysicsSession.character`). */
export interface CharacterPort {
  send(message: ToPhysics): void
  /** Each tick of `steps` fixed steps: its report (`null` when the character did not step) and
   *  its feet (`PhysicsResults.feet`). */
  hear: ((report: CharacterReport | null, feet: TickRecords | null, steps: number) => void) | null
  /** The fraction of a step the frame's time stands at, as the session draws everything at it
   *  (`along`). */
  at(): number
}

/**
 * The session's end of the character: what the body sends before the world's first commands have
 * gone is held until they have (`flush`), so the worker never steps a body before the world it
 * stands in; from then on it is sent at once, the keys included, whenever the page reads them.
 * `at` is the session's reading of the frame's time.
 */
export function createCharacterPort(post: (message: ToPhysics) => void, at: () => number) {
  const held: ToPhysics[] = []
  let open = false
  return {
    send: (message: ToPhysics) => (open ? post(message) : void held.push(message)),
    hear: null as CharacterPort['hear'],
    at,
    flush() {
      open = true
      held.splice(0).forEach(post)
    },
  }
}

const NAMES = Object.keys(HUMAN_BODY) as (keyof CharacterSettings)[]

/**
 * A CHARACTER WHOSE BODY IS THE MODULE'S, in the world's physics worker (`characterDriver.ts`): the
 * same `CharacterBody` the controller drives, with the same settings, but the capsule meets every
 * body of the simulation — it climbs steps and slopes, rides what it stands on, pushes crates with
 * `pushStrength` and is pushed back. The page sends its keys when they change and draws the feet
 * as the bodies are drawn, between their two states (`twoSteps.ts`) at the frame's time (`at`):
 * the eye that follows it follows the simulated trajectory, never a clock of its own.
 */
export function createPhysicsCharacter(
  port: CharacterPort,
  settings: CharacterSettings,
): CharacterBody {
  /** The newest feet, and their two states (`twoSteps.ts`) one key holds. */
  const feet = new Float64Array(3),
    states = { from: new Float64Array(3), to: new Float64Array(3) },
    { from, to } = states,
    steps2 = createTwoSteps(1),
    velocity = new Float64Array(3),
    drawn = new Float64Array(3),
    sent: Partial<CharacterSettings> = {},
    keys: CharacterInput = { wishX: 0, wishZ: 0, sprint: false }
  let grounded = false,
    presses = 0,
    landed = -1,
    jumps = 0
  /** The settings as numbers, copied: what the worker is told. */
  const current = () => {
    const out = {} as CharacterSettings
    for (const name of NAMES) out[name] = settings[name]
    return out
  }
  const changed = () => NAMES.some((name) => sent[name] !== settings[name])
  const configure = (at: number[] | null) => {
    const next = current()
    Object.assign(sent, next)
    port.send({ type: 'character', settings: next, feet: at })
  }
  port.hear = (report, records, steps) => {
    if (report) {
      velocity.set(report.velocity)
      grounded = report.grounded
      landed = Math.max(landed, report.landed)
      jumps += report.jumps
    }
    steps2.begin(steps)
    if (records)
      eachRecord(records, 2, 3, (_, newest, before) => {
        if (steps2.record(0, states, newest, before, false)) feet.set(newest)
      })
    // A stepped tick that did not move them leaves them where their last step did.
    steps2.end(() => from.set(to))
  }
  return {
    feet,
    velocity,
    get onGround() {
      return grounded
    },
    place(x, y, z) {
      ;[feet[0], feet[1], feet[2]] = [x, y, z]
      from.set(feet)
      to.set(feet)
      velocity.fill(0)
      configure([x, y, z])
    },
    pressJump() {
      port.send({ type: 'input', input: { ...keys }, jumps: ++presses })
    },
    advance(_delta, input, events: CharacterEvents = {}) {
      if (changed()) configure(null)
      if (
        input.wishX !== keys.wishX ||
        input.wishZ !== keys.wishZ ||
        input.sprint !== keys.sprint
      ) {
        Object.assign(keys, input)
        port.send({ type: 'input', input: { ...keys }, jumps: presses })
      }
      for (; jumps > 0; jumps--) events.onJump?.()
      if (landed >= 0) events.onLand?.(landed)
      landed = -1
      lerpArray(drawn, from, to, port.at())
      return drawn
    },
    dispose() {
      port.hear = null
      port.send({ type: 'character', settings: null, feet: null })
    },
  }
}
