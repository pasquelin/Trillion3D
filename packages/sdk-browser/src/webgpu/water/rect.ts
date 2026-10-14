import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { bufferEntry } from '../core/liveEntries.ts'
import { composeGroup, heldGroup } from '../../placement/composeGroups.ts'
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
  // What the group names, read live by its entries: written once, made again when one moved.
  const bound = {} as Record<keyof typeof WATER_RECT_BINDING, GPUBuffer>
  const held = heldGroup()
  held.identity.entries[0] = (Object.keys(WATER_RECT_BINDING) as (keyof typeof bound)[]).map(
    (name) => bufferEntry(WATER_RECT_BINDING[name], () => bound[name]),
  )
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
      bound.frame = buffers.frame
      bound.keyed = buffers.keyed
      bound.waterItems = buffers.waterItems
      bound.items = items
      bound.volumes = volumes
      bound.verdict = buffers.verdict
      composeGroup(device, held, stages.boundWaterItems)
      pass.setBindGroup(0, held.group!)
      pass.setPipeline(stages.boundWaterItems)
      dispatchRows(pass, workgroupCount(waters, WORKGROUP_THREADS))
      pass.setPipeline(stages.writeWaterArgs)
      pass.dispatchWorkgroups(1)
    },
  }
}

export type WaterRect = Awaited<ReturnType<typeof createWaterRect>>
