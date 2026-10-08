import type { MatrixElements } from '../../../host/matrixElements.ts'
import type { BlendCopy } from '../../../cluster/blendCopyContract.ts'
import { createBlendCopyRecord } from '../../../cluster/blendCopyRecord.ts'
import type { EngineContext } from '../../../engine/types.ts'
import { createWebgpuPageTracking } from '../../row/pageTracking.ts'
import { collectClusterPages, indexPagesByUrl } from '../../../page/selection/selection.ts'
import type { WebgpuDiagnostics } from './setup.ts'
import { withWorldRoot } from './worldRoot.ts'
import { rootCoverOf } from './rootCover.ts'

/** The catalogue's pages, its blended copies, its request index and its root cover. */
export function setupPages(context: EngineContext, diag: WebgpuDiagnostics) {
  const { source, metadata, indices, associations } = context
  // The world DAG beside the scene's pages as the cut's last root, when the scene streams one
  // (`../../../scene/worldRecords.ts`).
  const collected = withWorldRoot(
    collectClusterPages(source, metadata, indices, associations, { allowMissing: true }),
    context,
  )
  const { roots, allPages, blendCopies, requestCount } = collected
  const sharedBlendMeshes = blendCopies.length
  const pagedBlendCopies = pagedBlendCopiesOf(roots, blendCopies)
  // Request rank → address, posted once for the scene's life: the delta the host receives after the
  // render carries only integers, and it is this table that translates them.
  const requestUrls: string[] = new Array<string>(requestCount)
  for (const { requestIndex: rank, streamUrl, url } of allPages)
    if (rank !== undefined && rank >= 0 && rank < requestCount) requestUrls[rank] = streamUrl ?? url
  const tracking = createWebgpuPageTracking(allPages)
  diag.traceDiagnostic('page-catalog', 'Stable WebGPU page catalogue', {
    count: tracking.pageCatalog.length,
    urls: tracking.pageCatalog,
  })
  return {
    ...collected,
    sharedBlendMeshes,
    pagedBlendCopies,
    requestUrls,
    tracking,
    ...rootCoverOf(roots, tracking),
  }
}

/** Transparent pages share selection/residency with opaque pages, but retain one forward draw
 *  per placement (all back faces, then all front faces), keyed by the world of the root that
 *  places its pages: the source mesh's own, or one row of its instance buffer. */
function pagedBlendCopiesOf(roots: SetupPages['roots'], blendCopies: BlendCopy[]) {
  const pagedBlendCopies = new Map<MatrixElements, BlendCopy>()
  for (const { world, placement, pages } of roots) {
    const rec = pages[0]
    if (!rec?.transparent || !rec.sourceMesh || pagedBlendCopies.has(world)) continue
    const copy = createBlendCopyRecord(
      rec.sourceMesh,
      rec.renderOrder,
      world,
      rec.material,
      placement,
    )
    copy.userData.pagedBlend = true
    // The compiler writes a geometry page for every cluster of a primitive, or for none.
    copy.userData.pageGeometry = !!rec.geometryPage
    pagedBlendCopies.set(world, copy)
    blendCopies.push(copy)
  }
  blendCopies.sort((a, b) => a.renderOrder - b.renderOrder)
  return pagedBlendCopies
}

type SetupPages = ReturnType<typeof collectClusterPages>

/** The setup's fields of the catalogue's tracking and root cover. */
export function bootstrapFields(pages: ReturnType<typeof setupPages>) {
  const { tracking, bootstrap, bootstrapUrls, bootstrapKey, floorPages } = pages
  // `byUrl` is indexed by REQUEST key: the streaming bundle when the cache publishes one, the cluster
  // object otherwise. One request therefore hands bytes to every cluster that shares it. The GPU page
  // cache stays keyed by pool address (`pageAddress`), the granularity it uploads and pins.
  const byUrl = indexPagesByUrl(pages.allPages)
  return { tracking, bootstrap, bootstrapUrls, bootstrapKey, floorPages, byUrl }
}
