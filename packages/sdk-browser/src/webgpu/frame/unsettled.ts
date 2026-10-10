import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { shadowsUnsettled } from '../pages/state/lights.ts'
import { reflectionsSettled } from '../../reflections/gpu.ts'

/** What can still change the frame, one bit each; `unsettledReasons` names them. */
const REASONS = [
  'lost',
  'capturing',
  'capturePending',
  'frameEncoder',
  'metricsPending',
  'cutMoving',
  'overBudget',
  'noOccluderHistory',
  'deferredDrops',
  'bootstrap',
  'residencyBusy',
  'rowsDirty',
  'texturesPending',
  'shadowsPending',
  'cutPending',
  'bounceProbes',
  'deforming',
  'reflections',
] as const
const BIT = Object.fromEntries(REASONS.map((reason, index) => [reason, 1 << index])) as Record<
  (typeof REASONS)[number],
  number
>
export const TEXTURES_PENDING = BIT.texturesPending,
  SHADOWS_PENDING = BIT.shadowsPending
/** The run's own state: loss, capture, frame, cut and budget flags. */
function runMask(rt: WebgpuPagesRuntime) {
  const { run, capture, timing } = rt,
    { rows } = rt.layout
  let mask = 0
  if (run.lost) mask |= BIT.lost
  if (capture.capturing) mask |= BIT.capturing
  if (capture.capturePending) mask |= BIT.capturePending
  if (timing.frameEncoder) mask |= BIT.frameEncoder
  // The image's GPU cut has not been read back yet: its counts are still on their way.
  if (!run.gpuMetricsReady) mask |= BIT.metricsPending
  if (!run.cutHeld) mask |= BIT.cutMoving
  // A cut past the page budget is a steady state: its surface is drawn by the nearest resident
  // ancestor, and the pages the pool accepted are counted by `cutPending` below.
  if (run.overBudget) mask |= BIT.overBudget
  // Only opaque rows need occluder history; sky and blend alone do not.
  if (run.noOccluderHistory && rows.packedCount) mask |= BIT.noOccluderHistory
  if (run.deferredDrops.size) mask |= BIT.deferredDrops
  return mask
}
/** The row table, the pages and the shadows still on their way. */
function loadMask(rt: WebgpuPagesRuntime) {
  const { run, vis, lights, services } = rt,
    { rows } = rt.layout
  let mask = 0
  if (!services.bootstrapState.ready) mask |= BIT.bootstrap
  if (services.residency.busy) mask |= BIT.residencyBusy
  if (
    rows.rowsChanged ||
    rows.dirtyCount > 0 ||
    rows.rowsEpoch !== rows.tableEpoch ||
    rows.rowsDenied
  )
    mask |= BIT.rowsDirty
  // Pending tiles must render on arrival, and settle must read what the pose requests.
  if (vis.textures?.counters.pending || run.textureConverging) mask |= BIT.texturesPending
  // A shadow page stale and read, a request report on its way, a representation change held
  // until the camera rests: each must find a frame (`shadowsUnsettled`).
  if (shadowsUnsettled(lights)) mask |= BIT.shadowsPending
  // Pending cut pages must land before holding; the cut difference keeps this count.
  if (services.cutPending.count) mask |= BIT.cutPending
  return mask
}
/** The temporal histories still advancing: bounce probes, deformation, and the reflections' radiance
 *  image while it is not yet one of the view standing still (`reflectionsSettled`). */
function historyMask(rt: WebgpuPagesRuntime, frame: number | undefined) {
  const { vis, bounce } = rt
  let mask = 0
  // Closed probe series hold; a pending unrefused series still needs a frame.
  if (bounce.probes ? bounce.probes.working : bounce.pending && !bounce.reason)
    mask |= BIT.bounceProbes
  // Deformation advances its own temporal history; its answers serve `frame`'s update alone.
  if (vis.deformation?.frame.pending(frame)) mask |= BIT.deforming
  if (!reflectionsSettled(rt.gpu.reflection, !!rt.gpu.temporal?.frame.active))
    mask |= BIT.reflections
  return mask
}
/**
 * Pending work that can change the frame. Read without allocation by hold and the barrier; the
 * hold names the `frame` it is about to draw, whose update then reuses what was read.
 */
export function unsettledMask(rt: WebgpuPagesRuntime, frame?: number) {
  return runMask(rt) | loadMask(rt) | historyMask(rt, frame)
}
/** Names of the bits that are set: what the barrier publishes when the pose does not settle. */
export const unsettledReasons = (mask: number) =>
  REASONS.filter((reason) => (mask & BIT[reason]) !== 0)
