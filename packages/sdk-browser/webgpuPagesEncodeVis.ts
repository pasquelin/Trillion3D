import type * as THREE from 'three';
import { VIS_MAX_PAGES } from './visibilityBuffer.ts';
import { partitionWebgpuVisibility } from './webgpuVisibilityPartition.ts';
import { buildWebgpuVisibilityItems } from './webgpuVisibilityItems.ts';
import { encodeWebgpuVisibilityPasses } from './webgpuVisibilityPasses.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { createRenderEncoder, submitColorCopy } from './webgpuPagesEncoder.ts';
import { encodeSurfaceLighting } from './webgpuPagesEncodeBlend.ts';
import { uploadDirtyRows } from './webgpuPagesEncodeDraws.ts';
import {
  encodeEmptySurfaces,
  encodeSmallTriangles,
  ensureGpuSmall,
  ensureVisBindings,
} from './webgpuPagesEncodeVisSetup.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The visibility-buffer image: occluder and rest raster passes, small triangles, material surfaces,
 *  lighting and presentation, all in the image's command buffer. Returns the triangles submitted. */
export function encodeVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  camera: THREE.PerspectiveCamera,
  itemsDirty: boolean,
) {
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
    !vis.shadePipeline ||
    !vis.pageTable ||
    !rows.pageTableInts
  )
    return 0;
  const idsView = vis.visView,
    depthTarget = gpu.depthView;
  const [width, height] = gpu.targetSize;
  if (!rows.packedCount) return encodeEmptySurfaces(rt, device, camera, depthTarget);
  ensureUniform(rt, device, Math.max(1, rows.packedCount + blendState.blendGpu.length));
  ensureGpuSmall(rt, device);
  // Occluder/rest partition of the image: the half the previous image drew unoccluded, and the nearest
  // half by depth when there is no history or the history splits nothing. The boxes feed both the
  // partition and the Hi-Z test, projected with the view-projection built once for the batch rather
  // than once per page and once again per tested page.
  const partition = partitionWebgpuVisibility(rt, camera);
  const { twoPass } = partition;
  timing.lastItemsMs = 0;
  const maxVertexCount = Math.max(1, rt.setup.pageBytes / 4);
  const useIndirect = !!vis.gpuDraw && rows.packedCount <= drawSlots;
  // The table holds every row ever claimed, so a row a page keeps stays valid across frames.
  const tableRows = rows.rowCount;
  if (tableRows > VIS_MAX_PAGES)
    throw new Error(
      `VISIBILITY_ID_RANGE: ${tableRows} pages exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`,
    );
  const items = buildWebgpuVisibilityItems(rt, twoPass, itemsDirty);
  uploadDirtyRows(rt, device);
  ensureVisBindings(rt, device, tableRows);
  const encoder = createRenderEncoder(rt, device);
  // The item words restate the rows, so the upload is what consumes the changed flag.
  if (useIndirect) {
    vis.gpuDraw!.encode(
      encoder,
      layout.drawItemWords,
      rows.packedCount,
      itemsDirty,
      layout.drawRestBits,
      maxVertexCount,
      run.gpuFrameActive ? run.gpuSelection : undefined,
    );
    rows.rowsChanged = false;
  }
  const vertices = encodeWebgpuVisibilityPasses(
    rt,
    device,
    encoder,
    partition,
    items,
    tableRows,
    useIndirect,
  );
  encodeSmallTriangles(rt, encoder, twoPass, tableRows, maxVertexCount, idsView, depthTarget);
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView) throw new Error('DEFERRED_UNAVAILABLE');
  const shadePass = encoder.beginRenderPass({
    label: 'WG material surfaces v1',
    colorAttachments: gpu.surfaces.views().map((view) => ({
      view,
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    })),
  });
  shadePass.setViewport(0, 0, width, height, 0, 1);
  if (vis.shadeBindGroup) {
    shadePass.setPipeline(vis.shadePipeline);
    shadePass.setBindGroup(0, vis.shadeBindGroup);
    shadePass.draw(3);
    run.gpuDrawCalls++;
  }
  shadePass.end();
  const presented = encodeSurfaceLighting(rt, device, encoder, camera, rows.packedCount);
  submitColorCopy(rt, device, encoder, height, width, presented);
  return vertices / 3 + run.blendSubmittedTriangles;
}
