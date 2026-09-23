/** Ceiling on the screen error the page budget may impose; past it the root cover is the cut. */
const MAX_BUDGET_PIXEL_ERROR = 4096;
/** Share of the slots under which a coarsened cut asks for the next finer threshold again. */
export const BUDGET_RELAX_RATIO = 0.7;
/** Finest rung of the budget ladder, in pixels: below it the cut is the one the host asked for. */
export const MIN_BUDGET_PIXEL_ERROR = 0.125;

/**
 * The page budget's ladder, carried from one image to the next: whether the requested cut fits
 * the pool, the coarser threshold it is drawn at when it does not, and what it remembers of this
 * view so as not to ask twice for a threshold that overflowed. Both engines climb it: the WebGPU
 * cut admission (`../pages/render/gpuCutAdmission.ts`) and the WebGL2 pool
 * (`../../backend/autonomous/pool.ts`).
 */
export interface PageBudgetLadder {
  coverageBudgetLimited: boolean;
  /** Screen-error floor the page budget imposes on the cut; 0 when the requested detail fits. */
  budgetPixelError: number;
  /** Finest threshold whose cut overflowed the pool for the current view, `-1` when none did, with
   *  the view revision and the slot count it was seen under: the ladder never asks for it again
   *  while both stay. */
  budgetOverflowError: number;
  budgetOverflowView: number;
  budgetOverflowSlots: number;
}

/** The WebGPU engine's ladder, and the verdict change its flush publishes. */
export interface WebgpuBudgetState extends PageBudgetLadder {
  /** The verdict just changed: published once by the flush, as `coverage-budget`. */
  coverageBudgetEvent: Record<string, unknown> | undefined;
}

export function createPageBudgetLadder(): PageBudgetLadder {
  return {
    coverageBudgetLimited: false,
    budgetPixelError: 0,
    budgetOverflowError: -1,
    budgetOverflowView: -1,
    budgetOverflowSlots: -1,
  };
}

export function createWebgpuBudgetState(): WebgpuBudgetState {
  return { ...createPageBudgetLadder(), coverageBudgetEvent: undefined };
}

/** A floor the host's own threshold has passed no longer decides anything: it is given up, so
 *  what is published is what the cut is drawn at. */
export function releasePassedFloor(ladder: PageBudgetLadder, pixelError: number) {
  if (ladder.budgetPixelError > 0 && ladder.budgetPixelError <= pixelError)
    ladder.budgetPixelError = 0;
}

/**
 * One step of the ladder, on a cut sampled at `sampled` that asked for `requested` pages and holds
 * `held` with what the image still draws, against `slots`. A cut wider than the pool is coarsened,
 * never truncated: truncating a DAG cut punches holes, while a coarser threshold is still an exact
 * partition of the surface.
 *
 * Two rules keep the floor from oscillating:
 * - while a floor rules, it moves only on a sample cut at that floor: a step is never taken on the
 *   count of another threshold;
 * - a threshold whose REQUESTED cut overflowed the pool for this view is not asked for again while
 *   the view and the pool stay: relaxing to it would only reproduce the overflow, then the
 *   coarsening. A view change or a pool resize forgets it, since either may fit it. What the image
 *   still holds from the previous cut can overflow the slots for a few images right after a
 *   coarsening: that transient coarsens once more but is not memorised, or a still camera would
 *   settle one rung too coarse.
 *
 * The ladder doubles what the image was drawn at — one pixel at least on a first overflow —, and
 * relaxing halves down to the finest rung, below which the floor is given up.
 */
export function stepPageBudgetLadder(
  ladder: PageBudgetLadder,
  pixelError: number,
  sampled: number,
  view: number,
  slots: number,
  requested: number,
  held: number,
) {
  if (ladder.budgetPixelError > 0 && sampled !== ladder.budgetPixelError) return;
  if (ladder.budgetOverflowView !== view || ladder.budgetOverflowSlots !== slots) {
    ladder.budgetOverflowView = view;
    ladder.budgetOverflowSlots = slots;
    ladder.budgetOverflowError = -1;
  }
  // What the image holds — root coverage, cut and drawn ancestors — must fit in the slots the same
  // way the cut does: without that, ancestors holding the slots would wait for children that cannot
  // enter.
  ladder.coverageBudgetLimited = requested > slots || held > slots;
  if (ladder.coverageBudgetLimited) {
    if (requested > slots) ladder.budgetOverflowError = sampled;
    ladder.budgetPixelError = Math.min(MAX_BUDGET_PIXEL_ERROR, Math.max(1, sampled * 2));
  } else if (ladder.budgetPixelError > 0 && requested < slots * BUDGET_RELAX_RATIO) {
    let next = ladder.budgetPixelError / 2;
    if (next <= pixelError || next < MIN_BUDGET_PIXEL_ERROR) next = 0;
    if (Math.max(pixelError, next) > ladder.budgetOverflowError) ladder.budgetPixelError = next;
  }
}
