import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { shadowsUnsettled } from '../backend/state/lights.ts'
import { reflectionsPending } from '../../lighting/reflections/gpu.ts'
import { exposureMoving } from '../../post/exposure/frame.ts'
import { finishMoving } from '../../post/finish/frame.ts'

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
  'hlodWarming',
  'exposure',
] as const
const BIT = Object.fromEntries(REASONS.map((reason, index) => [reason, 1 << index])) as Record<
  (typeof REASONS)[number],
  number
>
export const TEXTURES_PENDING = BIT.texturesPending,
  SHADOWS_PENDING = BIT.shadowsPending
/** The bits that say the view has not loaded what its scene holds yet: the root cover, the cut's
 *  readback and the row table (`viewLoading`). The finer pages the cut asks past the roots stream
 *  in after, image by image, as they would once shown. */
const LOADING = BIT.bootstrap | BIT.metricsPending | BIT.rowsDirty
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
  if (rowsDirty(rows)) mask |= BIT.rowsDirty
  // Pending tiles must render on arrival, and settle must read what the pose requests.
  if (vis.textures?.counters.pending || run.textureConverging) mask |= BIT.texturesPending
  // A shadow page stale and read, a request report on its way, a representation change held
  // until the camera rests: each must find a frame (`shadowsUnsettled`).
  if (shadowsUnsettled(lights, rt.rowWords)) mask |= BIT.shadowsPending
  // Pending cut pages must land before holding; the cut difference keeps this count.
  if (services.cutPending.count) mask |= BIT.cutPending
  // An HLOD switch waiting on its actor's warm-up switches on a later cut: a still view keeps
  // drawing till it has (`../prepare/hlodWarm.ts`).
  if (run.gpuSelection?.world?.warming) mask |= BIT.hlodWarming
  // The automatic exposure still moving toward what the image asks (`exposureMoving`), or the
  // finishing's settings or composition not yet shown (`finishMoving`).
  if (exposureMoving(rt) || finishMoving(rt)) mask |= BIT.exposure
  return mask
}
/** The temporal histories still advancing: bounce probes and deformation. */
function historyMask(rt: WebgpuPagesRuntime, frame: number | undefined) {
  const { vis, bounce } = rt
  let mask = 0
  // Closed probe series hold; a pending unrefused series still needs a frame.
  if (bounce.probes ? bounce.probes.working : bounce.pending && !bounce.reason)
    mask |= BIT.bounceProbes
  // Deformation advances its own temporal history; its answers serve `frame`'s update alone.
  if (vis.deformation?.frame.pending(frame)) mask |= BIT.deforming
  return mask
}
/**
 * Pending work that can change the frame. Read without allocation by hold and the barrier; the
 * hold names the `frame` it is about to draw, whose update then reuses what was read. The
 * reflections hold no state of their own to settle — they trace and accumulate every image
 * drawn —: their bit says only that the view's radiance pyramid holds no image yet
 * (`reflectionsPending`).
 */
export function unsettledMask(rt: WebgpuPagesRuntime, frame?: number) {
  const other = runMask(rt) | loadMask(rt) | historyMask(rt, frame)
  return reflectionsPending(rt.gpu.reflection) ? other | BIT.reflections : other
}
/**
 * Whether the active view still loads: one of its loading bits set (`LOADING`), or a world's
 * cell wished and not visible yet — its content not loaded, its placements' roots not resident
 * (`WorldCells.shown`). What the session's first image waits for (`firstImage.ts`): the streaming
 * of the cells completed. Textures, shadows, the finer pages and the temporal histories refine an
 * image already whole, and wait for nothing here.
 */
export function viewLoading(rt: WebgpuPagesRuntime) {
  const world = rt.run.gpuSelection?.world
  return ((runMask(rt) | loadMask(rt)) & LOADING) !== 0 || (!!world && !world.shown)
}
/** Names of the bits that are set: what the barrier publishes when the pose does not settle. */
export const unsettledReasons = (mask: number) =>
  REASONS.filter((reason) => (mask & BIT[reason]) !== 0)

/** Whether the row table still moves: rows changed, dirty, owed or refused. */
const rowsDirty = (rows: WebgpuPagesRuntime['layout']['rows']) =>
  rows.rowsChanged || rows.dirtyCount > 0 || rows.rowsEpoch !== rows.tableEpoch || !!rows.rowsDenied
