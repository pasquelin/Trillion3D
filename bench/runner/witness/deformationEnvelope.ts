import type { FrameMetrics } from '../../../packages/sdk-core/src/index.ts';

type Source = {
  onFrame(hook: (frame: { metrics: FrameMetrics }) => void): () => void;
  invalidate(): void;
};

/** Recette installs this on deformationCase.world, separately for count=1, 10 and 100.
 * Raw measured values are retained; unsupported GPU timestamps stay null, never CPU estimates. */
export function deformationEnvelope(world: Source, frames = 120, warmup = 30) {
  if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(warmup) || warmup < 0)
    throw new Error('INVALID_FRAME_COUNT');
  const result = {
    cpuFrameMs: [] as number[],
    gpuDeformationMs: [] as (number | null)[],
    geometryAllocationBytes: [] as (number | null)[],
    vramBytes: [] as (number | null)[],
  };
  return new Promise<typeof result>((resolve) => {
    let seen = 0;
    const unsubscribe = world.onFrame(({ metrics }) => {
      if (seen++ >= warmup) {
        result.cpuFrameMs.push(metrics.cpuFrameMs);
        result.gpuDeformationMs.push(metrics.gpuDeformationMs ?? null);
        result.geometryAllocationBytes.push(metrics.geometryAllocationBytes);
        result.vramBytes.push(metrics.vramBytes);
      }
      if (result.cpuFrameMs.length === frames) {
        unsubscribe();
        resolve(result);
      } else world.invalidate();
    });
    world.invalidate();
  });
}
