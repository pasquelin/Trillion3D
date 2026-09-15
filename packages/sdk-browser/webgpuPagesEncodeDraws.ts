import { frustumPlanesFromMatrix } from '../sdk-core/index.ts';
import { WebGPUCoordinateSystem } from 'three';
import type * as THREE from 'three';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { projectedPageError } from './pageSelection.ts';
import { screenErrorRatio } from './diagnosticColors.ts';
import { selectWebgpuBlend } from './webgpuBlendSelection.ts';
import { drawWebgpuFallback } from './webgpuFallbackDraw.ts';
import { remap, viewProj } from './webgpuPagesHelpers.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import {
  abandonFrameEncoder,
  createRenderEncoder,
  encodeClear,
  submitColorCopy,
} from './webgpuPagesEncoder.ts';
import { encodeBlend } from './webgpuPagesEncodeBlend.ts';
import { encodeVis } from './webgpuPagesEncodeVis.ts';
import { dropVis } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The row table spans every row a page can claim, so it is allocated once and never resized. */
export function ensurePageTable(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    { rows, drawSlots } = rt.layout;
  if (rows.pageTableFloats) return;
  const bytes = Math.max(PAGE_INFO_STRIDE, drawSlots * PAGE_INFO_STRIDE);
  rows.pageTableFloats = new Float32Array(bytes / 4);
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer);
  vis.pageTable?.destroy();
  vis.shadeBindGroup = undefined;
  vis.visBindGroup = undefined;
  vis.visHizBindGroup = undefined;
  vis.visSlotGroups.fill(undefined);
  vis.smallGroups.fill(undefined);
  vis.pageTable = device.createBuffer({
    label: 'WG page table',
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/** Uploads the span of rows whose bytes changed, and nothing when none did. */
export function uploadDirtyRows(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { rows, drawSlots } = rt.layout,
    { pageTable } = rt.vis;
  rt.timing.encodeCounts.lignesTeleversees = Math.max(0, rows.dirtyTo - rows.dirtyFrom + 1);
  if (rows.dirtyTo < rows.dirtyFrom || !pageTable || !rows.pageTableFloats) return;
  device.queue.writeBuffer(
    pageTable,
    rows.dirtyFrom * PAGE_INFO_STRIDE,
    rows.pageTableFloats.buffer as ArrayBuffer,
    rows.dirtyFrom * PAGE_INFO_STRIDE,
    (rows.dirtyTo - rows.dirtyFrom + 1) * PAGE_INFO_STRIDE,
  );
  rows.dirtyFrom = drawSlots;
  rows.dirtyTo = -1;
}

/** Encodes and submits one image of the drawn cut; returns the triangles it submitted. */
export function encodeDraws(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  camera: THREE.PerspectiveCamera,
) {
  const { gpu, vis, run, timing, blendState, capture, context, diag } = rt,
    { rows } = rt.layout,
    { viewport } = rt.setup;
  run.gpuDrawCalls = 0;
  run.blendDrawCalls = 0;
  run.blendFrustumRejected = 0;
  blendState.visibleBlend.length = 0;
  timing.transparentEncodeMs = 0;
  if (!gpu.bindGroupLayout || !gpu.cache || !gpu.colorView || !gpu.depthView) return 0;
  const [width, height] = gpu.targetSize;
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustumPlanesFromMatrix(
    blendState.blendPlanes,
    viewProj.elements,
    camera.coordinateSystem === WebGPUCoordinateSystem,
  );
  run.blendFrustumRejected = selectWebgpuBlend(blendState);
  viewProj.premultiply(remap);
  ensurePageTable(rt, device);
  if (!run.gpuFrameActive) rt.services.syncRowsFromCut();
  else if (run.rowsSyncedFrame !== run.frame) {
    rt.services.syncRows();
    run.rowsSyncedFrame = run.frame;
  }
  if (run.diagnostic === 'screen-error' && rows.pageTableFloats) {
    const rowWords = PAGE_INFO_STRIDE / 4;
    for (let row = 0; row < rows.packedCount; row++) {
      const rec = rows.packedRecs[row];
      if (!rec) continue;
      rows.pageTableFloats[row * rowWords + 56] = screenErrorRatio(
        projectedPageError(rec, camera, viewport),
        run.diagnosticPixelError,
      );
      rows.markRowDirty(row);
    }
  }
  const itemsDirty = rows.rowsChanged;
  if (vis.visEnabled && vis.visPipelineBack && vis.shadePipeline && vis.visView) {
    try {
      return encodeVis(rt, device, camera, itemsDirty);
    } catch (error) {
      abandonFrameEncoder(rt);
      timing.gpuTiming?.cancelUnsubmitted();
      diag.diagnosticFailure('visibility-render-failed', error);
      dropVis(rt);
      run.gpuDrawCalls = 0;
      if (context.gpuCanvas || capture.secondaryCamera || run.gpuFrameActive) throw error;
    }
  }
  if (!gpu.pipelineBack) return 0;
  uploadDirtyRows(rt, device);
  if (!rows.packedCount) {
    const encoder = createRenderEncoder(rt, device);
    encodeClear(rt, encoder);
    encodeBlend(rt, device, encoder, 0);
    submitColorCopy(rt, device, encoder, height, width);
    return run.blendSubmittedTriangles;
  }
  ensureUniform(rt, device, Math.max(1, rows.packedCount + blendState.blendGpu.length));
  const { encoder, vertices } = drawWebgpuFallback(rt, device);
  encodeBlend(rt, device, encoder, rows.packedCount);
  submitColorCopy(rt, device, encoder, height, width);
  return vertices / 3 + run.blendSubmittedTriangles;
}
