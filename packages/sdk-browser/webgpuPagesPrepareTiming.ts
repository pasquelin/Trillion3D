import { createGpuTiming } from './gpuTiming.ts';
import { addGpuPasses } from './stageMapping.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Starts the per-pass GPU timer and reports whether the device can measure at all. */
export function prepareGpuTiming(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { timing, diag } = rt;
  const gpuTiming = createGpuTiming(gpuDevice, {
    // Le profil par étape a besoin d'assez de relevés pour un p95 honnête ; sans lui, la cadence
    // d'origine est conservée telle quelle.
    sampleEveryFrames: diag.traceEnabled ? 1 : timing.stages ? 3 : 12,
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
      timing.lastGpuHostGapMs = sample.hostGapMs;
      // Le relevé décrit une image déjà passée : il est rangé par étape sans jamais bloquer celle-ci.
      // L'enveloppe de l'image est publiée à part : sur un appareil qui fait se chevaucher les passes,
      // la somme des étapes dépasse l'image, et c'est l'enveloppe qui dit la vérité sur sa durée.
      if (timing.stages) {
        timing.stages.frameGpu((add) => addGpuPasses(timing.lastGpuPassMs, add));
        if (sample.submittedMs !== null) timing.stages.pushImageGpu(sample.submittedMs);
      }
      const phase = sample.error ? 'gpu-timing-unavailable' : 'gpu-timing',
        message = sample.error ? 'Mesure GPU indisponible' : 'Durées GPU mesurées par passe';
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
  diag.engineDiagnostic('gpu-timing-status', 'Disponibilité des mesures GPU par passe', {
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

/** Marks the backend lost on an uncaptured error or a lost device, reporting the first cause once. */
export function watchGpuDevice(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  onGpuError: (event: GPUUncapturedErrorEvent) => void,
) {
  const { run, diag } = rt;
  gpuDevice.addEventListener?.('uncapturederror', onGpuError);
  gpuDevice.lost
    .then((info) => {
      if (!run.lost)
        diag.engineDiagnostic('gpu-device-lost', 'Périphérique WebGPU perdu', {
          reason: info.reason,
          message: info.message,
        });
      run.lost = true;
    })
    .catch((error) => {
      if (!run.lost) diag.diagnosticFailure('gpu-device-lost', error);
      run.lost = true;
    });
}
