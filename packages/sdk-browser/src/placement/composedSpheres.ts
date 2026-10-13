/**
 * THE CPU COPY OF A COMPOSED ROW'S SPHERE, current where a CPU decision reads it. The shadow raster
 * sizes its chunks from where the rows are (`../vsm/rowPageBound.ts`), from the CPU copy of the
 * spheres (`lights.spheres.packed`); a row whose parent moved is moved by the GPU alone
 * (`gpuCompose.ts`), its sphere in the buffer rewritten there and its copy left where the last CPU
 * write put it. A chunk sized from that copy could hold more (row, page) pairs than its lists do.
 * So the copy of every composed row is made from the composed world a CPU reader reads — the one CPU
 * product (`multiplyMatrix4`, through the root's `world`) — by the one sphere formula
 * (`rowSphere.ts`), the first time a frame reads it after a parent moved, never otherwise — over
 * the rows of the composed roots alone (`followComposedRows`), never the table —: the
 * buffer is the GPU's, the copy is a reader's, and neither is written by the other. The rows it
 * rewrites are noted as an upload's are, for the bins to follow (`spheres.written`).
 */
import { rootOfPacked } from '../page/selection/placements.ts'
import { packClusterSpheres } from '../webgpu/shadow/spheres.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { followComposedRows } from './composedRowInputs.ts'

/** The composed rows in order, one scratch for every refresh. */
let sorted = new Int32Array(8)

export function refreshComposedSpheres(rt: WebgpuPagesRuntime) {
  const state = rt.compose,
    spheres = rt.lights.spheres
  if (!state?.parentIds.size || !spheres || spheres.composedVersion === state.version) return
  spheres.composedVersion = state.version
  // The rows of the composed roots, as the rows pass reads them, in order: runs of neighbours.
  followComposedRows(rt, state)
  const { rows, selectionRoots, placement } = rt.layout,
    { set } = state.rowList,
    last = Math.min(rows.packedCount, spheres.rows) - 1
  sorted = resized(sorted, set.count)
  const order = sorted.subarray(0, set.count)
  order.set(set.list.subarray(0, set.count))
  order.sort()
  const runs: number[] = []
  const rankOf = (row: number) => rootOfPacked(placement, rows.packedPageIndex[row])
  for (let k = 0; k < order.length && order[k] <= last;) {
    const row = order[k++]
    let end = row
    while (k < order.length && order[k] === end + 1 && order[k] <= last) end = order[k++]
    packClusterSpheres(rows.packedRecs, selectionRoots, spheres.packed, row, end, rankOf)
    runs.push(row, end)
  }
  if (runs.length) spheres.written = { epoch: spheres.written.epoch + 1, runs }
}
