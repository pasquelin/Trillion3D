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
  /** Les clusters que porte chaque requête : un abandon différé nomme la requête, pas le cluster. */
  byUrl: Map<string, PageRec[]>;
  traceEnabled: boolean;
  traceDiagnostic: Trace;
}) {
  const { tracking, sets, bootstrapUrls, deferredDrops, byUrl } = options;
  const { traceEnabled, traceDiagnostic } = options;
  /** Kept keys the cache cannot pin yet: their bytes have not arrived. */
  const waiting = createDenseKeySet(tracking.keyCount);
  /**
   * Ce que le relevé des pins publie : la DIFFÉRENCE de l'image, jamais l'ensemble pinné. Le
   * recopier et le filtrer coûtait quatre parcours de la coupe par image dès que la trace était
   * demandée, alors que les pins changent d'une poignée de clés.
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
    // Les clés gardées sont des clusters, un abandon différé nomme la requête qui les porte. La
    // question se pose donc requête par requête — une poignée — et non en recopiant l'ensemble gardé
    // dans deux tables de chaînes à chaque image où un abandon attend, ce que le nombre de clusters
    // d'une ville rend impraticable : le catalogue dit déjà quels clusters une requête porte.
    for (const key of deferredDrops) {
      const recs = byUrl.get(key);
      let kept = false;
      if (recs)
        for (let i = 0; i < recs.length && !kept; i++)
          kept = tracking.keep.has(tracking.keyOf(recs[i]));
      if (!kept) drop(key);
    }
    if (!traceEnabled || (!added.length && !removed.length)) return;
    traceDiagnostic('residency-pins', 'Pins GPU mis à jour', () => ({
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
