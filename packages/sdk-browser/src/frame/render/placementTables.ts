import { HLOD_INDEX } from '../../diagnostic/colors.ts'
import type { PlacementInfoSource } from '../../geometry/clusters/placementInfo.ts'
import { PLACEMENT_INFO_BYTES } from '../../geometry/dag/info/placementInfoLayout.ts'
import { rowWrittenAs } from '../prepare/worldRoot.ts'
import type { WebgpuPagesCore, WebgpuPagesRuntime } from '../backend/runtime.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'

/**
 * What the placements' records are made from (`../../geometry/clusters/placementInfo.ts`), read
 * off the runtime when a record is made: the session's deformation, what each root's object says of
 * its surfaces' offsets, the HLOD level the placement draws as, the cut's pages and the deformed results
 * of the root's pages. Bound once, at the services' making.
 */
export function placementSource(rt: WebgpuPagesCore): PlacementInfoSource {
  const { layout } = rt
  return {
    deformWord: (rank) => rt.vis.deformation?.rowWord(rank) ?? 0,
    offsets: (rank) => rt.vis.rootOffsets.rowOf(rank),
    hlod(rank) {
      const drawn = rowWrittenAs(layout.selectionRoots, rank)
      return drawn >= 0 ? HLOD_INDEX.level0 + drawn : HLOD_INDEX.none
    },
    infoShift: (rank) => rt.run.gpuSelection?.infoShift[rank] ?? 0,
    pageBase: (rank) => layout.placement.baseOfRoot[rank] ?? 0,
    outputs: (rank) => layout.selectionRoots[rank]?.deformationOutputs,
    pageCount: (rank) => layout.selectionRoots[rank]?.pages.length ?? 0,
  }
}

/**
 * The placements' records and the deformed results of their pages sent to the GPU, before the cut
 * and the decode read them: made at their first image, larger when the placements or the results
 * grew — the whole table sent again then, and whenever the cut was made again, whose page
 * indices the records name (`infoShift`) —, the records marked since sent in runs. Returns whether
 * they are in place.
 */
export function uploadPlacementTables(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, run } = rt,
    host = rt.layout.clusters.placementInfo
  if (!run.gpuSelection) return false
  const placements = rt.layout.selectionRoots.length
  host.ensure(placements)
  const wantBytes = Math.max(PLACEMENT_INFO_BYTES, host.capacity * PLACEMENT_INFO_BYTES),
    wantOutputs = Math.max(8, host.outputWords * 4)
  const held = vis.placementGpu
  let whole = false
  if (!held || held.buffer.size < wantBytes || held.outputs.size < wantOutputs) {
    if (held) {
      retire(device, held.buffer)
      retire(device, held.outputs)
    }
    vis.placementGpu = {
      buffer: device.createBuffer({
        label: 'Trillion3D placement records',
        size: grownLength(held?.buffer.size ?? 0, wantBytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
      outputs: device.createBuffer({
        label: 'Trillion3D placement results',
        size: grownLength(held?.outputs.size ?? 0, wantOutputs),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    }
    whole = true
  }
  const gpu = vis.placementGpu!
  // A cut made again names its pages by other indices: every record is made again for it.
  whole ||= cutHeld.get(gpu) !== run.gpuSelection
  cutHeld.set(gpu, run.gpuSelection)
  host.flush(device, gpu.buffer, gpu.outputs, whole)
  return true
}

/** The cut each table of records was last made for. */
const cutHeld = new WeakMap<object, object>()
