import { wantsReflections } from '../../../reflections/gpu.ts';
import { requestFrameTargets } from '../prepare/targetGrant.ts';
import { selectCpuCasters, writeCpuCasters } from '../../shadow/cpuCasters.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { projectedPageError, rootOf } from '../../../page/selection/selection.ts';
import { screenErrorRatio } from '../../../diagnostic/colors.ts';
import { drawWebgpuFallback } from '../../frame/fallbackDraw.ts';
import { viewProj } from '../helpers.ts';
import { taaRenderMatrix } from '../../../taa/frame.ts';
import { ensureUniform } from '../prepare/pipelineFor.ts';
import {
  abandonFrameEncoder,
  openFrameEncoder,
  createRenderEncoder,
  encodeClear,
  submitColorCopy,
} from './encoder.ts';
import { encodeBlend } from './encodeBlend.ts';
import { ensurePageTable } from './pageTable.ts';
import { encodeWebgpuGuides, guidesShown } from './encodeGuides.ts';
import { encodeVis } from './encodeVis.ts';
import { dropVis } from '../io/drops.ts';
import { uploadRowCorners } from '../../visibility/corners.ts';
import { refreshDrawItemWords } from '../../visibility/itemWords.ts';
import { visLayerTop } from '../../visibility/uniforms.ts';
import { uploadClusterSpheres, uploadRowMobility } from '../../shadow/bounds.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { displayApart } from '../state/renderScale.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import { uploadDirtyRows } from './dirtyRows.ts';

export { ensurePageTable, pageTableBuffer } from './pageTable.ts';

/**
 * Brings every reader of the row table's dirty marks up to date, then uploads the rows and clears
 * the marks. Both encode paths call it: the fallback draw clears the marks too, and a witness it
 * skipped — draw records, spheres, mobility, corners — would keep another occupant's words once
 * the visibility pass comes back on the same targets (#198). Each costs the rows that changed.
 */
export function followDirtyRows(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { rows } = rt.layout;
  refreshDrawItemWords(rt, visLayerTop(rt.vis), rt.vis.gpuDraw);
  if (rt.lights.cull) {
    uploadClusterSpheres(rt, device);
    uploadRowMobility(rt, device, rows.dirtyFrom, rows.dirtyTo);
  }
  uploadRowCorners(rt);
  uploadDirtyRows(rt);
}

/** Encodes and submits one image of the drawn cut; returns the triangles it submitted. */
/** The visibility pass can encode this image: the path under which light casters get rows. */
const visReady = ({ vis }: WebgpuPagesRuntime) =>
  vis.visEnabled && !!vis.visPipelineBack && !!vis.materialDepthPipeline && !!vis.visView;

export function encodeDraws(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, timing, blendState, capture, context, diag } = rt,
    { rows } = rt.layout,
    { viewport } = rt.setup;
  run.gpuDrawCalls = 0;
  run.gpuComputeDispatches = 0;
  run.blendDrawCalls = 0;
  run.blendFrustumRejected = 0;
  timing.transparentEncodeMs = 0;
  timing.transparentSelectMs = 0;
  timing.transparentPrepareMs = 0;
  timing.transparentDrawMs = 0;
  timing.transparentSpanUploadBytes = 0;
  if (!gpu.bindGroupLayout || !gpu.cache || !gpu.colorView || !gpu.depthView) return 0;
  // Frustum planes and view-projection are those image entry posted: the engine has one depth
  // convention (`../../../camera/depthConvention.ts`), so nothing is converted along the path.
  blendState.blendPlanes.set(cam.planes);
  // The render matrix carries temporal-antialiasing jitter; the camera knows nothing of it.
  viewProj.set(taaRenderMatrix(rt, cam));
  ensurePageTable(rt, device);
  if (!run.gpuFrameActive) {
    // The CPU cut selects its shadow casters from the lights before it writes its rows: those the
    // camera does not draw take rows behind the camera's.
    const shadows = visReady(rt) && vis.gpuDraw ? selectCpuCasters(rt, device, cam) : undefined;
    run.cameraRows = rt.services.syncRowsFromCut(shadows, rt.lights.cpuCasters?.castersPacked);
    if (shadows) writeCpuCasters(rt, device);
  } else if (run.rowsSyncedFrame !== run.frame) {
    rt.services.syncRows(!run.textureConverging);
    run.rowsSyncedFrame = run.frame;
  }
  if (gpu.reflection && gpu.reflection.active !== wantsReflections(rt)) {
    abandonFrameEncoder(rt);
    void requestFrameTargets(rt, device);
    return 0;
  }
  if (run.diagnostic === 'screen-error' && rows.pageTableFloats) {
    const rowWords = PAGE_INFO_STRIDE / 4;
    for (let row = 0; row < rows.packedCount; row++) {
      const rec = rows.packedRecs[row];
      if (!rec) continue;
      rows.pageTableFloats[row * rowWords + 56] = screenErrorRatio(
        projectedPageError(
          rec,
          rootOf(
            rt.layout.selectionRoots,
            rt.layout.placement.rootOfPacked[rows.packedPageIndex[row]],
          ).world,
          cam,
          viewport,
        ),
        run.diagnosticPixelError,
      );
      rows.markRowWords(row);
    }
  }
  if (vis.deformationCompute)
    vis.deformationCode!.encodeDeformation(rt, timing.frameEncoder ?? openFrameEncoder(rt, device));
  if (visReady(rt)) {
    try {
      return encodeVis(rt, device, cam);
    } catch (error) {
      abandonFrameEncoder(rt);
      timing.gpuTiming?.cancelUnsubmitted();
      diag.diagnosticFailure('visibility-render-failed', error);
      if (vis.deformation?.any) throw error;
      dropVis(rt);
      // The fallback draw walks every row: the light casters' rows leave before it runs.
      if (!run.gpuFrameActive && run.cameraRows < rows.packedCount)
        run.cameraRows = rt.services.syncRowsFromCut();
      run.gpuDrawCalls = 0;
      if (context.gpuCanvas || capture.capturing || run.gpuFrameActive) throw error;
    }
  }
  // The fallback draws into the colour target: targets drawn below the display are remade at its
  // size first, never presenting a display colour this image did not write.
  if (displayApart(gpu)) {
    abandonFrameEncoder(rt);
    void requestFrameTargets(rt, device);
    return 0;
  }
  if (!gpu.pipelineBack) return 0;
  followDirtyRows(rt, device);
  if (!rows.packedCount) {
    const encoder = createRenderEncoder(rt, device);
    encodeClear(rt, encoder);
    submitFallback(rt, device, encoder, cam, 0);
    return run.blendSubmittedTriangles;
  }
  ensureUniform(rt, device, Math.max(1, rows.packedCount + blendState.blendGpu.length));
  const { encoder, vertices } = drawWebgpuFallback(rt, device);
  submitFallback(rt, device, encoder, cam, rows.packedCount);
  return vertices / 3 + run.blendSubmittedTriangles;
}

/**
 * The end of every fallback image — blend, guides, copy — in one place: a branch that submits
 * without it would drop the guides and never record their revision, so no frame would hold again.
 */
function submitFallback(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  uniformBase: number,
) {
  const [width, height] = rt.gpu.targetSize;
  // No composition follows: the water word may not borrow the display colour (`encodeWaterPass`).
  encodeBlend(rt, device, encoder, uniformBase, false);
  if (guidesShown(rt)) encodeWebgpuGuides(rt, device, encoder, cam);
  submitColorCopy(rt, device, encoder, height, width);
}
