/**
 * THE DEFORMATION TAKES THE SOURCES ADDED TO THE SESSION (`addPlacements`, a growth of rows): the
 * placements a skeleton, morph weights, waves or a bank's track move, and the float geometries the
 * passes read in place of a quantized page. What the open built once — the stage's code and
 * compute, the records of the roots and of the tracks, the float pool's tail, the results of the
 * pages — is made for the content a session gains by the open's own functions, run on it:
 * - before the roots join (`prepareDeformationGrowth`): the code and the compute of a session
 *   opened with no deformation (`createDeformationCompute`), the float geometries of the pages
 *   placed in the pool's room (`place`, which grows it in place);
 * - between two images, once the roots hold their ranks (`joinDeformation`): the records behind
 *   the others' — those of the tracks of banks no record held yet first — and the result blocks
 *   (`SessionDeformation.append`, `assignDeformationOutputs`), the pool's tail made wider by
 *   doubling and drawn again for the records and the float-pool blocks of the pages
 *   (`extendGeometry`), the rows that read them pointed at them (`followPoolGrowth`).
 *
 * Cost of a source of A' placements bringing F' floats of records and P' float vertices:
 * O(A' + F' + P') written, the tail drawn again over the records held (O(F) words, a doubling of
 * the tail only when it is full, amortised O(1) a float).
 */
import { loadDeformationCode, prepareDeformationCompute } from './prepare.ts'
import { placeFloatPages } from '../geometry/pages/pool/geometryPrepare.ts'
import type { MatrixElements } from '../session/host/matrixElements.ts'
import type { ClusterRoot, PageRec } from '../geometry/selection/types.ts'
import { assignDeformationOutputs } from './outputs.ts'
import { deformsAny } from './session.ts'
import { markWebgpuLost, stopped } from '../frame/io/lost.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/**
 * The session can move what `roots` bring, the float geometries of the `pages` that read them
 * placed in the pool: the stage's code loaded for them by the open's rule (`deformsAny`) and its
 * compute made when the session was opened with none. False where the device or the pool refuses
 * (no room).
 */
export async function prepareDeformationGrowth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  roots: readonly ClusterRoot<PageRec>[],
  pages: readonly PageRec[],
) {
  await loadDeformationCode(rt.vis, deformsAny(roots))
  if (stopped(rt)) return false
  await prepareDeformationCompute(rt, device)
  return !!rt.vis.vertexPool && placeFloatPages(rt.vis.vertexPool, pages)
}

/**
 * The records of the roots `added` join the session's, behind the others'; `firstRank` is the rank
 * of the first root in the cut.
 */
export function joinDeformation(
  rt: WebgpuPagesRuntime,
  added: readonly ClusterRoot<PageRec>[],
  firstRank: number,
) {
  const { deformation } = rt.vis
  if (!deformation) return
  if (deformation.ranks !== firstRank) throw new Error('DEFORMATION_RANKS')
  // Each root's pages get results of their own, a row cloned from another's included, and the
  // blocks of the tracks they can play that no root of their page list made yet.
  rt.setup.deformationBlocks.push(...assignDeformationOutputs(added, deformation.tracks.shared))
  deformation.append(added)
}

/**
 * The rows of a deformed placement are another buffer's (`rebound`, `placement/growth/growth.ts`): the
 * records and the result blocks that name a placement by its world follow it.
 */
export function rebindDeformedWorlds(
  rt: Pick<WebgpuPagesRuntime, 'vis' | 'setup'>,
  rebound: ReadonlyMap<MatrixElements, MatrixElements>,
) {
  rt.vis.deformation?.rebind(rebound)
  for (const { pool } of rt.setup.deformationBlocks) {
    const world = pool?.world && rebound.get(pool.world)
    if (world) pool!.world = world
  }
}

/**
 * The pool's tail drawn again for the records and the float-pool blocks of the session, once these
 * exist. Fails the device when it refuses the room: the host opens the session again, as it does
 * for any refusal of the device.
 */
export function placeDeformation(rt: WebgpuPagesRuntime) {
  const { vis } = rt
  if (!vis.extendGeometry) return
  const pooledRows = vis.deformationCode?.pooledDeformationRows
  if (!vis.extendGeometry([], pooledRows))
    markWebgpuLost(rt, { reason: 'geometry-pool', message: 'GEOMETRY_POOL_DEVICE_LIMIT' })
}
