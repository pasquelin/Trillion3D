import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { EXPOSURE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { createDownsampleChain } from '../filters/downsampleChain.ts'
import { sizedImage } from '../filters/sizedImage.ts'
import type { SceneChain } from '../filters/sceneChain.ts'
import { SETUP_GROUP } from './basicWgsl.ts'
import type { MeterPrograms } from './meterPrograms.ts'

/** Levels of the scene's chain the setup needs: the half-size image, then the quarter-size one. */
const SCENE_LEVELS = 2
/** Levels of the grid, counting the setup's image as the first: it ends four levels under it, at a
 *  sixty-fourth of the image's size on each axis. */
const GRID_LEVELS = 5
const PASS = { label: EXPOSURE_PASS }

/**
 * THE BASIC METHOD'S IMAGE FOR THE MEASURE: the scene's chain (`SceneChain`, begun on the metered
 * image: the half-size image and the quarter-size level, drawn once for the finishing as well)
 * whose quarter-size level the setup (`basicSetup`, `basicWgsl.ts`) turns into the placed log
 * luminance of each of its texels, and the four levels under that (`createDownsampleChain`: each
 * the mean of the 4 × 4 texels around the one above), the last of which is the grid the measure
 * sums. Made at the first image of the method and kept while the size holds.
 */
export function createBasicMeasure(device: GPUDevice, programs: MeterPrograms) {
  const grid = createDownsampleChain(device, EXPOSURE_PASS)
  // The texture the setup writes, one texel to a texel of the quarter-size level.
  const logged = sizedImage(device, EXPOSURE_PASS, HDR_FORMAT, GPUTextureUsage.STORAGE_BINDING)
  const identity = createWebgpuBindIdentity(1)
  let setup: GPUBindGroup | undefined
  /** The setup's pass, from the quarter-size level `quarter` of `width × height` texels into the
   *  logged image `view`. */
  function encodeSetup(
    encoder: GPUCommandEncoder,
    quarter: GPUTextureView,
    view: GPUTextureView,
    [width, height]: readonly number[],
    uniform: GPUBuffer,
  ) {
    identity.next[0] = quarter
    identity.next[1] = view
    identity.next[2] = uniform
    if (identity.moved())
      setup = device.createBindGroup({
        layout: programs.setupLayout,
        entries: sequentialEntries([quarter, view, { buffer: uniform }]),
      })
    const pipeline = programs.setup.get()
    if (!pipeline) return false
    const pass = encoder.beginComputePass(PASS)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, setup)
    pass.dispatchWorkgroups(ceilDiv(width, SETUP_GROUP), ceilDiv(height, SETUP_GROUP))
    pass.end()
    return true
  }
  return {
    /**
     * Encodes the grid of the chain `scene`, begun on the metered image, in `encoder` — the
     * setup's pass and the levels' — and returns its last level, the placed log luminance in its
     * alpha, none while the setup is not compiled. `uniform` is the meter's (`METER_PARAMS`), which the setup reads.
     */
    encode(encoder: GPUCommandEncoder, scene: SceneChain, uniform: GPUBuffer) {
      scene.need(SCENE_LEVELS)
      const size = scene.size(1)
      const image = logged.view(size[0], size[1])
      if (!encodeSetup(encoder, scene.view(1)!, image, size, uniform)) return undefined
      grid.resize(size[0], size[1], GRID_LEVELS)
      grid.encode(encoder, image, GRID_LEVELS)
      return grid.view(GRID_LEVELS - 1)!
    },
    /** The textures given back. */
    dispose() {
      logged.release()
      identity.clear()
      grid.dispose()
    },
  }
}
