import type { MeasuredWorld } from '../session/explorer.ts';

/** `world.stageProfile`, `world.cpuSteps` and `world.resetCpuSteps`: the open session's per-step
 *  CPU profile, read through `live` so a disposed world still throws and a session not yet open
 *  reads as unmeasured rather than missing. */
export function worldTelemetry(live: () => MeasuredWorld | null) {
  return {
    /** Per-step profile of the session's frames. */
    stageProfile: () => live()?.stageProfile() ?? null,
    /** CPU bounds of the frames since `resetCpuSteps()` (p50, p95, max per step); `null` unmeasured. */
    cpuSteps: () => live()?.cpuSteps() ?? null,
    /** Opens a new `cpuSteps()` window. */ resetCpuSteps: () => live()?.resetStageProfile(),
  };
}
