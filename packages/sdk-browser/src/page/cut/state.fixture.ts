import { FRUSTUM_PLANE_VALUES } from '../../../../sdk-core/src/index.ts'
import { type NormalCone } from '../cone/cone.ts'
import { type ConeContext } from '../cone/cone.fixture.ts'
import { createConeContext } from '../cone/cone.fixture.ts'
import type { EngineCamera } from '../../camera/world.ts'
import { IDENTITY_WORLD, type MatrixElements } from '../../math/matrixElements.ts'
import type { ClusterCut } from '../selection/math.ts'
import type { PageSurface } from '../surface.ts'
import type { CutReadiness } from './readiness.ts'
import type { HeldResidency } from './held.fixture.ts'

export interface PageRecord extends ClusterCut {
  triangles: number
  level?: number
  min?: number[]
  max?: number[]
  cone?: NormalCone
  material?: PageSurface
  array?: Uint32Array
}

export interface SelectionState<T extends PageRecord> {
  cam: EngineCamera
  wanted: T[]
  shown: T[]
  /** The same two cuts by packed catalogue rank, rank by rank (the root's `packedBase` plus the
   *  page's index): what the engines' consumers read, resolved back to a record through the
   *  catalogue (`recordOf`). The cut still decides on the records above — a packed rank names the
   *  instance, never a record. Reused `Int32Array`s widened as the cut emits (`fitPacked`). */
  wantedPacked: Int32Array
  shownPacked: Int32Array
  /** Packed base of the root the cut is walking: set by `selectFlat` per root, like `flatWorld`,
   *  so a kept page is named without a field on the shared record. */
  flatBase: number
  pixelError: number
  frustumRejected: number
  /** Hierarchy nodes popped by this image's cut. */
  nodesTested: number
  lodLevel: number
  complete: boolean
  cameraStretch: number
  flatWorld: MatrixElements
  flatElements: ArrayLike<number>
  flatStretch: number
  flatFocal: number
  /** How far this root's GPU deformation moves a vertex this frame, in its units: every
   *  box and every sphere the cut reads of it grows by it; zero at rest. */
  flatReach: number
  /** The cut rule's residency of this root's pages (`./held.fixture.ts`), with the open count of each of
   *  its culling nodes; absent when nothing is held, every page then deemed resident. */
  flatHeld?: CutReadiness
  /** What cone rejection reads of the root and the camera, set at the root's first cone. */
  flatCone: ConeContext
  /** The per-cluster path reads `cone`: false on a root its deformation moves (`flatReach`). */
  flatCones: boolean
  /** This root declares that each of its pages carries its box: under a node entirely inside
   *  the frustum, the per-cluster path then reads neither `min` nor `max`. */
  flatBoxes: boolean
  /** Where the cut rule's readiness of each root is held and moved (`./held.fixture.ts`); absent when
   *  the cut holds no residency. */
  held: HeldResidency | undefined
  /** What the two lists actually hold. The arrays are not cleared with `length = 0` each
   *  image — they would lose their capacity and grow it back from zero to eighty thousand — but
   *  rewritten by index, and their length is set only once the cut is finished. During the cut,
   *  these two counts are the only truth: `length` is behind. */
  shownCount: number
  wantedCount: number
  /** Triangles of both cuts, summed with a running total in array order: the sum is that of a
   *  sweep of `wanted` and `shown`, in the same order and at the same bits. */
  wantedTriangles: number
  shownTriangles: number
  /** Triangles of the holes, see `SelectionResult.uncoveredTriangles`. */
  uncoveredTriangles: number
}

/**
 * A packed list wide enough for `needed` ranks. The buffer is kept when it already holds them —
 * `Int32Array.length` is getter-only in a module, so the list is never truncated; the cut's counts
 * are the record lists' lengths, rank by rank — and replaced by a power-of-two-sized one otherwise,
 * holding the previous one's first `keep` ranks: a cut that has been seen reuses its two lists for
 * life, and one that selects more widens them a logarithmic number of times, to what it selected.
 */
export function fitPacked(list: Int32Array, needed: number, keep = 0): Int32Array {
  if (list.length >= needed) return list
  let size = Math.max(8, list.length)
  while (size < needed) size <<= 1
  const next = new Int32Array(size)
  if (keep) next.set(list.subarray(0, keep))
  return next
}

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
}

/** State of a cut, set only once. Selection is synchronous and non-reentrant, like
 *  `selectionScratch`: reusing this state removes the last per-image allocation. */
const reusedState: SelectionState<PageRecord> = {
  cam: undefined as unknown as EngineCamera,
  wanted: [],
  shown: [],
  wantedPacked: new Int32Array(0),
  shownPacked: new Int32Array(0),
  flatBase: -1,
  pixelError: 0,
  frustumRejected: 0,
  nodesTested: 0,
  lodLevel: 0,
  complete: true,
  cameraStretch: 1,
  flatWorld: IDENTITY_WORLD,
  flatElements: IDENTITY_WORLD.elements,
  flatStretch: 1,
  flatFocal: 1,
  flatReach: 0,
  flatCone: createConeContext(),
  flatCones: true,
  flatBoxes: false,
  held: undefined,
  shownCount: 0,
  wantedCount: 0,
  wantedTriangles: 0,
  shownTriangles: 0,
  uncoveredTriangles: 0,
}

/** The reused state, viewed at the requested page type. */
export function selectionState<T extends PageRecord>(): SelectionState<T> {
  return reusedState as unknown as SelectionState<T>
}
