import type { StageProfile } from '../../../sdk-core/src/runtime/stageProfile.ts'
import type { Engine } from '../session/engine/types.ts'
import type { EngineProfiler } from '../diagnostic/telemetry.ts'

export function createExplorerTelemetryApi(profiler: EngineProfiler, engine: Engine) {
  return {
    /** The session's one profiler: its report (`getReport`, `printReport`) and its log
     *  (`startAutoLog`, `stopAutoLog`). */
    profiler,
    /**
     * Per-step profile of the engine: one row per step, p50 and p95, CPU duration and GPU
     * duration kept separate and never added. "Unmeasured" is `null`, never `0`. Empty as long
     * as `stageProfile: true` was not requested of `openMeasuredWorld`.
     */
    stageProfile: (): StageProfile => engine.stageProfile(),
    /**
     * What the GPU partition of the engine wrote for the last frame, with the world corners and
     * the matrices it drew it from, or `null` when it holds none. Redoing
     * the CPU computation on those inputs proves, cluster by cluster, that the GPU screen
     * rectangle contains the CPU one and that its depth underestimates the CPU one.
     */
    partitionAudit: () => engine.partitionAudit(),
    /** Transparent clusters the occlusion test rejected on the last frame, with their world
     *  corners and the frame depth: enough to check, cluster by cluster, that each one was
     *  entirely behind the opaque. */
    transparentOcclusionAudit: () => engine.transparentOcclusionAudit(),
    /** What the main view's next image computes, and where: its cut's clusters, its shadow pages,
     *  its reflection rays, its lights and frustums, in world metres (`FrameInspection`). */
    inspectFrame: () => engine.inspectFrame(),
    /** Clears the engine's profile window, to measure only what comes next. */
    resetStageProfile: () => engine.resetStageProfile(),
    /**
     * CPU bounds of the engine over the same window: p50, p95 and max of each named bound
     * (`gateMs`, `worldMs`, `selectionDispatchMs`, …) and its worst images, read once, then
     * forgotten. `null` with none yet.
     */
    cpuSteps: () => engine.cpuSteps(),
  }
}
