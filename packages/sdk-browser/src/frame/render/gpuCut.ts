import { cpuNow } from '../../diagnostic/stopwatch.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { cameraSelectionUniforms } from '../../gpu/core/selection.ts'
import {
  CULL_CLIP_PLANE_OFF,
  CULL_DRAW_DISTANCE_OFF,
  CULL_FRUSTUM_OFF,
  CULL_MIN_LOD_OFF,
} from '../../geometry/dag/shader/viewsWgsl.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import { writeCutOcclusion } from './cutPyramid.ts'
import { writeCutViewSet } from './cutViewSet.ts'
import { CUT_RULES } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { mirrorDrawnFromShown } from '../backend/helpers.ts'
import { abandonFrameEncoder, openFrameEncoder } from './encoder.ts'
import { encodeDraws, followRows } from './encodeDraws.ts'
import { admitGpuCut } from './gpuCutAdmission.ts'
import { cutOf, dispatchCut, dispatchWaitingSelection, streamCutResidency } from './gpuCutStream.ts'
import { keepWebgpuFrame } from '../loop/hold.ts'
import { adoptPendingFreeze, cullStep } from './cutFreeze.ts'
import { recordGpuCutTiming, traceGpuCutFrame, traceGpuCutWaiting } from './gpuCutTrace.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { cutListCaps } from '../../geometry/dag/lists/cutListCaps.ts'

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
 * its own (`../../geometry/dag/aside.ts`). A scene without a cluster draws what is not paged alone.
 */
export function renderGpuCut(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  pixelError: number,
  cpuStart: number,
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
  adoptAndAdmit(rt, cam, pixelError)
  if (run.gpuSelection && !services.bootstrapState.ready) {
    // The root cover is not resident yet: nothing can be drawn, nor held. Once it is, every surface
    // is drawn by a resident representation (`../../geometry/cut/rule.ts`), and no frame waits again.
    // The wait keeps asking for missing pages, syncing residency and sending selection — that is
    // the only send that can produce the sample of the resume.
    run.gate.resourcesChanged()
    run.gpuMetricsReady = false
    streamCutResidency(rt, gpuDevice)
    // No image follows, nor a post pass: the cut runs in one.
    if (cullStep(rt) !== 'held') run.selectionUniforms.occlusion = 0
    if (!dispatchWaitingSelection(rt)) dropFailedView(rt)
    traceGpuCutWaiting(rt)
    return
  }
  streamCutResidency(rt, gpuDevice)
  if (cutFrame(rt, gpuDevice, cam)) encodeImage(rt, gpuDevice, cam)
}

/**
 * The drawn view's occlusion, decided once its rows are followed: two passes when the host asks
 * them (`cutTwoPassOcclusion`, `cutOcclusionCulling`), the image draws rows — its visibility
 * passes then encode the post pass (`../../visibility/passes/passes.ts`) — and the view's last
 * pyramid stands for it (`./cutPyramid.ts`); that pyramid bound for the next dispatch of the drawn
 * view's cut, the main one or its own aside (`cutOf`). A frozen cut keeps what it froze with.
 */
function decideOcclusion(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run, layout } = rt
  if (cullStep(rt) === 'held') return
  const asked =
    cutSetting(rt, 'cutTwoPassOcclusion') &&
    cutSetting(rt, 'cutOcclusionCulling') &&
    layout.rows.packedCount > 0
  const pyramid = writeCutOcclusion(rt, cam, run.selectionUniforms, asked)
  cutOf(rt)?.bindPyramid(pyramid)
}

/** The cut's setting `field` the session holds (`cutOptions.ts`), by its one resolver. */
const cutSetting = contextReader(CUT_RULES)

/**
 * The level of detail's factor of the drawn view (`cutLodBiasFollowsUpscale`): an image the
 * temporal pass reconstructs to a wider display is cut as the display would be — its threshold
 * divided by the width's ratio, shifted by `2^-cutLodBiasOffset` —, never finer than
 * `2^-cutLodBiasMin`; any other image at its own size.
 */
function lodBiasFactor(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  if (!gpu.temporal?.frame.active || !cutSetting(rt, 'cutLodBiasFollowsUpscale')) return 1
  const upscale = gpu.displaySize[0] / Math.max(1, gpu.targetSize[0])
  return Math.min(
    upscale * 2 ** -cutSetting(rt, 'cutLodBiasOffset'),
    2 ** -cutSetting(rt, 'cutLodBiasMin'),
  )
}

/**
 * The drawn view's selection uniforms under `cam`: its pixels at the size the image is drawn at,
 * the image's render matrix — its jitter included — the boxes' pixel centres are found with, the
 * culls the host turned off, the scale of the draw distances, the view's clip plane and filter, the
 * frame. The threshold the cut reads is the host's pixels per edge divided by the view's
 * level-of-detail factor (`lodBiasFactor`) and the streaming quality scale
 * (`../../geometry/residency/poolPressure.ts`): residency coarsens, one DAG level where a page is
 * missing (`../../geometry/cut/rule.ts`) — or, where a GPU time budget asks it, by the lesser of
 * that scale and the edge scale's fraction, the world's for every view
 * (`../scale/scaleControl.ts`, `cutEdgeScaleBudgetMs`).
 */
function writeCutUniforms(rt: WebgpuPagesRuntime, cam: EngineCamera, pixelError: number) {
  const { run, gpu, services } = rt,
    uniforms = run.selectionUniforms,
    size = gpu.targetSize
  const scale = Math.min(
    services.residency.qualityScale,
    rt.views.main.scale.edge.ask(
      cutSetting(rt, 'cutEdgeScaleBudgetMs'),
      cutSetting(rt, 'cutEdgeScaleMinPercent'),
    ),
  )
  const threshold = pixelError / (lodBiasFactor(rt) * scale)
  cameraSelectionUniforms(cam, threshold, size, uniforms, taaRenderMatrix(rt, cam))
  uniforms.cullOff =
    (cutSetting(rt, 'cutFrustumCulling') ? 0 : CULL_FRUSTUM_OFF) |
    (cutSetting(rt, 'cutMinLodCulling') ? 0 : CULL_MIN_LOD_OFF) |
    (cutSetting(rt, 'cutDrawDistanceCulling') ? 0 : CULL_DRAW_DISTANCE_OFF) |
    (cutSetting(rt, 'cutClipPlaneCulling') ? 0 : CULL_CLIP_PLANE_OFF)
  // The view's clip plane and its lists of hidden and shown objects (`./cutViewSet.ts`).
  writeCutViewSet(rt, cam, uniforms, cutSetting(rt, 'cutViewFiltering'))
  const distances = cutSetting(rt, 'cutViewDistanceScale')
  uniforms.viewDistanceScale = distances
  // What the rays' scene meets of the objects out of their draw distances, from the same eye.
  run.gpuSelection?.proxyDistance(
    cam.eye,
    cutSetting(rt, 'cutDrawDistanceCulling') ? distances : undefined,
  )
  // The clock every view's cut of this frame stamps the rows it uses with
  // (`../../geometry/rows/rowClosureWgsl.ts`), and a cut in two passes is known by.
  uniforms.frame = run.frame
}

/** The view's selection uniforms written, its last readback adopted and its cut admitted. */
function adoptAndAdmit(rt: WebgpuPagesRuntime, cam: EngineCamera, pixelError: number) {
  const { run, services } = rt,
    marks = rt.timing.marks
  // A frozen cut keeps the uniforms of the camera it froze at (`./cutFreeze.ts`).
  if (cullStep(rt) !== 'held') writeCutUniforms(rt, cam, pixelError)
  // The caps the session's settings give the cut's lists, from its next cut on.
  run.gpuSelection?.holdLists(cutListCaps(rt.context))
  adoptPendingFreeze(rt)
  // An image that adopts no readback moves no page; the adoption reports what it actually moved.
  run.pagesEntered = 0
  run.pagesExited = 0
  services.adoptViewCut()
  // A scene without a cluster DAG waits for no readback: its counts are the image's own, and it has
  // no cut to move — held, or a still view of unpaged surfaces alone would never be.
  if (!run.gpuSelection) run.gpuMetricsReady = run.cutHeld = true
  marks.adoptEnd = cpuNow()
  admitGpuCut(rt)
  marks.admissionEnd = cpuNow()
}

/** The frame's encoder opened, the rows followed, the occlusion decided and the cut dispatched into
 *  it; false when the image stops there. */
function cutFrame(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, cam: EngineCamera) {
  let cut: boolean
  try {
    const encoder = openFrameEncoder(rt, gpuDevice)
    followRows(rt, gpuDevice)
    rt.vis.deformationCode?.encodeDeformation(rt, encoder)
    decideOcclusion(rt, cam)
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
  marks.selectionEnd = cpuNow()
  logFirstRenderPath(rt)
  const imageBeforeEncode = run.imageRevision
  marks.encodeStart = cpuNow()
  try {
    encodeDraws(rt, gpuDevice, cam)
  } finally {
    // An encode path that returned without submitting would strand the selection's readback slot.
    abandonFrameEncoder(rt)
  }
  marks.cpuEnd = cpuNow()
  // The cut's own triangles came back with the readback, every transparent cluster among them.
  if (run.gpuMetricsReady) run.submittedTriangles = run.selectedTriangles
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
