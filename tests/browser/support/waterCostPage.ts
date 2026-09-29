// Runs only when invoked by the measurer. No engine optimization or pass timing reconstruction.
import type {
  BackendDiagnostic,
  BackendFactory,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import { summarize } from '../../../packages/sdk-core/src/runtime/stats.ts';
import { colorBytesPerSample } from '../../../packages/sdk-browser/src/gpu/core/colorBytes.ts';
import { waterSurfaceTargets } from '../../../packages/sdk-browser/src/webgpu/water/pipelines.ts';
import { engine, releaseScene } from './sharedSceneProof.ts';
import {
  BACKGROUND,
  SIZE,
  waterCostScene,
  waterCostCamera,
  poseWaterCost,
  projectedFraction,
  tileHalfWidthPixels,
} from './waterCostScene.ts';

export interface WaterCostOptions {
  fraction: number;
  enabled: boolean;
  moving: boolean;
  frames: number;
  warmup: number;
}

// The colour bytes per sample the water surface stage writes, from its own targets.
export const WATER_ATTACHMENT_BYTES = colorBytesPerSample(
  waterSurfaceTargets(true).map((target) => target.format),
);

export async function run(factory: BackendFactory, options: WaterCostOptions) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { unavailable: 'no WebGPU adapter' };
  if (!adapter.features.has('timestamp-query'))
    return { unavailable: 'timestamp-query unavailable' };
  if (adapter.limits.maxColorAttachmentBytesPerSample < WATER_ATTACHMENT_BYTES)
    return {
      unavailable: `water requires ${WATER_ATTACHMENT_BYTES} color attachment bytes per sample`,
    };
  // Ask for only the five-target requirement, not the adapter's whole attachment budget.
  const device = await adapter.requestDevice({
    requiredFeatures: ['timestamp-query'],
    requiredLimits: {
      maxColorAttachmentBytesPerSample: WATER_ATTACHMENT_BYTES,
    },
  });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const scene = waterCostScene(options.fraction, options.enabled);
  const diagnostics: BackendDiagnostic[] = [];
  const { backend, canvas } = engine(
    factory,
    scene,
    device,
    (e) => {
      if (/failed|unavailable|status|lost|refused/.test(e.phase)) diagnostics.push(e);
    },
    {
      viewport: [...SIZE],
      pixelRatio: () => 1,
      pixelError: 0,
      stageProfile: true,
      clearColor: BACKGROUND,
      temporalAntialiasing: false,
    },
  );
  const camera = waterCostCamera();
  const observedPassNames = new Set<string>();
  const samples: { frame: number; submittedMs: number; hostGapMs: number | null }[] = [];
  let waterPassMismatches = 0,
    invalidSamples = 0;
  let lastSample = -1,
    held = 0,
    minCoverage = 1,
    maxCoverage = 0;
  try {
    await backend.prepare();
    if (!backend.setClearColor) throw new Error('same-camera redraw API unavailable');
    for (let frame = 0; frame < options.warmup + options.frames; frame++) {
      await new Promise<number>((done) => requestAnimationFrame(done));
      const offset = poseWaterCost(camera, frame, options.moving);
      // Reassert the SAME clear colour: the public API bumps only resource revision. This
      // requests a fresh fixed-camera frame without rebuilding the scene or changing its image.
      // Applied equally to both camera regimes and both water states.
      backend.setClearColor(BACKGROUND);
      backend.render(camera);
      (backend as { cpuFrameEnd?: () => void }).cpuFrameEnd?.();
      // Like the existing anisotropy cost fixture, serialize frames, but skip image readback.
      // This host wait is outside the engine's timestamp spans; no wall-clock GPU estimate.
      await backend.flush!({ image: false });
      const metrics = backend.metrics();
      const sample = metrics.gpuPassMs;
      const fresh = sample && sample.frame !== lastSample;
      if (sample) lastSample = sample.frame;
      if (frame < options.warmup) continue;
      held += Number(metrics.frameHeld === true);
      const coverage = options.enabled ? projectedFraction(options.fraction, offset) : 0;
      minCoverage = Math.min(minCoverage, coverage);
      maxCoverage = Math.max(maxCoverage, coverage);
      if (fresh) {
        for (const pass of sample.passes) observedPassNames.add(pass.name);
        if (
          sample.truncated ||
          sample.error ||
          typeof metrics.gpuFrameMs !== 'number' ||
          typeof metrics.gpuHostGapMs !== 'number'
        )
          invalidSamples++;
        const surfaces = sample.passes.some((p) => p.name === 'Trillion3D water surfaces');
        const composite = sample.passes.some((p) => p.name === 'Trillion3D water composite');
        if (options.enabled ? !surfaces || !composite : surfaces || composite)
          waterPassMismatches++;
      }
      if (
        fresh &&
        !sample.truncated &&
        !sample.error &&
        typeof metrics.gpuFrameMs === 'number' &&
        typeof metrics.gpuHostGapMs === 'number'
      )
        samples.push({
          frame: sample.frame,
          submittedMs: metrics.gpuFrameMs,
          hostGapMs: metrics.gpuHostGapMs ?? null,
        });
    }
    return {
      options,
      requestedSize: SIZE,
      size: [canvas.width, canvas.height],
      dpr: devicePixelRatio,
      pixelError: 0,
      temporalAntialiasing: false,
      adapter: {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
      },
      browser: navigator.userAgent,
      colorAttachmentBytesPerSample: {
        adapter: adapter.limits.maxColorAttachmentBytesPerSample,
        device: device.limits.maxColorAttachmentBytesPerSample,
      },
      held,
      samples,
      waterPassMismatches,
      observedPassNames: [...observedPassNames],
      invalidSamples,
      gpuFrameMs: summarize(samples.map((s) => s.submittedMs)),
      gpuEnvelopeMs: summarize(
        samples.flatMap((s) => (s.hostGapMs === null ? [] : [s.submittedMs + s.hostGapMs])),
      ),
      gpuHostGapMs: summarize(samples.flatMap((s) => (s.hostGapMs === null ? [] : [s.hostGapMs]))),
      declaredFraction: options.enabled ? options.fraction : 0,
      projectedFraction: { min: minCoverage, max: maxCoverage },
      tileProjectedSize: [
        2 * tileHalfWidthPixels(options.fraction),
        SIZE[1] * Math.sqrt(options.fraction),
      ],
      rasterCoverage: null,
      errors,
      diagnostics,
      transparentDrawCalls: backend.metrics().transparentDrawCalls,
    };
  } finally {
    await backend.dispose();
    canvas.remove();
    releaseScene(scene);
    await device.queue.onSubmittedWorkDone();
    device.destroy();
  }
}
