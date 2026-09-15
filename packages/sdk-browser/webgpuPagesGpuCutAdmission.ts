import type * as THREE from 'three';
import { selectVisiblePages, type PageRec } from './pageSelection.ts';
import { MAX_BUDGET_PIXEL_ERROR, appendAll, triangleSum } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { WebgpuRunState } from './webgpuPagesStateRun.ts';

export type TransparentCut = ReturnType<typeof selectVisiblePages<PageRec>> | undefined;

/** Triangles of the opaque cut, counted when the readback was adopted and not counted again. */
export const opaqueTriangles = (run: WebgpuRunState) =>
  run.shownOpaqueTriangles >= 0 ? run.shownOpaqueTriangles : triangleSum(run.shown, false);

/** The forward transparents have their own CPU cut; they are absent from the GPU cluster set. */
function selectTransparentCut(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  budgeted: number,
  pinnedOnly: boolean,
) {
  const { transparentRoots } = rt.layout,
    { viewport, slots, bootstrapUrls } = rt.setup,
    hold = rt.run.transparentHold,
    cache = rt.gpu.cache!;
  // The image's cut writes into the arrays the hold publishes; the rare pinned fallback keeps its own.
  return selectVisiblePages(
    transparentRoots,
    camera,
    {
      pixelError: budgeted,
      viewport,
      holdResident: true,
      rootFallback: true,
      pageBudget: Math.max(1, slots - bootstrapUrls.size),
      isResident: pinnedOnly
        ? (rec) => bootstrapUrls.has(rec.url) && !!cache.get(rec.url)
        : (rec) => !!cache.get(rec.url),
      wanted: pinnedOnly ? undefined : hold.wanted,
      result: pinnedOnly ? undefined : hold.result,
    },
    pinnedOnly ? undefined : hold.shown,
  );
}

/**
 * The transparent cut of this image. The DAG is swept only when one of the six inputs the cut is a
 * function of has moved since the held cut was swept; otherwise the held cut is the answer, and it is
 * the very arrays a sweep would have rewritten, so nothing downstream can tell the two apart.
 */
export function transparentCutOf(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  budgeted: number,
) {
  const { viewport } = rt.setup,
    hold = rt.run.transparentHold,
    epoch = rt.layout.rows.tableEpoch,
    cache = rt.gpu.cache!;
  camera.updateMatrixWorld();
  const revision = cache.residencyRevision;
  if (hold.holds(camera, budgeted, viewport, epoch, cache, revision)) return hold.result;
  const cut = selectTransparentCut(rt, camera, budgeted, false);
  hold.keep(camera, budgeted, viewport, epoch, cache, revision);
  return cut;
}

/**
 * Counts what the frame asks the cache for, and moves the page budget's error floor. A cut wider than
 * the GPU page budget is coarsened, never truncated: truncating a DAG cut punches holes, while a
 * coarser threshold is still an exact partition of the surface.
 *
 * The count comes from the set the previous image left, moved by the pages that entered and left it:
 * no image rebuilds the requested set, whatever the cut is worth.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime, pixelError: number, budgeted: number) {
  const { run, services } = rt,
    { slots } = rt.setup;
  const requested = services.admitCut();
  const wasLimited = run.coverageBudgetLimited;
  run.coverageBudgetLimited = requested > slots;
  // Coarsen until the wanted cut fits, and relax again once it fits with room to spare. Doubling
  // and halving with a gap between the two thresholds keeps the loop from oscillating every frame.
  if (run.coverageBudgetLimited)
    run.budgetPixelError = Math.min(
      MAX_BUDGET_PIXEL_ERROR,
      run.budgetPixelError > 0 ? run.budgetPixelError * 2 : Math.max(1, pixelError * 2),
    );
  else if (run.budgetPixelError > 0 && requested < slots * 0.7)
    run.budgetPixelError = run.budgetPixelError > pixelError * 2 ? run.budgetPixelError / 2 : 0;
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = {
      version: 1,
      limited: run.coverageBudgetLimited,
      requiredSlots: requested,
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
) {
  const { run, services } = rt,
    { slots } = rt.setup,
    sets = services.residencySets;
  if (transparent?.complete === false)
    throw new Error('GPU_COVERAGE_INCOMPLETE: a pinned transparent root cluster is not resident');
  sets.refreshTransparentShown(run.transparentShown);
  // What the image asks for plus what it draws: the kept set already is that union, held across
  // images, so the transition costs the transparent cut and nothing else.
  const transition = transparent && !run.coverageBudgetLimited ? sets.keepCount : 0;
  if (transition > slots) {
    const fallback = selectTransparentCut(rt, camera, budgeted, true);
    if (!fallback.complete)
      throw new Error('GPU_COVERAGE_INCOMPLETE: the pinned transparent cover is not resident');
    run.transparentShown.length = 0;
    appendAll(run.transparentShown, fallback.shown);
    run.shown.length = run.shownOpaque;
    appendAll(run.shown, run.transparentShown);
    sets.refreshTransparentShown(run.transparentShown);
  }
  run.selectedTriangles = opaqueTriangles(run) + triangleSum(run.transparentShown);
}
