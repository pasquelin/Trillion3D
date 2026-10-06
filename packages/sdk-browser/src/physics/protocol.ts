import {
  ASLEEP_BIT,
  EVENT_WORDS,
  PHYSICS_LAYOUT_VERSION,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/layout.ts'
import { MAX_CATCH_UP_STEPS, type PhysicsBudget } from '../../../sdk-core/src/physics/options.ts'
import type { WaterSpec } from '../../../sdk-core/src/fluids/index.ts'
import type { JoltThreadStart } from './joltThreads.ts'
import type { CharacterReport } from './characterDriver.ts'
import type {
  CharacterInput,
  CharacterSettings,
} from '../../../sdk-core/src/collision/characterSettings.ts'

/** Version of the page ↔ worker messages below and of the word layouts they carry. */
export const PHYSICS_PROTOCOL = PHYSICS_LAYOUT_VERSION

/** What the page tells the physics worker. */
export type ToPhysics =
  | {
      type: 'start'
      protocol: number
      /** URL of `joltPhysics.wasm`, or of `joltPhysicsThreads.wasm` when `threads` is above 1. */
      wasm: string
      budget: PhysicsBudget
      /** Threads that step the module, the worker's included (`budget.threads`, capped). */
      threads: number
      /** Seconds of one fixed step: the page's clock owes them (`stepClock.ts`), the worker
       *  takes them. */
      step: number
      /** Two result buffers, exchanged back and forth. */
      buffers: ArrayBuffer[]
    }
  /** A frame's commands, applied before the next step. */
  | { type: 'commands'; words: Uint32Array<ArrayBuffer> }
  /** A frame's time: the page's clock stands `to` fixed steps from its start, `steps` of them
   *  this frame's (`stepClock.ts`); the steps before them passed while the page sent nothing, the
   *  world at rest. None, the clock standing still: the commands sent before it run in place. */
  | { type: 'advance'; to: number; steps: number }
  /** The body of water the bodies float in (`fluids/buoyancy.ts`), or none; its waves start at 0 s
   *  when the page's clock stands `at` steps from its start. */
  | { type: 'water'; water: WaterSpec | null; at: number }
  /** Scene queries (`CAST_WORDS` each), answered against the last step by a `cast` reply. */
  | { type: 'cast'; id: number; queries: Uint32Array }
  /** The world's character: its settings (`null` removes it), and its feet when it is put there. */
  | { type: 'character'; settings: CharacterSettings | null; feet: number[] | null }
  /** The character's keys, and the jump presses counted since it began. */
  | { type: 'input'; input: CharacterInput; jumps: number }
  /** A result buffer the page has read, handed back. */
  | { type: 'buffer'; buffer: ArrayBuffer }
  /** Sent by the worker to a worker of its own: run one of the module's threads. */
  | JoltThreadStart

/**
 * A tick's records of one kind (`recordTick.ts`), `id, count, …` then `count` items each: in
 * `words`, each where its last step left it; in `befores`, at the same words, a record the tick's
 * step before wrote too as that step left it, any other's id word inverted, naming none (`null`
 * when the tick wrote none twice). The page draws between the two (`twoSteps.ts`).
 */
export interface TickRecords {
  words: Uint32Array
  befores: Uint32Array | null
}

/** One tick's results: the poses and events of every step it took, in one buffer. */
export interface PhysicsResults {
  type: 'results'
  buffer: ArrayBuffer
  /** Pose records from the buffer's start, event records from `eventsAt` (`layout.ts`). */
  poses: number
  events: number
  /** Enters dropped past `budget.contactEvents` in one step. */
  dropped: number
  /** Fixed steps taken. */
  steps: number
  /** The page's step the simulation stands at after them (`advance.to`): the state its poses
   *  hold. */
  step: number
  /** Whether the world rests after them — every body asleep, no leave owed, the character
   *  still —: it steps no more until the page sends something that wakes it. */
  resting: boolean
  /** The page's messages that may wake the world the worker had run by then (commands, the
   *  character, keys): a rest the page sent more since says nothing of them. */
  heard: number
  /** Worker milliseconds spent in the module during this tick: its own clock, never the page's. */
  stepMs: number
  /** Worker milliseconds of the tick's slowest fixed step, on the same clock. */
  stepMaxMs: number
  /** Bodies awake after the tick. */
  active: number
  /** The character after the tick, when it has one and it stepped; its feet, as a record of one
   *  item of 3 words (`recordTick.ts`). */
  character: CharacterReport | null
  feet: TickRecords | null
  /** Each vehicle the tick wrote (`vehicleLayout.ts`); a parked one is not written: `null` when
   *  none. */
  vehicles: TickRecords | null
  /** The soft bodies the tick moved (`softLayout.ts`), or `null` when none moved. */
  soft: TickRecords | null
  /** Command buffers the worker ran since its last results, handed back for the page to fill
   *  again (`CommandWriter.recycle`). */
  spent: ArrayBuffer[]
}

/**
 * What the physics worker tells the page. An error names a code (`PHYSICS_BUDGET`,
 * `PHYSICS_FAILED`, `PHYSICS_DIVERGED`); a fatal one stopped the simulation, and one with `bodies`
 * refused those bodies alone (their engine ids).
 */
export type FromPhysics =
  | { type: 'ready' }
  | PhysicsResults
  /** An advance found the world at rest after the page's first `heard` waking messages: the
   *  simulation stands at `step`, and steps no more. */
  | { type: 'rest'; step: number; heard: number }
  /** The hits of a `cast` request (`HIT_WORDS` each), in its order. */
  | { type: 'cast'; id: number; hits: Uint32Array }
  /** The joints a step broke, by id (`JOINT_WORDS`): the module took them out. */
  | { type: 'broken'; joints: number[] }
  /** The soft bodies a step found diverged on amplitude — their vertices going apart at twice the
   *  speed of a fall from a hundred times their size for half a second, or spread past three times
   *  their rest size with an edge pulled past five times its length — and brought back to a good
   *  state, by engine id: they stay simulated (`soft.cpp`). */
  | { type: 'recovered'; bodies: number[] }
  | { type: 'error'; code: string; message: string; fatal: boolean; bodies?: number[] }

/** Word where a result buffer's earlier poses start: after one pose per body. Record `r` there
 *  is the pose of record `r`'s body one step before it (`tickResults.ts`). */
export const beforesAt = (budget: Pick<PhysicsBudget, 'bodies'>) => budget.bodies * POSE_WORDS

/** Whether the earlier-state word `before` beside a record whose id word is `id` holds its state a
 *  step before: one the tick met once has its id word inverted there (`~id`), naming none. A
 *  pose's sleep bit may change between the two steps. */
export const keptBefore = (id: number, before: number) => ((id ^ before) & ~ASLEEP_BIT) === 0

/** Word where a result buffer's events start: after two poses per body. */
export const eventsAt = (budget: PhysicsBudget) => 2 * beforesAt(budget)

/**
 * Words of one result buffer: every body's pose once, its pose a step before when the tick took
 * that step too, then `MAX_CATCH_UP_STEPS` steps' worth of events. A tick writes one pose per body
 * at most (a later step overwrites an earlier one), and steps no more once the next step's events
 * might not fit: nothing is ever cut.
 */
export const resultWords = (budget: PhysicsBudget) =>
  eventsAt(budget) + budget.contactEvents * MAX_CATCH_UP_STEPS * EVENT_WORDS

/** What the world's physics reports: counts from the last tick, and both clocks apart. */
export interface PhysicsStats {
  /** Bodies the simulation holds. */ bodies: number
  /** Bodies awake after the last tick. */ active: number
  /** Worker milliseconds per fixed step, last tick: the worker's clock, never added to the page's. */
  stepMs: number
  /** Worker milliseconds of the slowest fixed step of the last tick: a slow step the mean hides. */
  stepMaxMs: number
  /** Page milliseconds the physics took in the last frame (the `physics` CPU stage). */
  mainMs: number
  /** Poses the last tick sent back. */ poses: number
  /** Contact events the last tick sent back. */ events: number
  /** `enter` events dropped since the physics started, past `budget.physics.contactEvents` in
   *  one step (their `leave` is never sent). */
  droppedEvents: number
  /** Soft bodies brought back at rest to their last good state (with none, their rest shape) since
   *  the physics started, each time one diverged on amplitude; they also raise a
   *  `PHYSICS_DIVERGED` that names them and stops nothing, at most once a second. */
  softRecoveries: number
}

/** The stats of a world whose physics holds nothing yet. */
export const emptyPhysicsStats = (): PhysicsStats => ({
  bodies: 0,
  active: 0,
  stepMs: 0,
  stepMaxMs: 0,
  mainMs: 0,
  poses: 0,
  events: 0,
  droppedEvents: 0,
  softRecoveries: 0,
})
