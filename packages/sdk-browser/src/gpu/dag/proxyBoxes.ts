/**
 * THE PLACEMENTS' WORLD BOXES THE PROBES' OCCUPANCY MAP KEEPS (`bounce/probes.ts`), beside the run-time proxy
 * (`proxyInstances.ts`), kept from call to call: a placement's box is its mesh's root bounds through the world
 * it stands at, made again for a row marked since (`mark`), the rows whose box moved listed, the extent kept as
 * the boxes change. A row that wears no proxy, or stands parked, holds the empty box.
 */
import { boxTransform } from '../../../../math/src/geometry/box.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { createChangedRuns } from '../../webgpu/residency/ranges.ts'
import type { ProxyBoxes } from '../../bounce/probeSync.ts'
import { RUNTIME_NONE } from '../../bounce/runtimeLayout.ts'
import type { DagRoot, PackedDag } from './types.ts'

/** The boxes of the `slots` placements of `packed`, the `live()` first of them standing. */
export function createProxyBoxes(packed: PackedDag, slots: number, live: () => number) {
  const boxes = new Float64Array(slots * 6),
    box = new Float64Array(6),
    boxedCuts: (RuntimeCutProxy | undefined)[] = new Array(slots)
  for (let w = 0; w < slots; w++)
    boxes.fill(Infinity, w * 6, w * 6 + 3).fill(-Infinity, w * 6 + 3, w * 6 + 6)
  const boxed = createChangedRuns(slots, 1),
    movedBoxes = createChangedRuns(slots, 1)
  const extent = [0, 0, 0, 0, 0, 0]
  // Whether the extent was found again since a box that held its edge moved, and holds a box.
  let extentStale = true,
    extentHolds = false

  /** Placement `w`'s box made again: whether it moved — a world that moved and left the box where it was
   *  moves none. */
  function rebox(w: number) {
    const root = packed.worldSources[w] as DagRoot | undefined
    const cut = root?.proxy?.primitive.runtimeProxy
    const at = w * 6
    const wears =
      w < live() && !!root && !!cut?.nodeBounds.length && packed.rootNodes[w] !== RUNTIME_NONE
    if (!wears) {
      if (!boxedCuts[w]) return false
      boxedCuts[w] = undefined
      boxes.fill(Infinity, at, at + 3).fill(-Infinity, at + 3, at + 6)
      return true
    }
    boxTransform(box, 0, cut!.nodeBounds, 0, root!.world.elements)
    if (boxedCuts[w] === cut && sameValues(box, boxes.subarray(at, at + 6))) return false
    boxedCuts[w] = cut
    boxes.set(box, at)
    return true
  }

  /** Whether box `w`, before it changes, touches the extent: the extent is then found again. */
  function onEdge(w: number) {
    for (let axis = 0; axis < 3; axis++)
      if (boxes[w * 6 + axis] === extent[axis] || boxes[w * 6 + 3 + axis] === extent[3 + axis])
        return true
    return false
  }

  /** The extent of every box, found again: zeros without a box. */
  function fitExtent() {
    extent.fill(0)
    let first = true
    for (let w = 0; w < slots; w++) {
      if (!boxedCuts[w]) continue
      for (let axis = 0; axis < 3; axis++) {
        const low = boxes[w * 6 + axis],
          high = boxes[w * 6 + 3 + axis]
        extent[axis] = first ? low : Math.min(extent[axis], low)
        extent[3 + axis] = first ? high : Math.max(extent[3 + axis], high)
      }
      first = false
    }
    extentHolds = !first
  }

  return {
    /** Row `w` was written — its world, what it wears, its park —: its box is made again at the next
     *  `worldBoxes`. */
    mark(w: number) {
      if (w >= 0 && w < slots) boxed.mark(w)
    },
    /** The boxes made again for the rows marked since the last call, and the runs of those whose box moved:
     *  the work follows them, never the placements' count — the extent alone is found again over every box,
     *  when a box that held its edge moved. */
    worldBoxes(): ProxyBoxes {
      const { count, pairs } = boxed.runs()
      for (let r = 0; r < count; r++)
        for (let w = pairs[2 * r]; w <= pairs[2 * r + 1]; w++) {
          const edge = !!boxedCuts[w] && onEdge(w)
          if (!rebox(w)) continue
          movedBoxes.mark(w)
          if (edge || extentStale || !extentHolds || !boxedCuts[w]) {
            extentStale ||= edge || (!extentHolds && !!boxedCuts[w])
            continue
          }
          for (let axis = 0; axis < 3; axis++) {
            extent[axis] = Math.min(extent[axis], boxes[w * 6 + axis])
            extent[3 + axis] = Math.max(extent[3 + axis], boxes[w * 6 + 3 + axis])
          }
        }
      boxed.clear()
      if (extentStale) fitExtent()
      extentStale = false
      const moved = movedBoxes.runs()
      const result = {
        boxes,
        moved: { count: moved.count, pairs: moved.pairs },
        extent: extent.slice(),
      }
      movedBoxes.clear()
      return result
    },
    /** Bytes the CPU keeps: the boxes and the two changed lists' marks, a byte a row each. */
    hostBytes: boxes.byteLength + box.byteLength + 2 * slots,
  }
}
