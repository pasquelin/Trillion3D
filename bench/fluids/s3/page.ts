import type { S3Options, S3Result } from './contracts.ts';
import { canvasDimensions, validateOptions } from './matrix.ts';
import { makeEffect } from './effect.ts';
import { nextFrame, openHost, type S3Host } from './host.ts';

/** Browser entry for the existing bench runner; Chrome execution belongs to recette. */
export async function runS3Case(options: S3Options): Promise<S3Result> {
  validateOptions(options);
  const result: S3Result = {
    options,
    status: 'refused',
    refusal: null,
    renderer: null,
    device: null,
    capabilities: {},
    bytes: 0,
    steps: 0,
    splats: 0,
    dropped: 0,
    droppedSteps: 0,
    clampedSeconds: 0,
    cpuFrameMs: [],
    rafIntervalMs: [],
    gpuFrameMs: [],
    gpuTiming: {},
  };
  const dpr = devicePixelRatio;
  let width: number, height: number;
  try {
    [width, height] = canvasDimensions(options.width, options.height, dpr);
  } catch (error) {
    result.refusal = String(error);
    return result;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${options.width}px`;
  canvas.style.height = `${options.height}px`;
  document.body.append(canvas);
  let host: S3Host | undefined;
  let effect: Awaited<ReturnType<typeof makeEffect>> | undefined;
  try {
    host = await openHost(canvas, options.case.backend, result);
    Object.assign(result.capabilities, {
      width,
      height,
      dpr,
      simulationClock: 'rAF elapsed; fixed solver cadence; elapsed clamped to 0.25 seconds',
      workload: options.case.kind === 'ripples' ? 'simulation-only' : 'simulation-and-raymarch',
      maxCatchupSteps: options.case.kind === 'ripples' ? 4 : 1,
      rippleExtent: options.case.kind === 'ripples' ? 64 : null,
      rippleDepth: options.case.kind === 'ripples' ? 0.01 : null,
      memoryCeilingBytes: 96 * 1024 * 1024,
    });
    effect = await makeEffect(host, options.case, width, height);
    result.bytes = effect.bytes;
    if (!Number.isSafeInteger(result.bytes) || result.bytes < 0 || result.bytes > 96 * 1024 * 1024)
      throw new Error('S3 simulation resources exceed the explicit 96MiB experimental ceiling');
    const cpu = new Float64Array(options.frames),
      raf = new Float64Array(options.frames);
    let previous = await nextFrame();
    for (let frame = 0; frame < options.warmup + options.frames; frame++) {
      const now = await nextFrame();
      const start = performance.now();
      const encoder = host.begin(frame);
      const elapsed = Math.max(0, (now - previous) / 1000);
      const work = options.enabled ? effect.step(Math.min(elapsed, 0.25), encoder) : null;
      host.end();
      if (frame >= options.warmup) {
        const rank = frame - options.warmup;
        cpu[rank] = performance.now() - start;
        raf[rank] = now - previous;
        result.steps += work?.steps ?? 0;
        result.splats += work?.splats ?? 0;
        result.dropped += work?.dropped ?? 0;
        result.droppedSteps += work?.droppedSteps ?? 0;
        result.clampedSeconds += Math.max(0, elapsed - 0.25);
      }
      previous = now;
    }
    await host.finish();
    result.cpuFrameMs = Array.from(cpu);
    result.rafIntervalMs = Array.from(raf);
    result.status = 'measured';
  } catch (error) {
    result.refusal = String(error);
  } finally {
    try {
      effect?.dispose();
    } finally {
      try {
        host?.dispose();
      } finally {
        canvas.remove();
      }
    }
  }
  return result;
}
