import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import type { CutSteps } from './cutSteps.ts'
import { dagBindEntries, type dagGroupEntries } from './shader/bindings.ts'
import { validatedOrWhy } from '../core/errorScope.ts'
import { checkShaderModule } from '../core/shaderModule.ts'
import type { CameraFrames } from './cameraFrames.ts'
import { createDagStages } from './stages.ts'
import { dagArmGroup, dagArmLayout, type DagArmWords } from './arm.ts'

/** The selection stages and the arming kernel, the cut's bind group over `frames` and the arming
 *  group over `arm.work` and `arm.args`, under one validation scope, or why the device refused
 *  them. One layout and one text whatever the world: every table is a record table
 *  (`cutTables.ts`). A text that does not compile throws its compiler's messages. */
export function createDagPipeline(
  device: GPUDevice,
  buffers: Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>,
  frames: CameraFrames,
  arm: { work: GPUBuffer; args: GPUBuffer; words: DagArmWords },
  steps?: CutSteps,
) {
  return validatedOrWhy(device, async () => {
    const layout = device.createBindGroupLayout({ entries: dagBindEntries() })
    steps?.begin('shader module')
    const module = await checkShaderModule(
      device.createShaderModule({ code: DAG_SELECTION_SHADER }),
      'camera cut selection',
    )
    steps?.begin('pipelines')
    const armLayout = dagArmLayout(device)
    const stages = await createDagStages(
      device,
      layout,
      module,
      { layout: armLayout, words: arm.words },
      steps,
    )
    const bindGroup = frames.bindGroup(layout, buffers)
    return {
      /** Bind layout, returned with the stages: the dispatch bench mounts the previous cut on
       *  EXACTLY this one, instead of retyping a fourth copy. */
      layout,
      /** The program, which the row cache's closure is compiled from too
       *  (`../../webgpu/row/rowClosure.ts`). */
      module,
      ...stages,
      bindGroup,
      armGroup: dagArmGroup(device, armLayout, arm.work, arm.args),
    }
  })
}
