import type { EngineCamera } from '../../camera/engineCamera.ts'
import { encodeMaterialPasses } from '../../materials/classes/materialPasses.ts'
import { VIS_MAX_PAGES } from '../../visibility/types.ts'
import { beginTransparentOcclusion } from '../../blend/transparent/occlusionHost.ts'
import { sendDrawItemWords } from '../../visibility/passes/itemWords.ts'
import { encodeWebgpuVisibilityPasses } from '../../visibility/passes/passes.ts'
import { skyLightSubmitted } from './encodeSkyLight.ts'
import { createRenderEncoder, openFrameEncoder, submitColorCopy } from './encoder.ts'
import { encodeRowWords } from '../../placement/rows/rowWordsPass.ts'
import { encodeSurfaceLighting } from './surfaceLighting.ts'
import { followLobes } from '../prepare/lobesTarget.ts'
import {
  encodeEmptySurfaces,
  ensureGpuRaster,
  ensureVisBindings,
  visibilityRasterStages,
} from './encodeVisSetup.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { prepared } from '../backend/state/prepared.ts'
import { PARTITION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'

/** The visibility's opening compute pass, the main pass's draw compaction, opened once it
 *  dispatches. */
const compactionPass = new LazyComputePass(PARTITION_PASS)

/** The visibility-buffer image: the cluster split and the software binning, main and post
 *  raster passes, material surfaces, lighting and presentation, all in the image's command buffer.
 *  Returns the triangles submitted. */
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
  const depthTarget = gpu.depthView
  const [width, height] = gpu.targetSize
  encodeRowWords(rt, device, timing.frameEncoder ?? openFrameEncoder(rt, device))
  followLobes(rt) // Every image's, one of transmissive lobed surfaces alone too.
  if (!rows.packedCount) return encodeEmptySurfaces(rt, device, cam, depthTarget)
  ensureGpuRaster(rt, device)
  // The table holds every row ever claimed, so a row a page keeps stays valid across frames.
  const tableRows = rows.rowCount
  if (tableRows > VIS_MAX_PAGES)
    throw new Error(
      `VISIBILITY_ID_RANGE: ${tableRows} pages exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`,
    )
  ensureVisBindings(rt, device, cam, tableRows)
  const encoder = createRenderEncoder(rt, device)
  // The frame the transparent clusters are tested under, written before the image's commands.
  beginTransparentOcclusion(rt, cam)
  // This image's pyramid is the one the next image's cut occlusion reads (`noOccluderHistory`).
  run.noOccluderHistory = false
  sendDrawItemWords(rt)
  run.gpuComputeDispatches = 0
  // The cluster split and the main pass's binning run before the compaction, their `raster` words
  // what it reads.
  const raster = visibilityRasterStages(rt, device, encoder)
  if (!raster) throw new Error('VISIBILITY_RASTER_UNAVAILABLE')
  const pass = compactionPass.begin(encoder)
  // The rows are the GPU cut's cache: its frame mask, before the post pass, says which the main
  // pass draws; the post pass's are compacted by the raster's `rest` (`encodeVisSetup.ts`).
  prepared(vis, 'gpuDraw').encode(pass, rows.packedCount, run.gpuSelection)
  pass.end()
  encodeWebgpuVisibilityPasses(rt, encoder, raster)
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView) throw new Error('DEFERRED_UNAVAILABLE')
  // Surfaces, one class at a time, and the virtual-texture feedback target where each opaque
  // pixel posts the tile rank it wants — completed by transparents, reduced to counts at submit.
  encodeMaterialPasses(rt, encoder)
  // The voxel trace's counters of a sampled image, copied, then mapped once the image is
  // submitted: no image waits for that readback.
  vis.voxelSteps?.encodeCopy(encoder, run.frame)
  const presented = encodeSurfaceLighting(rt, device, encoder, cam)
  submitColorCopy(rt, device, encoder, height, width, presented)
  // A captured scene that is due is drawn between this image and the next.
  skyLightSubmitted(rt)
  // Submitted triangles are those of every drawable row, the ones the cut's masks leave undrawn
  // included. The total is held by the row table, on its dirty rows only.
  return layout.itemWordsHold.total + run.blendSubmittedTriangles
}
