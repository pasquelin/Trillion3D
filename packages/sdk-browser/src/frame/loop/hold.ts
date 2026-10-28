import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { sampleWebgpuFrame } from './signature.ts'
import { CPU_STEP } from '../../diagnostic/stage/cpuStepTable.ts'
import { beginTaaFrame } from '../../post/taa/frame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { frameTargetsAwaited } from '../prepare/targetGrant.ts'
import { asidePending, swapAsideTargets } from '../prepare/targetsAside.ts'
import { freshDisplay } from '../io/displayRead.ts'
import { deviceAnswering, noteHold } from './deviceAnswer.ts'
import { NOISE_PHASE, unsettledMask } from './unsettled.ts'
import { traceDrawnFrame, traceHeldOnAnswer } from './holdTrace.ts'
import { beginNoiseImage } from '../render/noiseFrame.ts'
import { taaRuns } from '../backend/state/renderScale.ts'
import { drawsEveryImage } from './everyImage.ts'
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
  const { run, timing } = rt
  run.gpuDrawCalls = presented ? 1 : 0
  run.gpuComputeDispatches = 0
  run.blendDrawCalls = 0
  run.submittedTriangles = 0
  run.blendSubmittedTriangles = 0
  // No pass was timed on the device: “unmeasured”, never the duration of another one.
  timing.lastGpuPassMs = null
  timing.lastGpuFrameMs = null
  timing.lastGpuHostGapMs = null
  timing.lastGpuIdleMs = null
  timing.lastSubmitMs = submitMs
  const steps = timing.profiler.row
  steps.fill(0)
  // No tile was pumped: the textures stage stays unmeasured, as on an image with nothing to serve.
  steps[CPU_STEP.tilesPumpMs] = NaN
  steps[CPU_STEP.queueSubmitMs] = submitMs
  steps[CPU_STEP.encodeSubmitMs] = submitMs
  steps[CPU_STEP.submitMs] = submitMs
  steps[CPU_STEP.totalMs] = submitMs
  timing.rowFilled = true
  // The detailed sample describes an encoded frame; this one is not, and does not republish one.
  timing.cpuSample = undefined
}

/** Whether the held image was presented again: nothing is shown while nothing is drawn yet, targets are not granted, or the image is withheld — till the view has loaded, or
 *  while a load blocks on slow streaming (`firstImage.ts`). */
function presentHeld(rt: WebgpuPagesRuntime, device: GPUDevice, awaited: boolean) {
  const { run, gpu } = rt
  const { presenter, displayTexture } = gpu,
    [width, height] = gpu.displaySize,
    at = rt.views.active.rect
  if (
    !presenter ||
    !displayTexture ||
    run.imageRevision <= 0 ||
    run.imageWithheld ||
    awaited ||
    (!at && presenter.holds(displayTexture, width, height))
  )
    return false
  // The canvas lost the image: the display colour is composed again where it was not written.
  freshDisplay(rt)
  const encoder = device.createCommandEncoder({ label: 'Trillion3D held frame' })
  const presented = presenter.present(encoder, displayTexture, width, height, at)
  device.queue.submit([encoder.finish()])
  run.imageRevision++
  return presented
}

/**
 * Whether this image is held: the view stands (`gate.held`), nothing is unsettled, nothing draws it every image (read only then), and it is not the final image of its
 * establishment (`beginNoiseImage`), which is drawn once more, at the canonical phase of the noise, before the view is held on it.
 */
function holdDecision(rt: WebgpuPagesRuntime) {
  const { run } = rt
  let unsettled = unsettledMask(rt, run.frame)
  const established = run.gate.held() && unsettled === 0
  const every = established && drawsEveryImage(rt)
  const final = beginNoiseImage(rt, established && !every, taaRuns(rt))
  if (final) unsettled |= NOISE_PHASE
  // A change of the clock itself (the light began, the temporal pass turned on) draws an image although the gate stands.
  return { unsettled, quiet: established && !every && !final && !run.gate.hold.noise.changed }
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
    answered = !deviceAnswering(rt)
  if ((answered && !awaited) || rt.capture.capturing) {
    const { unsettled, quiet } = holdDecision(rt)
    // Targets the device granted aside enter here, before anything is drawn: this frame is drawn
    // into them, never held on a display colour they never had. Its stillness is the scene's.
    const swapped = !awaited && answered && swapAsideTargets(rt, device)
    if (swapped || !quiet) {
      if (rt.diag.traceEnabled) traceDrawnFrame(rt, unsettled, swapped)
      // Only an image that is drawn enters the accumulation: a held one leaves it as is (#26).
      beginTaaFrame(rt, run.gate.cam)
      run.frameHeld = false
      run.heldEmpty = false
      noteHold(rt, true, answered, awaited)
      return false
    }
  }
  // Held on an answer still in flight is not the still frame the page waits for (`frameHeld`):
  // that answer asks the next frame, and nothing it holds is this frame. Nor is one held while
  // targets are made aside: the frame that swaps them in is drawn.
  run.frameHeld = answered && !asidePending(rt)
  // Held on an answer, or on targets the device has not granted, a frame drew nothing: no image of the view's number, whatever `frameHeld` says.
  run.heldEmpty = !answered || awaited
  // A frame held on an answer, or on targets not granted, drew no image, so none was there to time: said among the frames the GPU timer left out.
  if (!answered || awaited) {
    rt.timing.gpuTiming?.skippedAnswering()
    if (rt.diag.traceEnabled) traceHeldOnAnswer(rt, awaited)
  }
  noteHold(rt, false, answered, awaited)
  // Whether this held frame is an image of the view's number is `advanceImageNumber`'s rule (`imageNumber.ts`), applied by the frame entry.
  const start = cpuNow()
  const presented = presentHeld(rt, device, awaited)
  recordHeldFrameWork(rt, presented, msSince(start))
  return true
}

/** Stores the frame that has just been fully encoded and submitted: it alone allows a hold. The
 *  witness does not see a settle frame: two identical ordinary frames remain two consecutive frames
 *  in its eyes. */
export function keepWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { gate, textureConverging } = rt.run
  if (textureConverging || rt.feedbackAB?.force) return
  sampleWebgpuFrame(rt, gate.hold.sample)
  gate.hold.keep(gate.revisions)
}
