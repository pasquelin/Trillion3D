/**
 * THE COPLANAR LAYERS A SOURCE BRINGS ARE GRANTED IN PLACE. A session draws one set of indirect
 * slots for each coplanar layer its pages carry (`depthLayerSlots`, the open's rule): the compaction
 * is made for that many (`createGpuDraw`), the visibility uniforms hold a slot for each; every
 * layer draws with the same pipelines, its clusters carrying their layer's depth units in their
 * rows (`page.depthBias`, `VIS_WRITE_WGSL`). A source whose pages stack deeper than the session's
 * slots — a model compiled with coplanar surfaces, joining a world opened on none — is granted the
 * slots it needs by the open's own functions: the compaction and the uniforms are made beside the
 * running ones, and put in place in one step between two images, the draw records written again
 * (`refreshDrawItemWords`).
 * Queued behind the growths of the tables (`queueTableGrowth`): both read the compaction.
 *
 * Cost of a grant from L to L' layers over R rows: the compaction's buffers for L' (R·(6+perRow)
 * words and (L'-L)·slots commands), the draw records sent once; every other table is the
 * session's.
 */
import { createGpuDraw } from '../../visibility/draw/factory.ts'
import { deviceMade } from '../../gpu/core/errorScope.ts'
import { visUniformBuffer } from '../../gpu/bind/bindLayout.ts'
import { visUniformSlots } from '../../visibility/passes/uniforms.ts'
import { pendingBuffers } from '../../gpu/core/tableGrowth.ts'
import { stopped } from '../io/lost.ts'
import { dropRaster } from '../io/drops.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { queueTableGrowth } from './growthQueue.ts'
import { depthLayerSlots } from './visibility.ts'

/** Whether the session draws every coplanar layer `pages` carry, granting the slots it lacks;
 *  false when the device refuses them or the session holds no draw path to make again. */
export async function grantDepthLayers(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pages: readonly { depthLayer: number }[],
) {
  const slots = depthLayerSlots(pages)
  if (slots <= rt.vis.drawLayerSlots) return true
  return queueTableGrowth(rt, () => grant(rt, device, slots))
}

async function grant(rt: WebgpuPagesRuntime, device: GPUDevice, slots: number) {
  const { vis, layout, setup, run } = rt
  // Granted meanwhile, by another source's growth ahead of this one in the queue.
  if (slots <= vis.drawLayerSlots) return true
  const held = vis.gpuDraw
  if (!held || run.lost) return false
  const draw = await createGpuDraw(device, layout.drawSlots, slots, setup.maxCorners)
  const uniform = await deviceMade(device, () => {
    const next = visUniformBuffer(device, visUniformSlots({ drawLayerSlots: slots }))
    return pendingBuffers(device, [next], () => {
      const old = vis.visUniform
      vis.visUniform = next
      return [old]
    })
  })
  // The draw path moved while these were made (a lost device, a disposal): nothing is changed.
  const stale = vis.gpuDraw !== held || stopped(rt)
  if (!draw || !uniform || stale) {
    draw?.dispose()
    uniform?.destroy()
    return false
  }
  vis.gpuDraw = draw
  vis.drawLayerSlots = slots
  uniform.commit()
  held.dispose()
  dropRaster(rt)
  // Origin of the resource change: the slots, the compaction and the uniforms were replaced.
  run.gate.resourcesChanged()
  rt.diag.engineDiagnostic('coplanar-layers-grown', 'Coplanar layers granted in place', {
    layers: slots - 1,
  })
  return true
}
