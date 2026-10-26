import {
  characterGravity,
  HUMAN_BODY,
  type CharacterBody,
  type CharacterSettings,
} from '../../../../sdk-core/src/collision/characterSettings.ts'
import type { CharacterMode } from '../../../../sdk-core/src/collision/characterModes.ts'
import type {
  CharacterEvents,
  CharacterInput,
} from '../../../../sdk-core/src/collision/characterDrive.ts'
import type { CharacterReport } from './characterDriver.ts'
import type { TickRecords, ToPhysics } from '../protocol.ts'
import { createTwoSteps, eachRecord } from '../step/twoSteps.ts'
import { lerpArray } from '../../../../math/src/scalar/reals.ts'

/** The session's end of the character (`PhysicsSession.character`). */
export interface CharacterPort {
  send(message: ToPhysics): void
  /** Each tick of `steps` fixed steps: its report (`null` when the character did not step) and
   *  its feet (`PhysicsResults.feet`). */
  hear: ((report: CharacterReport | null, feet: TickRecords | null, steps: number) => void) | null
  /** The fraction of a step the frame's time stands at, as the session draws everything at it
   *  (`along`). */
  at(): number
  /** The world's gravity along y, m/s², live (`world.physics.gravity`). */
  gravity(): number
}

/**
 * The session's end of the character: what the body sends before the world's first commands have
 * gone is held until they have (`flush`), so the worker never steps a body before the world it
 * stands in; from then on it is sent at once, the keys included, whenever the page reads them.
 * `at` is the session's reading of the frame's time, `gravity` its reading of the world's.
 */
export function createCharacterPort(
  post: (message: ToPhysics) => void,
  at: () => number,
  gravity: () => number,
) {
  const held: ToPhysics[] = []
  let open = false
  return {
    send: (message: ToPhysics) => (open ? post(message) : void held.push(message)),
    hear: null as CharacterPort['hear'],
    at,
    gravity,
    flush() {
      open = true
      held.splice(0).forEach(post)
    },
  }
}

/** The keys one `input` message carries. */
const NAMES_OF_KEYS = ['wishX', 'wishY', 'wishZ', 'jump', 'crouch'] as const

const NAMES = Object.keys(HUMAN_BODY) as (keyof CharacterSettings)[]

/** What the body last reported, and the feet's two states (`../step/twoSteps.ts`) one key holds. */
interface View {
  feet: Float64Array
  states: { from: Float64Array; to: Float64Array }
  velocity: Float64Array
  grounded: boolean
  mode: CharacterMode
  crouched: boolean
  landed: number
  jumps: number
}

/** The settings as numbers, copied: what the worker is told. */
function settingsCopy(settings: CharacterSettings) {
  const out: Record<string, number | boolean> = {}
  for (const name of NAMES) out[name] = settings[name]
  return out as unknown as CharacterSettings
}

/** Tells the worker of the settings and the gravity when they change from what it was last told. */
function createSettingsSync(port: CharacterPort, settings: CharacterSettings) {
  const sent: Partial<CharacterSettings> = {}
  let sentGravity = NaN
  /** The downward pull the world's gravity gives the body, under its scale. */
  const gravity = () => characterGravity(port.gravity(), settings.gravityScale)
  return {
    gravity,
    changed: () => NAMES.some((name) => sent[name] !== settings[name]) || sentGravity !== gravity(),
    configure(at: number[] | null) {
      const next = settingsCopy(settings)
      Object.assign(sent, next)
      sentGravity = gravity()
      port.send({ type: 'character', settings: next, gravity: sentGravity, feet: at })
    },
  }
}

/** Sends the keys when `input` changes them from what the worker last heard. */
function sendKeys(
  port: CharacterPort,
  keys: Required<CharacterInput>,
  input: CharacterInput,
  presses: number,
) {
  const next = { wishY: 0, jump: false, crouch: false, ...input }
  if (NAMES_OF_KEYS.some((name) => next[name] !== keys[name])) {
    Object.assign(keys, next)
    port.send({ type: 'input', input: { ...keys }, jumps: presses })
  }
}

/** Takes in a tick's report and the feet its steps reached. */
function hearTick(
  view: View,
  steps2: ReturnType<typeof createTwoSteps>,
  report: CharacterReport | null,
  records: TickRecords | null,
  steps: number,
) {
  if (report) {
    view.velocity.set(report.velocity)
    view.grounded = report.grounded
    view.mode = report.mode
    view.crouched = report.crouched
    view.landed = Math.max(view.landed, report.landed)
    view.jumps += report.jumps
  }
  steps2.begin(steps)
  if (records)
    eachRecord(records, 2, 3, (_, newest, before) => {
      if (steps2.record(0, view.states, newest, before, false)) view.feet.set(newest)
    })
  // A stepped tick that did not move them leaves them where their last step did.
  steps2.end(() => view.states.from.set(view.states.to))
}

/** Tells the page of the jumps and the landing the reports held. */
function fireEvents(view: View, events: CharacterEvents) {
  for (; view.jumps > 0; view.jumps--) events.onJump?.()
  if (view.landed >= 0) events.onLand?.(view.landed)
  view.landed = -1
}

/**
 * A CHARACTER WHOSE BODY IS THE MODULE'S, in the world's physics worker (`characterDriver.ts`): the
 * same `CharacterBody` the controller drives, with the same settings, but the capsule meets every
 * body of the simulation — it climbs steps and slopes, rides what it stands on, pushes crates with
 * `pushStrength` and is pushed back. The page sends its keys when they change and draws the feet
 * as the bodies are drawn, between their two states (`../step/twoSteps.ts`) at the frame's time (`at`):
 * the eye that follows it follows the simulated trajectory, never a clock of its own.
 */
export function createPhysicsCharacter(
  port: CharacterPort,
  settings: CharacterSettings,
): CharacterBody {
  const view: View = {
    feet: new Float64Array(3),
    states: { from: new Float64Array(3), to: new Float64Array(3) },
    velocity: new Float64Array(3),
    grounded: false,
    mode: 'falling',
    crouched: false,
    landed: -1,
    jumps: 0,
  }
  const { feet, velocity } = view,
    { from, to } = view.states,
    steps2 = createTwoSteps(1),
    drawn = new Float64Array(3),
    keys: Required<CharacterInput> = { wishX: 0, wishY: 0, wishZ: 0, jump: false, crouch: false }
  let presses = 0
  const { gravity, changed, configure } = createSettingsSync(port, settings)
  port.hear = (report, records, steps) => hearTick(view, steps2, report, records, steps)
  return {
    feet,
    velocity,
    get onGround() {
      return view.grounded
    },
    get mode() {
      return view.mode
    },
    get crouched() {
      return view.crouched
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
      sendKeys(port, keys, input, presses)
      fireEvents(view, events)
      lerpArray(drawn, from, to, port.at())
      return drawn
    },
    dispose() {
      port.hear = null
      port.send({ type: 'character', settings: null, gravity: gravity(), feet: null })
    },
  }
}
