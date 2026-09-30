import type { MeasuredCosts, SafetyConfig } from './safety.ts';

/** Decides on one sample, at once, with no switching period. */
export const config: SafetyConfig = {
  minimumSamples: 1,
  minimumPeriodMs: 0,
  disableRatio: 1.2,
  enableRatio: 0.8,
  consecutiveViolations: 1,
};
export const reference: MeasuredCosts = {
  contextKey: 'scene-1',
  provenance: 'measured',
  cpuMs: 10,
  gpuMs: 10,
  latencyMs: 10,
  memoryBytes: 10,
  evictionsPerSecond: 0,
};
/** The reference with every duration set to `ms`. */
export const timed = (ms: number): MeasuredCosts => ({
  ...reference,
  cpuMs: ms,
  gpuMs: ms,
  latencyMs: ms,
});
/** Half the reference's durations: beneficial under `config`. */
export const faster = timed(5);
