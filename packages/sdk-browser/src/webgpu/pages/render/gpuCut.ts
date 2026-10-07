import type { EngineCamera } from '../../../camera/world.ts'
import { cameraSelectionUniforms } from '../../../gpu/core/selection.ts'
import { prefetchHorizonMs } from '../../../engine/common.ts'
import { mirrorDrawnFromShown } from '../helpers.ts'
import { abandonFrameEncoder, openFrameEncoder } from './encoder.ts'
import { encodeComposedRoots } from '../../../placement/gpuCompose.ts'
import { encodeDraws } from './encodeDraws.ts'
import { admitGpuCut } from './gpuCutAdmission.ts'
import { dispatchCut, dispatchWaitingSelection, streamCutResidency } from './gpuCutStream.ts'
import { keepWebgpuFrame } from '../../frame/hold.ts'
import { recordGpuCutTiming, traceGpuCutFrame, traceGpuCutWaiting } from './gpuCutTrace.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** Logs the configuration of the first image once. */
function logFirstRenderPath(rt: WebgpuPagesRuntime) {
  const { run, gpu, diag, layout } = rt
  if (run.renderPathLogged) return
  run.renderPathLogged = true
  diag.engineDiagnostic('first-render-path', 'WebGPU first render configuration', {
    clearColor: `#${run.clearColor.toString(16).padStart(6, '0')}`,
    targetSize: gpu.targetSize,
    residentCandidates: layout.rows.candidateCount,
  })
}

/**
 * One image drawn by the GPU cluster cut, the engine's one cut (#1483): the mask of the current
 * frame decides the draw, the readback of the previous one decides streaming and metrics. A view
 * drawn beside the main one — a capture, a persistent view — cuts on the same tables, with lists of
 * its own (`../../../gpu/dag/aside.ts`). A scene without a cluster draws what is not paged alone.
 */
export function renderGpuCut(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  pixelError: number,
  cpuStart: number,
  lightsEnd: number,
) {
  const { run, gpu, services } = rt,
    gpuDevice = gpu.device,
    marks = rt.timing.marks
  if (!gpuDevice || !gpu.cache) {
    // Origin of the resource change: the device or the cache has gone.
    run.gate.resourcesChanged()
    return
  }
  marks.cpuStart = cpuStart
  marks.lightsEnd = lightsEnd
  adoptAndAdmit(rt, cam, pixelError)
  if (run.gpuSelection && !services.bootstrapState.ready) {
    // The root cover is not resident yet: nothing can be drawn, nor held. Once it is, every surface
    // is drawn by a resident representation (`../../../page/cut/rule.ts`), and no frame waits again.
    // The wait keeps asking for missing pages, syncing residency and sending selection — that is
    // the only send that can produce the sample of the resume.
    run.gate.resourcesChanged()
    run.gpuMetricsReady = false
    streamCutResidency(rt, gpuDevice)
    if (!dispatchWaitingSelection(rt)) dropFailedView(rt)
    traceGpuCutWaiting(rt)
    return
  }
  streamCutResidency(rt, gpuDevice)
  if (cutFrame(rt, gpuDevice)) encodeImage(rt, gpuDevice, cam)
}

/** The camera's motion the view's cut reads its view ahead from: the main view's alone, which
 *  looks a round trip further for pages that come from further away; none for a view aside. */
export function cutMotion(rt: WebgpuPagesRuntime) {
  const { run, context, views } = rt
  run.motion.horizonMs = prefetchHorizonMs(context.pageRoundTripMs?.())
  return views.active === views.main ? run.motion : undefined
}

/** The view's selection uniforms written, its last readback adopted and its cut admitted. */
function adoptAndAdmit(rt: WebgpuPagesRuntime, cam: EngineCamera, pixelError: number) {
  const { run, services } = rt,
    { viewport } = rt.setup,
    marks = rt.timing.marks
  // The host's threshold, and no other: residency coarsens, one DAG level where a page is missing
  // (`../../../page/cut/rule.ts`).
  const uniforms = run.selectionUniforms
  cameraSelectionUniforms(cam, pixelError, viewport, uniforms, cutMotion(rt))
  // A pool short of the views' cuts has the GPU rank the requests by admission (`request.ts`).
  uniforms.admitByLevel = services.residency.short()
  // An image that adopts no readback moves no page; the adoption reports what it actually moved.
  run.pagesEntered = 0
  run.pagesExited = 0
  services.adoptViewCut()
  // A scene without a cluster DAG waits for no readback: its counts are the image's own, and it has
  // no cut to move — held, or a still view of unpaged surfaces alone would never be.
  if (!run.gpuSelection) run.gpuMetricsReady = run.cutHeld = true
  marks.adoptEnd = performance.now()
  // One cut covers both passes: the image sweeps no DAG of its own for the transparents any more.
  marks.transparentSelectEnd = marks.adoptEnd
  admitGpuCut(rt)
  marks.admissionEnd = performance.now()
}

/** The frame's encoder opened and the cut dispatched into it; false when the image stops there. */
function cutFrame(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  let cut: boolean
  try {
    const encoder = openFrameEncoder(rt, gpuDevice)
    rt.vis.deformationCode?.encodeDeformation(rt, encoder)
    encodeComposedRoots(rt, gpuDevice, encoder)
    cut = dispatchCut(rt, encoder)
  } catch (error) {
    abandonFrameEncoder(rt)
    rt.diag.diagnosticFailure('gpu-selection-dispatch-failed', error)
    dropFailedView(rt)
    return false
  }
  // A list being grown cut nothing for a view drawn aside: it keeps the image it has.
  if (!cut) abandonFrameEncoder(rt)
  return cut
}

/** The cut image's draws encoded and submitted, its counts, timing and trace recorded. */
function encodeImage(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, cam: EngineCamera) {
  const { run } = rt,
    marks = rt.timing.marks
  // An image whose lists no adoption touched would push eighty thousand records already in place:
  // the flag says so, the copy abstains.
  mirrorDrawnFromShown(run)
  marks.selectionEnd = performance.now()
  logFirstRenderPath(rt)
  const imageBeforeEncode = run.imageRevision
  marks.encodeStart = performance.now()
  try {
    encodeDraws(rt, gpuDevice, cam)
  } finally {
    // An encode path that returned without submitting would strand the selection's readback slot.
    abandonFrameEncoder(rt)
  }
  marks.cpuEnd = performance.now()
  // The cut's own triangles came back with the readback; the meshes outside the DAG are counted
  // where they are drawn.
  if (run.gpuMetricsReady)
    run.submittedTriangles = run.selectedTriangles + run.blendUnpagedTriangles
  recordGpuCutTiming(rt)
  traceGpuCutFrame(rt, cam)
  // The image was encoded and submitted in full: it alone allows a hold, and only if the previous
  // one was already identical to it.
  if (run.imageRevision !== imageBeforeEncode) keepWebgpuFrame(rt)
}

/** A send that failed, said by its caller: the image is skipped, never a lost device — only
 *  `device.lost` says that (#1483). A view drawn aside drops its cut: it cuts anew at its next image. */
function dropFailedView(rt: WebgpuPagesRuntime) {
  const { run, views } = rt
  if (views.active === views.main || !run.asideCut) return
  run.asideCut.dispose()
  run.asideCut = undefined
}
