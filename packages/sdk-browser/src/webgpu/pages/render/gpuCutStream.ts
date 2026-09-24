import type { GpuSelection } from '../../../gpu/core/selection.ts';
import { ensurePageTable } from './encodeDraws.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * What advances an image's stream: ask the cache for the pages the cut wants, post the page table,
 * sync ranks then publish residency flags to GPU selection.
 *
 * Returns false when visibility identifiers overflow: only the CPU cut then knows how to pick a
 * representable subset, and the caller decides what it says about it.
 */
export function streamCutResidency(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  selection: GpuSelection,
) {
  const { run, services } = rt,
    { rows } = rt.layout,
    marks = rt.timing.marks;
  // What the light cuts asked for last time they reported: the lower tier, served after this cut.
  const lightCut = rt.lights.lightCut,
    asked = lightCut?.reports.takeRequests();
  if (asked) services.shadowTier.offerIds(asked);
  // Never throttled: this cut meets the budget by growing its screen error.
  services.queueCutResidency(false);
  // Enumerate the bounded resident candidates once. GPU selection and compaction
  // share their page indices; no CPU frustum/LOD traversal or regrouping follows.
  marks.queueEnd = performance.now();
  ensurePageTable(rt, gpuDevice);
  services.syncRows();
  run.rowsSyncedFrame = run.frame;
  marks.rowsEnd = performance.now();
  if (rows.candidateOverflow) return false;
  // The rank journal names pages that just entered or left: comparing the DAG's two thousand three
  // hundred pages no longer happens, and only their ranges are rewritten.
  if (selection.updateResidency(rows.residentFlags, rows.residencyChanges))
    run.gpuMetricsReady = false;
  rows.clearResidencyChanges();
  marks.residencyUploadEnd = performance.now();
  return true;
}

/**
 * Sending the selection of an image waiting for coverage. Nothing is drawn from an incomplete
 * sample, but the wait cannot settle for rereading it: without a new send, the same sample comes
 * back every image and the cut stays stuck on it, camera still, even once the missing bytes have
 * arrived. Selection submits its own command buffer here; no draw pass goes with it.
 *
 * Returns false when the send fails: the wait then has no way left to produce the sample it hopes
 * for, and the caller drops GPU selection as it does on the full path. Failure is announced only
 * here, once per lost send.
 */
export function dispatchWaitingSelection(rt: WebgpuPagesRuntime, selection: GpuSelection) {
  try {
    selection.dispatch(rt.run.selectionUniforms);
    return true;
  } catch (error) {
    rt.diag.diagnosticFailure('gpu-selection-dispatch-failed', error);
    return false;
  }
}
