import { frustumExcludesBox, maxStretch, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import { selectFlat } from './select.ts';
import { startBudgetPass } from './tally.ts';
import { budgetCeiling, searchBudget } from './search.ts';
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
    /** The largest error the DAG roots carry as parents, in object units: the search's ceiling,
     *  seen at the near plane (`budgetCeiling`). Without it, the search has none. */
    pageBudgetRootError?: number;
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
  const ceiling = budgetCeiling(
    floor,
    budget ? options.pageBudgetRootError : 0,
    state.cameraStretch,
    cam,
  );
  state.budgetStrict = from !== undefined;
  // Whether the cut at the host's threshold fits, once a pass has tried it; without a budget, it
  // does.
  let hostCutFits: boolean | null = budget ? null : true;
  const pass = (threshold: number) => {
    state.pixelError = threshold;
    sweep();
    if (threshold === floor) hostCutFits = !state.over;
  };
  const settled = searchBudget(state, pass, floor, from, ceiling);
  // When even the coarsest threshold overflows, the whole cut is redone: the overflow flag rises
  // on a complete cover, never on a truncated cut.
  const exceeded = state.over;
  if (exceeded) {
    state.budget = 0;
    sweep();
  }
  // What the cut at the host's threshold charges is known only when that pass ran to the end.
  const requiredSlots =
    budget && state.budget !== 0 && state.pixelError === floor ? state.budgetUsed : null;
  state.budget = 0;
  state.budgetStrict = false;
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
  result.hostCutFits = hostCutFits;
  result.budgetExceeded = exceeded;
  // The reused state keeps no hold on this image's scene.
  state.isResident = undefined;
  state.flatStructure = undefined;
  state.flatForced = undefined;
  state.flatForcedList = undefined;
  return result;
}
