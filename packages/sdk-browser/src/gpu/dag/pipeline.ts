import { dagSelectionShader } from './shader/splitWgsl.ts'
import type { CutSteps } from './cutSteps.ts'
import { dagPartCounts, type DagSplit } from './split.ts'
import { dagBindEntries, type dagGroupEntries } from './shader/bindings.ts'
import { validatedOrWhy } from '../core/errorScope.ts'
import { checkShaderModule } from '../core/shaderModule.ts'
import type { CameraFrames } from './frameRanges.ts'
import { createDagStages } from './stages.ts'

/** The selection stages, and one bind group per range of `frames` with its primitive count, under
 *  one validation scope, or why the device refused them. `split`, the tables in parts on this
 *  device (`split.ts`): the layout binds every part, and the text reads across them. A text that
 *  does not compile throws its compiler's messages. */
export function createDagPipeline(
  device: GPUDevice,
  buffers: Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>,
  frames: CameraFrames,
  split?: DagSplit,
  steps?: CutSteps,
) {
  return validatedOrWhy(device, async () => {
    const layout = device.createBindGroupLayout({
      entries: dagBindEntries(split && dagPartCounts(split)),
    })
    steps?.begin('shader module')
    const module = await checkShaderModule(
      device.createShaderModule({
        code: dagSelectionShader(split),
      }),
      'camera cut selection',
    )
    steps?.begin('pipelines')
    const stages = await createDagStages(device, layout, module, frames.ranges.length > 1, steps)
    const ranges = frames.bindGroups(layout, buffers)
    return {
      /** Bind layout, returned with the stages: the dispatch bench mounts the previous cut on
       *  EXACTLY this one, instead of retyping a fourth copy. */
      layout,
      ...stages,
      ranges,
    }
  })
}
