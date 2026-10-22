import { createGpuTiming } from '../../gpu/timing/timing.ts'
import { addGpuPasses, bounceGpuMs } from '../../diagnostic/stage/mapping.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { createGpuLog } from './gpuLog.ts'
import type { GpuTimingSample } from '../../gpu/timing/types.ts'
import { viewGroup, type WebgpuView } from '../backend/state/view.ts'

/** Trace samples every image; the per-stage profile needs enough samples for an honest p95;
 *  without either, the original cadence is kept as-is. The render-scale controller reads every
 *  image it can (`../scale/scaleControl.ts`), its bounds read at each frame: a page may ask
 *  `'auto'` after the session opened. */
const sampleEvery = (rt: WebgpuPagesRuntime) => () =>
  rt.diag.traceEnabled || rt.views.main.scale.bounds.auto ? 1 : rt.timing.profiler.stages ? 3 : 12

/** What a sample says of its image, written into the timing group of the view that drew it: the
 *  public metric carries the contract's fields only; the diagnostic keeps the full context. */
function noteSample(timing: WebgpuView['timing'], sample: GpuTimingSample) {
  timing.lastGpuPassMs = {
    frame: sample.frame,
    totalMs: sample.totalMs,
    passes: sample.passes,
    truncated: sample.truncated,
    ...(sample.error ? { error: sample.error } : {}),
  }
  timing.lastGpuFrameMs = sample.submittedMs
  timing.lastGpuHostGapMs = sample.hostGapMs
  timing.lastGpuIdleMs = sample.idleBetweenMs
}

/** The GPU milliseconds a frame spends beside its main image: each view drawn beside it
 *  (`../backend/state/persistentView.ts`), its last image's time over the frames it is drawn on. */
function besideMs(rt: WebgpuPagesRuntime) {
  let ms = 0
  for (const view of rt.views.persistent)
    ms += (viewGroup(rt, view, 'timing').lastGpuFrameMs ?? 0) / Math.max(1, view.every ?? 1)
  return ms
}

/** Starts the per-pass GPU timer and reports whether the device can measure at all. */
export function prepareGpuTiming(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { timing, diag } = rt
  const gpuLog = createGpuLog(gpuDevice)
  timing.logFrame = gpuLog.frame
  const gpuTiming = createGpuTiming(gpuDevice, {
    sampleEveryFrames: sampleEvery(rt),
    onSample: (sample) => {
      const main = viewGroup(rt, rt.views.main, 'timing')
      noteSample(main, sample)
      gpuLog(rt, sample)
      // The dynamic resolution reads the frame's GPU busy time, never the CPU's: the time the
      // submissions cover, the host gaps between them left out — a gap is the host's, no lower
      // resolution shortens it —, and the views drawn beside the main image with it, since the
      // frame's GPU time holds all of its GPU work. An image a pass's pair could not be read in
      // holds no whole time: none, as a frame with no GPU timing yet is skipped.
      const busy = sample.pairs.invalid === 0 ? sample.submittedMs : null
      rt.views.main.scale.observe(
        busy === null ? null : busy + besideMs(rt),
        sample.renderScale as number,
        sample.scaleSteered !== false,
      )
      // The bounce stage's duration, the per-pass profile's: a measure the metrics publish, never a control.
      const bounceMs = bounceGpuMs(main.lastGpuPassMs)
      if (bounceMs !== null && bounceMs > 0) rt.bounce.passMs = bounceMs
      // The sample describes an image already past: it is filed by stage without ever blocking this one.
      // The image envelope is published separately: on a device that overlaps passes, the sum of stages
      // exceeds the image, and it is the envelope that tells the truth about its duration.
      const { stages } = timing.profiler
      if (stages) {
        stages.frameGpu((add) => addGpuPasses(main.lastGpuPassMs, add))
        if (sample.submittedMs !== null) stages.pushImageGpu(sample.submittedMs)
      }
      const phase = sample.error ? 'gpu-timing-unavailable' : 'gpu-timing',
        message = sample.error ? 'GPU timing unavailable' : 'GPU timings measured per pass'
      diag.engineDiagnostic(phase, message, sample)
      if (diag.traceEnabled)
        diag.traceDiagnostic(phase, message, () => ({
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

/** The GPU timer of a view drawn beside the main one, sampled at the main one's cadence: what its
 *  images cost, its own metrics (`../io/metrics.ts`), and its share of the frame's budget
 *  (`besideMs`). None where the device times nothing. */
export function createViewGpuTiming(rt: WebgpuPagesRuntime, device: GPUDevice, view: WebgpuView) {
  if (!rt.timing.gpuTiming?.supported) return undefined
  return createGpuTiming(device, {
    sampleEveryFrames: sampleEvery(rt),
    onSample: (sample) => noteSample(viewGroup(rt, view, 'timing'), sample),
  })
}
