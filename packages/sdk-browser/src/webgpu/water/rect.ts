import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { WATER_RECT_BINDING, WATER_RECT_SHADER, waterRectBindEntries } from './rectWgsl.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'

/** What the rectangle binds of the scene's kernel buffers (`../blend/expandBuffers.ts`). */
type KernelBuffers = Record<'frame' | 'keyed' | 'waterItems' | 'verdict', GPUBuffer>

/**
 * The water rectangle's two kernels on the GPU (`rectWgsl.ts`): each drawn water item's surface
 * and backdrop rectangles folded into the verdict, then what the water pass draws from them —
 * dispatched in the transparents' compute pass after the verdict (`../blend/expansionFrame.ts`).
 * The group is made again only when a buffer it names moved.
 */
export async function createWaterRect(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, WATER_RECT_SHADER, 'WATER_RECT')
  const layout = device.createBindGroupLayout({ entries: waterRectBindEntries() })
  const stages = await buildComputeStages(device, [layout], module, [
    'boundWaterItems',
    'writeWaterArgs',
  ])
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return {
    /** The water items' rectangles, then the pass's words, in the open compute pass `pass`: the
     *  kernels' buffers, the item records and the volumes bound. */
    encode(
      pass: GPUComputePassEncoder,
      buffers: KernelBuffers,
      items: GPUBuffer,
      volumes: GPUBuffer,
      waters: number,
    ) {
      const named = identity.next
      named[0] = buffers.frame
      named[1] = buffers.keyed
      named[2] = buffers.waterItems
      named[3] = items
      named[4] = volumes
      named[5] = buffers.verdict
      named.length = 6
      if (identity.moved() || !group)
        group = device.createBindGroup({
          layout,
          entries: namedEntries(WATER_RECT_BINDING, {
            frame: { buffer: buffers.frame },
            keyed: { buffer: buffers.keyed },
            waterItems: { buffer: buffers.waterItems },
            items: { buffer: items },
            volumes: { buffer: volumes },
            verdict: { buffer: buffers.verdict },
          }),
        })
      pass.setBindGroup(0, group)
      pass.setPipeline(stages.boundWaterItems)
      dispatchRows(pass, workgroupCount(waters, WORKGROUP_THREADS))
      pass.setPipeline(stages.writeWaterArgs)
      pass.dispatchWorkgroups(1)
    },
  }
}

export type WaterRect = Awaited<ReturnType<typeof createWaterRect>>
