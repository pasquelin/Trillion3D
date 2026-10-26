import type { ComputeRun } from '../gpu/core/lazyComputePass.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/** The stage's buffers, refilled each image: the compute keeps its own copy when it binds them. */
const buffers: (GPUBuffer | GPUTextureView)[] = []

/** Fills `buffers` with what the stage reads and writes: the geometry pool, the normal atlas, the
 *  decoded clusters, the UVs and the work buffer that lists the clusters to deform. False while
 *  one is missing. */
function fillBuffers(rt: WebgpuPagesRuntime) {
  const { gpu, vis } = rt
  const cache = gpu.cache
  if (!cache || !vis.concatPos || !vis.concatNrm || !vis.concatUv || !vis.pageTable) return false
  buffers[0] = cache.buffer
  buffers[1] = vis.concatPos
  buffers[2] = vis.concatNrm // the normal atlas's view
  buffers[3] = vis.pageTable
  buffers[4] = vis.concatUv
  buffers[5] = vis.gpuBins?.workBuffer ?? vis.zeroRows!
  return true
}

/** The deformation's first stage, once an image, before the cut, selection or raster: the bank pass
 *  — every image the session holds a track (`bankTracks.ts`) —, then the float-pool blocks, which
 *  the rows of the pooled table deform for every page that reads them. The clusters the image
 *  draws deform later, once their records are decoded (`encodeDeformedClusters`). */
export function encodeDeformation(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { vis } = rt
  if (!vis.deformationCompute || !fillBuffers(rt)) return
  vis.deformationCompute.encode(
    encoder,
    buffers,
    rt.run.frame,
    vis.pooledDeformation,
    vis.deformation,
  )
}

/** The deformation's second stage, once a pass of the cut: the clusters whose vertices a deformation
 *  moves, which the pass's decode listed, deformed, before the bins and the rasters read their
 *  vertices. */
export function encodeDeformedClusters(rt: WebgpuPagesRuntime, run: ComputeRun) {
  const { vis } = rt
  if (!vis.deformationCompute || !fillBuffers(rt)) return
  vis.deformationCompute.encodeClusters(run, buffers, rt.run.frame)
}
