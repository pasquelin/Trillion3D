import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts'
import { levelViews, reductionGroups } from './mipBatch.ts'
import { radianceMipPipeline } from './mips.ts'
import { REFLECTION_RADIANCE_MIPS_PASS } from './mipsPass.ts'

/** The radiance levels a reflection cone reads (`../reflections/conePyramid.ts`), each reduced
 *  from the one above and drawn into its level (`RADIANCE_MIP_WGSL`); encoding never allocates or
 *  submits. */
export function createRadianceMipChain(device: GPUDevice, texture: GPUTexture) {
  const program = radianceMipPipeline(sharedGpuDevice(device), texture.format)
  const views = levelViews(texture)
  const { uniforms, groups } = reductionGroups(
    device,
    'Trillion3D radiance mip extents',
    [texture.width, texture.height],
    views.length - 1,
    (index, extent) =>
      device.createBindGroup({
        layout: program.layout,
        entries: [
          { binding: 0, resource: views[index] },
          { binding: 1, resource: extent },
        ],
      }),
  )
  return {
    encode(encoder: GPUCommandEncoder) {
      for (let index = 0; index < groups.length; index++) {
        const pass = encoder.beginRenderPass({
          label: REFLECTION_RADIANCE_MIPS_PASS,
          colorAttachments: [{ view: views[index + 1], loadOp: 'clear', storeOp: 'store' }],
        })
        pass.setPipeline(program.pipeline)
        pass.setBindGroup(0, groups[index])
        pass.draw(3)
        pass.end()
      }
    },
    dispose() {
      uniforms.destroy()
    },
  }
}
