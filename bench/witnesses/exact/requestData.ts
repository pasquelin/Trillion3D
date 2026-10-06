import {
  indexPagesByUrl,
  RequestStamps,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts'
import type { WitnessPage as PageRec } from './pose.ts'

/** The scratch tables the request walk reuses from one frame to the next: by URL, the pending and
 *  url lists and the request stamps. Built once per scene. */
export function createExactPagesRequestData(allPages: PageRec[], requestCount: number) {
  const byUrl = indexPagesByUrl(allPages)
  const pendingScratch: string[] = [],
    urlScratch: string[] = [],
    missingRoots: PageRec[] = []
  const bundled = allPages.some((rec) => rec.streamUrl !== undefined)
  const requestStamps = new RequestStamps(requestCount)
  return {
    byUrl,
    pendingScratch,
    urlScratch,
    missingRoots,
    bundled,
    requestStamps,
  }
}
