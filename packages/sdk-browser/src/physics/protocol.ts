import {
  EVENT_WORDS,
  MAX_CATCH_UP_STEPS,
  PHYSICS_LAYOUT_VERSION,
  POSE_WORDS,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { JoltThreadStart } from './joltThreads.ts';

/** Version of the page ↔ worker messages below and of the word layouts they carry. */
export const PHYSICS_PROTOCOL = PHYSICS_LAYOUT_VERSION;

/** What the page tells the physics worker. */
export type ToPhysics =
  | {
      type: 'start';
      protocol: number;
      /** URL of `joltPhysics.wasm`, or of `joltPhysicsThreads.wasm` when `threads` is above 1. */
      wasm: string;
      budget: PhysicsBudget;
      /** Threads that step the module, the worker's included (`budget.threads`, capped). */
      threads: number;
      /** Two result buffers, exchanged back and forth. */
      buffers: ArrayBuffer[];
    }
  /** A frame's commands, applied before the next step. */
  | { type: 'commands'; words: Uint32Array }
  /** The clock: `timeScale` is above 0 unless `paused` (the page sends a scale of 0 as a pause). */
  | { type: 'clock'; paused: boolean; timeScale: number }
  /** A result buffer the page has read, handed back. */
  | { type: 'buffer'; buffer: ArrayBuffer }
  /** Sent by the worker to a worker of its own: run one of the module's threads. */
  | JoltThreadStart;

/** One tick's results: the poses and events of every step it took, in one buffer. */
export interface PhysicsResults {
  type: 'results';
  buffer: ArrayBuffer;
  /** Pose records from the buffer's start, event records from `eventsAt` (`layout.ts`). */
  poses: number;
  events: number;
  /** Enters dropped past `budget.contactEvents` in one step. */
  dropped: number;
  /** Fixed steps taken, and the simulated seconds they cover. */
  steps: number;
  seconds: number;
  /** Worker milliseconds spent in the module during this tick: its own clock, never the page's. */
  stepMs: number;
  /** Bodies awake after the tick. */
  active: number;
}

/**
 * What the physics worker tells the page. An error names a code (`PHYSICS_BUDGET`,
 * `PHYSICS_FAILED`); a fatal one stopped the simulation, and one with `bodies` refused those
 * bodies alone (their engine ids).
 */
export type FromPhysics =
  | { type: 'ready' }
  | PhysicsResults
  | { type: 'error'; code: string; message: string; fatal: boolean; bodies?: number[] };

/** Word where a result buffer's events start: after one pose per body. */
export const eventsAt = (budget: PhysicsBudget) => budget.bodies * POSE_WORDS;

/**
 * Words of one result buffer: every body's pose once, then the events of the most steps a tick
 * takes. A tick writes one pose per body at most (a later step overwrites an earlier one), and
 * steps no more once the next step's events might not fit: nothing is ever cut.
 */
export const resultWords = (budget: PhysicsBudget) =>
  eventsAt(budget) + budget.contactEvents * MAX_CATCH_UP_STEPS * EVENT_WORDS;

/** What the world's physics reports: counts from the last tick, and both clocks apart. */
export interface PhysicsStats {
  /** Bodies the simulation holds. */ bodies: number;
  /** Bodies awake after the last tick. */ active: number;
  /** Worker milliseconds per fixed step, last tick: the worker's clock, never added to the page's. */
  stepMs: number;
  /** Page milliseconds the physics took in the last frame (the `physics` CPU stage). */
  mainMs: number;
  /** Poses the last tick sent back. */ poses: number;
  /** Contact events the last tick sent back. */ events: number;
  /** `enter` events dropped since the physics started, past `budget.physics.contactEvents` in
   *  one step (their `leave` is never sent). */
  droppedEvents: number;
}

/** The stats of a world whose physics holds nothing yet. */
export const emptyPhysicsStats = (): PhysicsStats => ({
  bodies: 0,
  active: 0,
  stepMs: 0,
  mainMs: 0,
  poses: 0,
  events: 0,
  droppedEvents: 0,
});
