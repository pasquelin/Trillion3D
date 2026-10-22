import { boxEmpty } from '../../../../../math/src/geometry/box.ts'
import type { PageRec } from '../../../geometry/selection/types.ts'
import type { WebgpuLightState } from '../../../frame/backend/state/lights.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { ROW_WORDS } from '../../../visibility/types.ts'
import { rowKind } from '../../../geometry/rows/page/pageRow.ts'
import { BIN_KIND } from '../../../visibility/draw/contract.ts'
import { mobilityRows } from './rowBuffers.ts'
import type { RowRunVisitor } from '../../../geometry/rows/dirty.ts'
import { CASTS_NO_SHADOW } from '../../../visibility/shader/spriteWgsl.ts'
import { FAR_SHADOW_ROOT } from '../../../visibility/shader/castingMark.ts'
import { MOBILITY_FAR_SHADOW, MOBILITY_SHADOWLESS } from '../mobilityBits.ts'
import { growClusterBox } from './spheres.ts'
import {
  rootOfPacked,
  type PlacementIndex,
  type Placements,
} from '../../../geometry/selection/placements.ts'

import { PAGE_INFO } from '../../../visibility/pageInfo.ts'

/**
 * What `mobility.writeRows` reads of the table, built once per runtime and kept on its lights
 * (`mobilitySource`): the table, its roots and its placements are the layout's own objects for the
 * session (`../../../frame/prepare/layout.ts`), and the buffer is read from the lights when a run is
 * pushed, so no run and no image builds a closure. `device` is the one the call in progress
 * uploads on.
 */
export type MobilitySource = {
  rt: WebgpuPagesRuntime
  device: GPUDevice
  worldOf: (rank: number) => ArrayLike<number>
  placementOf: (row: number) => number
  push: (first: number, count: number) => void
  corners: (row: number) => number
  cutout: (row: number) => boolean
  castFlags: (rank: number) => number
}

function sourceOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const built = rt.lights.mobilitySource
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
      rows.packedRecs[row] ? rootOfPacked(placement, rows.packedPageIndex[row]) : -1,
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
      rows.pageTableInts?.[row * ROW_WORDS + PAGE_INFO.at.indexCount] ?? rt.setup.maxCorners,
    cutout: (row) => !!rows.pageTableInts && rowKind(rows.pageTableInts, row) === BIN_KIND.CUTOUT,
    castFlags: (rank) => {
      const root = selectionRoots[rank],
        mark = root?.mark ?? 0
      return (
        (!root || root.parked || mark & CASTS_NO_SHADOW ? MOBILITY_SHADOWLESS : 0) |
        (mark & FAR_SHADOW_ROOT ? MOBILITY_FAR_SHADOW : 0)
      )
    },
  }
  lights.mobilitySource = source
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
    source.castFlags,
  )
}

/**
 * Mobility word of rows `[from, to]` — whether its placement moves, whether it is a cutout,
 * whether it casts no shadow (`castShadow = false`, hidden or parked), whether it casts far
 * shadows (`castFarShadow`), the corners its row draws — pushed on the same
 * dirty interval as the spheres and the page table's flags — a row whose cut readiness moved is
 * marked too (`gpuCutStream.ts`) —, and the rows of each placement that turned moving or static,
 * or started or stopped casting (`mobility.touch`): what the
 * page cull splits a page's casters by, static layer or moving casters, and drawn with no fragment
 * stage or with the cutout test.
 */
function uploadRowMobility(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const source = sourceOf(rt, device),
    { lights, layout } = rt,
    { casterSlots } = layout.rows,
    { mobility } = lights
  mobility.ensure(layout.selectionRoots.length, casterSlots, source.worldOf)
  // Made the first time a light casts; a table grown resizes it (`growShadowRows`).
  if (!lights.mobilityRows) {
    lights.mobilityRows = mobilityRows(device, casterSlots)
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
  rows.forEachDirtyRun(sourceOf(rt, device), mobilityRun)
}

/** The flat world box a residence change is declared with, and its halves, allocated once. */
const changeBox = new Float64Array(6),
  changeMin = changeBox.subarray(0, 3),
  changeMax = changeBox.subarray(3, 6)

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
  placement: PlacementIndex,
  packed: number,
  rec: PageRec,
  moving?: boolean,
  atOnce = false,
) {
  const { store, changes } = lights
  if (!store.count) return
  const rank = rootOfPacked(placement, packed) ?? -1
  const onlyMoving = moving ?? (rank >= 0 && lights.mobility.moves(rank))
  boxEmpty(changeBox, 0)
  growClusterBox(rec, roots, changeBox, rank)
  if (atOnce) changes.residencyChanged(changeMin, changeMax, onlyMoving)
  else changes.representationChanged(changeMin, changeMax, onlyMoving)
}
