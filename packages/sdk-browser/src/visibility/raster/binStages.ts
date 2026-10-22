import { RASTER_PASSES, type RasterPass } from './contract.ts'
import { binSource } from './binWgsl.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'

/** The compute stages of a module on a layout, asked, compiled off the thread from now, the frames
 *  held on them: the raster is made at a frame's entry (`../../frame/loop/framePipelines.ts`), and
 *  the frame that draws it finds them. One module each, one pipeline a pass: the pass's lists are
 *  its override (`LIST`), the word their header starts at. */
export const stagesOf =
  (device: GPUDevice, listOffsets: readonly number[]) =>
  (layout: GPUBindGroupLayout, module: GPUShaderModule) => {
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
    return (entryPoint: string, pass: RasterPass) =>
      preparedComputeStage(device, pipelineLayout, module, entryPoint, {
        LIST: listOffsets[pass]! / 4,
      }).ask()
  }

/** The binning of each pass over the split that leaves the tessellated rows to the tessellation
 *  (`binSource`'s flag), `clipping` as the plain one: one pipeline a pass, made at the first ask. A
 *  scene without a displaced surface never compiles it. */
export function lazyTessellatedBin(
  device: GPUDevice,
  capacity: number,
  clipping: boolean,
  layout: GPUBindGroupLayout,
  stages: ReturnType<typeof stagesOf>,
) {
  let made: ReturnType<ReturnType<ReturnType<typeof stagesOf>>>[] | undefined
  return () => {
    if (!made) {
      const module = device.createShaderModule({ code: binSource(capacity, true, clipping) })
      const stage = stages(layout, module)
      made = RASTER_PASSES.map((pass) => stage('bin', pass))
    }
    return made
  }
}
