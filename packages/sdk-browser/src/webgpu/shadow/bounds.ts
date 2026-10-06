import { boxEmpty } from '../../../../sdk-core/src/index.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import type { WebgpuLightState } from '../pages/state/lights.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/types.ts'
import { ROW_INDEX_WORDS, rowCutout } from '../row/pageRow.ts'
import { mobilityRows } from './rowBuffers.ts'
import { forEachDirtyRun, type RowRunVisitor } from '../row/dirty.ts'
import { CASTS_NO_SHADOW } from '../../visibility/shader/spriteWgsl.ts'
import { growClusterBox } from './spheres.ts'

export { growClusterBox, uploadClusterSpheres } from './spheres.ts'

const ROW_WORDS = PAGE_INFO_STRIDE / 4

/**
 * What `mobility.writeRows` reads of the table, built once per runtime: the table, its roots and its
 * placements are the layout's own objects for the session (`../pages/prepare/layout.ts`), and the buffer is
 * read from the lights when a run is pushed, so no run and no image builds a closure. `device` is
 * the one the call in progress uploads on.
 */
type MobilitySource = {
  rt: WebgpuPagesRuntime
  device: GPUDevice
  worldOf: (rank: number) => ArrayLike<number>
  placementOf: (row: number) => number
  push: (first: number, count: number) => void
  corners: (row: number) => number
  cutout: (row: number) => boolean
  shadowless: (rank: number) => boolean
}

const sources = new WeakMap<WebgpuPagesRuntime, MobilitySource>()

function sourceOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const built = sources.get(rt)
  if (built) {
    built.device = device
    return built
  }
  const { lights, layout } = rt,
    { rows, selectionRoots, placement } = layout
  const source: MobilitySource = {
    rt,
    device,
    worldOf: (rank) => selectionRoots[rank].world.elements,
    placementOf: (row) =>
      rows.packedRecs[row] ? placement.rootOfPacked[rows.packedPageIndex[row]] : -1,
    push: (first, count) =>
      source.device.queue.writeBuffer(
        lights.mobilityRows!,
        first * 4,
        lights.mobility.rowWords,
        first,
        count,
      ),
    // A row the table does not hold yet is sized as the scene's largest: never a triangle short.
    corners: (row) =>
      rows.pageTableInts?.[row * ROW_WORDS + ROW_INDEX_WORDS] ?? rt.setup.maxCorners,
    cutout: (row) => !!rows.pageTableInts && rowCutout(rows.pageTableInts, row),
    shadowless: (rank) => {
      const root = selectionRoots[rank]
      return !root || !!root.parked || ((root.mark ?? 0) & CASTS_NO_SHADOW) !== 0
    },
  }
  sources.set(rt, source)
  return source
}

/** Rows `[from, to]`'s mobility words, on the buffer `uploadRowMobility` sized: one dirty run's. */
const mobilityRun: RowRunVisitor<MobilitySource> = (source, from, to) => {
  const { rows } = source.rt.layout
  source.rt.lights.mobility.writeRows(
    source.placementOf,
    rows.casterSlots,
    from,
    to,
    source.push,
    source.corners,
    rows.blendFirst,
    source.cutout,
    source.shadowless,
  )
}

/**
 * Mobility word of rows `[from, to]` — whether its placement moves, whether it is a cutout,
 * whether it casts no shadow (`castShadow = false`, hidden or parked), the corners its row draws
 * — pushed on the same
 * dirty interval as the spheres and the page table's flags — a row whose cut readiness moved is
 * marked too (`gpuCutStream.ts`) —, and the rows of each placement that turned moving or static,
 * or started or stopped casting (`mobility.touch`): what the
 * page cull splits a page's casters by, static layer or moving casters, and drawn with no fragment
 * stage or with the cutout test.
 */
export function uploadRowMobility(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  from: number,
  to: number,
) {
  const source = sourceOf(rt, device),
    { lights, layout } = rt,
    { casterSlots } = layout.rows,
    { mobility } = lights
  mobility.ensure(layout.selectionRoots.length, casterSlots, source.worldOf)
  if (!lights.mobilityRows || lights.mobilityRows.size !== mobility.rowWords.byteLength) {
    lights.mobilityRows?.destroy()
    lights.mobilityRows = mobilityRows(device, mobility.rowWords.length)
    from = 0
    to = casterSlots - 1
  }
  mobilityRun(source, from, to)
}

/**
 * The mobility words of the rows the table declared dirty, run by run (`forEachDirtyRun`), as the
 * spheres and the row detail go: two models moving at both ends of the table write their own rows,
 * never the still rows between them. The rows of the placements touched since, and every row of a
 * table of another size, go first, through an empty interval; a row both touched and dirty is
 * then written whole by its run, from the same placement state.
 */
export function uploadDirtyRowMobility(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { rows } = rt.layout
  uploadRowMobility(rt, device, 0, -1)
  forEachDirtyRun(rows.dirtyMarks, rows.dirtyFrom, rows.dirtyTo, sourceOf(rt, device), mobilityRun)
}

/** Two flat world boxes and their halves, allocated once, that a change is declared with: the
 *  rows the static layer holds, then the rows already moving. */
export const changeBoxes = [0, 1].map(() => {
  const box = new Float64Array(6)
  return { box, min: box.subarray(0, 3), max: box.subarray(3, 6) }
})

/** True when the placement of rank `rank` already moves: the static layer does not hold its
 *  casters, and a change of its own redraws the moving casters alone. */
export const recordMoves = ({ mobility }: WebgpuLightState, rank: number) =>
  rank >= 0 && mobility.moves(rank)

/**
 * A page entered residency or left it since the last plan: the scene is drawn at another
 * precision where it is, so the shadow maps of lights whose range touches this box
 * no longer describe it exactly and become candidates again. Without that, a settled map would
 * keep the shadow of a cluster that left, or ignore that of a cluster that arrived. A
 * residency change the cut reads (`atOnce`) stales its pages at the next plan, the camera moving
 * or not: a page kept with a superseded form of a surface shades the form the camera now
 * draws in patches. Another change of the representation waits for the camera to rest. The
 * declared box is that of the cluster's world sphere; a moving placement's, or a blended
 * caster's (`moving`), leaves the static layer as it is.
 */
export function noteResidenceChange(
  lights: WebgpuLightState,
  roots: Placements,
  rootOfPacked: Int32Array,
  packed: number,
  rec: PageRec,
  moving?: boolean,
  atOnce = false,
) {
  const { store, changes } = lights
  if (!store.count) return
  const rank = rootOfPacked[packed] ?? -1
  const onlyMoving = moving ?? recordMoves(lights, rank)
  const { box, min, max } = changeBoxes[+onlyMoving]
  boxEmpty(box, 0)
  growClusterBox(rec, roots, box, rank)
  if (atOnce) changes.residencyChanged(min, max, onlyMoving)
  else changes.representationChanged(min, max, onlyMoving)
}
