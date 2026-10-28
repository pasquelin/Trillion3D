import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { shadowsUnsettled } from '../backend/state/lights.ts'
import { shadowsOn } from '../../lighting/shadows/vsm/frame/vsmGates.ts'
import { ambientOcclusionSettling } from '../../lighting/ao/frame.ts'
import { screenProbesSettling } from '../../lighting/bounce/screen/frame.ts'
import { reflectionsPending } from '../../lighting/reflections/gpu.ts'
import { translucencyVolumeSettling } from '../../lighting/translucency/frame.ts'
import { translucencyGiSettling } from '../../lighting/translucencyGi/frame.ts'
import { verifyImages } from '../../materials/virtual/convergeRules.ts'
import { taaPhaseCount } from '../../post/taa/frame.ts'
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
  'clustersOwed',
  'texturesPending',
  'shadowsPending',
  'cutPending',
  'bounceProbes',
  'deforming',
  'reflections',
  'hlodWarming',
  'exposure',
  'fogVolume',
  'translucencyVolume',
  'translucencyGi',
  'screenProbes',
  'occlusion',
  'casterSettling',
  'noisePhase',
] as const
const BIT = Object.fromEntries(REASONS.map((reason, index) => [reason, 1 << index])) as Record<
  (typeof REASONS)[number],
  number
>
export const TEXTURES_PENDING = BIT.texturesPending,
  SHADOWS_PENDING = BIT.shadowsPending,
  /** The final image of an establishment, drawn at the canonical phase of the noise before the view is held (`finalNoiseImage`). */
  NOISE_PHASE = BIT.noisePhase
/** The bits that say the view has not loaded what its scene holds yet: the root cover, the cut's
 *  readback and the clusters' records (`viewLoading`). The finer pages the cut asks past the roots stream
 *  in after, image by image, as they would once shown. */
const LOADING = BIT.bootstrap | BIT.metricsPending | BIT.clustersOwed
/** The run's own state: loss, capture, frame, cut and budget flags. */
function runMask(rt: WebgpuPagesRuntime) {
  const { run, capture, timing, layout } = rt
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
  // Only opaque clusters need occluder history; sky and blend alone do not.
  if (run.noOccluderHistory && layout.packedPages.length > layout.blendedPageCount)
    mask |= BIT.noOccluderHistory
  if (run.deferredDrops.size) mask |= BIT.deferredDrops
  return mask
}
/** The clusters' records, the pages and the shadows still on their way. */
function loadMask(rt: WebgpuPagesRuntime) {
  const { run, vis, lights, services } = rt
  let mask = 0
  if (!services.bootstrapState.ready) mask |= BIT.bootstrap
  if (services.residency.busy) mask |= BIT.residencyBusy
  if (services.clustersOwed()) mask |= BIT.clustersOwed
  // Pending tiles must render on arrival, and settle must read what the pose requests: every pixel heard to ask nothing more after the last tile (`verifying`).
  if (
    vis.textures?.counters.pending ||
    vis.textures?.counters.verifying(verifyImages(taaPhaseCount(rt))) ||
    run.textureConverging
  )
    mask |= BIT.texturesPending
  // A shadow page stale and read, a request report on its way: each must find a frame
  // (`shadowsUnsettled`).
  if (shadowsUnsettled(lights)) mask |= BIT.shadowsPending
  // A caster that moved stays cached as dynamic until enough still frames are drawn (`mobility.settle`): a view held before shows other shadows.
  // The age advances in the shadows' plan, so it counts only while they run (`shadowsOn`): none, nothing is cached.
  if (lights.mobility?.settling && shadowsOn(rt)) mask |= BIT.casterSettling
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
/** The temporal histories still advancing: bounce probes, deformation, the fog's volume, the screen probes' and the occlusion's. */
function historyMask(rt: WebgpuPagesRuntime, frame: number | undefined) {
  const { vis, bounce } = rt
  let mask = 0
  // Closed probe series hold; a pending unrefused series still needs a frame. Switched off, nothing is waited for.
  if (bounce.wanted && (bounce.probes ? bounce.probes.working : bounce.pending && !bounce.reason))
    mask |= BIT.bounceProbes
  // The translucency volume's own cache closes its series the same way.
  if (bounce.translucency?.probes?.working) mask |= BIT.bounceProbes
  // Deformation advances its own temporal history; its answers serve `frame`'s update alone.
  if (vis.deformation?.frame.pending(frame)) mask |= BIT.deforming
  // The fog's volume blends its history in over images: a still view draws till it is whole.
  if (rt.gpu.fogVolume?.gpu?.settling) mask |= BIT.fogVolume
  // The translucency lighting volume's temporal filter blends its history in the same way.
  if (translucencyVolumeSettling(rt.gpu)) mask |= BIT.translucencyVolume
  // The translucency global illumination volume's temporal filter blends its history in the same way.
  if (translucencyGiSettling(rt.gpu)) mask |= BIT.translucencyGi
  // The screen probes' history is built over the frames it holds at most (`screenProbesSettling`).
  if (screenProbesSettling(rt)) mask |= BIT.screenProbes
  // The horizon occlusion's history converges over the images it is drawn on (`ambientOcclusionSettling`).
  if (ambientOcclusionSettling(rt)) mask |= BIT.occlusion
  return mask
}
/**
 * Pending work that can change the frame. Read without allocation by hold and the barrier; the
 * hold names the `frame` it is about to draw, whose update then reuses what was read. The
 * reflections hold no state of their own to settle — they trace and accumulate every image
 * drawn —: their bit says only that the view holds no lit image of itself yet
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
