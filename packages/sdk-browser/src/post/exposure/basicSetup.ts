import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { EXPOSURE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { LOG_LUMA_LEVEL } from '../filters/sceneChain.ts'
import { sizedImage } from '../filters/sizedImage.ts'
import { SETUP_GROUP } from './basicWgsl.ts'
import type { MeterPrograms } from './meterPrograms.ts'

const PASS = { label: EXPOSURE_PASS }

/** The level of the scene's chain the measure sums: four levels under the setup's (`LOG_LUMA_LEVEL`), a sixty-fourth of the image's size on each axis. */
export const BASIC_GRID_LEVEL = LOG_LUMA_LEVEL + 4

/**
 * THE BASIC METHOD'S SETUP FOR THE SCENE'S CHAIN: the quarter-size level (`LOG_LUMA_LEVEL`) turned by
 * the setup (`basicSetup`, `basicWgsl.ts`) into the same image with the placed log luminance of each texel in its alpha; the chain
 * (`SceneChain`) goes on from that image, so its last level is the grid the measure sums. Made at the first image of the method and
 * kept while the size holds.
 */
export function createBasicSetup(device: GPUDevice, programs: MeterPrograms) {
  // The texture the setup writes, one texel to a texel of the quarter-size level.
  const logged = sizedImage(device, EXPOSURE_PASS, HDR_FORMAT, GPUTextureUsage.STORAGE_BINDING)
  const identity = createWebgpuBindIdentity(1)
  let setup: GPUBindGroup | undefined
  return {
    /** The setup's pass, from the quarter-size level `quarter` of `size` texels; the image it writes, none while the
     *  setup is not compiled. `uniform` is the meter's (`METER_PARAMS`), which the setup reads. */
    encode(
      encoder: GPUCommandEncoder,
      quarter: GPUTextureView,
      size: readonly number[],
      uniform: GPUBuffer,
    ) {
      const view = logged.view(size[0], size[1])
      identity.next[0] = quarter
      identity.next[1] = view
      identity.next[2] = uniform
      if (identity.moved())
        setup = device.createBindGroup({
          layout: programs.setupLayout,
          entries: sequentialEntries([quarter, view, { buffer: uniform }]),
        })
      const pipeline = programs.setup.get()
      if (!pipeline) return undefined
      const pass = encoder.beginComputePass(PASS)
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, setup)
      pass.dispatchWorkgroups(ceilDiv(size[0], SETUP_GROUP), ceilDiv(size[1], SETUP_GROUP))
      pass.end()
      return view
    },
    /** The texture given back. */
    dispose() {
      logged.release()
      identity.clear()
    },
  }
}
