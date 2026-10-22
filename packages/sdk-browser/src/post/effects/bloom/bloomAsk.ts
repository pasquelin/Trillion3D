import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { askConvolutionPrograms } from './convolution/convolutionPrograms.ts'

/**
 * Asks the programs a bloom that draws needs beyond the Gaussian glow's — the convolution's — of
 * `device` off the frame, the frames held until they landed (`../../../frame/loop/framePipelines.ts`,
 * `KIND_RULES.bloom.ask`): the kernel's, the input's, and the transform's for the lines it makes at
 * the sizes the view draws at. Nothing for the Gaussian glow: it costs nothing then. The view's
 * resolution is read apart (`KindSettings.peek`), as the frame reads it.
 */
export function askBloomPrograms(bloom: Bloom, device: GPUDevice, rt: WebgpuPagesRuntime) {
  if (bloom.method !== 'convolution') return
  const { gpu } = rt
  const { bloomScreenPercentage } = gpu.kindSettings.peek('bloom', rt.context)
  askConvolutionPrograms(
    device,
    [gpu.displaySize, gpu.targetSize],
    bloomScreenPercentage,
    bloom.convolution,
  )
}
