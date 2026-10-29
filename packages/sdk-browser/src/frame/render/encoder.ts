import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { sampledDebugSubmitted } from '../../lighting/manyLightsSampled/debug/frame.ts'
import { sceneDebugSubmitted } from '../../lighting/surfaceCache/sceneDebug/frame.ts'
import { subsurfaceDebugSubmitted } from '../../lighting/subsurface/frame.ts'
import { vsmSubmitted } from '../../lighting/shadows/vsm/frame/vsmFrameEnd.ts'
import { gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { viewProj } from '../backend/helpers.ts'
import { enginePose } from '../../camera/world.ts'
import { composesOffscreen } from '../../diagnostic/gpuVariant.ts'
import type { WebgpuPagesCore } from '../backend/runtime.ts'
import { queueSubmits } from '../../gpu/core/sessionHandle.ts'
import { distanceFieldsSubmitted } from '../../lighting/distanceField/frame.ts'
import { hzbOcclusionSubmitted } from '../../visibility/hzbOcclusion/hzbOcclusion.ts'

/** A command buffer of the image, timed with its other parts when the image is sampled
 *  (`../../gpu/timing/encoder.ts`), never a capture's. */
export const createImagePart = (rt: WebgpuPagesCore, device: GPUDevice) =>
  rt.timing.gpuTiming && !rt.capture.capturing
    ? rt.timing.gpuTiming.createEncoder(rt.run.frame)
    : device.createCommandEncoder()

/** Whether this image's texture feedback is read back: not a capture's, nor an image without the
 *  target — a scene that wears no texture, the feedback A/B's arm without it. The reduction, its
 *  copy and the readback's mapping all ask it. */
const feedbackPublished = (rt: WebgpuPagesCore) => !rt.capture.capturing && !!rt.gpu.feedbackView

/** The image's own command buffer when one is open, a fresh one otherwise. */
export const createRenderEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  rt.timing.frameEncoder ?? createImagePart(rt, device)

export const openFrameEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  (rt.timing.frameEncoder = createImagePart(rt, device))

/** Drops the open command buffer and settles the selection whose readback would have ridden in it.
 *  The passes it held never ran. */
export function abandonFrameEncoder(rt: WebgpuPagesCore) {
  const { timing } = rt
  const dropped = timing.frameEncoder
  if (!dropped) return
  timing.frameEncoder = undefined
  settleFrameSelection(timing, false)
  timing.gpuTiming?.cancelUnsubmitted()
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
  rt.blendState.expand?.submitted()
  if (published) rt.vis.textures?.feedback.submitted()
  rt.lights.tiles?.submitted()
  rt.bounce.probes?.submitted()
  rt.bounce.translucency?.probes?.submitted()
  rt.gpu.reflection?.census.submitted()
  rt.gpu.exposure?.submitted()
  sampledDebugSubmitted(rt)
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
      submission: run.imageRevision,
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

export function submitColorCopy(
  rt: WebgpuPagesCore,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  height: number,
  width: number,
  presented = false,
) {
  const { run, gpu, timing, capture } = rt
  if (!presented) presentDisplay(rt, encoder)
  const owned = encoder === timing.frameEncoder
  // Texture image feedback leaves with the image: the target where pixels posted their requests is
  // reduced to counts, copied to their readback then zeroed.
  const published = feedbackPublished(rt)
  if (published)
    rt.vis.textures?.publishRequests(
      encoder,
      run.feedbackWritten ? gpu.feedbackView : undefined,
      gpu.targetSize,
      run.textureConverging,
    )
  const refusal = gpuDeviceLedgerOf(device)?.refusal
  if (refusal) throw refusal
  // Submit is timed alone: the encode that precedes it no longer carries it.
  const submitStart = cpuNow()
  const command = encoder.finish()
  device.queue.submit([command])
  timing.lastQueueSubmitMs = msSince(submitStart)
  // The image is in flight until the device has run it: the loop paces itself on that count, one
  // a frame — the main view's image; the views drawn beside it follow it in the queue.
  if (rt.views.active === rt.views.main) {
    run.gpuFramesInFlight++
    // Kept for the loop's own feedback wait (`pendingWebgpuFrame`): one device call a frame.
    run.submittedDone = device.queue.onSubmittedWorkDone()
    run.submittedAt = queueSubmits(device)
    void run.submittedDone.finally(() => run.gpuFramesInFlight--)
  }
  // What the image replaced as it was encoded goes, its last command submitted (`frameRetire.ts`).
  destroyRetired(device)
  submittedReadbacks(rt, published)
  // An inspection asked reads the main view's image now, before a view aside overwrites what the
  // views share (`../../diagnostic/inspection/read.ts`).
  if (rt.views.active === rt.views.main && !capture.capturing) run.inspect?.()
  run.imageRevision++
  if (owned) {
    timing.frameEncoder = undefined
    settleFrameSelection(timing, true)
  }
  traceSubmit(rt, width, height)
  sampleSubmitted(rt, encoder, width, height)
}
