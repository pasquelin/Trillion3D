import { clipWeight } from '../../../../sdk-core/src/math/primitives/camera.ts';
import type { EngineCamera } from '../../camera/world.ts';
import { MIN_BUDGET_PIXEL_ERROR } from './tally.ts';
import { selectionScratch, type PageRecord, type SelectionState } from './state.ts';

/** One step of the budget search: a threshold √2 apart from the last one tried. */
const BUDGET_STEP = Math.SQRT2;
/** Coarser steps a search may climb before the whole cut is redone without a budget: the range the
 *  sixteen doublings of the one-shot search cover. */
const BUDGET_CLIMBS = 32;

/** One step finer than `threshold`, never under the host's `floor`: at the finest step, the floor. */
function finerStep(threshold: number, floor: number) {
  const next = threshold / BUDGET_STEP;
  return next <= floor || next < MIN_BUDGET_PIXEL_ERROR ? floor : next;
}

/**
 * The coarsest threshold the budget search climbs to: the DAG roots' error (`rootError`, object
 * units) seen at the near plane, on the view axis, never under the host's `floor`. Past it, the
 * pages the cut still refines on that axis are those whose parent reaches the near plane — an
 * infinite screen error, which no threshold coarsens. Without a root error, nothing bounds the
 * search.
 */
export function budgetCeiling(floor: number, rootError = 0, stretch: number, cam: EngineCamera) {
  if (!rootError) return Infinity;
  const { pixelScale } = selectionScratch;
  const focal = Math.max(pixelScale[0], pixelScale[1]);
  return Math.max(floor, (rootError * stretch * focal) / clipWeight(cam.perspective, cam.near));
}

/**
 * The thresholds a cut under a page budget passes at (`pass`), from the host's `floor`. Without
 * `from` (the one-shot cut), the threshold doubles until the cut fits. With it, the search goes on
 * from the previous image: one step finer, else the threshold it kept, else coarser by √2 until the
 * cut fits. An image mostly costs one pass, and the detail converges on the finest step that fits.
 * A pass whose overflow no coarser threshold can cut down (`budgetFiner`) stops the climb; and no
 * threshold ever goes past the `ceiling`, whatever the last image kept. Returns whether nothing
 * finer is left to try: the threshold is the host's, or its finer step overflowed.
 */
export function searchBudget<T extends PageRecord>(
  state: SelectionState<T>,
  pass: (threshold: number) => void,
  floor: number,
  from: number | undefined,
  ceiling: number,
) {
  if (from === undefined) {
    pass(floor);
    // A pass above the budget brings only one thing: the next threshold. The abandoned cut
    // therefore stops at the overflowing page, and only the pass that holds the budget is taken
    // to the end.
    for (
      let attempt = 0;
      state.budget && state.over && state.pixelError < ceiling && attempt < 16;
      attempt++
    )
      pass(Math.min(ceiling, state.pixelError > 0 ? state.pixelError * 2 : 1));
    return true;
  }
  let current = Math.min(ceiling, Math.max(floor, from)),
    settled = true;
  const finer = finerStep(current, floor);
  pass(finer);
  if (finer < current) {
    if (!state.over) settled = finer === floor;
    else if (state.budgetFiner) pass(current);
  }
  for (
    let attempt = 0;
    state.over && state.budgetFiner && current < ceiling && attempt < BUDGET_CLIMBS;
    attempt++
  ) {
    current = Math.min(ceiling, current > 0 ? current * BUDGET_STEP : 1);
    pass(current);
  }
  return settled;
}
