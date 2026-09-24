import type { PageRec } from '../../page/selection/selection.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';

type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/**
 * Whether bytes arriving for these clusters can change the image. The answer reads only the sets
 * the residency path already carries: the bootstrap cover, what the image keeps (the upload queue
 * and what it draws), what the cache holds pinned, what the cut asks for past the page budget, and
 * the casters the light cuts asked for. A cluster in none of them is neither drawn, nor queued, nor
 * waited for, nor a shadow caster: its arrival leaves the held frame alone. When in doubt, yes.
 */
export function createImageRelevance(options: {
  tracking: Tracking;
  bootstrapKey: Uint8Array;
  requests: (key: number) => boolean;
  casts: (key: number) => boolean;
}) {
  const { tracking, bootstrapKey, requests, casts } = options;
  const { keep, pinned } = tracking;
  return (recs: readonly PageRec[]) => {
    for (let i = 0; i < recs.length; i++) {
      const key = tracking.keyOf(recs[i]);
      if (bootstrapKey[key] || keep.has(key) || pinned.has(key) || requests(key) || casts(key))
        return true;
    }
    return false;
  };
}
