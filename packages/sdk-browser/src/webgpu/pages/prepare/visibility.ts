import { createWebgpuVisibilityShaders } from '../../visibility/shaders.ts'
import { visUniformSlots } from '../../visibility/uniforms.ts'
import { MAX_DEPTH_LAYER } from '../../../../../sdk-core/src/index.ts'
import { createGpuHiz } from '../../../gpu/hiz/hiz.ts'
import type { GpuHiz } from '../../../gpu/hiz/types.ts'
import { validated } from '../../../gpu/core/errorScope.ts'
import { createGpuDraw } from '../../../gpu/draw/draw.ts'
import { createGpuPartition } from '../../../gpu/partition/factory.ts'
import { createGpuRestCompact } from '../../../gpu/raster/restCompact.ts'
import { prepareTransparentOcclusion } from '../../transparent/occlusionHost.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import {
  bindShade,
  prepareBlendPipelines,
  prepareLayerPipelines,
  prepareRasterPipelines,
  prepareShadeClasses,
} from './visibilitySteps.ts'

/** Builds the blend pipelines, the visibility raster and shade pipelines, the Hi-Z pyramid, the
 *  indirect draw and the partition; throws by name when one of them cannot be made: the visibility
 *  pass is the one image (#1483). */
export async function prepareWebgpuVisibility(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis } = rt,
    { drawSlots } = rt.layout
  await prepareBlendPipelines(rt, gpuDevice)
  // Coplanar depth sets draw slots before visibility uniforms and indirect compaction.
  let maxDepthLayer = 0
  for (const rec of rt.setup.allPages)
    if (rec.depthLayer > maxDepthLayer) maxDepthLayer = rec.depthLayer
  vis.drawLayerSlots = 1 + Math.min(maxDepthLayer, MAX_DEPTH_LAYER)
  const variant = rt.context?.diagnosticGpuVariant
  const shaders = await createWebgpuVisibilityShaders(
    gpuDevice,
    drawSlots,
    visUniformSlots(vis),
    variant,
    rt.context.feedbackTargetAB === true,
    vis.writesFeedback,
  )
  vis.shadeUniform = shaders.shadeUniform
  vis.visBindGroupLayout = shaders.visBindGroupLayout
  vis.zeroFlags = shaders.zeroFlags
  vis.visUniform = shaders.visUniform
  const hiz = await createHizFor(rt, gpuDevice)
  await prepareRasterPipelines(rt, gpuDevice, shaders, variant)
  await prepareLayerPipelines(rt, gpuDevice, shaders, variant)
  const classes = await prepareShadeClasses(rt, gpuDevice, shaders, variant)
  await bindShade(rt, gpuDevice, shaders, classes)
  await prepareDrawPath(rt, gpuDevice, hiz)
  // Transparent occlusion last: it borrows the pyramid, partition uniform and compaction verdicts.
  await prepareTransparentOcclusion(rt, gpuDevice)
}

/** Hi-Z is the one occlusion path (#1483): a device that cannot hold its pyramid at the view's
 *  size refuses the scene by name, as one that cannot build the raster that writes it. */
async function createHizFor(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const [width, height] = rt.setup.viewport
  const hiz = await createGpuHiz(gpuDevice, 1, 1, rt.layout.drawSlots)
  const size = () => hiz?.resize(gpuDevice, Math.max(1, width), Math.max(1, height)) || undefined
  if (!hiz || !(await validated(gpuDevice, size, 'out-of-memory'))) {
    hiz?.dispose()
    throw new Error('WEBGPU_HIZ_UNAVAILABLE')
  }
  rt.vis.gpuHiz = hiz
  return hiz
}

/** Indirect draws and the partition are the one draw path: without them nothing draws. */
async function prepareDrawPath(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, hiz: GpuHiz) {
  const { vis } = rt,
    { drawSlots } = rt.layout
  const gpuDraw = await createGpuDraw(gpuDevice, drawSlots, vis.drawLayerSlots, rt.setup.maxCorners)
  if (!gpuDraw) throw new Error('WEBGPU_DRAW_UNAVAILABLE')
  vis.gpuDraw = gpuDraw
  // The partition mounts last: it writes compaction buffers and rereads pyramid verdicts.
  const partition = await createGpuPartition(gpuDevice, drawSlots, {
    items: gpuDraw.itemsBuffer,
    flags: hiz.flags,
    restBits: gpuDraw.restBitsBuffer,
    slotUsed: gpuDraw.slotUsedBuffer,
    pyramid: () => vis.gpuHiz?.pyramidBuffer(),
  })
  if (!partition) throw new Error('WEBGPU_PARTITION_UNAVAILABLE')
  vis.gpuPartition = partition
  // The tested half's compaction reads the pyramid verdict and draw compaction's list: both.
  vis.gpuRestCompact = await createGpuRestCompact(gpuDevice, {
    instances: gpuDraw.instanceBuffer,
    indirect: gpuDraw.indirectBuffer,
    slotOffsets: gpuDraw.slotOffsetsBuffer,
    flags: hiz.flags,
  })
  hiz.attach(partition.tested, partition.state)
}
