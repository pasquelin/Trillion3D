import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { pumpResidentTiles } from '../prepare/lightResources.ts'
import { ensurePageTable } from './pageTable.ts'
import { followCutRows } from '../prepare/growTables.ts'
import { warmWorldActors } from '../prepare/hlodWarm.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The cut of the drawn view: the main one, or the view's own beside it on the same tables
 *  (`../../geometry/dag/aside.ts`), made at its first image. None for a scene without a cluster. */
function cutOf({ run, views }: WebgpuPagesRuntime) {
  const selection = run.gpuSelection
  if (!selection || views.active === views.main) return selection
  return (run.asideCut ??= selection.aside())
}

/**
 * What advances an image's stream: ask the cache for the pages the views' cuts want, post the page
 * table, hand the drawn view's readback to the row cache and sync it, then publish residency flags
 * to the GPU cut. Requests the row table could not serve grow it, as the blended casters it could
 * not seat do: what the view uses sizes the table, never the placements (#1232).
 */
export function streamCutResidency(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { run, services, views } = rt,
    { rows } = rt.layout,
    marks = rt.timing.marks,
    selection = run.gpuSelection
  // Never throttled: past the budget the queue keeps the coarsest pages the readbacks ask for, and
  // the rest is drawn by its nearest resident ancestor (`../../geometry/residency/requestAdmission.ts`).
  services.queueCutResidency()
  // The cache gives slots back in the order the main cut published (`../../geometry/residency/evictionFeed.ts`).
  if (selection && views.active === views.main) services.followEvictions(selection, run.frame)
  marks.queueEnd = cpuNow()
  ensurePageTable(rt, gpuDevice)
  // The readback the drawn view adopts.
  services.followCut(cutOf(rt)?.peek())
  const passed = services.syncRows(!run.textureConverging)
  run.rowsSyncedFrame = run.frame
  marks.rowsEnd = cpuNow()
  // Only a pass over the table says anew what it could not hold: an image that skipped it asks
  // nothing more.
  const casters = services.blendCasters
  if (passed && (rows.rowsDenied || casters.asked > casters.used))
    followCutRows(rt, Math.max(rows.packedCount + rows.rowsDenied, casters.asked))
  // The rank journal names pages that just entered or left: comparing every page of the DAG
  // no longer happens, and only their ranges are rewritten. A row whose readiness
  // moved has its detail's bits written again, nothing else of it: whether a finer form now stands
  // for it (`../../placement/rows/rowWords.ts`).
  if (selection?.updateResidency(rows.residency, rows.residencyChanges, rows.markRowOfPage))
    run.gpuMetricsReady = false
  rows.clearResidencyChanges()
  marks.residencyUploadEnd = cpuNow()
  // The world's HLOD switches wait for the actors they draw to warm: the tiles those ask are
  // served in this pass beside the feedback's (`../prepare/hlodWarm.ts`).
  warmWorldActors(rt)
  // What the previous image's feedback requested of the textures becomes resident, on what the
  // rows left of the frame's clock: a page without its row draws a coarser ancestor — a hole where
  // a window was —, a tile not in yet only a coarser level. The pass times itself on its budget
  // clock, the one bound the textures stage reads. A tile served is a resource change.
  if (pumpResidentTiles(rt.vis.textures, run.frame, run.textureConverging))
    run.gate.resourcesChanged()
  marks.tilesEnd = cpuNow()
}

/**
 * The cut of the drawn view into the frame's `encoder`: the main cut, or the view's own beside it
 * (`../../geometry/dag/aside.ts`), made at its first image. Returns false when no cut ran — a view
 * aside while the list grows —: its image is not drawn from another view's mask. A scene without a
 * cluster has nothing to cut.
 */
export function dispatchCut(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { run, views, timing } = rt,
    cut = cutOf(rt)
  if (!cut) return true
  timing.frameSelection = cut.dispatch(run.selectionUniforms, encoder)
  return views.active === views.main || !!timing.frameSelection
}

/**
 * Sending the selection of an image waiting for its root cover. Nothing is drawn before it, but the
 * wait cannot settle for rereading the last sample: without a new send, the same sample comes back
 * every image and the cut stays stuck on it, camera still, even once the missing bytes have
 * arrived. The selection is sent in a command buffer of its own; no draw pass goes with it.
 *
 * Returns false when the send fails, said here once per lost send: the image is skipped, and a
 * view drawn aside drops its cut (`gpuCut.ts`); only `device.lost` declares the device lost.
 */
export function dispatchWaitingSelection(rt: WebgpuPagesRuntime) {
  const { run, gpu } = rt
  try {
    // Its own command buffer, sent only when the cut encoded something into it.
    const encoder = gpu.device!.createCommandEncoder()
    const settle = cutOf(rt)!.dispatch(run.selectionUniforms, encoder)
    if (settle) {
      gpu.device!.queue.submit([encoder.finish()])
      settle(true)
    }
    return true
  } catch (error) {
    rt.diag.diagnosticFailure('gpu-selection-dispatch-failed', error)
    return false
  }
}
