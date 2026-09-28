import { createDisplayFilter, type DisplayFilter } from '../../blend/displayFilter.ts';
import type { WebgpuGpuState } from '../state/gpu.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Releases the display layers, the bytes they counted and their temporal history. */
function dropDisplayFilter(gpu: WebgpuGpuState) {
  if (!gpu.displayFilter) return undefined;
  gpu.targetBytes -= gpu.displayFilter.bytes + (gpu.temporal?.filterHistory.bytes ?? 0);
  gpu.temporal?.filterHistory.drop();
  gpu.displayFilter.dispose();
  gpu.displayFilter = undefined;
}

/**
 * Opens this image's display layers (`../../blend/displayFilter.ts`) when its
 * blends hold a multiply or subtractive surface and a beauty image is composed: made at the image
 * size by the first such image, dropped once the plan holds none. A diagnostic view or variant
 * keeps the lit target's own equations, as it draws the surfaces for what they are.
 */
export function beginDisplayFilter(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
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
  gpu.displayFilter.open();
  return gpu.displayFilter;
}

/** Composes the display layers the image resolved — the temporal ones, else the raw targets —
 *  over the composed image and the canvas it was presented to: the tint, then the added value. */
export function endDisplayFilter(
  rt: WebgpuPagesRuntime,
  filter: DisplayFilter,
  encoder: GPUCommandEncoder,
  resolved: readonly [GPUTextureView, GPUTextureView] | undefined,
  presentation: GPUTextureView | undefined,
) {
  filter.active = false;
  // No blend pass wrote them: they are `(1, 0)`, the image already what it shows.
  if (!filter.written) return;
  filter.apply(encoder, resolved ?? filter.views, rt.gpu.colorView!, presentation);
  rt.run.gpuDrawCalls += 2;
}
