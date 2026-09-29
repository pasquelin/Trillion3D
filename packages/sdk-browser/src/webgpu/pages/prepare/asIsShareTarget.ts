import { AS_IS_SHARE_BYTES, createAsIsShare } from '../../../lighting/deferred/asIsShare.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { readsAsIs } from './lightResources.ts';
import { drawsParticles } from '../../../particles/webgpuParticles.ts';

/** Whether the transparents write the share: a blended image that can show a debug view (#365),
 *  or whose temporal pass reads their coverage as the reactive value (#833). */
export const blendWritesShare = (rt: WebgpuPagesRuntime) =>
  rt.blendState.blendGpu.length > 0 && (readsAsIs(rt) || !!rt.gpu.temporalWanted);

/** Whether the image has a share target: its transparents or its particles (their coverage as the
 *  reactive value, #833) write it. Any other scene draws and allocates what it did before (#365). */
export const wantsAsIsShare = (rt: WebgpuPagesRuntime) =>
  blendWritesShare(rt) || drawsParticles(rt);

/** The share target at `width`×`height`, over the opaque flags: made with the targets or later. */
export function makeAsIsShare(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  rt.gpu.asIsShare = createAsIsShare(device, rt.gpu.surfaces!.views()[3], width, height);
}

/** The share the transparents blend into this image, when they write one (`blendWritesShare`). */
export const activeAsIsShare = (rt: WebgpuPagesRuntime) =>
  blendWritesShare(rt) ? rt.gpu.asIsShare : undefined;

/**
 * Seeds, from the opaque flags, the share the transparents and particles blend into this image,
 * and returns it: the one made with the targets, or one made at the first image that wants it and
 * kept with them. An image where neither writes it runs no seed pass, makes no share target and
 * returns nothing.
 */
export function seedAsIsShare(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu } = rt;
  const written = (!!rt.vis.blendPipelines && blendWritesShare(rt)) || drawsParticles(rt);
  if (!written || !gpu.surfaces) return undefined;
  if (!gpu.asIsShare) {
    const [width, height] = gpu.allocatedSize;
    gpu.targetBytes += width * height * AS_IS_SHARE_BYTES;
    makeAsIsShare(rt, device, width, height);
  }
  gpu.asIsShare!.seed(encoder);
  return gpu.asIsShare;
}
