import type { EngineCamera } from '../../../camera/world.ts'
import { selectVisiblePages, type PageRec } from '../../../page/selection/selection.ts'
import { applyTemporalHiz, resetHizCounts } from '../../../hiz/hiz.ts'
import { pageAddress } from '../../row/pageSlots.ts'
import {
  appendAll,
  copyPacked,
  markDrawnDiverged,
  partitionByPass,
  partitionPacked,
  triangleSum,
} from '../helpers.ts'
import { publishCpuProfile } from './cpuSteps.ts'
import { encodeDraws } from './encodeDraws.ts'
import { traceCpuFrame, traceCpuFrameWaiting, traceCpuSelection } from './trace.ts'
import {
  cpuSampleOf,
  logFirstCpuRenderPath,
  traceAdmission,
  traceDrawnVerify,
  traceQueueReconstruct,
} from './steps.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { coverageBudgetEvent } from '../../../diagnostic/engineDiagnostic.ts'
import { drawnViewChanged } from '../state/view.ts'

/** The image's cut, into the reused result: the cut rule draws the nearest representation the
 *  pool holds of each surface (`../../../page/cut/rule.ts`). */
function selectCpuCut(rt: WebgpuPagesRuntime, cam: EngineCamera, pixelError: number) {
  const { run } = rt
  rt.services.syncResidency()
  const selected = selectVisiblePages(
    rt.setup.roots,
    cam,
    {
      pixelError,
      viewport: rt.setup.viewport,
      held: rt.services.heldResidency,
      wanted: run.selectResult.wanted,
      result: run.selectResult,
    },
    run.shown,
  )
  // The packed ranks the cut published, rank by rank, kept beside the records: one record serves
  // every placement of its primitive.
  copyPacked(run.shownPacked, selected.shownPacked, run.shown.length)
  return selected
}

/** Drops the occluded half of a complete CPU cut when the temporal pyramid can vouch for it. */
function cullWithTemporalHiz(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run, vis, diag } = rt,
    ready = run.readyScratch
  ready.length = 0
  appendAll(ready, run.shown)
  if (!vis.visEnabled || vis.gpuHiz || ready.length < 2 || !ready.every((page) => page.array)) {
    copyPacked(run.drawnPacked, run.shownPacked)
    return ready
  }
  const roots = rt.layout.selectionRoots,
    rootOfPacked = rt.layout.placement.rootOfPacked,
    viewport = rt.setup.viewport ?? rt.gpu.targetSize
  try {
    const opaque = partitionByPass(ready, false, run.opaqueScratch),
      opaquePacked = partitionPacked(ready, run.shownPacked, false, run.opaquePackedScratch)
    const cut = applyTemporalHiz(
      opaque as Array<PageRec & { array: Uint32Array }>,
      { roots, packed: opaquePacked, rootOfPacked },
      cam,
      viewport,
      run.temporalHizState,
      run.cpuHizCounts,
      rt.setup.pixelRatio(),
    )
    run.cpuHizCounted = true
    run.culledScratch.length = 0
    appendAll(run.culledScratch, cut.shown, partitionByPass(ready, true, run.transparentScratch))
    // Written in place: the GPU cut's adopter and the row sync hold this very array.
    run.drawnPacked.length = 0
    appendAll(
      run.drawnPacked,
      cut.shownPacked,
      partitionPacked(ready, run.shownPacked, true, run.transparentPackedScratch),
    )
    return run.culledScratch
  } catch (error) {
    resetHizCounts(run.cpuHizCounts)
    run.cpuHizCounted = false
    diag.diagnosticFailure('hiz-frame-fallback', error) /* Keep the selected cut. */
    copyPacked(run.drawnPacked, run.shownPacked)
    return ready
  }
}

/** One image driven by the CPU reference cut, drawn once the pinned coverage is ready: each
 *  surface by the finest representation the pool holds. */
export function renderCpuCut(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  pixelError: number,
  cpuStart: number,
  lightsEnd: number,
) {
  const { run, gpu, timing, services } = rt,
    { bootstrapUrls, slots } = rt.setup,
    gpuDevice = gpu.device!
  // The CPU cut rewrites the lists itself: no held image leans on its own. On the main view the
  // GPU sample no longer describes the image's arrays: this cut will write them. Another view
  // writes its own, and only its own hold breaks.
  drawnViewChanged(rt)
  if (rt.views.active === rt.views.main) services.forgetReadback()
  // This image writes `shown` and `drawn` itself, and may exit by an error between the two: the
  // flag falls before the first write, never after.
  markDrawnDiverged(run)
  run.pagesEntered = null
  run.pagesExited = null
  const cpuSelectionStarted = performance.now()
  const selected = selectCpuCut(rt, cam, pixelError)
  run.cpuSelectMs = performance.now() - cpuSelectionStarted
  traceCpuSelection(rt, selected, run.cpuSelectMs)
  // The chosen cut, not yet published. Admission weighs it here, but the residency sets receive it
  // only once the pinned coverage is ready, below: publishing earlier would make the cache hold —
  // and forbid it from reclaiming — a cut the image never drew.
  const wanted = selected.wanted,
    wantedIds = selected.wantedPacked,
    recordOf = rt.layout.recordOf
  run.overBudget = false
  run.visible = selected.visible
  run.selectedTriangles = selected.selectedTriangles
  run.frustumRejected = selected.frustumRejected
  run.lodLevel = selected.lodLevel
  const admissionStarted = performance.now(),
    requested = run.requestedScratch
  requested.clear()
  for (const url of bootstrapUrls) requested.add(url)
  // The cut publishes packed ranks, walked to the record list's length (the reused buffer is never
  // truncated): a requested address is read back through the catalogue alone.
  for (let i = 0; i < wanted.length; i++) {
    const rec = recordOf(wantedIds[i])
    if (rec) requested.add(pageAddress(rec))
  }
  const wasLimited = run.coverageBudgetLimited
  run.coverageBudgetLimited = requested.size > slots
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = coverageBudgetEvent(
      run.coverageBudgetLimited,
      requested.size,
      slots,
      services.bootstrapState.ready,
      pixelError,
    )
  traceAdmission(rt, requested, wanted, admissionStarted)
  if (!services.bootstrapState.ready) {
    run.drawn.length = 0
    run.submittedTriangles = 0
    run.gpuDrawCalls = 0
    const loadingEnd = performance.now()
    timing.cpuSample = cpuSampleOf(
      rt,
      { cpuStart, lightsEnd, selectionEnd: loadingEnd },
      loadingEnd,
    )
    traceCpuFrameWaiting(rt, cam, requested)
    return
  }
  if (run.shown.some((page) => !services.hasBytes(page)))
    throw new Error('GPU_COVERAGE_BYTES_MISSING')
  const culled = cullWithTemporalHiz(rt, cam)
  const selectionEnd = performance.now()
  const queueStarted = performance.now()
  // Here, and no earlier: the image has passed its guards and `shown` is final. The CPU cut then
  // publishes its own by the same delta as the GPU sample — once, and only once, for an image that
  // draws.
  services.adoptCpuCut(wantedIds, selected.shownPacked, wanted.length, selected.shown.length)
  services.residency.queueCutResidency()
  services.followEvictions(null)
  const queueEnd = performance.now()
  traceQueueReconstruct(rt, queueEnd - queueStarted)
  const drawnVerifyStarted = performance.now()
  run.drawn.length = 0
  appendAll(run.drawn, culled)
  run.blendPagedTriangles = triangleSum(run.drawn, true)
  // The CPU cut draws what it selected; what the Hi-Z pass drops is occluded, not missing. The cut
  // rule drew only what the pool holds: the whole cut goes to draw, and occlusion reject does not
  // drop out here — `hizRejectedTriangles` counts it.
  run.drawnTriangles = run.selectedTriangles
  traceDrawnVerify(rt, performance.now() - drawnVerifyStarted)
  logFirstCpuRenderPath(rt)
  const encodeStart = performance.now()
  run.submittedTriangles = encodeDraws(rt, gpuDevice, cam)
  const cpuEnd = performance.now()
  timing.lastSubmitMs = cpuEnd - encodeStart
  timing.cpuSample = cpuSampleOf(rt, { cpuStart, lightsEnd, selectionEnd, encodeStart }, cpuEnd)
  publishCpuProfile(rt)
  traceCpuFrame(rt, cam)
}
