import type { PageRec } from '../../page/selection/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createDenseKeySet } from '../cut/denseKeys.ts';
import type { WebgpuResidencySets } from './sets.ts';
type Cache = ReturnType<typeof createGpuPageCache>;
type Trace = ReturnType<typeof createWebgpuDiagnostics>['traceDiagnostic'];
type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/**
 * Keeps the complete root cover and current cut pinned while admitting new detail.
 *
 * The kept set changed by a difference, so the pins follow that difference: the keys that left are
 * unpinned, the keys that joined are pinned as soon as the cache holds their bytes, and `waiting`
 * carries the ones still in flight to the next image. Nothing walks the pinned set per image.
 */
export function createWebgpuPinUpdater(options: {
  tracking: Tracking;
  sets: WebgpuResidencySets;
  bootstrapUrls: Set<string>;
  deferredDrops: Set<string>;
  /** Clusters each request carries: a deferred drop names the request, not the cluster. */
  byUrl: Map<string, PageRec[]>;
  traceEnabled: boolean;
  traceDiagnostic: Trace;
}) {
  const { tracking, sets, bootstrapUrls, deferredDrops, byUrl } = options;
  const { traceEnabled, traceDiagnostic } = options;
  /** Kept keys the cache cannot pin yet: their bytes have not arrived. */
  const waiting = createDenseKeySet(tracking.keyCount);
  /**
   * What the pin sample publishes: the image's DELTA, never the pinned set. Copying and filtering
   * it cost four walks of the cut per image as soon as trace was requested, while pins change by a
   * handful of keys.
   */
  const added: string[] = [],
    removed: string[] = [];
  return (
    cache: Cache | undefined,
    shown: PageRec[],
    frame: number,
    drop: (key: string) => void,
  ) => {
    if (!cache) return;
    added.length = 0;
    removed.length = 0;
    const { entering, leaving } = sets;
    for (let i = leaving.count - 1; i >= 0; i--) {
      const key = leaving.list[i];
      waiting.remove(key);
      if (!tracking.pinned.remove(key)) continue;
      const url = tracking.pageCatalog[key];
      if (traceEnabled) removed.push(url);
      cache.unpin(url);
    }
    leaving.clear();
    for (let i = entering.count - 1; i >= 0; i--) {
      const key = entering.list[i];
      if (!tracking.pinned.has(key)) waiting.add(key);
    }
    entering.clear();
    // A host page drop unpins behind this path's back; a key it still keeps goes back in the queue.
    const notices = tracking.unpinned;
    for (let i = 0; i < notices.length; i++) {
      const key = notices[i];
      if (tracking.keep.has(key) && !tracking.pinned.has(key)) waiting.add(key);
    }
    notices.length = 0;
    // Residency is asked of the cache only for a key that is not pinned yet, which is a handful per
    // image once the cut has settled instead of one lookup per kept key.
    for (let i = waiting.count - 1; i >= 0; i--) {
      const key = waiting.list[i];
      if (!tracking.pinned.has(key)) {
        const url = tracking.pageCatalog[key];
        if (!cache.get(url)) continue;
        cache.pin(url);
        tracking.markPinned(key);
        if (traceEnabled) added.push(url);
      }
      waiting.remove(key);
    }
    // Kept keys are clusters; a deferred drop names the request that carries them. The question is
    // therefore asked request by request — a handful — and not by copying the kept set into two
    // string tables on every image where a drop waits, which the cluster count of a city makes
    // impractical: the catalogue already says which clusters a request carries.
    for (const key of deferredDrops) {
      const recs = byUrl.get(key);
      let kept = false;
      if (recs)
        for (let i = 0; i < recs.length && !kept; i++)
          kept = tracking.keep.has(tracking.keyOf(recs[i]));
      if (!kept) drop(key);
    }
    if (!traceEnabled || (!added.length && !removed.length)) return;
    traceDiagnostic('residency-pins', 'GPU pins updated', () => ({
      frame,
      added: tracking.traceSet('pins.added', added),
      removed: tracking.traceSet('pins.removed', removed),
      pinned: tracking.traceKeys('pins', tracking.pinned),
      bootstrap: tracking.traceSet('pins.bootstrap', [...bootstrapUrls]),
      wanted: tracking.traceKeys('pins.wanted', tracking.wanted),
      shown: tracking.traceRecs('pins.shown', shown),
    }));
  };
}
