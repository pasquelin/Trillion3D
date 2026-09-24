import type { EngineCamera } from '../../../camera/world.ts';
import { selectVisiblePages, type PageRec } from '../../../page/selection/selection.ts';
import { applyTemporalHiz, resetHizCounts } from '../../../hiz/hiz.ts';
import { pageAddress } from '../../row/pageSlots.ts';
import { appendAll, markDrawnDiverged, partitionByPass, triangleSum } from '../helpers.ts';
import { publishCpuProfile } from './cpuSteps.ts';
import { ensureTargets } from '../prepare/targets.ts';
import { encodeDraws } from './encodeDraws.ts';
import { traceCpuFrame, traceCpuFrameWaiting, traceCpuSelection } from './trace.ts';
import {
  cpuSampleOf,
  logFirstCpuRenderPath,
  traceAdmission,
  traceDrawnVerify,
  traceQueueReconstruct,
  traceTargetsEnsured,
  traceTransition,
} from './steps.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

function selectCpuCut(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  pixelError: number,
  pinnedOnly: boolean,
) {
  const { roots, viewport, bootstrapUrls } = rt.setup,
    { poolHolds } = rt.services;
  // The image's cut writes into the reused result; the rare pinned fallback keeps its own.
  const result = pinnedOnly ? undefined : rt.run.selectResult;
  return selectVisiblePages(
    roots,
    cam,
    {
      pixelError,
      viewport,
      holdResident: true,
      rootFallback: true,
      isResident: pinnedOnly
        ? (rec) => bootstrapUrls.has(pageAddress(rec)) && poolHolds(rec)
        : poolHolds,
      wanted: result?.wanted,
      result,
    },
    pinnedOnly ? undefined : rt.run.shown,
  );
}

/** Drops the occluded half of a complete CPU cut when the temporal pyramid can vouch for it. */
function cullWithTemporalHiz(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run, vis, diag } = rt,
    ready = run.readyScratch;
  ready.length = 0;
  appendAll(ready, run.shown);
  if (!vis.visEnabled || vis.gpuHiz || ready.length < 2 || !ready.every((page) => page.array))
    return ready;
  try {
    const cut = applyTemporalHiz(
      partitionByPass(ready, false, run.opaqueScratch) as Array<PageRec & { array: Uint32Array }>,
      cam,
      rt.setup.viewport ?? rt.gpu.targetSize,
      run.temporalHizState,
      run.cpuHizCounts,
    );
    run.cpuHizCounted = true;
    run.culledScratch.length = 0;
    appendAll(run.culledScratch, cut.shown, partitionByPass(ready, true, run.transparentScratch));
    return run.culledScratch;
  } catch (error) {
    resetHizCounts(run.cpuHizCounts);
    run.cpuHizCounted = false;
    diag.diagnosticFailure('hiz-frame-fallback', error); /* Keep the selected cut. */
    return ready;
  }
}

/** One image driven by the CPU reference cut, drawn only once the cut is entirely resident. */
export function renderCpuCut(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  pixelError: number,
  cpuStart: number,
  lightsEnd: number,
) {
  const { run, gpu, timing, services } = rt,
    { bootstrapUrls, slots, viewport } = rt.setup,
    gpuDevice = gpu.device!;
  // The CPU cut rewrites the lists itself: no held image leans on its own.
  run.gate.resourcesChanged();
  // The GPU sample no longer describes the image's arrays: this cut will write them.
  services.forgetReadback();
  // This image writes `shown` and `drawn` itself, and may exit by an error between the two: the
  // flag falls before the first write, never after.
  markDrawnDiverged(run);
  run.pagesEntered = null;
  run.pagesExited = null;
  const cpuSelectionStarted = performance.now();
  const selected = selectCpuCut(rt, cam, pixelError, false);
  run.cpuSelectMs = performance.now() - cpuSelectionStarted;
  traceCpuSelection(rt, selected, run.cpuSelectMs);
  // The chosen cut, not yet published. Admission weighs it here, but the residency sets receive it
  // only once the image's three guards have passed, below: publishing earlier would make the cache
  // hold — and forbid it from reclaiming — a cut the image may never have drawn, while the pinned
  // coverage it needs first is still in flight.
  const wanted = selected.wanted;
  run.overBudget = false;
  run.visible = selected.visible;
  run.selectedTriangles = selected.selectedTriangles;
  run.frustumRejected = selected.frustumRejected;
  run.lodLevel = selected.lodLevel;
  const admissionStarted = performance.now(),
    requested = run.requestedScratch;
  requested.clear();
  for (const url of bootstrapUrls) requested.add(url);
  for (let i = 0; i < wanted.length; i++) requested.add(pageAddress(wanted[i]));
  const wasLimited = run.coverageBudgetLimited;
  run.coverageBudgetLimited = requested.size > slots;
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = {
      version: 1,
      limited: run.coverageBudgetLimited,
      requiredSlots: requested.size,
      slots,
      fallbackRetained: services.bootstrapState.ready,
    };
  traceAdmission(rt, requested, wanted, admissionStarted);
  if (!services.bootstrapState.ready) {
    run.drawn.length = 0;
    run.submittedTriangles = 0;
    run.gpuDrawCalls = 0;
    const loadingEnd = performance.now();
    timing.cpuSample = cpuSampleOf(
      rt,
      { cpuStart, lightsEnd, selectionEnd: loadingEnd },
      loadingEnd,
    );
    traceCpuFrameWaiting(rt, cam, requested);
    return;
  }
  if (selected.complete === false) throw new Error('GPU_COVERAGE_INCOMPLETE');
  // A complete root cover is always pinned. Coarsen atomically before reclaiming
  // old detail slots if old and new refinements cannot coexist in the budget.
  const transitionStarted = performance.now(),
    transition = run.transitionScratch;
  transition.clear();
  for (const url of requested) transition.add(url);
  for (let i = 0; i < run.shown.length; i++) transition.add(pageAddress(run.shown[i]));
  if (!run.coverageBudgetLimited && transition.size > slots) {
    const fallback = selectCpuCut(rt, cam, pixelError, true);
    if (!fallback.complete) throw new Error('GPU_COVERAGE_INCOMPLETE');
    run.shown.length = 0;
    appendAll(run.shown, fallback.shown);
    run.lodLevel = fallback.lodLevel;
  }
  traceTransition(rt, requested, transition, transitionStarted);
  if (run.shown.some((page) => !services.hasBytes(page)))
    throw new Error('GPU_COVERAGE_BYTES_MISSING');
  const culled = cullWithTemporalHiz(rt, cam);
  const selectionEnd = performance.now();
  const queueStarted = performance.now();
  // Here, and no earlier: the image has passed its guards and `shown` is final, pinned fallback
  // included. The CPU cut then publishes its own by the same delta as the GPU sample — once, and
  // only once, for an image that draws.
  services.adoptCpuCut(wanted, run.shown);
  services.queueCutResidency(run.coverageBudgetLimited);
  const queueEnd = performance.now();
  traceQueueReconstruct(rt, queueEnd - queueStarted);
  const drawnVerifyStarted = performance.now();
  if (culled.some((page) => !services.poolHolds(page))) throw new Error('GPU_COVERAGE_INCOMPLETE');
  run.drawn.length = 0;
  appendAll(run.drawn, culled);
  run.blendPagedTriangles = triangleSum(run.drawn, true);
  // The CPU cut draws what it selected; what the Hi-Z pass drops is occluded, not missing.
  run.uncoveredTriangles = 0;
  // No cluster without residency has survived the checks above: the whole cut goes to draw, and
  // occlusion reject does not drop out here — `hizRejectedTriangles` counts it.
  run.drawnTriangles = run.selectedTriangles;
  traceDrawnVerify(rt, performance.now() - drawnVerifyStarted);
  const [width, height] = viewport ?? gpu.targetSize,
    targetStarted = performance.now();
  ensureTargets(rt, gpuDevice, Math.max(1, width), Math.max(1, height));
  traceTargetsEnsured(rt, width, height, targetStarted);
  logFirstCpuRenderPath(rt);
  const encodeStart = performance.now();
  run.submittedTriangles = encodeDraws(rt, gpuDevice, cam);
  const cpuEnd = performance.now();
  timing.lastSubmitMs = cpuEnd - encodeStart;
  timing.cpuSample = cpuSampleOf(rt, { cpuStart, lightsEnd, selectionEnd, encodeStart }, cpuEnd);
  publishCpuProfile(rt);
  traceCpuFrame(rt, cam);
}
