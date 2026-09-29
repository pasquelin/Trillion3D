import { createAsIsShare } from '../../../lighting/deferred/asIsShare.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { readsAsIs } from './lightResources.ts';

/** Whether the transparents write an as-is share: a blended image that can show a debug view.
 *  Any other scene draws, and allocates, exactly what it did before the share (#365). */
export const wantsAsIsShare = (rt: WebgpuPagesRuntime) =>
  rt.blendState.blendGpu.length > 0 && readsAsIs(rt);

/**
 * Seeds, from the opaque flags, the share the transparents blend into this image, and returns it:
 * the one made with the targets, or one made at the first image that wants it and kept with them.
 * An image with no debug view to keep, or no blend pipelines, runs no seed pass, makes no r8 target
 * and returns nothing.
 */
export function seedAsIsShare(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu } = rt;
  if (!rt.vis.blendPipelines || !wantsAsIsShare(rt) || !gpu.surfaces) return undefined;
  if (!gpu.asIsShare) {
    const [width, height] = gpu.allocatedSize;
    gpu.targetBytes += width * height;
    gpu.asIsShare = createAsIsShare(device, gpu.surfaces.views()[3], width, height);
  }
  gpu.asIsShare.seed(encoder);
  return gpu.asIsShare;
}
