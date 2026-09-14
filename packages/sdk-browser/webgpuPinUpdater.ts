import type { PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';
import type { WebgpuResidencySets } from './webgpuResidencySets.ts';
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
  requestUrlByPage: Map<string, string> | undefined;
  traceEnabled: boolean;
  traceDiagnostic: Trace;
}) {
  const { tracking, sets, bootstrapUrls, deferredDrops, requestUrlByPage } = options;
  const { traceEnabled, traceDiagnostic } = options;
  /** Kept keys the cache cannot pin yet: their bytes have not arrived. */
  const waiting = createDenseKeySet(tracking.keyCount);
  const pinsBefore = new Set<string>();
  return (
    cache: Cache | undefined,
    shown: PageRec[],
    frame: number,
    drop: (key: string) => void,
  ) => {
    if (!cache) return;
    // `added`/`removed` only feed the trace record, so the copy that computes them is taken only then.
    if (traceEnabled) {
      pinsBefore.clear();
      for (const url of tracking.pinnedUrls()) pinsBefore.add(url);
    }
    const { entering, leaving } = sets;
    for (let i = leaving.count - 1; i >= 0; i--) {
      const key = leaving.list[i];
      waiting.remove(key);
      if (!tracking.pinned.remove(key)) continue;
      cache.unpin(tracking.pageCatalog[key]);
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
      }
      waiting.remove(key);
    }
    if (deferredDrops.size) {
      // The kept keys are clusters; a deferred drop names the request that carries them.
      const keepUrls = new Set<string>();
      for (let i = 0; i < tracking.keep.count; i++)
        keepUrls.add(tracking.pageCatalog[tracking.keep.list[i]]);
      const keepRequests = requestUrlByPage
        ? new Set([...keepUrls].map((url) => requestUrlByPage.get(url) ?? url))
        : keepUrls;
      for (const key of deferredDrops) if (!keepRequests.has(key)) drop(key);
    }
    if (!traceEnabled) return;
    const pinned = tracking.pinnedUrls(),
      pinnedSet = new Set(pinned);
    const added = pinned.filter((url) => !pinsBefore.has(url)),
      removed = [...pinsBefore].filter((url) => !pinnedSet.has(url));
    if (added.length || removed.length)
      traceDiagnostic('residency-pins', 'Pins GPU mis à jour', () => ({
        frame,
        added: tracking.traceSet('pins.added', added),
        removed: tracking.traceSet('pins.removed', removed),
        pinned: tracking.traceSet('pins', pinned),
        bootstrap: tracking.traceSet('pins.bootstrap', [...bootstrapUrls]),
        wanted: tracking.traceSet('pins.wanted', tracking.wantedUrls()),
        shown: tracking.traceSet(
          'pins.shown',
          shown.map((page) => page.url),
        ),
      }));
  };
}
