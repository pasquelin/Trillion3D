/**
 * THE COPLANAR LAYERS A SOURCE BRINGS ARE GRANTED IN PLACE. A session draws one set of indirect
 * slots for each coplanar layer its pages carry (`depthLayerSlots`, the open's rule): the bins are
 * made for that many (`createBinStages`), the visibility uniforms hold a slot for each; every
 * layer draws with the same pipelines, its clusters carrying their layer's depth units in their
 * records (`page.depthBias`, `visWriteWgsl`). A source whose pages stack deeper than the session's
 * slots — a model compiled with coplanar surfaces, joining a world opened on none — is granted the
 * slots it needs by the open's own functions: the uniforms are made beside the running ones, and
 * put in place in one step between two images, the bins made again for the new slots at the next
 * frame (`../render/visibleTables.ts`).
 * Queued behind the growths of the lanes (`queueTableGrowth`).
 */
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
 *  false when the device refuses them. */
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
  const { vis, run } = rt
  // Granted meanwhile, by another source's growth ahead of this one in the queue.
  if (slots <= vis.drawLayerSlots) return true
  if (run.lost) return false
  const uniform = await deviceMade(device, () => {
    const next = visUniformBuffer(device, visUniformSlots({ drawLayerSlots: slots }))
    return pendingBuffers(device, [next], () => {
      const old = vis.visUniform
      vis.visUniform = next
      return [old]
    })
  })
  // The session was lost or disposed while these were made: nothing is changed.
  if (!uniform || stopped(rt)) {
    uniform?.destroy()
    return false
  }
  vis.drawLayerSlots = slots
  uniform.commit()
  dropRaster(rt)
  // Origin of the resource change: the slots and the uniforms were replaced.
  run.gate.resourcesChanged()
  rt.diag.engineDiagnostic('coplanar-layers-grown', 'Coplanar layers granted in place', {
    layers: slots - 1,
  })
  return true
}
