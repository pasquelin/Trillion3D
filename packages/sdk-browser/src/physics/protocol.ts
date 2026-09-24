import {
  EVENT_WORDS,
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
      /** Two result buffers, exchanged back and forth. */ buffers: ArrayBuffer[];
    }
  /** A frame's commands, applied before the next step. */
  | { type: 'commands'; words: Uint32Array }
  | { type: 'clock'; paused: boolean; timeScale: number }
  /** A result buffer the page has read, handed back. */
  | { type: 'buffer'; buffer: ArrayBuffer }
  /** Sent by the worker to a worker of its own: run one of the module's threads. */
  | JoltThreadStart;

/** One tick's results: the poses and events of every step it took, in one buffer. */
export interface PhysicsResults {
  type: 'results';
  buffer: ArrayBuffer;
  /** Pose records, then event records (`layout.ts`). */
  poses: number;
  events: number;
  /** Fixed steps taken, and the simulated seconds they cover. */
  steps: number;
  seconds: number;
  /** Worker milliseconds spent in the module during this tick: its own clock, never the page's. */
  stepMs: number;
  /** Bodies awake after the tick. */
  active: number;
}

/** What the physics worker tells the page. */
export type FromPhysics =
  { type: 'ready' } | PhysicsResults | { type: 'error'; code: string; message: string };

/** Contact events one tick reports at most; the rest of a tick's events are dropped and counted. */
export const MAX_EVENTS = 4096;

/**
 * Bytes of one result buffer: every body's pose once, plus the events. A tick writes one pose per
 * body at most (a later step overwrites an earlier one), so it never needs more.
 */
export const resultBytes = (budget: PhysicsBudget) =>
  (budget.bodies * POSE_WORDS + MAX_EVENTS * EVENT_WORDS) * 4;

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
}
