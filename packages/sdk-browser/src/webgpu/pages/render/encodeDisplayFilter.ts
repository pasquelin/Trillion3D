import { createDisplayFilter, type DisplayFilter } from '../../blend/displayFilter.ts';
import type { WebgpuGpuState } from '../state/gpu.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Releases the display filter and the bytes it counted. */
function dropDisplayFilter(gpu: WebgpuGpuState) {
  if (!gpu.displayFilter) return undefined;
  gpu.targetBytes -= gpu.displayFilter.bytes;
  gpu.displayFilter.dispose();
  gpu.displayFilter = undefined;
}

/**
 * Opens this image's display filter (`../../blend/displayFilter.ts`), cleared white, when its
 * blends hold a multiply or subtractive surface and a beauty image is composed: made at the image
 * size by the first such image, dropped once the plan holds none. A diagnostic view or variant
 * keeps the lit target's own equations, as it draws the surfaces for what they are.
 */
export function beginDisplayFilter(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
): DisplayFilter | undefined {
  const { gpu, blendState, run } = rt;
  if (!blendState.filtersDisplay) return dropDisplayFilter(gpu);
  if (run.diagnostic !== 'beauty' || rt.context.diagnosticGpuVariant || !rt.vis.blendPipelines)
    return undefined;
  const [width, height] = gpu.targetSize;
  if (gpu.displayFilter?.width !== width || gpu.displayFilter.height !== height) {
    dropDisplayFilter(gpu);
    gpu.displayFilter = createDisplayFilter(device, width, height);
    gpu.targetBytes += gpu.displayFilter.bytes;
  }
  const filter = gpu.displayFilter;
  filter.clear(encoder);
  filter.active = true;
  return filter;
}

/** Multiplies the composed image, and the canvas it was presented to, by the filter the image
 *  resolved: the temporal one, else the raw target. One draw. */
export function endDisplayFilter(
  rt: WebgpuPagesRuntime,
  filter: DisplayFilter,
  encoder: GPUCommandEncoder,
  resolved: GPUTextureView | undefined,
  presentation: GPUTextureView | undefined,
) {
  filter.active = false;
  filter.apply(encoder, resolved ?? filter.view, rt.gpu.colorView!, presentation);
  rt.run.gpuDrawCalls++;
}
