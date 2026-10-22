import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedPipeline, fullscreenDescriptor } from '../../../lighting/deferred/fullscreen.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { finishLayout } from '../../finish/finishLayout.ts'
import { filterPrograms } from '../../filters/filterPrograms.ts'
import { GLOW_FINISH_WGSL, GLOW_SHAPE_BYTES } from './glowFinishWgsl.ts'

/**
 * THE GLOW'S FINISHING PROGRAM once a device, prepared off the thread when the first image that draws
 * the dirt mask or a convolution asks (`askGlowPrograms`), none made before: the pass over the
 * image (`glowFinish`), the layout of its group — the image, the glow, the dirt mask, the sampler,
 * the uniform — and the sampler it reads through: bilinear, clamping to the edge, the mip levels
 * of the mask chosen, not blended.
 */
export const glowPrograms = oncePerDevice((device: GPUDevice) => {
  const fragment = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: BLOOM_PASS,
    entries: [
      computeTextureEntry(0, 'float', '2d', fragment),
      computeTextureEntry(1, 'float', '2d', fragment),
      computeTextureEntry(2, 'float', '2d', fragment),
      computeSamplerEntry(3, 'filtering', fragment),
      computeUniformEntry(4, { minBindingSize: GLOW_SHAPE_BYTES }, fragment),
    ],
  })
  const label = `${BLOOM_PASS} glow`
  const module = device.createShaderModule({ label, code: GLOW_FINISH_WGSL })
  return {
    layout,
    finish: preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        [layout, finishLayout(device)],
        'glowFinish',
        [{ format: HDR_FORMAT }],
        label,
      ),
    ),
    filters: filterPrograms(device),
  }
})

/** Asks the glow's finishing program of `device` off the thread, the frames held until it landed
 *  (`../../../frame/loop/framePipelines.ts`). */
export const askGlowPrograms = (device: GPUDevice) => void glowPrograms(device).finish.ask()
