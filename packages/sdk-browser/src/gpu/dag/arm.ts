import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { DAG_ARM_SHADER } from './shader/armWgsl.ts'

/**
 * The arming kernel of a cut (`shader/armWgsl.ts`) on its `work` and `args`, whose group words —
 * where each list's group count lies in `work` — are fixed with the layout: its pipeline, compiled
 * off the thread, and its one group. `undefined` when its shader does not compile; the caller's
 * validation scope catches the rest.
 */
export async function createDagArm(
  device: GPUDevice,
  work: GPUBuffer,
  args: GPUBuffer,
  words: { drawnGroups: number; candGroups: number; liveGroups: number; listGroups: number },
) {
  const module = device.createShaderModule({ code: DAG_ARM_SHADER })
  if (await shaderFailed(module)) return undefined
  const layout = bounceLayout(device, ['read-only-storage', 'storage'])
  const pipeline = await buildComputePipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module,
      entryPoint: 'dagArm',
      constants: {
        DRAWN_GROUPS: words.drawnGroups,
        CAND_GROUPS: words.candGroups,
        LIVE_GROUPS: words.liveGroups,
        LIST_GROUPS: words.listGroups,
      },
    },
  })
  return { armPipeline: pipeline, armGroup: bounceGroup(device, layout, [work, args]) }
}
