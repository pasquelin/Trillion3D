import type * as THREE from 'three';
import { selectVisiblePages, type PageRec } from './pageSelection.ts';
import { MAX_BUDGET_PIXEL_ERROR, appendAll, triangleSum } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export type TransparentCut = ReturnType<typeof selectVisiblePages<PageRec>> | undefined;

/** The forward transparents have their own CPU cut; they are absent from the GPU cluster set. */
export function selectTransparentCut(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  budgeted: number,
  pinnedOnly: boolean,
) {
  const { transparentRoots } = rt.layout,
    { viewport, slots, bootstrapUrls } = rt.setup,
    cache = rt.gpu.cache!;
  return selectVisiblePages(transparentRoots, camera, {
    pixelError: budgeted,
    viewport,
    frame: rt.run.frame,
    holdResident: true,
    rootFallback: true,
    pageBudget: Math.max(1, slots - bootstrapUrls.size),
    isResident: pinnedOnly
      ? (rec) => bootstrapUrls.has(rec.url) && !!cache.get(rec.url)
      : (rec) => !!cache.get(rec.url),
  });
}

/**
 * Counts what the frame asks the cache for, and moves the page budget's error floor. A cut wider than
 * the GPU page budget is coarsened, never truncated: truncating a DAG cut punches holes, while a
 * coarser threshold is still an exact partition of the surface.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime, pixelError: number, budgeted: number) {
  const { run } = rt,
    { tracking, bootstrapKeys, slots } = rt.setup;
  tracking.requestedEpoch++;
  tracking.requestedCount = 0;
  const request = (key: number) => {
    if (tracking.requestedStamp[key] !== tracking.requestedEpoch) {
      tracking.requestedStamp[key] = tracking.requestedEpoch;
      tracking.requestedList[tracking.requestedCount++] = key;
    }
  };
  for (let i = 0; i < bootstrapKeys.length; i++) request(bootstrapKeys[i]);
  for (let i = 0; i < run.desired.length; i++) request(tracking.keyOf(run.desired[i]));
  const wasLimited = run.coverageBudgetLimited;
  run.coverageBudgetLimited = tracking.requestedCount > slots;
  // Coarsen until the wanted cut fits, and relax again once it fits with room to spare. Doubling
  // and halving with a gap between the two thresholds keeps the loop from oscillating every frame.
  if (run.coverageBudgetLimited)
    run.budgetPixelError = Math.min(
      MAX_BUDGET_PIXEL_ERROR,
      run.budgetPixelError > 0 ? run.budgetPixelError * 2 : Math.max(1, pixelError * 2),
    );
  else if (run.budgetPixelError > 0 && tracking.requestedCount < slots * 0.7)
    run.budgetPixelError = run.budgetPixelError > pixelError * 2 ? run.budgetPixelError / 2 : 0;
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = {
      version: 1,
      limited: run.coverageBudgetLimited,
      requiredSlots: tracking.requestedCount,
      slots,
      fallbackRetained: rt.services.bootstrapState.ready,
      pixelError: budgeted,
    };
}

/**
 * Checks the transparent cut against the slot budget once the opaque cut is admitted. With the roots
 * pinned the transparent cut always falls back to them, so an incomplete cut here means a pinned root
 * is itself absent from the cache, which is a bug and not a streaming state.
 */
export function transitionGpuCut(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  budgeted: number,
  transparent: TransparentCut,
  oldOpaque: PageRec[],
) {
  const { run } = rt,
    { tracking, slots } = rt.setup;
  if (transparent?.complete === false)
    throw new Error('GPU_COVERAGE_INCOMPLETE: a pinned transparent root cluster is not resident');
  tracking.transitionEpoch++;
  tracking.transitionCount = 0;
  if (transparent && !run.coverageBudgetLimited) {
    const transition = (key: number) => {
      if (tracking.transitionStamp[key] !== tracking.transitionEpoch) {
        tracking.transitionStamp[key] = tracking.transitionEpoch;
        tracking.transitionCount++;
      }
    };
    for (let i = 0; i < tracking.requestedCount; i++) transition(tracking.requestedList[i]);
    for (let i = 0; i < transparent.shown.length; i++)
      transition(tracking.keyOf(transparent.shown[i]));
  }
  if (transparent && !run.coverageBudgetLimited && tracking.transitionCount > slots) {
    const fallback = selectTransparentCut(rt, camera, budgeted, true);
    if (!fallback.complete)
      throw new Error('GPU_COVERAGE_INCOMPLETE: the pinned transparent cover is not resident');
    run.shown.length = 0;
    appendAll(run.shown, oldOpaque, fallback.shown);
  }
  run.selectedTriangles = triangleSum(run.shown);
}
