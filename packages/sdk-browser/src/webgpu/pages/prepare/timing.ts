import { createGpuTiming } from '../../../gpu/timing/timing.ts'
import { addGpuPasses, bounceGpuMs } from '../../../stage/mapping.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { createGpuLog } from './gpuLog.ts'

/** Starts the per-pass GPU timer and reports whether the device can measure at all. */
export function prepareGpuTiming(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { timing, diag } = rt
  // Trace samples every image; the per-stage profile needs enough samples for an honest p95;
  // without either, the original cadence is kept as-is. The render-scale controller reads every
  // image it can (`../../../frame/scaleControl.ts`), its bounds read at each frame: a page may ask
  // `'auto'` after the session opened.
  const sampleEveryFrames = () =>
    diag.traceEnabled || rt.scale.bounds.auto ? 1 : timing.stages ? 3 : 12
  const gpuLog = createGpuLog(gpuDevice)
  timing.logFrame = gpuLog.frame
  const gpuTiming = createGpuTiming(gpuDevice, {
    sampleEveryFrames,
    onSample: (sample) => {
      // The public metric carries the contract's fields only; the diagnostic keeps the full context.
      timing.lastGpuPassMs = {
        frame: sample.frame,
        totalMs: sample.totalMs,
        passes: sample.passes,
        truncated: sample.truncated,
        ...(sample.error ? { error: sample.error } : {}),
      }
      timing.lastGpuFrameMs = sample.submittedMs
      gpuLog(rt, sample)
      // The controller steps on an image timed whole: a pass whose pair cannot be read may lie
      // outside the span, which is then short, and the frame interval steps it as for no time.
      rt.scale.observe(
        sample.pairs.invalid > 0 ? null : sample.frameMs,
        sample.renderScale,
        sample.scaleSteered !== false,
      )
      // The bounce budget is a duration: it reads here the timer of its own stage, the per-pass
      // profile's, and corrects the next image's batch. Never an estimate.
      rt.bounce.probes?.observeGpuMs(bounceGpuMs(timing.lastGpuPassMs))
      timing.lastGpuHostGapMs = sample.hostGapMs
      timing.lastGpuIdleMs = sample.idleBetweenMs
      // The sample describes an image already past: it is filed by stage without ever blocking this one.
      // The image envelope is published separately: on a device that overlaps passes, the sum of stages
      // exceeds the image, and it is the envelope that tells the truth about its duration.
      if (timing.stages) {
        timing.stages.frameGpu((add) => addGpuPasses(timing.lastGpuPassMs, add))
        if (sample.submittedMs !== null) timing.stages.pushImageGpu(sample.submittedMs)
      }
      const phase = sample.error ? 'gpu-timing-unavailable' : 'gpu-timing',
        message = sample.error ? 'GPU timing unavailable' : 'GPU timings measured per pass'
      diag.engineDiagnostic(phase, message, sample)
      if (diag.traceEnabled)
        diag.traceDiagnostic(phase, message, () => ({
          backend: 'webgpu-page-raster',
          submission: sample.submission ?? null,
          ...sample,
        }))
    },
  })
  timing.gpuTiming = gpuTiming
  const timingStats = gpuTiming.stats()
  diag.engineDiagnostic('gpu-timing-status', 'Availability of per-pass GPU timings', {
    version: 1,
    available: gpuTiming.supported,
    reason: gpuTiming.supported ? null : 'timestamp-query-unavailable',
    method: 'timestamp-query',
    sampleEveryFrames: timingStats.sampleEveryFrames,
    maxPasses: timingStats.maxPasses,
    maxParts: timingStats.maxParts,
    maxPending: timingStats.maxPending,
    queryCount: timingStats.queryCount,
    scope: 'selection-and-render-passes',
    excludes: ['uploads and copies', 'CPU work', 'presentation latency'],
    stats: timingStats,
  })
}
