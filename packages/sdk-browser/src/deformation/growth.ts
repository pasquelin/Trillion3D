/**
 * THE DEFORMATION TAKES THE SOURCES ADDED TO THE SESSION (`addPlacements`, a growth of rows): the
 * placements a skeleton, morph weights or waves move, and the float geometries the passes read in
 * place of a quantized page. What the open built once — the stage's code and compute, the records
 * of the roots, the float pool's tail, the results of the pages — is made for the content a session
 * gains by the open's own functions, run on it:
 * - before the roots join (`prepareDeformationGrowth`): the code and the compute of a session
 *   opened with no deformation (`createDeformationCompute`), the float geometries of the pages
 *   placed in the pool's room (`place`, which grows it in place);
 * - between two images, once the roots hold their ranks (`growDeformation`): the records behind
 *   the others' (`SessionDeformation.append`), the pool's tail made wider by doubling and drawn
 *   again for the records, the whole copies and the float-pool blocks of the pages
 *   (`extendGeometry`), the rows that read them pointed at them (`followPoolGrowth`).
 *
 * Cost of a source of A' placements bringing F' floats of records, P' float vertices and W' words of
 * whole copies: O(A' + F' + P') written, the tail drawn again over the records and whole copies
 * held (O(F + W) words, a doubling of the tail only when it is full, amortised O(1) a float).
 */
import type { Primitive } from '../../../sdk-core/src/index.ts'
import { loadDeformationCode, prepareDeformationCompute } from './prepare.ts'
import { placeFloatPages } from '../webgpu/core/geometryPrepare.ts'
import type { BlendCopy } from '../cluster/blendCopyContract.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import type { DrawSource } from '../page/selection/drawSource.ts'
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'
import { animates, assignDeformationOutputs, pageDeforms, rowsAnimate } from './outputs.ts'
import { markWebgpuLost } from '../webgpu/pages/io/lost.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** Whether the content a source brings is moved by the deformation stage or written by it: a
 *  primitive measured with joints or targets, a page that asks for results (`pageDeforms`), a mesh
 *  of the source or of its rows that animates. */
export function deformsContent(
  source: DrawSource,
  primitive: Primitive,
  pages: readonly PageRec[],
) {
  return (
    !!primitive.deformation ||
    source.dynamic ||
    pages.some(pageDeforms) ||
    animates(source.node) ||
    rowsAnimate(source.rows ?? undefined)
  )
}

/**
 * The session can move what `pages` bring, the float geometries of the pages that read them placed
 * in the pool: the stage's code loaded and its compute made when the session was opened with none.
 * False where the device or the pool refuses (no room).
 */
export async function prepareDeformationGrowth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  deforms: boolean,
  pages: readonly PageRec[],
) {
  await loadDeformationCode(rt.vis, deforms)
  if (rt.signal.aborted || rt.run.lost) return false
  await prepareDeformationCompute(rt, device, deforms)
  return !!rt.vis.vertexPool && placeFloatPages(rt.vis.vertexPool, pages)
}

/**
 * The records of the roots `added` and of the blended `copies` join the session's, behind the
 * others'; `firstRank` is the rank of the first root in the cut.
 */
export function joinDeformation(
  rt: WebgpuPagesRuntime,
  added: readonly ClusterRoot<PageRec>[],
  copies: readonly BlendCopy[],
  firstRank: number,
) {
  const { deformation } = rt.vis
  if (!deformation) return
  if (deformation.ranks !== firstRank) throw new Error('DEFORMATION_RANKS')
  // Each root's pages get results of their own, a row cloned from another's included.
  rt.setup.deformationBlocks.push(...assignDeformationOutputs(added))
  deformation.append(
    added,
    copies.filter((copy) => !copy.userData.pagedBlend),
  )
}

/**
 * The rows of a deformed placement are another buffer's (`rebound`, `placement/growth.ts`): the
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
 * The pool's tail drawn again for the records and for the whole copies and float-pool blocks of the
 * session's items, once these exist. Fails the device when it refuses the room: the host opens the
 * session again, as it does for any refusal of the device.
 */
export function placeDeformation(rt: WebgpuPagesRuntime) {
  const { vis } = rt
  if (!vis.extendGeometry) return
  const wholePool = vis.deformationCode?.wholeDeformationPool
  if (!vis.extendGeometry([], rt.blendState.blendGpu, wholePool))
    markWebgpuLost(rt, { reason: 'geometry-pool', message: 'GEOMETRY_POOL_DEVICE_LIMIT' })
}
