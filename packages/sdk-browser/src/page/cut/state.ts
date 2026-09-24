import { FRUSTUM_PLANE_VALUES } from '../../../../sdk-core/src/index.ts';
import { createConeContext, type ConeContext, type NormalCone } from '../cone/cone.ts';
import type { EngineCamera } from '../../camera/world.ts';
import { IDENTITY_ELEMENTS, type MatrixElements } from '../../math/matrixElements.ts';
import type { ClusterCut } from '../selection/math.ts';
import type { ClusterStructureIndex } from '../selection/types.ts';
import type { PageSurface } from '../surface.ts';
import { budgetTally, type BudgetShare, type BudgetTally } from './tally.ts';

export interface PageRecord extends ClusterCut {
  triangles: number;
  level?: number;
  min?: number[];
  max?: number[];
  cone?: NormalCone;
  material?: PageSurface;
  array?: Uint32Array;
  budgetShare?: BudgetShare;
}

export interface SelectionState<T extends PageRecord> extends BudgetTally {
  cam: EngineCamera;
  hold: boolean;
  rootFallback: boolean;
  wanted: T[];
  shown: T[];
  isResident?: (page: T) => boolean;
  pixelError: number;
  frustumRejected: number;
  /** Hierarchy nodes popped by this image's cut. */
  nodesTested: number;
  lodLevel: number;
  complete: boolean;
  cameraStretch: number;
  flatWorld: MatrixElements;
  flatElements: ArrayLike<number>;
  flatStretch: number;
  flatFocal: number;
  flatStructure?: ClusterStructureIndex;
  flatForced?: Uint8Array;
  flatForcedList?: number[];
  /** What cone rejection reads of the root and the camera, set at the root's first cone. */
  flatCone: ConeContext;
  /** This root declares it carries cones: the per-cluster path reads `cone`. A root that
   *  declares it carries none takes the cone out of the loop, without changing a single decision. */
  flatCones: boolean;
  /** This root declares that each of its pages carries its box: under a node entirely inside
   *  the frustum, the per-cluster path then reads neither `min` nor `max`. */
  flatBoxes: boolean;
  /** Residency rule of this cut, resolved once: `RESIDENT_ALL` when nothing is held
   *  (everything is deemed resident), `RESIDENT_ASK` when the host supplies its answer,
   *  `RESIDENT_ARRAY` when residency is the page's index array. The per-cluster path reads this
   *  mode instead of re-reading `hold` and `isResident` on the state at each kept cluster; fallbacks
   *  apply it through `residentUnder`. */
  residentMode: number;
  /** This image's threshold is zero and stretch, focal length and near plane are sound: the
   *  cut then decides without projecting, identically. */
  flatExact: boolean;
  flatUseForcing: boolean;
  flatMissing: boolean;
  flatShort: boolean;
  /** What the two lists actually hold. The arrays are no longer cleared with `length = 0` each
   *  image — they would lose their capacity and grow it back from zero to eighty thousand — but
   *  rewritten by index, and their length is set only once the cut is finished. During the cut,
   *  these two counts are the only truth: `length` is behind. */
  shownCount: number;
  wantedCount: number;
  /** Triangles of both cuts, summed with a running total in array order: the sum is that of a
   *  sweep of `wanted` and `shown`, in the same order and at the same bits. */
  wantedTriangles: number;
  shownTriangles: number;
}

/** Cut result, filled in place: the caller supplies the object, the image allocates none. */
export interface SelectionResult<T> {
  shown: T[];
  wanted: T[];
  visible: number;
  selectedTriangles: number;
  displayedTriangles: number;
  frustumRejected: number;
  /** Hierarchy nodes popped by the cut, what selection actually tested. */
  nodesTested: number;
  lodLevel: number;
  complete: boolean;
  pixelError: number;
  /** Slots the cut at the host's threshold charges, held ones included; `null` if it overflowed. */
  requiredSlots: number | null;
  /** Nothing finer is left for the budget search to try (`pageBudgetFrom`). */
  budgetSettled: boolean;
  /** The cut at the host's threshold fits the budget; `null` when this image did not try it. */
  hostCutFits: boolean | null;
}

/** An empty cut result, set once per hot caller: `selectVisiblePages` rewrites every field. */
export function createSelectionResult<T>(): SelectionResult<T> {
  return {
    shown: [],
    wanted: [],
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    nodesTested: 0,
    lodLevel: 0,
    complete: true,
    pixelError: 0,
    requiredSlots: null,
    budgetSettled: true,
    hostCutFits: null,
  };
}

/** Nothing is held: the cut has no residency to test. */
export const RESIDENT_ALL = 0;
/** The host itself answers for a page's residency. */
export const RESIDENT_ASK = 1;
/** A page's residency is its index array. */
export const RESIDENT_ARRAY = 2;

/** Residency rule of a cut, stated once per call: `keep` receives it as a parameter and no longer
 *  re-reads the state per cluster. A single write of the rule, for the hot path as for the
 *  fallbacks. */
export function residentModeOf(hold: boolean, isResident: unknown) {
  return !hold ? RESIDENT_ALL : isResident ? RESIDENT_ASK : RESIDENT_ARRAY;
}

/** Residency of a page under an already-resolved mode. */
export function residentUnder<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  mode: number,
): boolean {
  if (mode === RESIDENT_ALL) return true;
  if (mode === RESIDENT_ARRAY) return !!rec.array;
  return (s.isResident as (page: T) => boolean)(rec);
}

export const IDENTITY_WORLD: MatrixElements = { elements: IDENTITY_ELEMENTS };
/** Synchronous selection reuses these buffers between frames without allocating a new cut. */
export const selectionScratch = {
  viewMatrix: new Float64Array(16),
  viewMin: [Infinity, Infinity, Infinity] as [number, number, number],
  viewMax: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  pixelScale: [1, 1] as [number, number],
  clip: new Float64Array(16),
  /** Frustum planes in the current root's space, raw: those of the exact descent. */
  planes: new Float64Array(FRUSTUM_PLANE_VALUES),
  stack: new Int32Array(4096),
};
export const fallbackScratch: unknown[] = [];
export const forceScratch: number[] = [];

/** State of a cut, set only once. Selection is synchronous and non-reentrant, like
 *  `selectionScratch`: reusing this state removes the last per-image allocation. */
const reusedState: SelectionState<PageRecord> = {
  cam: undefined as unknown as EngineCamera,
  hold: false,
  rootFallback: false,
  wanted: [],
  shown: [],
  isResident: undefined,
  pixelError: 0,
  frustumRejected: 0,
  nodesTested: 0,
  lodLevel: 0,
  complete: true,
  cameraStretch: 1,
  flatWorld: IDENTITY_WORLD,
  flatElements: IDENTITY_ELEMENTS,
  flatStretch: 1,
  flatFocal: 1,
  flatCone: createConeContext(),
  flatCones: true,
  flatBoxes: false,
  residentMode: RESIDENT_ALL,
  flatExact: false,
  flatUseForcing: false,
  flatMissing: false,
  flatShort: false,
  shownCount: 0,
  wantedCount: 0,
  wantedTriangles: 0,
  shownTriangles: 0,
  ...budgetTally(),
};

/** The reused state, viewed at the requested page type. */
export function selectionState<T extends PageRecord>(): SelectionState<T> {
  return reusedState as unknown as SelectionState<T>;
}
