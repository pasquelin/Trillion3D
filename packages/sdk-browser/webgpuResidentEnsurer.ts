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
    const loaded = () =>
      tracking.traceSet(
        'ensure.loaded',
        urls.filter((url) => !!cache!.get(url)),
      );
    const payload = <T extends object>(extra: T) => ({
      frame: jobFrame,
      jobId,
      scope: 'async-residency-ensure',
      pages: tracking.traceSet('ensure', urls),
      ...extra,
      cpuWorkIncluded: true,
      gpuQueueWaitIncluded: false,
    });
    traceDiagnostic('residency-ensure-start', 'Vérification de la résidence GPU demandée', () =>
      payload({
        wanted: tracking.traceSet('ensure.wanted', urls),
        loaded: loaded(),
        queueWaitMs: null,
        elapsedMs: null,
      }),
    );
    for (let i = 0; i < wanted.length; i++) {
      const rec = wanted[i],
        key = tracking.keyOf(rec);
      if (!tracking.wanted.has(key)) continue;
      signal?.throwIfAborted();
      if (isLost()) throw new Error('WEBGPU_LOST');
      if (!hasBytes(rec) || cache.get(rec.url)) continue;
      try {
        await cache.load(rec.url, signal);
      } catch (error) {
        if (!tracking.wanted.has(key) && String(error).includes('ALL_PAGES_PINNED')) continue;
        throw error;
      }
      cache = getCache();
      if (isLost() || !cache) throw new Error('WEBGPU_LOST');
      if (tracking.wanted.has(key) || bootstrapKey[key]) {
        cache.pin(rec.url);
        tracking.markPinned(key);
      }
    }
    traceDiagnostic('residency-ensure-end', 'Résidence GPU vérifiée', () => ({
      ...payload({
        loaded: loaded(),
        durationMs: performance.now() - started,
        elapsedMs: performance.now() - started,
      }),
      pinned: tracking.traceSet('pins', tracking.pinnedUrls()),
    }));
  };
}
