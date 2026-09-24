import { maxStretch } from '../../../../sdk-core/src/index.ts';
import { clipWeight } from '../../../../sdk-core/src/math/primitives/camera.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { BudgetSearch, CutPass } from '../../page/cut/cut.ts';
import { selectionScratch } from '../../page/cut/state.ts';
import { MIN_BUDGET_PIXEL_ERROR } from '../../residency/pools.ts';

/** One step of the search: a threshold √2 apart from the last one tried. */
const STEP = Math.SQRT2;
/** Coarser steps one image may climb, and images `flush` may take to fix the search: the range
 *  the sixteen doublings of the one-shot search cover. */
export const MAX_SEARCH_STEPS = 32;

/** The cut at the host's threshold, as of this image: it fits, it overflowed, or no pass tried it. */
type BudgetVerdict = 'fits' | 'over' | 'untried';

/** The places a page takes in a pass, shared by every record of the page: charged once a pass. */
export type PageShare = { pass: number; slots: number };

/**
 * The WebGL2 pool's threshold search, from one image to the next. An image mostly costs one pass:
 * one step finer than the threshold the last image kept, unless that step overflowed since and the
 * kept cut charges no less than it did then (`refused`); the kept threshold again when the finer
 * step overflows (the only image that costs two passes); coarser by √2 in the same image when
 * the cut no longer fits, while a coarser step may still cut it down (`finer`), never past the
 * ceiling the DAG roots' error sets at the near plane. When even that cut overflows, the pool is
 * limited by the root cover: the cut is drawn there without its budget, and probed again only once
 * the budget, the copies, the view or the host's threshold change.
 */
export function createPoolSearch(env: {
  /** Places the cut must fit (0: none), and those the root cover holds beforehand. */
  budget: () => number;
  held: () => number;
  shares: ReadonlyMap<string, PageShare>;
  /** The largest error the DAG roots carry as parents, in object units. */
  rootError: number;
  coverRevision: () => number;
  viewRevision: () => number;
}) {
  const { budget: budgetOf, held, shares, rootError, coverRevision, viewRevision } = env;
  let passes = 0,
    // The threshold the budget held the last cut at (0: it did not limit it), what that pass
    // charged, and what it charged when its finer step overflowed.
    kept = 0,
    keptUsed = Infinity,
    refused = Infinity,
    hostError = 0,
    rootCover = false,
    settling = false,
    verdict: BudgetVerdict = 'untried',
    requiredSlots: number | null = null,
    seenBudget = -1,
    seenCover = -1,
    seenView = -1;
  // This image's pass, set once an image: the passes below allocate nothing.
  let passOf: Parameters<BudgetSearch>[0] | undefined;
  const run = (at: number) => {
    passes++;
    const cut = passOf!(at, seenBudget, held());
    if (at === hostError) {
      verdict = cut.over ? 'over' : 'fits';
      requiredSlots = cut.over ? null : cut.used;
    }
    return cut;
  };
  /** The roots' error seen at the near plane, on the view axis: past it, what the cut still
   *  refines has a parent reaching the near plane, which no threshold coarsens. */
  const ceilingOf = (floor: number, cam: EngineCamera) => {
    if (!rootError) return Infinity;
    const { pixelScale } = selectionScratch;
    const focal = Math.max(pixelScale[0], pixelScale[1]);
    return Math.max(
      floor,
      (rootError * maxStretch(cam.view) * focal) / clipWeight(cam.perspective, cam.near),
    );
  };
  const search: BudgetSearch = (pass, floor, cam) => {
    const budget = budgetOf(),
      cover = coverRevision(),
      view = viewRevision();
    const changed =
      budget !== seenBudget || cover !== seenCover || view !== seenView || floor !== hostError;
    // A finer host threshold starts the search over from it.
    if (floor < hostError) kept = 0;
    hostError = floor;
    seenBudget = budget;
    seenCover = cover;
    seenView = view;
    verdict = 'untried';
    if (!budget) {
      pass(floor, 0, 0);
      kept = 0;
      rootCover = settling = false;
      verdict = 'fits';
      requiredSlots = null;
      return;
    }
    const ceiling = ceilingOf(floor, cam);
    let threshold = Math.min(ceiling, Math.max(floor, kept));
    if (rootCover && !changed) {
      pass(threshold, 0, 0);
      return;
    }
    if (changed) refused = Infinity;
    passOf = pass;
    const from = threshold;
    let cut: CutPass;
    if (threshold > floor && keptUsed < refused) {
      const next = threshold / STEP;
      const finer = next <= floor || next < MIN_BUDGET_PIXEL_ERROR ? floor : next;
      cut = run(finer);
      if (!cut.over) threshold = finer;
      else {
        refused = keptUsed;
        cut = run(threshold);
      }
    } else cut = run(threshold);
    for (
      let step = 0;
      cut.over && cut.finer && threshold < ceiling && step < MAX_SEARCH_STEPS;
      step++
    )
      cut = run((threshold = Math.min(ceiling, threshold > 0 ? threshold * STEP : 1)));
    // Overflowed at the coarsest step: the cut redoes it without the budget.
    rootCover = cut.over;
    keptUsed = rootCover ? Infinity : cut.used;
    if (threshold !== from) refused = Infinity;
    kept = threshold > floor ? threshold : 0;
    settling = !rootCover && kept > 0 && keptUsed < refused;
  };
  return {
    search,
    /** What a page asked for costs in the pass under way: its share, once a pass. */
    slotsOf(rec: { url: string }) {
      const share = shares.get(rec.url);
      if (!share || share.pass === passes) return 0;
      share.pass = passes;
      return share.slots;
    },
    /** The threshold the budget holds the cut at, 0 when the requested detail fits. */
    get pixelError() {
      return kept;
    },
    get rootCover() {
      return rootCover;
    },
    /** A finer step is left to try, or the budget changed since the last image. */
    get settling() {
      return settling || budgetOf() !== seenBudget;
    },
    get verdict() {
      return verdict;
    },
    /** Places the cut at the host's threshold charged, when it fit this image. */
    get requiredSlots() {
      return requiredSlots;
    },
  };
}
