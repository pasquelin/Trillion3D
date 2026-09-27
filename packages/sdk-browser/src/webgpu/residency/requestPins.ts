import type { PageRec } from '../../page/selection/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import type { WebgpuResidencySets } from './sets.ts';

type Cache = Pick<ReturnType<typeof createGpuPageCache>, 'get' | 'pin' | 'unpin'>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/**
 * Settles the host's deferred page drops: a request whose clusters the image no longer `holds` is
 * dropped. The question is asked request by request — a handful — through the catalogue's list of
 * the clusters each carries, never by copying the held set.
 */
export function settleDeferredDrops(
  deferredDrops: Set<string>,
  byUrl: Map<string, PageRec[]>,
  holds: (rec: PageRec) => boolean,
  drop: (key: string) => void,
) {
  for (const key of deferredDrops) {
    const recs = byUrl.get(key);
    let kept = false;
    if (recs) for (let i = 0; i < recs.length && !kept; i++) kept = holds(recs[i]);
    if (!kept) drop(key);
  }
}

/**
 * The GPU cut's pin step (#836): the pool keeps pinned the root cover and what the image admitted
 * (`requestAdmission.ts`), and nothing else. A page that leaves the upload queue is unpinned at
 * once: the cache then reclaims it in the order the GPU cut published (`evictionFeed.ts`), which
 * never lists a page the latest cut read and lists children before their parents (#477). A queued
 * page is pinned when its bytes arrive (`admission.ts`), or here when it was already resident.
 *
 * It reads the queue's difference (`pinFeed.ts`), never the queue. Taking over from the CPU cut's
 * step (`resync`), it sets the pins to the queue once: that step also pinned what the image drew
 * and what waited out its window.
 */
export function createRequestPins(options: {
  tracking: Tracking;
  sets: WebgpuResidencySets;
  bootstrapKey: Uint8Array;
  deferredDrops: Set<string>;
  byUrl: Map<string, PageRec[]>;
}) {
  const { tracking, sets, bootstrapKey, deferredDrops, byUrl } = options;
  const { pinned, wanted, pageCatalog } = tracking;
  const { joined, left } = sets.wantedChanges;
  let cache: Cache;
  const pin = (key: number) => {
    const url = pageCatalog[key];
    if (pinned.has(key) || !cache.get(url)) return;
    cache.pin(url);
    tracking.markPinned(key);
  };
  const unpin = (key: number) => {
    if (bootstrapKey[key] || wanted.has(key) || !pinned.remove(key)) return;
    cache.unpin(pageCatalog[key]);
  };
  const holds = (rec: PageRec) => tracking.keep.has(tracking.keyOf(rec));
  return (current: Cache | undefined, resync: boolean, drop: (key: string) => void) => {
    if (!current) return;
    cache = current;
    if (resync) {
      for (let i = pinned.count - 1; i >= 0; i--) unpin(pinned.list[i]);
      for (let i = 0; i < wanted.count; i++) pin(wanted.list[i]);
    } else {
      for (let i = 0; i < left.count; i++) unpin(left.list[i]);
      for (let i = 0; i < joined.count; i++) pin(joined.list[i]);
    }
    joined.clear();
    left.clear();
    // A host drop unpins behind this step's back: a key still queued is pinned again.
    const notices = tracking.unpinned;
    for (let i = 0; i < notices.length; i++) if (wanted.has(notices[i])) pin(notices[i]);
    notices.length = 0;
    settleDeferredDrops(deferredDrops, byUrl, holds, drop);
  };
}
