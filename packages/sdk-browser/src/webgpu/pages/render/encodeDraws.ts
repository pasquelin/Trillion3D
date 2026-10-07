import { wantsReflections } from '../../../reflections/gpu.ts'
import { requestFrameTargets } from '../prepare/targetGrant.ts'
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import { projectedPageError, rootOf } from '../../../page/selection/selection.ts'
import { screenErrorRatio } from '../../../diagnostic/colors.ts'
import { viewProj } from '../helpers.ts'
import { taaRenderMatrix } from '../../../taa/frame.ts'
import { abandonFrameEncoder, openFrameEncoder } from './encoder.ts'
import { ensurePageTable } from './pageTable.ts'
import { encodeVis } from './encodeVis.ts'
import { uploadRowCorners } from '../../visibility/corners.ts'
import { refreshDrawItemWords } from '../../visibility/itemWords.ts'
import { visLayerTop } from '../../visibility/uniforms.ts'
import { uploadClusterSpheres, uploadDirtyRowMobility } from '../../shadow/bounds.ts'
import { uploadRowLods } from '../../shadow/rowLods.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { EngineCamera } from '../../../camera/world.ts'
import { uploadDirtyRows } from './dirtyRows.ts'
import { castingLights } from './vsm/vsmPlan.ts'

/**
 * The caster rows' shadow data — world spheres, mobility words, detail — exists and follows the
 * row table only while a light casts. While none does, no shadow row buffer is made or written:
 * only the placements' mobility state is sized, which a placement's move reads
 * (`mobility.move`). The first frame a light casts makes them, before that frame's shadow set is
 * granted (`planVsmFrame`, after the rows in `encodeVis`), so the grant's room counts them, and the
 * budget reserved their bytes beside the set's until then (`vsmReserveBytes`); every caster row is
 * marked once, so each reader writes them all. Later frames write the rows the table declared
 * dirty, as long as a light casts.
 */
function followShadowRows(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, layout } = rt,
    { rows, selectionRoots } = layout
  if (!lights.pageLayout) return
  if (!castingLights(rt)) {
    const worldOf = (rank: number) => selectionRoots[rank].world.elements
    lights.mobility.ensure(selectionRoots.length, rows.casterSlots, worldOf)
    lights.rowsFollowed = false
    return
  }
  if (!lights.rowsFollowed && rows.casterSlots > 0) rows.markRowWords(0, rows.casterSlots - 1)
  lights.rowsFollowed = true
  uploadClusterSpheres(rt, device)
  uploadDirtyRowMobility(rt, device)
  uploadRowLods(rt, device)
}

/**
 * Brings every reader of the row table's dirty marks up to date — draw records, spheres, mobility,
 * corners —, then uploads the rows and clears the marks: a reader skipped would keep another
 * occupant's words (#198). Each costs the rows that changed.
 */
export function followDirtyRows(rt: WebgpuPagesRuntime, device: GPUDevice) {
  refreshDrawItemWords(rt, visLayerTop(rt.vis), rt.vis.gpuDraw)
  followShadowRows(rt, device)
  uploadRowCorners(rt)
  uploadDirtyRows(rt)
}

/** Encodes and submits one image of the drawn cut; returns the triangles it submitted. */
export function encodeDraws(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, timing, blendState, diag } = rt,
    { rows } = rt.layout,
    { viewport } = rt.setup
  run.gpuDrawCalls = 0
  run.gpuComputeDispatches = 0
  run.blendDrawCalls = 0
  run.blendFrustumRejected = 0
  timing.transparentEncodeMs = 0
  timing.transparentSelectMs = 0
  timing.transparentPrepareMs = 0
  timing.transparentDrawMs = 0
  timing.transparentSpanUploadBytes = 0
  if (!gpu.cache || !gpu.depthView) return 0
  // Frustum planes and view-projection are those image entry posted: the engine has one depth
  // convention (`../../../camera/depthConvention.ts`), so nothing is converted along the path.
  blendState.blendPlanes.set(cam.planes)
  // The render matrix carries temporal-antialiasing jitter; the camera knows nothing of it.
  viewProj.set(taaRenderMatrix(rt, cam))
  ensurePageTable(rt, device)
  if (run.rowsSyncedFrame !== run.frame) {
    rt.services.syncRows(!run.textureConverging)
    run.rowsSyncedFrame = run.frame
  }
  if (gpu.reflection && gpu.reflection.active !== wantsReflections(rt)) {
    abandonFrameEncoder(rt)
    void requestFrameTargets(rt, device)
    return 0
  }
  if (run.diagnostic === 'screen-error' && rows.pageTableFloats) {
    const rowWords = PAGE_INFO_STRIDE / 4
    for (let row = 0; row < rows.packedCount; row++) {
      const rec = rows.packedRecs[row]
      if (!rec) continue
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
      )
      rows.markRowWords(row)
    }
  }
  if (vis.deformationCompute)
    vis.deformationCode!.encodeDeformation(rt, timing.frameEncoder ?? openFrameEncoder(rt, device))
  // The engine draws through the visibility pass alone (#1483): pipelines a prepare left missing
  // are its failure, never another image.
  if (!vis.visPipelineBack || !vis.shadeClasses)
    throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE')
  // Targets not made yet — refused, or late after a resize — draw nothing: the last image stays
  // shown, and they are asked for. Past this, the image's encoders read them as made.
  if (!vis.visView || !gpu.surfaces || !gpu.hdrView || !gpu.displayView) {
    abandonFrameEncoder(rt)
    void requestFrameTargets(rt, device)
    return 0
  }
  try {
    return encodeVis(rt, device, cam)
  } catch (error) {
    abandonFrameEncoder(rt)
    timing.gpuTiming?.cancelUnsubmitted()
    diag.diagnosticFailure('visibility-render-failed', error)
    run.gpuDrawCalls = 0
    throw error
  }
}
