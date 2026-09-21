import { sampleWebgpuFrame } from './webgpuFrameSignature.ts';
import { CPU_STEP } from './webgpuPagesCpuSteps.ts';
import { beginTaaFrame, taaSettled } from './taaFrame.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** What can still change the frame, one bit each; `unsettledReasons` names them. */
const REASONS = [
  'lost',
  'secondaryCamera',
  'capturePending',
  'frameEncoder',
  'visDisabled',
  'gpuFrameInactive',
  'cutMoving',
  'overBudget',
  'uncoveredTriangles',
  'noOccluderHistory',
  'deferredDrops',
  'bootstrap',
  'residencyBusy',
  'rowsDirty',
  'texturesPending',
  'shadowsPending',
  'cutPending',
  'bounceProbes',
] as const;
const BIT = Object.fromEntries(REASONS.map((reason, index) => [reason, 1 << index])) as Record<
  (typeof REASONS)[number],
  number
>;
export const TEXTURES_PENDING = BIT.texturesPending,
  SHADOWS_PENDING = BIT.shadowsPending;

/**
 * What still keeps the frame from depending only on a host write, in bits: a load in progress, a
 * shown list still to adopt, an occlusion history to establish, a texture in flight, a pending
 * shadow, a probe to converge. Zero when nothing moves any more. Every doubt is settled on the
 * “redo the work” side: each missing condition sets its bit. No allocation: hold reads it every
 * frame, the barrier uses it as a stop predicate.
 */
export function unsettledMask(rt: WebgpuPagesRuntime) {
  const { run, vis, lights, bounce, capture, services, timing } = rt,
    { rows } = rt.layout;
  let mask = 0;
  if (run.lost) mask |= BIT.lost;
  if (capture.secondaryCamera) mask |= BIT.secondaryCamera;
  if (capture.capturePending) mask |= BIT.capturePending;
  if (timing.frameEncoder) mask |= BIT.frameEncoder;
  if (!vis.visEnabled || !vis.gpuDraw) mask |= BIT.visDisabled;
  if (!run.gpuFrameActive || !run.gpuMetricsReady) mask |= BIT.gpuFrameInactive;
  if (!run.cutHeld) mask |= BIT.cutMoving;
  if (run.overBudget || run.coverageBudgetLimited) mask |= BIT.overBudget;
  if (run.uncoveredTriangles !== 0) mask |= BIT.uncoveredTriangles;
  if (run.noOccluderHistory) mask |= BIT.noOccluderHistory;
  if (run.deferredDrops.size) mask |= BIT.deferredDrops;
  if (!services.bootstrapState.ready) mask |= BIT.bootstrap;
  if (services.residency.busy) mask |= BIT.residencyBusy;
  if (
    rows.rowsChanged ||
    rows.dirtyTo >= rows.dirtyFrom ||
    rows.rowsEpoch !== rows.tableEpoch ||
    rows.candidateOverflow
  )
    mask |= BIT.rowsDirty;
  // A requested tile not yet served will change the frame when it arrives; and a settle must
  // render to read what the pose asks for, never hold.
  if (vis.textures?.counters.pending || run.textureConverging) mask |= BIT.texturesPending;
  // A representation change held until the camera rests must find a frame to enter the queue:
  // the plan keeps it only while a frame will plan it, and drops it otherwise.
  if (lights.plan.counts.pendingPages > 0 || lights.plan.deferredChanges)
    mask |= BIT.shadowsPending;
  // Every page of the requested cut carries its bytes. A still-pending page can still change the
  // cut, hence the frame: holding it would open a hole. This count is held by the cut difference,
  // never reread on the list.
  if (services.cutPending.count) mask |= BIT.cutPending;
  // Bounce-light probes converge from frame to frame: their state is written by no revision, and
  // a held frame would freeze it before convergence.
  if (bounce.probes) mask |= BIT.bounceProbes;
  return mask;
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
 * The held frame. No CPU step is executed and nothing is re-encoded: the previous frame's colour
 * target IS this frame, to the bit, since nothing it depends on has moved. It is simply
 * redisplayed.
 *
 * A `GPUCommandBuffer` already submitted is not resubmitted, and a `GPURenderBundle` can carry
 * neither the frame's compute passes — selection, Hi-Z pyramid, small triangles, light lists,
 * deferred resolve — nor its copies: replaying the render bundles alone would not yield the frame.
 * Redisplaying the intact target yields it exactly, and that is the only command encoded.
 */
export function holdWebgpuFrame(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { run, gpu } = rt;
  // Still frame: nothing it depends on has moved and nothing is in flight. That is the frame
  // input of temporal accumulation, which restarts there in a fixed phase and converges over a
  // full cycle of those frames before one of them can be held (`TAA_STILL_FRAMES`).
  const quiet = run.gate.held() && unsettledMask(rt) === 0;
  beginTaaFrame(rt, run.gate.cam, quiet);
  if (!quiet || !taaSettled(rt)) {
    run.frameHeld = false;
    return false;
  }
  run.frameHeld = true;
  run.frame++;
  const start = performance.now();
  let presented = false;
  if (gpu.presenter && gpu.colorTexture) {
    const encoder = device.createCommandEncoder({ label: 'WG held frame' });
    gpu.presenter.present(encoder, gpu.colorTexture, gpu.targetSize[0], gpu.targetSize[1]);
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
  if (textureConverging) return;
  sampleWebgpuFrame(rt, gate.hold.sample);
  gate.hold.keep(gate.revisions);
}
