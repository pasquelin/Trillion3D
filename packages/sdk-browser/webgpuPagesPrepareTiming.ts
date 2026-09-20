import { createGpuTiming } from './gpuTiming.ts';
import { addGpuPasses, bounceGpuMs, directLightTimings } from './stageMapping.ts';
import { PAGES_RING } from './webgpuPagesStateLights.ts';
import { markWebgpuLost } from './webgpuPagesLost.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Starts the per-pass GPU timer and reports whether the device can measure at all. */
export function prepareGpuTiming(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { timing, diag } = rt;
  // Trace samples every image; the per-stage profile needs enough samples for an honest p95;
  // without either, the original cadence is kept as-is.
  let sampleEveryFrames = 12;
  if (diag.traceEnabled) sampleEveryFrames = 1;
  else if (timing.stages) sampleEveryFrames = 3;
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
      };
      timing.lastGpuFrameMs = sample.submittedMs;
      // The bounce budget is a duration: it reads here the timer of its own stage, the per-pass
      // profile's, and corrects the next image's batch. Never an estimate.
      rt.bounce.probes?.observeGpuMs(bounceGpuMs(timing.lastGpuPassMs));
      // The shadow budget is set the same way: the measured duration of the Shadows stage, reported
      // against the pages this image had redrawn.
      rt.lights.plan.observeCost(
        directLightTimings(timing.lastGpuPassMs).gpuShadowsMs,
        rt.lights.pagesByFrame[sample.frame % PAGES_RING],
      );
      timing.lastGpuHostGapMs = sample.hostGapMs;
      // The sample describes an image already past: it is filed by stage without ever blocking this one.
      // The image envelope is published separately: on a device that overlaps passes, the sum of stages
      // exceeds the image, and it is the envelope that tells the truth about its duration.
      if (timing.stages) {
        timing.stages.frameGpu((add) => addGpuPasses(timing.lastGpuPassMs, add));
        if (sample.submittedMs !== null) timing.stages.pushImageGpu(sample.submittedMs);
      }
      const phase = sample.error ? 'gpu-timing-unavailable' : 'gpu-timing',
        message = sample.error ? 'GPU timing unavailable' : 'GPU timings measured per pass';
      diag.engineDiagnostic(phase, message, sample);
      if (diag.traceEnabled)
        diag.traceDiagnostic(phase, message, () => ({
          backend: 'webgpu-page-raster',
          submission: sample.submission ?? null,
          ...sample,
        }));
    },
  });
  timing.gpuTiming = gpuTiming;
  const timingStats = gpuTiming.stats();
  diag.engineDiagnostic('gpu-timing-status', 'Availability of per-pass GPU timings', {
    version: 1,
    available: gpuTiming.supported,
    reason: gpuTiming.supported ? null : 'timestamp-query-unavailable',
    method: 'timestamp-query',
    sampleEveryFrames: timingStats.sampleEveryFrames,
    maxPasses: timingStats.maxPasses,
    maxParts: timingStats.maxParts,
    maxPending: 1,
    queryCount: timingStats.queryCount,
    scope: 'selection-and-render-passes',
    excludes: ['uploads and copies', 'CPU work', 'presentation latency'],
    stats: timingStats,
  });
}

/** Marks the backend lost on an uncaptured error or a lost device; `markWebgpuLost` announces it once. */
export function watchGpuDevice(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  onGpuError: (event: GPUUncapturedErrorEvent) => void,
) {
  gpuDevice.addEventListener?.('uncapturederror', onGpuError);
  gpuDevice.lost
    .then((info) => markWebgpuLost(rt, { reason: info.reason, message: info.message }))
    .catch((error) => markWebgpuLost(rt, { reason: 'unknown', message: String(error) }));
}
