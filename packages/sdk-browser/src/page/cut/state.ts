import type { LightPages } from '../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';
import { FRUSTUM_PLANE_VALUES } from '../../../../sdk-core/src/index.ts';
import { createConeContext, type ConeContext, type NormalCone } from '../cone/cone.ts';
import type { EngineCamera } from '../../camera/world.ts';
import { IDENTITY_ELEMENTS, type MatrixElements } from '../../math/matrixElements.ts';
import type { ClusterCut } from '../selection/math.ts';
import type { PageSurface } from '../surface.ts';
import type { CutReadiness } from './readiness.ts';
import type { HeldResidency } from './held.ts';

export interface PageRecord extends ClusterCut {
  triangles: number;
  level?: number;
  min?: number[];
  max?: number[];
  cone?: NormalCone;
  material?: PageSurface;
  array?: Uint32Array;
  /** Where a layout placed the record: its placement's rank, and its own among every placement's
   *  pages (`./held.ts` routes a residency move by them). */
  placementIndex?: number;
  packedIndex?: number;
}

export interface SelectionState<T extends PageRecord> {
  cam: EngineCamera;
  wanted: T[];
  shown: T[];
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
  /** The cut rule's residency of this root's pages (`./held.ts`), with the open count of each of
   *  its culling nodes; absent when nothing is held, every page then deemed resident. */
  flatHeld?: CutReadiness;
  /** What cone rejection reads of the root and the camera, set at the root's first cone. */
  flatCone: ConeContext;
  /** This root declares it carries cones: the per-cluster path reads `cone`. A root that
   *  declares it carries none takes the cone out of the loop, without changing a single decision. */
  flatCones: boolean;
  /** This root declares that each of its pages carries its box: under a node entirely inside
   *  the frustum, the per-cluster path then reads neither `min` nor `max`. */
  flatBoxes: boolean;
  /** A light's cut: its redrawn pages (`boxMissesLightPages`), and no cone test. */
  light?: LightPages;
  /** Where the cut rule's readiness of each root is held and moved (`./held.ts`); absent when
   *  the cut holds no residency. */
  held: HeldResidency | undefined;
  /** This image's threshold is zero and stretch, focal length and near plane are sound: the
   *  cut then decides without projecting, identically. */
  flatExact: boolean;
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
}

/** An empty cut result, to set once per hot caller then reuse from image to image:
 *  `selectVisiblePages` rewrites every field, only the object's identity matters. */
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
  };
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
  /** A cluster's `[own, parent]` screen errors, as the cut rule compares them. */
  pixels: new Float64Array(2),
};

/** State of a cut, set only once. Selection is synchronous and non-reentrant, like
 *  `selectionScratch`: reusing this state removes the last per-image allocation. */
const reusedState: SelectionState<PageRecord> = {
  cam: undefined as unknown as EngineCamera,
  wanted: [],
  shown: [],
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
  held: undefined,
  flatExact: false,
  shownCount: 0,
  wantedCount: 0,
  wantedTriangles: 0,
  shownTriangles: 0,
};

/** The reused state, viewed at the requested page type. */
export function selectionState<T extends PageRecord>(): SelectionState<T> {
  return reusedState as unknown as SelectionState<T>;
}
