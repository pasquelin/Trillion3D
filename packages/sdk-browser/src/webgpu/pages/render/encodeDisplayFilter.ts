import { createDisplayFilter, type DisplayFilter } from '../../blend/displayFilter.ts'
import type { WebgpuGpuState } from '../state/gpu.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** Releases the display layers, the bytes they counted and their temporal history. */
function dropDisplayFilter(gpu: WebgpuGpuState) {
  if (!gpu.displayFilter) return undefined
  gpu.targetBytes -= gpu.displayFilter.bytes + (gpu.temporal?.filterHistory.bytes ?? 0)
  gpu.temporal?.filterHistory.drop()
  gpu.displayFilter.dispose()
  gpu.displayFilter = undefined
}

/** Whether a beauty image opens the display layers: its blends hold a multiply or subtractive
 *  surface. A diagnostic view or variant keeps the lit target's equations, drawing surfaces as they
 *  are. */
export const opensDisplayFilter = ({ blendState, run, context, vis }: WebgpuPagesRuntime) =>
  blendState.filtersDisplay &&
  run.diagnostic === 'beauty' &&
  !context.diagnosticGpuVariant &&
  !!vis.blendPipelines

/** Opens the display layers (`../../blend/displayFilter.ts`) of an image that does
 *  (`opensDisplayFilter`): made at the targets' size by the first, dropped once the plan holds no
 *  surface that filters. */
export function beginDisplayFilter(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
): DisplayFilter | undefined {
  const { gpu, blendState } = rt
  if (!blendState.filtersDisplay) return dropDisplayFilter(gpu)
  if (!opensDisplayFilter(rt)) return undefined
  const [width, height] = gpu.allocatedSize
  if (gpu.displayFilter?.width !== width || gpu.displayFilter.height !== height) {
    dropDisplayFilter(gpu)
    gpu.displayFilter = createDisplayFilter(device, width, height)
    gpu.targetBytes += gpu.displayFilter.bytes
  }
  gpu.displayFilter.open()
  return gpu.displayFilter
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
  filter.active = false
  // No blend pass wrote them: they are `(1, 0)`, the image already what it shows.
  if (!filter.written) return
  const { targetSize, allocatedSize, displayView } = rt.gpu
  // The raw layers, where the image drew them: the top-left of targets it may not fill.
  if (resolved) filter.apply(encoder, resolved, displayView!, presentation)
  else {
    const x = targetSize[0] / allocatedSize[0],
      y = targetSize[1] / allocatedSize[1]
    filter.apply(encoder, filter.views, displayView!, presentation, x, y)
  }
  rt.run.gpuDrawCalls += 2
}
