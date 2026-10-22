/**
 * THE PLACEMENTS' WORLD BOXES THE PROBES' OCCUPANCY MAP KEEPS (`lighting/bounce/probes/probes.ts`), beside the run-time proxy
 * (`proxyInstances.ts`), kept from call to call: a placement's box is its mesh's root bounds through the world
 * it stands at, made again for a row marked since (`mark`), the rows whose box moved listed, the extent kept as
 * the boxes change, the placements that wear a proxy counted with the triangles they wear. A row that wears no
 * proxy, or stands parked, holds the empty box.
 */
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { boxTransform } from '../../../../../math/src/geometry/box.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import type { RuntimeCutProxy } from '../../../../../sdk-core/src/contracts/proxy.ts'
import { proxyTriangleCount } from './proxyArena.ts'
import { createChangedRuns } from '../../residency/ranges.ts'
import type { ProxyBoxes } from '../../../lighting/bounce/probes/probeSync.ts'
import type { DagRoot, PackedDag } from '../types.ts'

/** The cut each placement wears, none for one that wears no proxy, and what they hold: the placements that wear
 *  a proxy and the triangles of the meshes they wear, one count a placement — what a ray can meet of the scene. */
function createWornCuts(slots: number) {
  const cuts: (RuntimeCutProxy | undefined)[] = new Array(slots)
  let placements = 0,
    triangles = 0
  return {
    cuts,
    /** Placement `w` wears `cut` from now on, none if it is left out. */
    wear(w: number, cut?: RuntimeCutProxy) {
      const before = cuts[w]
      if (before === cut) return
      if (before) {
        placements--
        triangles -= proxyTriangleCount(before)
      }
      if (cut) {
        placements++
        triangles += proxyTriangleCount(cut)
      }
      cuts[w] = cut
    },
    now: () => ({ placements, triangles }),
  }
}

/** The boxes of the `slots` placements of `packed`, the `live()` first of them standing. */
export function createProxyBoxes(packed: PackedDag, slots: number, live: () => number) {
  const boxes = new Float64Array(slots * 6),
    box = new Float64Array(6),
    worn = createWornCuts(slots)
  for (let w = 0; w < slots; w++)
    boxes.fill(Infinity, w * 6, w * 6 + 3).fill(-Infinity, w * 6 + 3, w * 6 + 6)
  const boxed = createChangedRuns(),
    movedBoxes = createChangedRuns()
  const extent = [0, 0, 0, 0, 0, 0]
  // Whether the extent was found again since a box that held its edge moved, and holds a box.
  let extentStale = true,
    extentHolds = false

  /** Placement `w`'s box made again; whether it moved (a world that left the box in place moved none). */
  function rebox(w: number) {
    const root = packed.worldSources[w] as DagRoot | undefined
    const cut = root?.proxy?.primitive.runtimeProxy
    const at = w * 6
    const wears =
      w < live() && !!root && !!cut?.nodeBounds.length && packed.rootNodes[w] !== NO_INDEX
    if (!wears) {
      if (!worn.cuts[w]) return false
      worn.wear(w)
      boxes.fill(Infinity, at, at + 3).fill(-Infinity, at + 3, at + 6)
      return true
    }
    boxTransform(box, 0, cut!.nodeBounds, 0, root!.world.elements)
    if (worn.cuts[w] === cut && sameValues(box, boxes.subarray(at, at + 6))) return false
    worn.wear(w, cut)
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
      if (!worn.cuts[w]) continue
      for (let axis = 0; axis < 3; axis++) {
        const low = boxes[w * 6 + axis],
          high = boxes[w * 6 + 3 + axis]
        extent[axis] = first ? low : Math.min(extent[axis], low)
        extent[3 + axis] = first ? high : Math.max(extent[3 + axis], high)
      }
      first = false
    }
    extentHolds = !first
    extentStale = false
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
          const edge = !!worn.cuts[w] && onEdge(w)
          if (!rebox(w)) continue
          movedBoxes.mark(w)
          if (edge || extentStale || !extentHolds || !worn.cuts[w]) {
            extentStale ||= edge || (!extentHolds && !!worn.cuts[w])
            continue
          }
          for (let axis = 0; axis < 3; axis++) {
            extent[axis] = Math.min(extent[axis], boxes[w * 6 + axis])
            extent[3 + axis] = Math.max(extent[3 + axis], boxes[w * 6 + 3 + axis])
          }
        }
      boxed.clear()
      if (extentStale) fitExtent()
      const moved = movedBoxes.runs()
      const result = {
        boxes,
        moved: { count: moved.count, pairs: moved.pairs },
        extent: extent.slice(),
        worn: worn.now(),
      }
      movedBoxes.clear()
      return result
    },
    /** Bytes the CPU keeps: the boxes and the two changed lists' marks, a byte a row each. */
    hostBytes: boxes.byteLength + box.byteLength + 2 * slots,
  }
}
