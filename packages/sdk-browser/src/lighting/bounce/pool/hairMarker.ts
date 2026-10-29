import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  namedEntries,
} from '../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { HAIR_ALL_TILES_DISPATCH } from '../../../hair/visibilityMath.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { MARK_HAIR_BINDINGS as H, MARK_HAIR_SHADER } from './poolMarkHairWgsl.ts'
import type { PoolMarker } from './pool.ts'

/** The strands' mark pass of a device: its layout and pipeline, compiled off the frame and not waited for. */
const kernels = new WeakMap<GPUDevice, ReturnType<typeof startedKernel>>()

function startedKernel(device: GPUDevice) {
  const label = 'Trillion3D bounce marks hair strands'
  const layout = device.createBindGroupLayout({
    label,
    entries: [
      computeBufferEntry(H.grid, 'uniform'),
      computeBufferEntry(H.view, 'uniform'),
      computeTextureEntry(H.hairDepth, 'unfilterable-float', '2d'),
      computeBufferEntry(H.counts, 'uniform'),
      computeBufferEntry(H.tiles, 'read-only-storage'),
      computeBufferEntry(H.marks, 'storage'),
    ],
  })
  const stages = startedComputeStages(
    device,
    label,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ label, code: MARK_HAIR_SHADER }),
    ['markHair'],
  )
  return { layout, stages }
}

/**
 * THE MARK OF THE CELLS THE STRANDS READ (`PoolMarker`): where the image holds strands, a pass over the tiles that hold them marks the probes
 * round the nearest strand of each tile, as the surfaces' marks do for the surfaces, so that the strands' environment light finds its probes
 * in the radiance cache. The bind group is made again only when the pool's buffers or the strands' moved; none while the strands, the view or
 * the pipeline are not there.
 */
export function hairMarker(rt: WebgpuPagesRuntime): PoolMarker {
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return {
    mark(pass, grid, marks) {
      const device = rt.gpu.device
      const strands = rt.gpu.hair?.visible?.shadow
      const view = rt.gpu.deferred?.uniform
      if (!device || !strands || !view) return
      let kernel = kernels.get(device)
      if (!kernel) kernels.set(device, (kernel = startedKernel(device)))
      if (!kernel.stages.ready) return
      bound.next[0] = grid
      bound.next[1] = marks
      bound.next[2] = view
      bound.next[3] = strands.hairDepth
      bound.next[4] = strands.counts
      bound.next[5] = strands.tiles
      if (!group || bound.moved())
        group = device.createBindGroup({
          layout: kernel.layout,
          entries: namedEntries(H, {
            grid: { buffer: grid },
            view: { buffer: view },
            hairDepth: strands.hairDepth,
            counts: { buffer: strands.counts },
            tiles: { buffer: strands.tiles },
            marks: { buffer: marks },
          }),
        })
      pass.setPipeline(kernel.stages.pipelineOf('markHair'))
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroupsIndirect(strands.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
    },
  }
}
