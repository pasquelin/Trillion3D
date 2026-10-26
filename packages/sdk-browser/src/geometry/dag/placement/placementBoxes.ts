/**
 * THE PLACEMENTS' WORLD BOXES the probes follow (`lighting/bounce/probes/probeSync.ts`), kept from call to call: a placement's box is its
 * mesh's local box (`DagRoot.localBox`) through the world it stands at, made again for a row marked since (`mark`), the rows whose box
 * moved listed, the extent kept as the boxes change. A row that has no local box, or stands parked, holds the empty box.
 */
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { boxEmpty, boxTransform } from '../../../../../math/src/geometry/box.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { createChangedRuns } from '../../residency/ranges.ts'
import type { DagRoot, PackedDag } from '../types.ts'

/** The placements a change touched, as runs of rows: `count` `[first, last]` pairs. */
type MovedRows = {
  /** How many runs `pairs` holds. */
  readonly count: number
  /** The runs, `[first, last]` row pairs, first-inclusive and last-inclusive. */
  readonly pairs: ArrayLike<number>
}

/** The placements' world boxes: six world bounds a placement (an empty box for one that holds none), the runs of those that moved since
 *  the last call, the extent of every box — three lower bounds then three upper, zeros without a box — and how many placements hold one. */
export type PlacementBoxes = {
  boxes: Float64Array
  moved: MovedRows
  extent: readonly number[]
  placements: number
}

/** No placement holds a box. */
export const NO_PLACEMENT_BOXES: PlacementBoxes = {
  boxes: new Float64Array(0),
  moved: { count: 0, pairs: new Int32Array(0) },
  extent: [0, 0, 0, 0, 0, 0],
  placements: 0,
}

/** The extent of the boxes: its six edges, whether it was found again since a box that held its edge
 *  moved (`stale`), and whether it holds a box. */
type Extent = { edges: number[]; stale: boolean; holds: boolean }

/** Whether box `w`, before it changes, touches the extent: the extent is then found again. */
function onEdge(boxes: Float64Array, edges: number[], w: number) {
  for (let axis = 0; axis < 3; axis++)
    if (boxes[w * 6 + axis] === edges[axis] || boxes[w * 6 + 3 + axis] === edges[3 + axis])
      return true
  return false
}

/** The extent of every box, found again: zeros without a box. */
function fitExtent(extent: Extent, boxes: Float64Array, held: Uint8Array) {
  const { edges } = extent
  edges.fill(0)
  let first = true
  for (let w = 0; w < held.length; w++) {
    if (!held[w]) continue
    for (let axis = 0; axis < 3; axis++) {
      const low = boxes[w * 6 + axis],
        high = boxes[w * 6 + 3 + axis]
      edges[axis] = first ? low : Math.min(edges[axis], low)
      edges[3 + axis] = first ? high : Math.max(edges[3 + axis], high)
    }
    first = false
  }
  extent.holds = !first
  extent.stale = false
}

/** Box `w` held by the extent, which only grows. */
function growExtent(boxes: Float64Array, edges: number[], w: number) {
  for (let axis = 0; axis < 3; axis++) {
    edges[axis] = Math.min(edges[axis], boxes[w * 6 + axis])
    edges[3 + axis] = Math.max(edges[3 + axis], boxes[w * 6 + 3 + axis])
  }
}

/** The boxes held: which placements hold one, and how many. */
type Held = { has: Uint8Array; count: number }

/** Placement `w`'s box made again in `boxes`, `box` the scratch; whether it moved (a world that left
 *  the box in place moved none). */
function rebox(
  packed: PackedDag,
  live: () => number,
  held: Held,
  boxes: Float64Array,
  box: Float64Array,
  w: number,
) {
  const root = packed.worldSources[w] as DagRoot | undefined
  const local = root?.localBox
  const at = w * 6
  const holds =
    w < live() && !!root && !!local && local[3] >= local[0] && packed.rootNodes[w] !== NO_INDEX
  if (!holds) {
    if (!held.has[w]) return false
    held.has[w] = 0
    held.count--
    boxEmpty(boxes, at)
    return true
  }
  boxTransform(box, 0, local!, 0, root!.world.elements)
  if (held.has[w] && sameValues(box, boxes.subarray(at, at + 6))) return false
  if (!held.has[w]) {
    held.has[w] = 1
    held.count++
  }
  boxes.set(box, at)
  return true
}

/** The boxes of the `slots` placements of `packed`, the `live()` first of them standing. */
export function createPlacementBoxes(packed: PackedDag, slots: number, live: () => number) {
  const boxes = new Float64Array(slots * 6),
    box = new Float64Array(6),
    held: Held = { has: new Uint8Array(slots), count: 0 }
  for (let w = 0; w < slots; w++) boxEmpty(boxes, w * 6)
  const boxed = createChangedRuns(),
    movedBoxes = createChangedRuns()
  const extent: Extent = { edges: [0, 0, 0, 0, 0, 0], stale: true, holds: false }
  // Every row is to be boxed at the first call.
  for (let w = 0; w < slots; w++) boxed.mark(w)

  /** Placement `w`'s box made again, the extent kept or marked to be found again. */
  function remake(w: number) {
    const edge = !!held.has[w] && onEdge(boxes, extent.edges, w)
    if (!rebox(packed, live, held, boxes, box, w)) return
    movedBoxes.mark(w)
    if (edge || extent.stale || !extent.holds || !held.has[w]) {
      extent.stale ||= edge || (!extent.holds && !!held.has[w])
      return
    }
    growExtent(boxes, extent.edges, w)
  }

  return {
    /** Row `w` was written — its world, its park —: its box is made again at the next `boxes`. */
    mark(w: number) {
      if (w >= 0 && w < slots) boxed.mark(w)
    },
    /** Rows `[from, to)` were appended. */
    markRange(from: number, to: number) {
      for (let w = Math.max(from, 0); w < Math.min(to, slots); w++) boxed.mark(w)
    },
    /** The first `count` of `rows` were written. */
    markRows(rows: ArrayLike<number>, count = rows.length) {
      for (let k = 0; k < count; k++) if (rows[k] >= 0 && rows[k] < slots) boxed.mark(rows[k])
    },
    /** The boxes made again for the rows marked since the last call, and the runs of those whose box moved:
     *  the work follows them, never the placements' count — the extent alone is found again over every box,
     *  when a box that held its edge moved. */
    boxes(): PlacementBoxes {
      const { count, pairs } = boxed.runs()
      for (let r = 0; r < count; r++)
        for (let w = pairs[2 * r]; w <= pairs[2 * r + 1]; w++) remake(w)
      boxed.clear()
      if (extent.stale) fitExtent(extent, boxes, held.has)
      const moved = movedBoxes.runs()
      const result = {
        boxes,
        moved: { count: moved.count, pairs: moved.pairs },
        extent: extent.edges.slice(),
        placements: held.count,
      }
      movedBoxes.clear()
      return result
    },
    /** Bytes the CPU keeps: the boxes and the two changed lists' marks, a byte a row each. */
    hostBytes: boxes.byteLength + box.byteLength + 3 * slots,
  }
}
/** The tracker of the boxes, made. */
export type PlacementBoxesTracker = ReturnType<typeof createPlacementBoxes>
