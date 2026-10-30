import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { SkyLightCubemap } from '../../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { uniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { arrayLevelView } from '../../../gpu/core/textureViews.ts'
import { CUBE_HALF_BINDINGS, CUBE_HALF_ENTRY, cubeHalfShader } from './cubeHalfWgsl.ts'
import { CUBE_FACES } from './layout.ts'

/**
 * A HALF-FLOAT CUBE MADE FROM THE FLOAT CUBE ALREADY ON THE GPU: the cube the peak was found over (`floatCubeOf`) is converted, times the
 * fit's scale, into the `rgba16float` texture the light reads, in one dispatch, so the cube is not written from the CPU a second time.
 */

/** The workgroup's side, the conversion's (`@workgroup_size(8, 8, 1)`). */
const GROUP = 8

/** The conversion's kernel of a device, compiled off the frame once, and the layout it binds. */
const kernel = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D cube half',
    entries: [
      computeTextureEntry(CUBE_HALF_BINDINGS.source, 'unfilterable-float', '2d-array'),
      computeStorageTextureEntry(CUBE_HALF_BINDINGS.half, 'rgba16float', 'write-only', '2d-array'),
      computeUniformEntry(CUBE_HALF_BINDINGS.fit),
    ],
  })
  const stages = startedComputeStages(
    device,
    'Trillion3D cube half',
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ label: 'Trillion3D cube half', code: cubeHalfShader() }),
    [CUBE_HALF_ENTRY],
  )
  return { layout, stages }
})

/** Asks the compiler for the conversion's kernel, so it is ready by the time a cube needs it. */
export const prepareCubeHalf = (device: GPUDevice) => void kernel(device)

/**
 * `floats` converted into the first mip of `half` (`rgba16float`, `CUBE_FACES` layers, storage-bound), each channel times `scale`. False,
 * nothing done, while the kernel is still compiling: the caller writes the cube from the CPU instead.
 */
export function convertCubeHalf(
  device: GPUDevice,
  floats: GPUTexture,
  half: GPUTexture,
  { size }: SkyLightCubemap,
  scale: number,
) {
  const { layout, stages } = kernel(device)
  if (!stages.ready) return false
  const fit = uniformBlock(device, 'Trillion3D cube half', 16)
  fit.words.f[0] = scale
  fit.send()
  const encoder = device.createCommandEncoder({ label: 'Trillion3D cube half' })
  const pass = encoder.beginComputePass({ label: 'Trillion3D cube half' })
  pass.setPipeline(stages.pipelineOf(CUBE_HALF_ENTRY))
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout,
      entries: [
        { binding: CUBE_HALF_BINDINGS.source, resource: arrayLevelView(floats, 0) },
        { binding: CUBE_HALF_BINDINGS.half, resource: arrayLevelView(half, 0) },
        { binding: CUBE_HALF_BINDINGS.fit, resource: { buffer: fit.buffer } },
      ],
    }),
  )
  const side = ceilDiv(size, GROUP)
  pass.dispatchWorkgroups(side, side, CUBE_FACES)
  pass.end()
  device.queue.submit([encoder.finish()])
  // Destroyed after the submit that names it: the device frees it once that work is done.
  fit.buffer.destroy()
  return true
}
