import type { S3Result } from './contracts.ts';
import type { GpuTimingSample } from '../../../packages/sdk-browser/src/gpu/timing/types.ts';

/** A complete GPU frame envelope is evidence; summed passes, warmup and invalid samples are not. */
export function recordGpuSample(result: S3Result, sample: GpuTimingSample) {
  const rank = sample.frame - result.options.warmup;
  if (
    rank < 0 ||
    rank >= result.options.frames ||
    !Number.isInteger(rank) ||
    sample.truncated ||
    sample.error
  )
    return;
  if (sample.frameMs !== null && Number.isFinite(sample.frameMs) && sample.frameMs >= 0)
    result.gpuFrameMs.push({ frame: rank, ms: sample.frameMs });
}
