import { dagSelectionShader } from './shader/shader.ts'
import type { CutSteps } from './cut/cutSteps.ts'
import { dagBindEntries } from './shader/bindings.ts'
import { validatedOrWhy } from '../../gpu/core/errorScope.ts'
import { checkShaderModule } from '../../gpu/core/shaderModule.ts'
import type { CameraFrames, DagGroup } from './cameraFrames.ts'
import { createDagStages } from './stages.ts'
import { dagArmGroup, dagArmLayout, type DagArmWords } from './arm.ts'

/** The selection stages and the arming kernel, the cut's bind group over `frames` and the arming
 *  group over `arm.work` and `arm.args`, under one validation scope, or why the device refused
 *  them; the stages that read the pyramid on `occlusion` too (`occlusion.ts`). One layout and one
 *  text whatever the world but for the project switch `clipPlane` (`dagSelectionShader`): every
 *  table is a record table (`cut/cutTables.ts`). A text that does not compile throws its
 *  compiler's messages. */
export function createDagPipeline(
  device: GPUDevice,
  buffers: DagGroup,
  frames: CameraFrames,
  arm: { work: GPUBuffer; args: GPUBuffer; words: DagArmWords },
  occlusion: GPUBindGroupLayout,
  steps?: CutSteps,
  clipPlane = false,
) {
  return validatedOrWhy(device, async () => {
    const layout = device.createBindGroupLayout({ entries: dagBindEntries() })
    steps?.begin('shader module')
    const module = await checkShaderModule(
      device.createShaderModule({ code: dagSelectionShader(clipPlane) }),
      'camera cut selection',
    )
    steps?.begin('pipelines')
    const armLayout = dagArmLayout(device)
    const stages = await createDagStages(
      device,
      layout,
      occlusion,
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
       *  (`../rows/rowClosure.ts`). */
      module,
      ...stages,
      bindGroup,
      armGroup: dagArmGroup(device, armLayout, arm.work, arm.args),
    }
  })
}
