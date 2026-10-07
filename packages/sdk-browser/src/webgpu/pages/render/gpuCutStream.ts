import { ensurePageTable } from './pageTable.ts'
import { followCutRows } from '../prepare/growTables.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The cut of the drawn view: the main one, or the view's own beside it on the same tables
 *  (`../../../gpu/dag/aside.ts`), made at its first image. None for a scene without a cluster. */
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
  // the rest is drawn by its nearest resident ancestor (`../../residency/requestAdmission.ts`).
  services.queueCutResidency()
  // The cache gives slots back in the order the main cut published (`../../residency/evictionFeed.ts`).
  if (selection && views.active === views.main) services.followEvictions(selection)
  marks.queueEnd = performance.now()
  ensurePageTable(rt, gpuDevice)
  // The readback the drawn view adopts, followed by the differences its adoption published.
  services.followCut(cutOf(rt)?.peek(), views.active.cut)
  const passed = services.syncRows(!run.textureConverging)
  run.rowsSyncedFrame = run.frame
  marks.rowsEnd = performance.now()
  // Only a pass over the table says anew what it could not hold: an image that skipped it asks
  // nothing more.
  const casters = services.blendCasters
  if (passed && (rows.rowsDenied || casters.asked > casters.used))
    followCutRows(rt, Math.max(rows.packedCount + rows.rowsDenied, casters.asked))
  // The rank journal names pages that just entered or left: comparing the DAG's two thousand three
  // hundred pages no longer happens, and only their ranges are rewritten. A row whose readiness
  // moved has its mobility word written again: whether a finer form now stands for it (#831).
  if (selection?.updateResidency(rows.residentFlags, rows.residencyChanges, rows.markRowOfPage))
    run.gpuMetricsReady = false
  rows.clearResidencyChanges()
  marks.residencyUploadEnd = performance.now()
}

/**
 * The cut of the drawn view into the frame's `encoder`: the main cut, or the view's own beside it
 * (`../../../gpu/dag/aside.ts`), made at its first image. Returns false when no cut ran — a view
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
