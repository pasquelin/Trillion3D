/**
 * The engine's CPU clock, the one every stopwatch reads: a step of the image, a job, a load or a
 * diagnostic takes `cpuNow()` when it starts and `msSince` of it when it ends. A host or a test
 * that hands its own clock (`createFrameBudget`, the tile streamer) keeps it.
 */

/** Now on the CPU clock, ms. */
export const cpuNow = () => performance.now()

/** Ms elapsed since `started`, a `cpuNow()`. */
export const msSince = (started: number) => performance.now() - started
