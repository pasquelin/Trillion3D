import type { PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';
type Cache = ReturnType<typeof createGpuPageCache>;
type Trace = ReturnType<typeof createWebgpuDiagnostics>['traceDiagnostic'];
type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/** Keeps the complete root cover and current cut pinned while admitting new detail. */
export function createWebgpuPinUpdater(
  tracking: Tracking,
  bootstrapKeys: Int32Array,
  bootstrapUrls: Set<string>,
  deferredDrops: Set<string>,
  requestUrlByPage: Map<string, string> | undefined,
  traceEnabled: boolean,
  traceDiagnostic: Trace,
) {
  const pinsBefore = new Set<string>();
  return (
    cache: Cache | undefined,
    shown: PageRec[],
    gpuFrameActive: boolean,
    frame: number,
    dropPage: (key: string) => void,
  ) => {
    if (!cache) return;
    // `added`/`removed` only feed the trace record, so the copy that computes them is taken only then.
    if (traceEnabled) {
      pinsBefore.clear();
      for (const url of tracking.pinnedUrls()) pinsBefore.add(url);
    }
    tracking.keepEpoch++;
    tracking.keepCount = 0;
    const keep = (key: number) => {
      if (tracking.keepStamp[key] !== tracking.keepEpoch) {
        tracking.keepStamp[key] = tracking.keepEpoch;
        tracking.keepList[tracking.keepCount++] = key;
      }
    };
    for (let i = 0; i < bootstrapKeys.length; i++) keep(bootstrapKeys[i]);
    for (let i = 0; i < shown.length; i++)
      if (!gpuFrameActive || shown[i].transparent) keep(tracking.keyOf(shown[i]));
    for (let i = 0; i < tracking.wantedCount; i++) keep(tracking.wantedList[i]);
    // Walking the pinned list from the top down makes a removal a swap with an entry already decided.
    for (let i = tracking.pinnedCount - 1; i >= 0; i--) {
      const key = tracking.pinnedList[i];
      if (tracking.keepStamp[key] === tracking.keepEpoch) continue;
      cache.unpin(tracking.pageCatalog[key]);
      tracking.unmarkPinned(key);
    }
    // Residency is asked of the cache only for a key that is not pinned yet, which is a handful per
    // image once the cut has settled instead of one lookup per kept key.
    for (let i = 0; i < tracking.keepCount; i++) {
      const key = tracking.keepList[i];
      if (tracking.pinnedAt[key] >= 0) continue;
      const url = tracking.pageCatalog[key];
      if (!cache.get(url)) continue;
      cache.pin(url);
      tracking.markPinned(key);
    }
    if (deferredDrops.size) {
      // The kept keys are clusters; a deferred drop names the request that carries them.
      const keepUrls = new Set<string>();
      for (let i = 0; i < tracking.keepCount; i++)
        keepUrls.add(tracking.pageCatalog[tracking.keepList[i]]);
      const keepRequests = requestUrlByPage
        ? new Set([...keepUrls].map((url) => requestUrlByPage.get(url) ?? url))
        : keepUrls;
      for (const key of deferredDrops) if (!keepRequests.has(key)) dropPage(key);
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
