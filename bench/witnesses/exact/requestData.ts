import {
  indexPagesByUrl,
  RequestStamps,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { WitnessPage as PageRec } from './pose.ts';

/** The scratch tables the request walk reuses from one frame to the next: by URL, the pending and
 *  url lists, the request stamps, the prefetch lists and the pixel scale. Built once per scene. */
export function createExactPagesRequestData(allPages: PageRec[], requestCount: number) {
  const byUrl = indexPagesByUrl(allPages);
  const pendingScratch: string[] = [],
    urlScratch: string[] = [],
    missingRoots: PageRec[] = [];
  const bundled = allPages.some((rec) => rec.streamUrl !== undefined);
  const requestStamps = new RequestStamps(requestCount);
  const prefetchScratch: string[] = [],
    prefetchShown: PageRec[] = [];
  const pixelScaleScratch: number[] = [1, 1];
  return {
    byUrl,
    pendingScratch,
    urlScratch,
    missingRoots,
    bundled,
    requestStamps,
    prefetchScratch,
    prefetchShown,
    pixelScaleScratch,
  };
}
