/**
 * THE COPLANAR LAYERS A SOURCE BRINGS ARE GRANTED IN PLACE. A session draws one set of indirect
 * slots for each coplanar layer its pages carry (`depthLayerSlots`, the open's rule): the compaction
 * is made for that many (`createGpuDraw`), the visibility uniforms hold a slot for each, a pipeline
 * of its own carries each layer's depth bias (`buildLayerPipelines`). A source whose pages stack
 * deeper than the session's slots — a model compiled with coplanar surfaces, joining a world opened
 * on none — is granted the slots it needs by the open's own functions: the compaction, the layers'
 * pipelines and the uniforms are made beside the running ones, and put in place in one step between
 * two images, the partition and the tested half's compaction reading the new compaction
 * (`partitionSourcesOf`, `restSourcesOf`), the draw records written again (`refreshDrawItemWords`).
 * Queued behind the growths of the tables (`queueTableGrowth`): both read the compaction.
 *
 * Cost of a grant from L to L' layers over R rows: the compaction's buffers for L' (R·(5+perRow)
 * words and (L'-L)·slots commands), L'-L layers of pipelines, the draw records sent once; every
 * other table is the session's.
 */
import { createGpuDraw } from '../../../gpu/draw/draw.ts'
import { deviceMade } from '../../../gpu/core/errorScope.ts'
import { pendingBuffers } from '../../../gpu/core/tableGrowth.ts'
import { visUniformLayout } from '../../core/bindLayout.ts'
import { visUniformSlots } from '../../visibility/uniforms.ts'
import { invalidateOccluderHistory } from '../io/drops.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { partitionSourcesOf, restSourcesOf } from './drawSources.ts'
import { queueTableGrowth } from './growthQueue.ts'
import { buildLayerPipelines } from './visibilitySteps.ts'
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
  const { vis, layout, setup, run, signal } = rt
  // Granted meanwhile, by another source's growth ahead of this one in the queue.
  if (slots <= vis.drawLayerSlots) return true
  const { gpuHiz: hiz, gpuPartition: partition, gpuRestCompact: rest, gpuDraw: held } = vis
  const { visModule, visBindGroupLayout } = vis
  if (!hiz || !partition || !rest || !held || !visModule || !visBindGroupLayout || run.lost)
    return false
  const [draw, pipelines] = await Promise.all([
    createGpuDraw(device, layout.drawSlots, slots, setup.maxCorners),
    buildLayerPipelines(
      rt,
      device,
      visModule,
      visBindGroupLayout,
      slots,
      rt.context.diagnosticGpuVariant,
    ),
  ])
  const uniform = await deviceMade(device, () => {
    const next = device.createBuffer({
      label: 'Trillion3D visibility uniforms',
      size: visUniformLayout(device.limits, visUniformSlots({ drawLayerSlots: slots })).bytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    return pendingBuffers([next], () => {
      const old = vis.visUniform
      vis.visUniform = next
      return [old]
    })
  })
  // The draw path moved while these were made (a lost device, a disposal): nothing is changed.
  const stale = vis.gpuDraw !== held || run.lost || signal.aborted
  if (!draw || !pipelines || !uniform || stale) {
    draw?.dispose()
    uniform?.destroy()
    return false
  }
  vis.gpuDraw = draw
  vis.drawLayerSlots = slots
  vis.visLayerPipelines = pipelines
  uniform.commit()
  partition.rebind(() => partitionSourcesOf(draw, hiz))
  rest.rebind(restSourcesOf(draw, hiz, partition))
  held.dispose()
  // The compute raster reads the compaction: made again at the next image; no occluder history
  // describes the new one.
  vis.gpuRaster?.dispose()
  vis.gpuRaster = undefined
  invalidateOccluderHistory(run)
  // Origin of the resource change: the slots, the compaction and the uniforms were replaced.
  run.gate.resourcesChanged()
  rt.diag.engineDiagnostic('coplanar-layers-grown', 'Coplanar layers granted in place', {
    layers: slots - 1,
  })
  return true
}
