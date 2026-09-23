/**
 * Bounds a host records itself — outside the frame they would have lengthened — and deposits on
 * the engine. They are named, never numbered: each engine slots them where it wants in its own
 * bound table, and an engine that holds none simply exposes nothing.
 */
export type HostCpuStep = 'arrivalsMs' | 'pendingMs' | 'retainMs' | 'submitMs';

/** What an engine offers the host for the per-step profile, when it holds one. */
export interface HostCpuProfile {
  cpuStep?(step: HostCpuStep, ms: number): void;
  cpuFrameEnd?(): void;
  gpuImageMs?(ms: number | null, supported: boolean, reason: string | null): void;
}
