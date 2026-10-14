/**
 * The engine's CPU clock, the one every stopwatch reads: a step of the image, a job, a load or a
 * diagnostic takes `cpuNow()` when it starts and `msSince` of it when it ends; the frame's
 * main-thread clock reads it too (`createFrameBudget`), unless a test hands its own.
 */

/** Now on the CPU clock, ms. */
export const cpuNow = () => performance.now()

/** Ms elapsed since `started`, a `cpuNow()`. */
export const msSince = (started: number) => performance.now() - started
