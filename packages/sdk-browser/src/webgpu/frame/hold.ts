import { sampleWebgpuFrame } from './signature.ts';
import { CPU_STEP } from '../pages/render/cpuStepTable.ts';
import { beginTaaFrame, restartTaaOnSettle, taaSettled } from '../../taa/frame.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { shadowsUnsettled } from '../pages/state/lights.ts';
import { effectsMoved } from '../pages/render/encodeEffects.ts';
import { guidesMoved } from '../pages/render/encodeGuides.ts';
import { particlesMoved } from '../particles/webgpuParticleFrame.ts';
import { frameTargetsAwaited } from '../pages/prepare/targetGrant.ts';
import { asidePending, swapAsideTargets } from '../pages/prepare/targetsAside.ts';
import { deviceAnswering } from './deviceAnswer.ts';
/** What can still change the frame, one bit each; `unsettledReasons` names them. */
const REASONS = [
  'lost',
  'capturing',
  'capturePending',
  'frameEncoder',
  'visDisabled',
  'gpuFrameInactive',
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
] as const;
const BIT = Object.fromEntries(REASONS.map((reason, index) => [reason, 1 << index])) as Record<
  (typeof REASONS)[number],
  number
>;
export const TEXTURES_PENDING = BIT.texturesPending,
  SHADOWS_PENDING = BIT.shadowsPending;
/** The run's own state: loss, capture, frame, cut and budget flags. */
function runMask(rt: WebgpuPagesRuntime) {
  const { run, vis, capture, timing } = rt,
    { rows } = rt.layout;
  let mask = 0;
  if (run.lost) mask |= BIT.lost;
  if (capture.capturing) mask |= BIT.capturing;
  if (capture.capturePending) mask |= BIT.capturePending;
  if (timing.frameEncoder) mask |= BIT.frameEncoder;
  if (!vis.visEnabled || !vis.gpuDraw) mask |= BIT.visDisabled;
  if (!run.gpuFrameActive || !run.gpuMetricsReady) mask |= BIT.gpuFrameInactive;
  if (!run.cutHeld) mask |= BIT.cutMoving;
  // A cut past the page budget is a steady state: its surface is drawn by the nearest resident
  // ancestor, and the pages the pool accepted are counted by `cutPending` below.
  if (run.overBudget) mask |= BIT.overBudget;
  // Only opaque rows with a partition need occluder history; sky and blend alone do not.
  if (run.noOccluderHistory && rows.packedCount && vis.gpuPartition) mask |= BIT.noOccluderHistory;
  if (run.deferredDrops.size) mask |= BIT.deferredDrops;
  return mask;
}
/** The row table, the pages and the shadows still on their way. */
function loadMask(rt: WebgpuPagesRuntime) {
  const { run, vis, lights, services } = rt,
    { rows } = rt.layout;
  let mask = 0;
  if (!services.bootstrapState.ready) mask |= BIT.bootstrap;
  if (services.residency.busy) mask |= BIT.residencyBusy;
  if (
    rows.rowsChanged ||
    rows.dirtyTo >= rows.dirtyFrom ||
    rows.rowsEpoch !== rows.tableEpoch ||
    rows.candidateOverflow
  )
    mask |= BIT.rowsDirty;
  // Pending tiles must render on arrival, and settle must read what the pose requests.
  if (vis.textures?.counters.pending || run.textureConverging) mask |= BIT.texturesPending;
  // A shadow page stale and read, a request report on its way, a representation change held
  // until the camera rests: each must find a frame (`shadowsUnsettled`).
  if (shadowsUnsettled(lights)) mask |= BIT.shadowsPending;
  // Pending cut pages must land before holding; the cut difference keeps this count.
  if (services.cutPending.count) mask |= BIT.cutPending;
  return mask;
}
/** The temporal histories still advancing: bounce probes, reflections and deformation. */
function historyMask(rt: WebgpuPagesRuntime) {
  const { vis, bounce } = rt;
  let mask = 0;
  // Closed probe series hold; a pending unrefused series still needs a frame.
  if (bounce.probes ? bounce.probes.working : bounce.pending && !bounce.reason)
    mask |= BIT.bounceProbes;
  // Only an active contract pass can advance reflection history; unlit never consumes it.
  const reflection = rt.gpu.reflection;
  if (
    rt.gpu.deferred?.usesContract &&
    reflection?.active &&
    reflection.history &&
    !reflection.history.settled
  )
    mask |= BIT.reflections;
  // Deformation advances its own temporal history.
  if (vis.deformation?.frame.pending()) mask |= BIT.deforming;
  return mask;
}
/**
 * Pending work that can change the frame. Read without allocation by hold and the barrier.
 */
export function unsettledMask(rt: WebgpuPagesRuntime) {
  return runMask(rt) | loadMask(rt) | historyMask(rt);
}
/** Names of the bits that are set: what the barrier publishes when the pose does not settle. */
export const unsettledReasons = (mask: number) =>
  REASONS.filter((reason) => (mask & BIT[reason]) !== 0);
/**
 * What a held frame actually did, published as such.
 *
 * It encoded only a present: no cluster was drawn, no pass ran, no CPU step was executed.
 * Republishing the draw counters and the step durations of the last full render would describe
 * work this frame did not do. CUT metrics — held pages, selected triangles, frustum rejection,
 * resident pages — stay intact: it is the same cut, redisplayed, and it still describes what the
 * frame shows.
 */
function recordHeldFrameWork(rt: WebgpuPagesRuntime, presented: boolean, submitMs: number) {
  const { run, timing } = rt;
  run.gpuDrawCalls = presented ? 1 : 0;
  run.gpuComputeDispatches = 0;
  run.blendDrawCalls = 0;
  run.submittedTriangles = 0;
  run.blendSubmittedTriangles = 0;
  run.cpuSelectMs = null;
  // No pass was timed on the device: “unmeasured”, never the duration of another one.
  timing.lastGpuPassMs = null;
  timing.lastGpuFrameMs = null;
  timing.lastGpuHostGapMs = null;
  timing.lastGpuIdleMs = null;
  timing.lastSubmitMs = submitMs;
  const steps = timing.cpuProfile.row;
  steps.fill(0);
  // No tile was pumped: the textures stage stays unmeasured, as on an image with nothing to serve.
  steps[CPU_STEP.tilesPumpMs] = NaN;
  steps[CPU_STEP.queueSubmitMs] = submitMs;
  steps[CPU_STEP.encodeSubmitMs] = submitMs;
  steps[CPU_STEP.submitMs] = submitMs;
  steps[CPU_STEP.totalMs] = submitMs;
  timing.rowFilled = true;
  // The detailed sample describes an encoded frame; this one is not, and does not republish one.
  timing.cpuSample = undefined;
}
/**
 * A frame whose targets the device has not granted (`targetGrant.ts`) would be drawn without
 * them, an incomplete image (#483): it is held instead, showing the previous image or nothing yet,
 * and `pendingWebgpuFrame` asks the next frame once the device answered. So is a lit frame whose
 * lit program still compiles (#1362): never the unlit stand-in. A capture is never held: it waited
 * for those answers before it began (`deviceAnswering`).
 *
 * The held frame. No CPU step is executed and nothing is re-encoded: the previous frame's colour
 * target IS this frame, to the bit, since nothing it depends on has moved: it is redisplayed.
 *
 * Replaying render bundles alone omits the frame's compute passes and copies.
 * Redisplaying the intact target yields it exactly, and that is the only command encoded — none
 * when the canvas still holds it whole (`holds`): a canvas keeps the image last presented into it.
 * A view placed at a rectangle presents as before: the canvas around it is the main view's.
 */
export function holdWebgpuFrame(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { run, gpu } = rt,
    awaited = frameTargetsAwaited(rt),
    answered = !deviceAnswering(rt);
  if ((answered && !awaited) || rt.capture.capturing) {
    // Reflection refinement delays holding, but a still source keeps the full TAA scale/lights.
    const unsettled = unsettledMask(rt);
    const quiet = run.gate.held() && (unsettled & ~BIT.reflections) === 0;
    // Targets the device granted aside enter here, before anything is drawn: this frame is drawn
    // into them, never held on a display colour they never had. Its stillness is the scene's.
    const swapped = !awaited && answered && swapAsideTargets(rt, device);
    // Guides and effects may still require drawing this quiet source.
    if (
      swapped ||
      !quiet ||
      unsettled & BIT.reflections ||
      !taaSettled(rt) ||
      guidesMoved(rt) ||
      effectsMoved(rt) ||
      particlesMoved(rt)
    ) {
      // Only an image that is drawn enters the accumulation: a held one leaves it as is (#26).
      restartTaaOnSettle(rt, (unsettled & BIT.reflections) !== 0);
      beginTaaFrame(rt, run.gate.cam, quiet);
      run.frameHeld = false;
      return false;
    }
  }
  // Held on an answer still in flight is not the still frame the page waits for (`frameHeld`):
  // that answer asks the next frame, and nothing it holds is this frame. Nor is one held while
  // targets are made aside: the frame that swaps them in is drawn.
  run.frameHeld = answered && !asidePending(rt);
  run.frame++;
  const start = performance.now();
  let presented = false;
  // Nothing drawn yet, or targets not granted: nothing is shown.
  const { presenter, displayTexture } = gpu,
    [width, height] = gpu.displaySize,
    at = rt.views.active.rect;
  if (
    presenter &&
    displayTexture &&
    run.imageRevision > 0 &&
    !awaited &&
    (at || !presenter.holds(displayTexture, width, height))
  ) {
    const encoder = device.createCommandEncoder({ label: 'Trillion3D held frame' });
    presenter.present(encoder, displayTexture, width, height, at);
    device.queue.submit([encoder.finish()]);
    run.imageRevision++;
    presented = true;
  }
  recordHeldFrameWork(rt, presented, performance.now() - start);
  return true;
}

/** Stores the frame that has just been fully encoded and submitted: it alone allows a hold. A
 *  settle frame replays the last ordinary frame: the witness does not see it, and two identical
 *  ordinary frames remain two consecutive frames in its eyes. */
export function keepWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { gate, textureConverging } = rt.run;
  if (textureConverging || rt.feedbackAB?.force) return;
  sampleWebgpuFrame(rt, gate.hold.sample);
  gate.hold.keep(gate.revisions);
}
