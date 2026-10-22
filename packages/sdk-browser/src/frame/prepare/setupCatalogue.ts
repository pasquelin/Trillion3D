import type { MatrixElements } from '../../session/host/matrixElements.ts'
import type { BlendCopy } from '../../geometry/cluster/blendCopyContract.ts'
import { createBlendCopyRecord } from '../../geometry/cluster/blendCopyRecord.ts'
import type { EngineContext } from '../../session/engine/types.ts'
import { createWebgpuPageTracking } from '../../geometry/rows/page/pageTracking.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { distanceFieldMeshes } from '../../lighting/distanceField/fieldsLoad.ts'
import { indexPagesByUrl } from '../../geometry/selection/requests.ts'
import type { WebgpuDiagnostics } from './setup.ts'
import { withWorldRoot } from './worldRoot.ts'
import { rootCoverOf } from './rootCover.ts'
import { rootBlends } from '../../geometry/selection/collectBlend.ts'

/** The catalogue's pages, its blended copies — one per blended root —, its request index and its
 *  root cover. */
export function setupPages(context: EngineContext, diag: WebgpuDiagnostics) {
  const { source, draws, metadata, indices } = context
  // The world DAG beside the scene's pages as the cut's last root, when the scene streams one
  // (`../../geometry/hlod/worldRecords.ts`).
  const scene = collectClusterPages(source, draws, metadata, indices, {
    allowMissing: true,
    distanceFieldMeshes: distanceFieldMeshes(context.distanceFields),
  })
  const collected = withWorldRoot(scene, context)
  const { roots, allPages, requests } = collected
  const pagedBlendCopies = new Map<MatrixElements, BlendCopy[]>()
  const blendCopies = pagedBlendCopiesOf(roots, pagedBlendCopies).sort(byRenderOrder)
  // Request rank → address, posted once for the scene's life: the delta the host receives after the
  // render carries only integers, and it is this table that translates them.
  const requestUrls = [...requests.keys()]
  const tracking = createWebgpuPageTracking(allPages)
  diag.traceDiagnostic('page-catalog', 'Stable WebGPU page catalogue', {
    count: tracking.pageCatalog.length,
    urls: tracking.pageCatalog,
  })
  return {
    ...collected,
    blendCopies,
    pagedBlendCopies,
    requestUrls,
    tracking,
    ...rootCoverOf(roots, tracking),
  }
}

/** Draw order of the forward copies: their source's rank. */
export const byRenderOrder = (a: BlendCopy, b: BlendCopy) => a.renderOrder - b.renderOrder

/** Transparent pages share selection/residency with opaque pages, but retain one forward draw
 *  per placement (all back faces, then all front faces), keyed by the world of the root that
 *  places its pages: the source mesh's own, or one row of its instance buffer — one per blended
 *  surface of a root mixing them (`rootBlends`, the world DAG's sections). The copies of `roots`
 *  not made yet — `held` names those that are, by world — are returned and held. */
export function pagedBlendCopiesOf(
  roots: SetupPages['roots'],
  held: Map<MatrixElements, BlendCopy[]>,
) {
  const made: BlendCopy[] = []
  for (const root of roots) {
    const { world, placement, pages } = root
    if (!rootBlends(root) || held.has(world)) continue
    const copies: BlendCopy[] = []
    // Each blended surface's first page stands for its copy: a blended root has one.
    for (const rec of pages) {
      if (!rec.transparent || copies.some((copy) => copy.surface === rec.material)) continue
      const copy = createBlendCopyRecord(
        rec.drawSource,
        rec.renderOrder,
        world,
        rec.material,
        placement,
      )
      // The compiler writes a geometry page for every cluster of a primitive, or for none.
      copy.userData.pageFlags = rec.geometryPage?.flags
      // The box its pages lie in at rest: the frustum and the water rectangle read it in place of
      // the source geometry's, which no coarse or quantized page keeps to. A deforming root's pages
      // leave it.
      if (!root.deformation) copy.userData.localBox = root.localBox
      copies.push(copy)
      if (!root.mixed) break
    }
    held.set(world, copies)
    made.push(...copies)
  }
  return made
}

type SetupPages = ReturnType<typeof collectClusterPages>

/** The setup's fields of the catalogue's tracking, root cover and root pages. */
export function bootstrapFields(pages: ReturnType<typeof setupPages>) {
  const { tracking, bootstrap, coverUrls, rootUrls, bootstrapKey, requests } = pages
  // `byUrl` is indexed by REQUEST key: the streaming bundle when the cache publishes one, the cluster
  // object otherwise. One request therefore hands bytes to every cluster that shares it. The GPU page
  // cache stays keyed by pool address (`pageAddress`), the granularity it uploads and pins.
  const byUrl = indexPagesByUrl(pages.allPages)
  return { tracking, bootstrap, coverUrls, rootUrls, bootstrapKey, byUrl, requests }
}
