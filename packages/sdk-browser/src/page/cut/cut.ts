import { frustumExcludesBox, maxStretch, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import { selectFlat } from './select.ts';
import { MIN_BUDGET_PIXEL_ERROR, startBudgetPass } from './tally.ts';
import {
  IDENTITY_WORLD,
  createSelectionResult,
  residentModeOf,
  selectionScratch,
  selectionState,
  type PageRecord,
  type SelectionResult,
} from './state.ts';
import { copyElements } from '../../math/matrixElements.ts';
import type { ClusterRoot } from '../selection/types.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';
import type { EngineCamera } from '../../camera/world.ts';

/**
 * World pose of a root copied into an owned buffer, once per root and per pass: the base product
 * only reads and writes `Float64Array`s (`packages/sdk-core/src/math/matrix/matrix4.ts`), and host-library matrices are ordinary
 * arrays.
 */
const rootWorld = new Float64Array(16);

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

/** Select the requested LOD cut and the resident cut that can be displayed this frame. */
export function selectVisiblePages<T extends PageRecord>(
  roots: ReadonlyArray<ClusterRoot<T>>,
  cam: EngineCamera,
  options: {
    pixelError?: number;
    viewport?: [number, number];
    holdResident?: boolean;
    isResident?: (page: T) => boolean;
    rootFallback?: boolean;
    pageBudget?: number;
    /** Slots of `pageBudget` held before the cut charges any page: what stays resident whatever
     *  it draws. */
    pageBudgetHeld?: number;
    /** The threshold the previous image kept under `pageBudget`: the search starts there, tries
     *  one √2 step finer, and climbs by √2 in this image only when it no longer fits. Without it,
     *  the search starts at `pixelError` and doubles. */
    pageBudgetFrom?: number;
    wanted?: T[];
    result?: SelectionResult<T>;
  },
  into?: T[],
): SelectionResult<T> {
  const viewport = options.viewport,
    hold = !!options.holdResident;
  const budget = options.pageBudget && options.pageBudget > 0 ? options.pageBudget : 0;
  const { viewMatrix } = selectionScratch;
  // World frustum planes are those image entry set, in the host's depth convention: an image
  // computes them once, for all of its consumers, and nothing is copied here.
  const worldPlanes = cam.planes;
  pixelScaleOf(cam.projection, viewport, selectionScratch.pixelScale);
  const shown = into ?? ([] as T[]);
  const wanted = options.wanted ?? ([] as T[]);
  // Cut state is set on the reused object: a render image allocates nothing here.
  const state = selectionState<T>();
  state.cam = cam;
  state.hold = hold;
  state.rootFallback = hold && !!options.rootFallback;
  state.wanted = wanted;
  state.shown = shown;
  state.isResident = options.isResident;
  // The residency rule depends only on the request: stating it here takes two re-reads of the
  // state and one indirect call out of the per-cluster loop, without touching the answer.
  state.residentMode = residentModeOf(hold, options.isResident);
  state.pixelError = options.pixelError ?? 0;
  state.cameraStretch = maxStretch(cam.view);
  state.flatWorld = roots[0]?.world ?? IDENTITY_WORLD;
  state.flatElements = (roots[0]?.world ?? IDENTITY_WORLD).elements;
  state.flatStretch = 1;
  state.flatFocal = 1;
  state.flatStructure = undefined;
  state.flatForced = undefined;
  state.flatForcedList = undefined;
  state.flatExact = false;
  state.flatUseForcing = false;
  state.flatMissing = false;
  state.flatShort = false;
  state.budget = budget;
  state.budgetHeld = options.pageBudgetHeld ?? 0;
  const sweep = () => {
    state.over = false;
    startBudgetPass(state);
    state.shownCount = 0;
    state.wantedCount = 0;
    state.wantedTriangles = 0;
    state.shownTriangles = 0;
    state.frustumRejected = 0;
    state.nodesTested = 0;
    state.lodLevel = 0;
    state.complete = true;
    for (const root of roots) {
      if (state.over) return;
      // A parked instance-buffer row places nothing: its root waits in the tables, untested.
      if (root.parked) continue;
      const box = root.worldBox;
      if (box && frustumExcludesBox(worldPlanes, box[0], box[1], box[2], box[3], box[4], box[5])) {
        state.frustumRejected++;
        continue;
      }
      copyElements(rootWorld, root.world.elements);
      multiplyMatrix4(viewMatrix, cam.view, rootWorld);
      selectFlat(state, root);
    }
  };
  const floor = state.pixelError,
    from = budget ? options.pageBudgetFrom : undefined;
  // Nothing finer is left to try: the threshold is the host's, or its finer step overflowed.
  let settled = true;
  if (from === undefined) {
    sweep();
    // A pass above the budget brings only one thing: the next threshold. The abandoned cut
    // therefore stops at the overflowing page, and only the pass that holds the budget is taken
    // to the end.
    for (let attempt = 0; budget && state.over && attempt < 16; attempt++) {
      state.pixelError = state.pixelError > 0 ? state.pixelError * 2 : 1;
      sweep();
    }
  } else {
    // The search goes on from the previous image: one step finer, else the threshold it kept,
    // else coarser by √2 until the cut fits. An image mostly costs one pass, and the detail
    // converges on the finest step that fits.
    let current = Math.max(floor, from);
    // At the floor, the finer step is the floor itself.
    state.pixelError = finerStep(current, floor);
    sweep();
    if (state.pixelError < current) {
      if (!state.over) settled = state.pixelError === floor;
      else {
        state.pixelError = current;
        sweep();
      }
    }
    for (let attempt = 0; state.over && attempt < BUDGET_CLIMBS; attempt++) {
      current = current > 0 ? current * BUDGET_STEP : 1;
      state.pixelError = current;
      sweep();
    }
  }
  // When even the coarsest threshold overflows, the whole cut is redone: the overflow flag rises
  // on a complete cover, never on a truncated cut.
  if (state.over) {
    state.budget = 0;
    sweep();
  }
  // What the cut at the host's threshold charges is known only when that pass ran to the end.
  const requiredSlots =
    budget && state.budget !== 0 && state.pixelError === floor ? state.budgetUsed : null;
  state.budget = 0;
  // The cut is finished: both lists take their length here, and only once. They thus keep their
  // capacity from one image to the next, instead of losing it again at every pass.
  shown.length = state.shownCount;
  wanted.length = state.wantedCount;
  // Both sums are held as a running total: no more sweep of the records after the cut.
  const displayedTriangles = state.shownTriangles;
  let selectedTriangles = state.wantedTriangles;
  if (!wanted.length) selectedTriangles = displayedTriangles;
  // The result is written into the caller's object when it supplies one: nothing is allocated.
  const result = options.result ?? createSelectionResult<T>();
  result.shown = shown;
  result.wanted = wanted;
  result.visible = wanted.length || shown.length;
  result.selectedTriangles = selectedTriangles;
  result.displayedTriangles = displayedTriangles;
  result.frustumRejected = state.frustumRejected;
  result.nodesTested = state.nodesTested;
  result.lodLevel = state.lodLevel;
  result.complete = state.complete;
  result.pixelError = state.pixelError;
  result.requiredSlots = requiredSlots;
  result.budgetSettled = settled;
  // The reused state keeps no hold on this image's scene.
  state.isResident = undefined;
  state.flatStructure = undefined;
  state.flatForced = undefined;
  state.flatForcedList = undefined;
  return result;
}
