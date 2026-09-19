import { disabledStageProfile, type StageProfile } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { EngineProfiler, TelemetryReport } from './telemetry.ts';

export function createExplorerTelemetryApi(profiler: EngineProfiler, active: () => RenderBackend) {
  return {
    profiler,
    getReport(): TelemetryReport {
      return profiler.getReport();
    },
    /**
     * Per-step profile of the active engine: one row per step, p50 and p95, CPU duration and
     * GPU duration kept separate and never added. "Unmeasured" is `null`, never `0`.
     * Empty as long as `stageProfile: true` was not requested of `createExplorer`.
     */
    stageProfile(): StageProfile {
      const backend = active();
      return (
        backend.stageProfile?.() ??
        disabledStageProfile(backend.id, 'this engine does not time its steps')
      );
    },
    /**
     * Shadow-atlas fingerprint of the active engine, bit for bit, or `null` when it holds none.
     * Two runs of the same scene — one redrawing whole faces, the other only invalidated
     * pages — must yield the same fingerprint once the queue is empty.
     */
    shadowAtlasDigest() {
      return active().shadowAtlasDigest?.() ?? Promise.resolve(null);
    },
    /**
     * What the GPU partition of the active engine wrote for the last frame, with the world
     * corners and the matrices it drew it from, or `null` when the engine holds none. Redoing
     * the reference compute on those inputs proves, cluster by cluster, that the GPU screen
     * rectangle contains the reference's and that its depth underestimates the reference's.
     */
    partitionAudit() {
      return active().partitionAudit?.() ?? Promise.resolve(null);
    },
    /** Transparent clusters the occlusion test rejected on the last frame, with their world
     *  corners and the frame depth: enough to check, cluster by cluster, that each one was
     *  entirely behind the opaque. */
    transparentOcclusionAudit() {
      return active().transparentOcclusionAudit?.() ?? Promise.resolve(null);
    },
    /** Clears the profile window of the active engine, to measure only what comes next. */
    resetStageProfile() {
      active().resetStageProfile?.();
    },
    printReport() {
      profiler.printReport();
    },
    enableAutoLog(intervalSeconds = 2) {
      return profiler.startAutoLog(intervalSeconds);
    },
    disableAutoLog() {
      profiler.stopAutoLog();
    },
  };
}
