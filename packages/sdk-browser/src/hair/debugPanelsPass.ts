import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { drawScreenPass, screenPassGroup, screenPassPipeline } from '../diagnostic/screenPass.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import {
  DEBUG_ATLAS_WGSL,
  DEBUG_ATLAS_WORDS,
  DEBUG_VOXEL_WORDS,
  debugVoxelWgsl,
} from './debugPanelsWgsl.ts'
import type { HairVoxelSet } from './voxelPass.ts'

const LABEL = `${HAIR_STRANDS_PASS_PREFIX}debug panels`

const voxelPipelines = preparedPipelines((mipmap: boolean) =>
  oncePerDevice((device) =>
    screenPassPipeline(device, `${LABEL} voxels`, debugVoxelWgsl(mipmap), 'debugVoxelFs'),
  ),
)

/** What the view of the voxels reads: the volume, the strands' view block, the opaque depth and the settings. */
export interface DebugVoxelInputs {
  readonly set: HairVoxelSet
  readonly viewBuffer: GPUBuffer
  readonly depth: GPUTextureView
  readonly mipmap: boolean
  readonly densityScale: number
  readonly stepping: number
  readonly forcedMip: number
  readonly drawPages: boolean
  readonly drawVoxels: boolean
  readonly frame: number
  readonly jitterMode: number
}

/** Draws one full-screen pass over `target` with `pipeline`, its group made of `entries`. */
const drawPanel = (
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  label: string,
  pipeline: GPURenderPipeline,
  target: GPUTextureView,
  entries: GPUBindingResource[],
) => drawScreenPass(encoder, label, pipeline, target, [screenPassGroup(device, pipeline, entries)])

/** Writes the voxel viewer's block (`DebugVoxels`): the display's `size` and the settings of `inputs`. */
function writeVoxelBlock(
  device: GPUDevice,
  block: GPUBuffer,
  size: readonly [number, number],
  inputs: DebugVoxelInputs,
) {
  const words = new ArrayBuffer(DEBUG_VOXEL_WORDS * 4)
  new Float32Array(words).set([size[0], size[1], inputs.densityScale, inputs.stepping])
  new Int32Array(words)[4] = inputs.forcedMip
  new Uint32Array(words).set(
    [inputs.drawPages ? 1 : 0, inputs.drawVoxels ? 1 : 0, inputs.frame & 7, inputs.jitterMode],
    5,
  )
  device.queue.writeBuffer(block, 0, words)
}

/**
 * THE PANELS OF THE DEBUG VIEWS DRAWN BY PIXEL over the display image: the deep shadows' atlases in two squares and the strands' count
 * through the voxels (`debugPanelsWgsl.ts`). Made when a view first shows one; the pipelines compile off the frame.
 */
export function createDebugPanelsGpu(device: GPUDevice) {
  const atlas = screenPassPipeline(device, `${LABEL} atlas`, DEBUG_ATLAS_WGSL, 'debugAtlasFs')
  const atlasBlock = device.createBuffer({
    label: `${LABEL} atlas`,
    size: DEBUG_ATLAS_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const voxelBlock = device.createBuffer({
    label: `${LABEL} voxels`,
    size: DEBUG_VOXEL_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    /** The atlases of the front depths (`frontView`) and the layers (`layersView`, divided by `scale`) in their squares. */
    encodeAtlas(
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      atlases: { frontView: GPUTextureView; layersView: GPUTextureView },
      scale: number,
    ) {
      const pipeline = atlas.get()
      if (!pipeline) return
      device.queue.writeBuffer(atlasBlock, 0, new Float32Array([scale, 0, 0, 0]))
      drawPanel(device, encoder, `${LABEL} atlas`, pipeline, target, [
        { buffer: atlasBlock },
        atlases.frontView,
        atlases.layersView,
      ])
    },
    /** The strands' count along each pixel's ray (`DebugVoxelInputs`), `size` the display's pixels. */
    encodeVoxels(
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      size: readonly [number, number],
      inputs: DebugVoxelInputs,
    ) {
      const pipeline = voxelPipelines.of(inputs.mipmap)(device).get()
      if (!pipeline) return
      writeVoxelBlock(device, voxelBlock, size, inputs)
      const { set } = inputs
      drawPanel(device, encoder, `${LABEL} voxels`, pipeline, target, [
        { buffer: set.paramsBuffer },
        { buffer: set.nodes },
        { buffer: set.pageIndex },
        { buffer: set.voxels },
        { buffer: inputs.viewBuffer },
        { buffer: voxelBlock },
        inputs.depth,
      ])
    },
    dispose() {
      atlasBlock.destroy()
      voxelBlock.destroy()
    },
  }
}

/** The panels pass of the debug views (`createDebugPanelsGpu`). */
export type DebugPanelsGpu = ReturnType<typeof createDebugPanelsGpu>
