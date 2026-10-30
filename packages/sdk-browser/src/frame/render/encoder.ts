import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { sampledDebugSubmitted } from '../../lighting/manyLightsSampled/debug/frame.ts'
import { translucencyVolumeDebugSubmitted } from '../../lighting/translucency/debug.ts'
import { sceneDebugSubmitted } from '../../lighting/surfaceCache/sceneDebug/frame.ts'
import { subsurfaceDebugSubmitted } from '../../lighting/subsurface/frame.ts'
import { vsmSubmitted } from '../../lighting/shadows/vsm/frame/vsmFrameEnd.ts'
import { gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import {
  commitSubmitted,
  destroyRetired,
  dropSubmitted,
  openEncoder,
  runAll,
  staleOpenEncoder,
  submitCommands,
} from '../../gpu/core/frameRetire.ts'
import { viewProj } from '../backend/helpers.ts'
import { enginePose } from '../../camera/world.ts'
import { composesOffscreen } from '../../diagnostic/gpuVariant.ts'
import type { WebgpuPagesCore } from '../backend/runtime.ts'
import { queueSubmits } from '../../gpu/core/sessionHandle.ts'
import { distanceFieldsSubmitted } from '../../lighting/distanceField/frame.ts'
import { hzbOcclusionSubmitted } from '../../visibility/hzbOcclusion/hzbOcclusion.ts'

/** A command buffer of the image, timed with its other parts when the image is sampled
 *  (`../../gpu/timing/encoder.ts`), never a capture's; `timed` false makes a plain one (a cut no image follows). It is open until its maker submits (`submitPart`, `submitColorCopy`) or drops it (`abandonPart`):
 *  a resource retired meanwhile outlives it (`frameRetire.ts`). */
export function createImagePart(
  rt: WebgpuPagesCore,
  device: GPUDevice,
  timed = true,
  label?: string,
) {
  return openEncoder(device, () =>
    timed && rt.timing.gpuTiming && !rt.capture.capturing
      ? rt.timing.gpuTiming.createEncoder(rt.run.frame, label)
      : device.createCommandEncoder({ label }),
  )
}

/** A part of the image dropped unsubmitted: its commits never run, and it counts no more in the timer image it was timed with (`settleTimedImage`), whatever its releases threw (the first error is thrown once both ran). The one way a part that did not reach the queue is let go; a part the queue took stays in the image. The image stays open for its owner (`settleTimedImage` with `ends`). */
export function abandonPart(rt: WebgpuPagesCore, encoder: GPUCommandEncoder) {
  runAll([() => dropSubmitted(encoder), () => settleTimedImage(rt, encoder, false)])
}

/** What the queue answered for each part of an image, the first time: the answer stands, so a part the queue took is never let go afterwards (an abandon of a submitted part) and one let go is not let go twice (a second submit refused as settled). */
const answers = new WeakMap<GPUCommandEncoder, boolean>()

/**
 * THE decision on the timer image of `encoder`, taken from what reached the queue and nowhere else (`takePart`, `abandonPart`,
 * `abandonFrameEncoder`, the waiting selection's send): a part the queue took marks the image; one it did not take is let go —
 * the image cancelled while no part of it reached the queue, otherwise left to close with the parts that did. Only the first answer
 * for a part counts. With `ends` (the image's owner is done), an image with a part that reached the queue is closed with it
 * (`sampleSubmitted`).
 */
export function settleTimedImage(
  rt: WebgpuPagesCore,
  encoder: GPUCommandEncoder,
  reached: boolean,
  ends = false,
) {
  const first = !answers.has(encoder)
  if (first) answers.set(encoder, reached)
  const timer = rt.timing.gpuTiming
  if (!timer?.isSampled(encoder)) return
  if (first) {
    if (reached) timer.markSubmitted(encoder)
    else if (timer.hasSubmittedPart()) timer.unreachedPart(encoder)
    else timer.cancelUnsubmitted()
  }
  if (ends && timer.hasSubmittedPart()) sampleSubmitted(rt, encoder, ...rt.gpu.targetSize)
}

const ledgerRefusal = (device: GPUDevice) => gpuDeviceLedgerOf(device)?.refusal

/** `submitCommands` on the image's behalf: an encoder already settled is refused with a diagnostic, not submitted twice. A device the ledger refused runs nothing: the encoder is dropped and the answer is 'refused' (`ledgerRefusal` is the reason). */
const takeCommands = (rt: WebgpuPagesCore, device: GPUDevice, encoder: GPUCommandEncoder) => {
  if (ledgerRefusal(device)) {
    dropSubmitted(encoder)
    return 'refused'
  }
  return submitCommands(device, encoder, () =>
    rt.diag.diagnosticFailure(
      'gpu-settled-submit-failed',
      new Error('GPU_SETTLED_ENCODER_SUBMITTED'),
    ),
  )
}

/** The queue takes `encoder`: true when it did, and the timer image knows a part of it reached the queue; 'refused' for a device the ledger refused. A part the queue did not take, or whose submit threw, is let go of the timer image it was timed with (`settleTimedImage`); an encoder already settled is refused and leaves the timer as it is. */
function takePart(rt: WebgpuPagesCore, device: GPUDevice, encoder: GPUCommandEncoder) {
  let reached: boolean | 'refused' = false
  try {
    reached = takeCommands(rt, device, encoder)
  } finally {
    settleTimedImage(rt, encoder, reached === true)
  }
  return reached
}

/** Whether this image's texture feedback is read back: not a capture's, nor an image without the
 *  target — a scene that wears no texture, the feedback A/B's arm without it. The reduction, its
 *  copy and the readback's mapping all ask it. */
const feedbackPublished = (rt: WebgpuPagesCore) => !rt.capture.capturing && !!rt.gpu.feedbackView

/** The image's own command buffer when one is open, a fresh one otherwise. */
const createRenderEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  rt.timing.frameEncoder ?? createImagePart(rt, device)

/** Runs `encode` on the image's encoder. An encoder made here settles on every exit: one `encode` left unsubmitted, or threw on, is abandoned with its timer image (an encoder no one owns would never settle: its releases and pools would stay; dropping a settled one again is a no-op); the frame's own is never dropped here, on a throw either: its owner settles it (`abandonFrameEncoder`, `submitColorCopy`). */
export function withRenderEncoder<T>(
  rt: WebgpuPagesCore,
  device: GPUDevice,
  encode: (encoder: GPUCommandEncoder) => T,
): T {
  const encoder = createRenderEncoder(rt, device)
  const framed = encoder === rt.timing.frameEncoder
  try {
    return encode(encoder)
  } finally {
    if (!framed) abandonPart(rt, encoder)
  }
}

export const openFrameEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  (rt.timing.frameEncoder = createImagePart(rt, device))

/** Drops the open command buffer and settles the selection whose readback would have ridden in it.
 *  The passes it held never ran. */
export function abandonFrameEncoder(rt: WebgpuPagesCore) {
  const { timing } = rt
  const dropped = timing.frameEncoder
  if (!dropped) return
  timing.frameEncoder = undefined
  // Each release runs whatever another threw; the first error is thrown once all ran.
  runAll([
    () => dropSubmitted(dropped),
    () => settleFrameSelection(timing, false),
    () => settleTimedImage(rt, dropped, false, true),
  ])
}

/** Settles the selection whose readback rode in the image's command buffer, once: `submitted`
 *  when the buffer left, false when it was dropped. */
function settleFrameSelection(timing: WebgpuPagesCore['timing'], submitted: boolean) {
  const settle = timing.frameSelection
  timing.frameSelection = undefined
  settle?.(submitted)
}

/** What the image copied for the CPU maps only once the image that copied it is submitted: the
 *  counts of a sampled image, the transparents' verdict counts (`verdictRead.ts`), the texture
 *  feedback where it was published, the light tiles, the cells its bounce pass marked (the translucency volume's own cache's too), the sky's
 *  harmonics, the exposure it left (`../../post/exposure/meter.ts`), the reflections' counters
 *  (`../../lighting/reflections/census.ts`) and the shadow pages. */
function submittedReadbacks(rt: WebgpuPagesCore, published: boolean) {
  rt.vis.voxelSteps?.submitted()
  rt.vis.gpuRaster?.tessellation?.losses.submitted()
  if (published) rt.vis.textures?.feedback.submitted()
  rt.lights.tiles?.submitted()
  rt.bounce.probes?.submitted()
  rt.bounce.translucency?.probes?.submitted()
  rt.gpu.reflection?.census.submitted()
  rt.gpu.exposure?.submitted()
  sampledDebugSubmitted(rt)
  translucencyVolumeDebugSubmitted(rt)
  subsurfaceDebugSubmitted(rt)
  sceneDebugSubmitted(rt)
  hzbOcclusionSubmitted(rt)
  vsmSubmitted(rt)
  distanceFieldsSubmitted(rt)
}

/** The display colour presented before the frame is submitted, unless the variant composes
 *  off-screen or the image is withheld. */
function presentDisplay(rt: WebgpuPagesCore, encoder: GPUCommandEncoder) {
  const { run, gpu, capture, context } = rt
  // The off-screen variant does not touch the swap chain in any way: neither a composition target
  // nor a separate presentation pass. That is what isolates what Presentation actually contains.
  // Nor does an image withheld — till the view has loaded, or while a load blocks on slow
  // streaming (`../loop/firstImage.ts`).
  const offscreen = composesOffscreen(context.diagnosticGpuVariant) || run.imageWithheld
  if (!offscreen && gpu.presenter && gpu.displayTexture && !capture.capturing) {
    // The display colour at its size: a frame drawn below it is the resolve's input, never shown.
    const at = rt.views.active.rect
    if (gpu.presenter.present(encoder, gpu.displayTexture, ...gpu.displaySize, at))
      run.gpuDrawCalls++
  }
}

/** The trace of the commands submitted. */
function traceSubmit(rt: WebgpuPagesCore, width: number, height: number) {
  const { run, capture, context } = rt
  if (rt.diag.traceEnabled)
    rt.diag.traceDiagnostic('encoding-submit', 'Commandes WebGPU soumises', () => ({
      frame: run.frame,
      submission: run.imageRevision,
      pose: run.lastCamera ? enginePose(run.gate.cam) : null,
      width,
      height,
      drawCalls: run.gpuDrawCalls,
      drawnTriangles: run.selectedTriangles,
      transparent: {
        drawCalls: run.blendDrawCalls,
        submittedTriangles: run.blendSubmittedTriangles,
      },
      presentation: capture.capturing
        ? 'surface-capture'
        : context.gpuCanvas
          ? 'direct'
          : 'composed',
    }))
}

/** The timing of the image, handed over once its commands are submitted, if it is sampled. */
export function sampleSubmitted(
  rt: WebgpuPagesCore,
  encoder: GPUCommandEncoder,
  width: number,
  height: number,
) {
  const { run, timing } = rt
  if (timing.gpuTiming?.isSampled(encoder))
    timing.gpuTiming.submitted(encoder, {
      // Its own counter: every closed sample, abandoned or waiting ones included, takes a number no other has.
      submission: ++run.timedSamples,
      viewport: [width, height],
      cameraWorld: run.lastCamera && [...run.gate.cam.eye],
      viewProjection: [...viewProj],
      scope: 'selection-and-render-passes',
      excludes: ['uploads and copies', 'CPU work', 'presentation latency'],
      drawCalls: run.gpuDrawCalls,
      renderScale: rt.views.active.scale.drawn,
      scaleSteered: rt.views.active.scale.steered,
      transparentDrawCalls: run.blendDrawCalls,
      transparentSubmittedTriangles: run.blendSubmittedTriangles,
    })
}

/**
 * After `encoder` left for `device`'s queue (`reached`: the queue took it): what the image replaced as it was encoded goes, its last command submitted (`frameRetire.ts`), and a taken
 * encoder commits what its passes advanced. A commit that throws, does not unsubmit the image: it is reported and the caller's bookkeeping runs.
 */
function settleSubmitted(
  rt: WebgpuPagesCore,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  reached: boolean,
) {
  try {
    // Only a real submit counts on the device's clock and leaves the open set; a dropped encoder already left it.
    if (reached) destroyRetired(device, encoder)
    else destroyRetired(device)
  } catch (error) {
    rt.diag.diagnosticFailure('gpu-retire-failed', error)
  }
  // An encoder open for many submits is a leak holding every session's retired resources: said, never destroyed.
  if (staleOpenEncoder(device))
    rt.diag.diagnosticFailure('gpu-open-encoder-stale', new Error('GPU_OPEN_ENCODER_STALE'))
  if (!reached) return
  try {
    commitSubmitted(encoder)
  } catch (error) {
    rt.diag.diagnosticFailure('gpu-commit-failed', error)
  }
}

/**
 * A part of the image, submitted on its own (the cut's send, the roots' pass): true when the queue took it (`takePart`). A taken one commits, and what the image retired goes (`settleSubmitted`).
 */
export function submitPart(rt: WebgpuPagesCore, device: GPUDevice, encoder: GPUCommandEncoder) {
  // A device the ledger refused takes no part and says nothing here: the refusal is the frame's to throw (`submitColorCopy`).
  let reached = false
  try {
    reached = takePart(rt, device, encoder) === true
  } finally {
    settleSubmitted(rt, device, encoder, reached)
  }
  return reached
}

export function submitColorCopy(
  rt: WebgpuPagesCore,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  height: number,
  width: number,
  presented = false,
) {
  const { run, gpu, timing, capture } = rt
  const owned = encoder === timing.frameEncoder
  // Whatever ended before the queue took the commands, they are neither run nor kept (`submitCommands`);
  // the timer image of an image the queue refused is dropped, as an abandoned one's — whether the
  // encoder was the frame's or a timed part beside it, and whether the submit threw or the queue took nothing.
  let reached = false
  let asked = false
  const published = feedbackPublished(rt)
  const main = rt.views.active === rt.views.main
  // What the image retired as it was encoded goes on every exit, a throw or a refusal included (`settleSubmitted`).
  try {
    try {
      if (!presented) presentDisplay(rt, encoder)
      // Texture image feedback leaves with the image: the target where pixels posted their requests is
      // reduced to counts, copied to their readback then zeroed.
      if (published)
        rt.vis.textures?.publishRequests(
          encoder,
          run.feedbackWritten ? gpu.feedbackView : undefined,
          gpu.targetSize,
          run.textureConverging,
        )
      asked = true
      // Submit is timed alone: the encode that precedes it no longer carries it.
      const submitStart = cpuNow()
      const taken = takePart(rt, device, encoder)
      if (taken === 'refused') throw ledgerRefusal(device)
      reached = taken
      timing.lastQueueSubmitMs = msSince(submitStart)
    } finally {
      if (!reached) {
        // A throw before the queue was asked leaves the encoder open: it is dropped with its timer image (`takePart` did both once asked).
        // The frame's encoder is settled (dropped), whether the submit threw, the queue took nothing or the device refused: it is not the frame's any more and its selection did not leave.
        runAll([
          () => {
            if (!asked && !owned) abandonPart(rt, encoder)
          },
          () => {
            if (owned) abandonFrameEncoder(rt)
          },
          // A timed part beside no frame encoder is the image's last: it closes the image with the parts that reached the queue, as the owned path does.
          () => {
            if (!owned && !timing.frameEncoder) settleTimedImage(rt, encoder, false, true)
          },
        ])
      }
    }
    // An image the queue refused (a released session's) ran nothing: it is in flight for no one, reads
    // nothing back and counts for no image. What it replaced as it was encoded goes as safely.
    if (reached && main) {
      // The image is in flight until the device has run it: the loop paces itself on that count, one
      // a frame — the main view's image; the views drawn beside it follow it in the queue.
      run.gpuFramesInFlight++
      // Kept for the loop's own feedback wait (`pendingWebgpuFrame`): one device call a frame.
      run.submittedDone = device.queue.onSubmittedWorkDone()
      run.submittedAt = queueSubmits(device)
      void run.submittedDone.finally(() => run.gpuFramesInFlight--)
    }
  } finally {
    settleSubmitted(rt, device, encoder, reached)
  }
  if (!reached) return
  // The frame's encoder is submitted: it is not the frame's any more and its selection left, before anything that reads back or inspects can throw.
  if (owned) {
    timing.frameEncoder = undefined
    settleFrameSelection(timing, true)
  }
  // The timed image closes as soon as the queue is confirmed to have taken the image, before anything that reads back, inspects or traces; its number is the timing samples' own.
  // Each step runs whatever another threw, so a closing that throws strands no readback; the first error is thrown once all ran.
  runAll([
    () => sampleSubmitted(rt, encoder, width, height),
    () => submittedReadbacks(rt, published),
    // An inspection asked reads the main view's image now, before a view aside overwrites what the
    // views share (`../../diagnostic/inspection/read.ts`).
    () => {
      if (main && !capture.capturing) run.inspect?.()
    },
    () => void run.imageRevision++,
    () => traceSubmit(rt, width, height),
  ])
}
