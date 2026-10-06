import type { HostAttribute } from '../../../packages/sdk-browser/src/host/resources.ts'
import {
  acceptPageArray,
  collectPendingUrls,
  RequestStamps,
  type ClusterRoot,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts'
import type { WitnessPage as PageRec } from './pose.ts'
import {
  applyArrivalPlan,
  createArrivalSpecs,
} from '../../../packages/sdk-browser/src/page/integration/arrivalSpecs.ts'
import type { ArrivalPlan } from '../../../packages/sdk-browser/src/page/integration/host.ts'
import { ClusterBatches } from './batches/batches.ts'
import { createAutonomousRequests } from '../../../packages/sdk-browser/src/backend/autonomous/requests.ts'
import type { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts'

export type ExactPagesRequestContext = {
  bootstrap: PageRec[]
  missingRoots: PageRec[]
  pendingScratch: string[]
  requestStamps: RequestStamps
  desired: PageRec[]
  /** The packed rank of each desired record, rank by rank. */
  desiredPacked: number[]
  shown: PageRec[]
  /** The packed rank of each shown record, rank by rank. */
  shownPacked: number[]
  roots: ReadonlyArray<ClusterRoot<PageRec>>
  urlScratch: string[]
  bundled: boolean
  batches: ClusterBatches
  byUrl: Map<string, PageRec[]>
  indexByUrl: Map<string, HostAttribute>
  disposeGeometry(geometry: Geometry): void
  readonly frame: number
  urlStamp: number
  /** Notified when page bytes arrive or leave: that is a resource write. */
  resourcesChanged: () => void
}

export function createExactPagesRequests(ctx: ExactPagesRequestContext) {
  const {
    bootstrap,
    missingRoots,
    pendingScratch,
    requestStamps,
    desiredPacked,
    shown,
    shownPacked,
    roots,
    urlScratch,
    bundled,
    batches,
    byUrl,
    indexByUrl,
    disposeGeometry,
    resourcesChanged,
  } = ctx
  // The WebGL cut's page rank lives in batches, not in a page table: the record therefore
  // only carries the position of each entry in the bundle and its size.
  const pageSpecs = createArrivalSpecs(byUrl, () => undefined)
  // The witness asks for and keeps the cut closed over its groups, as the engine does
  // (`page/cut/groupClosure.ts`): the rule draws a group only once all of it is resident.
  const closed: PageRec[] = [],
    requests = createAutonomousRequests(roots, () => 0)
  let closedAt = -1
  const closedCut = () => {
    if (closedAt !== ctx.frame)
      requests.of(desiredPacked.length ? desiredPacked : shownPacked, closed)
    closedAt = ctx.frame
    return closed
  }
  return {
    pageSpecs,
    pendingUrls() {
      // The root cover is requested first and never dropped: it is what the cut falls back on.
      missingRoots.length = 0
      for (let i = 0; i < bootstrap.length; i++)
        if (!bootstrap[i].array) missingRoots.push(bootstrap[i])
      if (missingRoots.length)
        return collectPendingUrls(missingRoots, pendingScratch, requestStamps)
      // Then the closed cut in its own order, as the engine's hosts ask (`webgpu/pages/io/hostLists.ts`).
      return collectPendingUrls(closedCut(), pendingScratch, requestStamps)
    },
    pageUrls() {
      urlScratch.length = 0
      // A streaming bundle is shared between primitives and instances, so the per-primitive stamp table
      // of the batches cannot deduplicate it. One stamp per request rank does it without a hash
      // table or allocation, on a cut that counts thousands of pages every frame.
      if (bundled) {
        requestStamps.begin()
        requestStamps.mark(bootstrap, urlScratch)
        requestStamps.mark(shown, urlScratch)
        requestStamps.mark(closedCut(), urlScratch)
        return urlScratch
      }
      ctx.urlStamp++
      batches.markUrls(bootstrap, ctx.urlStamp, urlScratch)
      batches.markUrls(shown, ctx.urlStamp, urlScratch)
      batches.markUrls(closedCut(), ctx.urlStamp, urlScratch)
      return urlScratch
    },
    // One request carries a whole bundle: every record it holds takes the view at its own offset, and
    // each of those views is what the batch writes into the primitive's index buffer.
    acceptPage(url: string, array: Uint32Array, plan?: ArrivalPlan) {
      const recs = byUrl.get(url)
      if (!recs) return
      // Packet views come from the plan computed off-thread; without a plan, the same compute
      // is redone inline, to the same result. Batches then write only the ranges thus named.
      if (!applyArrivalPlan(recs, array, plan)) acceptPageArray(recs, array)
      batches.acceptPage(recs, array)
      resourcesChanged()
    },
    dropPage(url: string) {
      const recs = byUrl.get(url)
      if (!recs) return
      resourcesChanged()
      batches.dropPage(recs)
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i]
        indexByUrl.delete(rec.url)
        rec.array = undefined
        rec.indexBytes = rec.triangles * 12
        if (rec.geometry) {
          disposeGeometry(rec.geometry)
          rec.geometry = undefined
        }
        rec.mesh = undefined
      }
    },
  }
}
