import type { EngineCamera } from '../../../camera/world.ts'
import { encodeMaterialPasses } from '../../core/materialPasses.ts'
import { VIS_MAX_PAGES } from '../../../visibility/buffer.ts'
import { encodeWebgpuPartition } from '../../visibility/partition.ts'
import { sendDrawItemWords } from '../../visibility/itemWords.ts'
import { encodeWebgpuVisibilityPasses } from '../../visibility/passes.ts'
import { createRenderEncoder, openFrameEncoder, submitColorCopy } from './encoder.ts'
import { encodeComposedRows } from '../../../placement/gpuCompose.ts'
import { encodeSurfaceLighting } from './surfaceLighting.ts'
import { followDirtyRows } from './encodeDraws.ts'
import { followLobes } from '../prepare/lobesTarget.ts'
import {
  encodeEmptySurfaces,
  computeRasterStages,
  ensureGpuRaster,
  ensureVisBindings,
} from './encodeVisSetup.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { prepared } from '../state/prepared.ts'
import { PARTITION_PASS } from '../../../stage/passLabels.ts'
import { LazyComputePass } from '../../../gpu/core/lazyComputePass.ts'

/** The visibility's opening compute pass, opened by the first of its modules that dispatches. */
const partitionPass = new LazyComputePass(PARTITION_PASS)

/** The visibility-buffer image: occluder and rest raster passes, small triangles, material surfaces,
 *  lighting and presentation, all in the image's command buffer. Returns the triangles submitted. */
export function encodeVis(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, timing, layout } = rt,
    { rows } = layout
  if (
    !vis.visBindGroupLayout ||
    !gpu.cache ||
    !vis.concatPos ||
    !gpu.depthView ||
    !vis.visView ||
    !vis.visPipelineBack ||
    !vis.shadeClasses ||
    !vis.pageTable ||
    !rows.pageTableInts
  )
    return 0
  const idsView = vis.visView,
    depthTarget = gpu.depthView
  const [width, height] = gpu.targetSize
  // Row words, spheres, mobility and corners follow only the row table: this image's dirty rows.
  // An image with no visibility row sends them too: the blended casters' rows, behind, still feed
  // its shadows, and rows left dirty would keep the frame from being held (#198).
  timing.encodeCounts.itemsUploaded = 0
  followDirtyRows(rt, device)
  encodeComposedRows(rt, device, timing.frameEncoder ?? openFrameEncoder(rt, device))
  followLobes(rt) // Every image's, one of transmissive lobed surfaces alone too.
  if (!rows.packedCount) return encodeEmptySurfaces(rt, device, cam, depthTarget)
  ensureGpuRaster(rt, device)
  // Corners of the widest page of the catalogue, never the slot's word count: the slot holds a
  // quantized page whose byte width is unrelated to how many corners the cluster draws.
  const maxVertexCount = rt.setup.maxCorners
  // The table holds every row ever claimed, so a row a page keeps stays valid across frames.
  const tableRows = rows.rowCount
  if (tableRows > VIS_MAX_PAGES)
    throw new Error(
      `VISIBILITY_ID_RANGE: ${tableRows} pages exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`,
    )
  ensureVisBindings(rt, device, tableRows)
  const encoder = createRenderEncoder(rt, device)
  // The image's partition opens the command buffer: it writes the rest bits and the per-slot counts
  // draw compaction reads right after, and the bounds the occlusion test will read later. It rereads
  // along the way the previous image's verdicts, which this image's test has not yet rewritten: that
  // is what feeds the occluder history. Both are one compute pass, the compaction's dispatches
  // seeing what the partition's wrote.
  const { twoPass } = encodeWebgpuPartition(rt, encoder, cam)
  const pass = partitionPass.begin(encoder)
  prepared(vis, 'gpuPartition').encode(pass)
  sendDrawItemWords(rt)
  // The rows are the GPU cut's cache: its mask says which this image draws.
  prepared(vis, 'gpuDraw').encode(pass, rows.packedCount, run.gpuSelection)
  pass.end()
  // The hardware raster opens the opaque image and draws its share of the cut; the compute raster,
  // when it exists, blends its own between its passes — small triangles under the hybrid split,
  // the whole cut under the `raster-compute` variant.
  run.gpuComputeDispatches = 0
  const compute = vis.gpuRaster
    ? computeRasterStages(rt, twoPass, tableRows, maxVertexCount, idsView, depthTarget)
    : null
  encodeWebgpuVisibilityPasses(rt, device, encoder, twoPass, compute)
  // Counts the GPU just wrote — partition and occlusion verdicts — are copied one image in fifteen,
  // the one whose kernels counted, and mapped once the image is submitted. No image waits for that
  // readback.
  vis.gpuPartition?.encodeCounts(encoder, run.frame)
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView) throw new Error('DEFERRED_UNAVAILABLE')
  // Surfaces, one class at a time, and the virtual-texture feedback target where each opaque
  // pixel posts the tile rank it wants — completed by transparents, reduced to counts at submit.
  encodeMaterialPasses(rt, device, encoder)
  const presented = encodeSurfaceLighting(rt, device, encoder, cam)
  submitColorCopy(rt, device, encoder, height, width, presented)
  // Submitted triangles are those of every drawable row: both halves are drawn, and a cluster the
  // occlusion test rejects was still submitted. The total is held by the row table, on its dirty
  // rows only.
  return layout.itemWordsHold.total + run.blendSubmittedTriangles
}
