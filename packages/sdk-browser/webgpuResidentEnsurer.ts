import type { PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
type Cache = ReturnType<typeof createGpuPageCache>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;
type Trace = ReturnType<typeof createWebgpuDiagnostics>['traceDiagnostic'];
type EnsureOptions = {
  getCache: () => Cache | undefined;
  tracking: Tracking;
  bootstrapKey: Uint8Array;
  signal?: AbortSignal;
  hasBytes: (page: PageRec) => boolean;
  isLost: () => boolean;
  traceEnabled: boolean;
  traceDiagnostic: Trace;
};

/** Loads newly wanted pages without acting on a stale camera cut. */
export function createWebgpuResidentEnsurer({
  getCache,
  tracking,
  bootstrapKey,
  signal,
  hasBytes,
  isLost,
  traceEnabled,
  traceDiagnostic,
}: EnsureOptions) {
  return async (wanted: readonly PageRec[], jobFrame: number, jobId: number) => {
    let cache = getCache();
    if (!cache) return;
    const started = performance.now(),
      urls = traceEnabled ? wanted.map((page) => page.url) : [];
    traceDiagnostic('residency-ensure-start', 'Vérification de la résidence GPU demandée', () => ({
      frame: jobFrame,
      jobId,
      scope: 'async-residency-ensure',
      pages: tracking.traceSet('ensure', urls),
      wanted: tracking.traceSet('ensure.wanted', urls),
      loaded: tracking.traceSet(
        'ensure.loaded',
        urls.filter((url) => !!cache!.get(url)),
      ),
      queueWaitMs: null,
      elapsedMs: null,
      cpuWorkIncluded: true,
      gpuQueueWaitIncluded: false,
    }));
    for (let i = 0; i < wanted.length; i++) {
      const rec = wanted[i],
        key = tracking.keyOf(rec);
      if (tracking.wantedStamp[key] !== tracking.wantedEpoch) continue;
      signal?.throwIfAborted();
      if (isLost()) throw new Error('WEBGPU_LOST');
      if (!hasBytes(rec) || cache.get(rec.url)) continue;
      try {
        await cache.load(rec.url, signal);
      } catch (error) {
        if (
          tracking.wantedStamp[key] !== tracking.wantedEpoch &&
          String(error).includes('ALL_PAGES_PINNED')
        )
          continue;
        throw error;
      }
      cache = getCache();
      if (isLost() || !cache) throw new Error('WEBGPU_LOST');
      if (tracking.wantedStamp[key] === tracking.wantedEpoch || bootstrapKey[key]) {
        cache.pin(rec.url);
        tracking.markPinned(key);
      }
    }
    traceDiagnostic('residency-ensure-end', 'Résidence GPU vérifiée', () => ({
      frame: jobFrame,
      jobId,
      scope: 'async-residency-ensure',
      pages: tracking.traceSet('ensure', urls),
      loaded: tracking.traceSet(
        'ensure.loaded',
        urls.filter((url) => !!cache!.get(url)),
      ),
      durationMs: performance.now() - started,
      elapsedMs: performance.now() - started,
      cpuWorkIncluded: true,
      gpuQueueWaitIncluded: false,
      pinned: tracking.traceSet('pins', tracking.pinnedUrls()),
    }));
  };
}
