import { fixedClock } from './clock.ts';
import type { S3Case } from './contracts.ts';
import type { S3Host } from './host.ts';
import { rippleInputs, smokeCamera } from './inputs.ts';
import { createWebglRipples } from './ripples/webgl.ts';
import { createWebgpuRipples } from './ripples/webgpu.ts';
import { createSmoke } from './smoke/index.ts';

/** Adapt the two experiments, keeping the same declared resources without advancing either solver. */
export async function makeEffect(host: S3Host, candidate: S3Case, width: number, height: number) {
  if (candidate.kind === 'ripples') {
    const spec = {
      resolution: candidate.resolution,
      rate: candidate.rate,
      extent: 64,
      depth: 0.01,
    };
    const runtime = host.gl
      ? createWebglRipples(host.gl, spec)
      : await createWebgpuRipples(host.device!, spec);
    const input = rippleInputs(candidate.splats);
    return {
      bytes: runtime.bytes,
      step(elapsed: number, encoder?: GPUCommandEncoder) {
        return runtime.step(elapsed, encoder, input);
      },
      dispose: () => runtime.dispose(),
    };
  }
  const runtime = await createSmoke(host.device!, {
    ...candidate,
    width,
    height,
    format: host.format!,
  });
  const clock = fixedClock(30, 1);
  const frame = {
    dt: 0,
    ...smokeCamera(),
    outputView: undefined as unknown as GPUTextureView,
  };
  const work = { steps: 0, splats: 0, dropped: 0, droppedSteps: 0 };
  return {
    bytes: runtime.info.totalBytes,
    step(elapsed: number, encoder?: GPUCommandEncoder) {
      const before = clock.dropped;
      work.steps = clock.advance(elapsed);
      work.droppedSteps = clock.dropped - before;
      frame.dt = work.steps ? clock.dt : 0;
      frame.outputView = host.view()!;
      runtime.encode(encoder!, frame);
      return work;
    },
    dispose: () => runtime.dispose(),
  };
}
