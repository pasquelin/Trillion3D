/**
 * THE CPU COPY OF A COMPOSED ROW'S SPHERE, current where a CPU decision reads it. The shadow raster
 * sizes its chunks from where the rows are (`../vsm/rowPageBound.ts`), from the CPU copy of the
 * spheres (`lights.spheres.packed`); a row whose parent moved is moved by the GPU alone
 * (`gpuCompose.ts`), its sphere in the buffer rewritten there and its copy left where the last CPU
 * write put it. A chunk sized from that copy could hold more (row, page) pairs than its lists do.
 * So the copy of every composed row is made from the composed world a CPU reader reads — the one CPU
 * product (`composeWorld`, through the root's `world`) — by the one sphere formula
 * (`rowSphere.ts`), the first time a frame reads it after a parent moved, never otherwise: the
 * buffer is the GPU's, the copy is a reader's, and neither is written by the other. The rows it
 * rewrites are noted as an upload's are, for the bins to follow (`spheres.written`).
 */
import { rootOfPacked } from '../page/selection/placements.ts'
import { packClusterSpheres } from '../webgpu/shadow/spheres.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { NONE } from './gpuComposeWgsl.ts'

/** The composition's version each copy was made at. */
const copied = new WeakMap<object, number>()

export function refreshComposedSpheres(rt: WebgpuPagesRuntime) {
  const state = rt.compose,
    spheres = rt.lights.spheres
  if (!state?.parentIds.size || !spheres || copied.get(spheres) === state.version) return
  copied.set(spheres, state.version)
  const { rows, selectionRoots, placement } = rt.layout,
    runs: number[] = []
  const rankOf = (row: number) => rootOfPacked(placement, rows.packedPageIndex[row])
  const composed = (row: number) => {
    const rank = rankOf(row)
    return rank >= 0 && rank < state.roots && state.parentOf[rank] !== NONE
  }
  const last = Math.min(rows.packedCount, spheres.rows) - 1
  for (let row = 0; row <= last; row++) {
    if (!composed(row)) continue
    let end = row
    while (end + 1 <= last && composed(end + 1)) end++
    packClusterSpheres(rows.packedRecs, selectionRoots, spheres.packed, row, end, rankOf)
    runs.push(row, end)
    row = end
  }
  if (runs.length) spheres.written = { epoch: spheres.written.epoch + 1, runs }
}
