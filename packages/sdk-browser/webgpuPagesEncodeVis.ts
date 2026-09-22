import type { EngineCamera } from './cameraWorld.ts';
import { encodeMaterialPasses } from './webgpuMaterialPasses.ts';
import { VIS_MAX_PAGES } from './visibilityBuffer.ts';
import { encodeWebgpuPartition } from './webgpuVisibilityPartition.ts';
import { uploadRowCorners } from './webgpuVisibilityCorners.ts';
import { clearDrawItemWords, refreshDrawItemWords } from './webgpuVisibilityItemWords.ts';
import { encodeWebgpuVisibilityPasses } from './webgpuVisibilityPasses.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { visLayerTop } from './webgpuVisibilityUniforms.ts';
import { createRenderEncoder, submitColorCopy } from './webgpuPagesEncoder.ts';
import { encodeSurfaceLighting } from './webgpuPagesEncodeBlend.ts';
import { uploadDirtyRows } from './webgpuPagesEncodeDraws.ts';
import { uploadClusterSpheres } from './webgpuShadowBounds.ts';
import {
  encodeEmptySurfaces,
  computeRasterStages,
  ensureGpuRaster,
  ensureVisBindings,
} from './webgpuPagesEncodeVisSetup.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The visibility-buffer image: occluder and rest raster passes, small triangles, material surfaces,
 *  lighting and presentation, all in the image's command buffer. Returns the triangles submitted. */
export function encodeVis(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, timing, blendState, layout } = rt,
    { rows, drawSlots } = layout;
  if (
    !vis.visBindGroupLayout ||
    !gpu.cache ||
    !vis.concatPos ||
    !gpu.colorView ||
    !gpu.depthView ||
    !vis.visView ||
    !vis.visPipelineBack ||
    !vis.materialDepthPipeline ||
    !vis.pageTable ||
    !rows.pageTableInts
  )
    return 0;
  const idsView = vis.visView,
    depthTarget = gpu.depthView;
  const [width, height] = gpu.targetSize;
  if (!rows.packedCount) return encodeEmptySurfaces(rt, device, cam, depthTarget);
  ensureUniform(rt, device, Math.max(1, rows.packedCount + blendState.blendGpu.length));
  ensureGpuRaster(rt, device);
  // Corners of the widest page of the catalogue, never the slot's word count: the slot holds a
  // quantized page whose byte width is unrelated to how many corners the cluster draws.
  const maxVertexCount = rt.setup.maxCorners;
  const useIndirect = !!vis.gpuDraw && rows.packedCount <= drawSlots;
  // The table holds every row ever claimed, so a row a page keeps stays valid across frames.
  const tableRows = rows.rowCount;
  if (tableRows > VIS_MAX_PAGES)
    throw new Error(
      `VISIBILITY_ID_RANGE: ${tableRows} pages exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`,
    );
  // Row words follow only the row table: this image's dirty range, and nothing more. They must be
  // kept up to date BEFORE `uploadDirtyRows`, which closes that range.
  const words = refreshDrawItemWords(rt, visLayerTop(rt.vis), vis.gpuDraw);
  timing.encodeCounts.fichesTeleversees = Math.max(0, words.to - words.from + 1);
  // World spheres of the rows the table just changed, on the same dirty interval as the table
  // itself: that is what shadow culling reads, and nothing else writes them.
  if (rt.lights.cull) uploadClusterSpheres(rt, device, rows.dirtyFrom, rows.dirtyTo);
  // World corners of the same rows, on the same interval: what GPU projection reads. Like the two
  // above, it is taken BEFORE `uploadDirtyRows`, which closes that range.
  if (vis.gpuPartition) uploadRowCorners(rt, vis.gpuPartition);
  uploadDirtyRows(rt, device);
  ensureVisBindings(rt, device, tableRows);
  const encoder = createRenderEncoder(rt, device);
  // The image's partition opens the command buffer: it writes the rest bits and the per-slot counts
  // draw compaction reads right after, and the bounds the occlusion test will read later. It rereads
  // along the way the previous image's verdicts, which this image's test has not yet zeroed: that is
  // what feeds the occluder history.
  const { twoPass } = encodeWebgpuPartition(rt, encoder, cam, useIndirect);
  // Row words restat the rows: uploading their range is what consumes the change flag.
  if (useIndirect) {
    vis.gpuDraw!.encode(
      encoder,
      layout.drawItemWords,
      rows.packedCount,
      words.from,
      words.to,
      maxVertexCount,
      run.gpuFrameActive ? run.gpuSelection : undefined,
    );
    clearDrawItemWords(words);
    rows.rowsChanged = false;
  }
  // The hardware raster opens the opaque image and draws its share of the cut; the compute raster,
  // when it exists, blends its own between its passes — small triangles under the reference split,
  // the whole cut under the `raster-calcul` variant.
  run.gpuComputeDispatches = 0;
  const compute = vis.gpuRaster
    ? computeRasterStages(rt, twoPass, tableRows, maxVertexCount, idsView, depthTarget)
    : null;
  encodeWebgpuVisibilityPasses(rt, device, encoder, twoPass, tableRows, useIndirect, compute);
  // Counts the GPU just wrote — partition and occlusion verdicts — are copied one image in fifteen,
  // and mapped once the image is submitted. No image waits for that readback.
  if (vis.gpuPartition?.countsDue(run.frame)) vis.gpuPartition.encodeCounts(encoder, run.frame);
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView) throw new Error('DEFERRED_UNAVAILABLE');
  // Surfaces, one class at a time, and the virtual-texture feedback target where each opaque
  // pixel posts the tile rank it wants — completed by transparents, reduced to counts at submit.
  encodeMaterialPasses(rt, encoder);
  const presented = encodeSurfaceLighting(rt, device, encoder, cam, rows.packedCount);
  submitColorCopy(rt, device, encoder, height, width, presented);
  // Submitted triangles are those of every drawable row: both halves are drawn, and a cluster the
  // occlusion test rejects was still submitted. The total is held by the row table, on its dirty
  // range only.
  return layout.itemWordsHold.total + run.blendSubmittedTriangles;
}
