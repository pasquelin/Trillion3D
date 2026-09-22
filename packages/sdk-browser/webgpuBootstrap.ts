import { pageRequestUrl, type PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';

type Cache = ReturnType<typeof createGpuPageCache>;
type Diagnostics = ReturnType<typeof createWebgpuDiagnostics>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;
type BootstrapOptions = {
  pages: PageRec[];
  urls: Set<string>;
  slots: number;
  tracking: Tracking;
  signal?: AbortSignal;
  readPage?: (url: string) => Promise<Uint32Array>;
  acceptPage: (url: string, data: Uint32Array) => void;
  getCache: () => Cache | undefined;
  getFrame: () => number;
  isLost: () => boolean;
  hasBytes: (page: PageRec) => boolean;
  engineDiagnostic: Diagnostics['engineDiagnostic'];
  traceDiagnostic: Diagnostics['traceDiagnostic'];
  diagnosticFailure: Diagnostics['diagnosticFailure'];
};

/** Pins the complete fallback cover before the first WebGPU image is rendered. */
export function createWebgpuBootstrap(options: BootstrapOptions) {
  const {
    pages,
    urls,
    slots,
    tracking,
    signal,
    readPage,
    acceptPage,
    getCache,
    getFrame,
    isLost,
    hasBytes,
    engineDiagnostic,
    traceDiagnostic,
    diagnosticFailure,
  } = options;
  let ready = false,
    loading: Promise<void> | undefined;
  const ensure = async () => {
    if (ready) return;
    if (loading) return loading;
    if (pages.some((page) => !hasBytes(page)) && !readPage) return;
    loading = (async () => {
      const started = performance.now();
      engineDiagnostic('coverage-bootstrap-start', 'Loading the full emergency cover', {
        version: 1,
        pages: pages.length,
        slots,
      });
      traceDiagnostic('coverage-bootstrap-start', 'Loading the full emergency cover', () => ({
        frame: getFrame(),
        pages: pages.length,
        pageIds: tracking.pageRefs(pages.map((page) => page.url)),
        slots,
        queueWaitMs: 0,
      }));
      let next = 0;
      const workers = Array.from({ length: Math.min(8, pages.length) }, async () => {
        while (next < pages.length) {
          const page = pages[next++];
          signal?.throwIfAborted();
          if (isLost()) throw new Error('WEBGPU_LOST');
          if (!hasBytes(page)) {
            const key = pageRequestUrl(page);
            const data = await readPage!(key);
            signal?.throwIfAborted();
            if (isLost()) throw new Error('WEBGPU_LOST');
            acceptPage(key, data);
          }
        }
      });
      const results = await Promise.allSettled(workers);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      // Every cover page is asked for at once, then awaited in order: a page whose bytes the cache
      // must still read starts that read immediately instead of waiting for the previous page's
      // round trip, and the cache's own queue keeps the uploads in order and bounded.
      const loads = pages.map((page) => {
        const job = getCache()!.load(page.url, signal);
        job.catch(() => {});
        return job;
      });
      for (let i = 0; i < pages.length; i++) {
        signal?.throwIfAborted();
        if (isLost()) throw new Error('WEBGPU_LOST');
        await loads[i];
        getCache()!.pin(pages[i].url);
        tracking.markPinned(tracking.keyOf(pages[i]));
      }
      ready = true;
      engineDiagnostic('coverage-bootstrap-ready', 'Full cover available on the GPU', {
        version: 1,
        pages: pages.length,
        slots,
      });
      traceDiagnostic('coverage-bootstrap-ready', 'Full cover available on the GPU', () => ({
        frame: getFrame(),
        pages: pages.length,
        bootstrap: tracking.traceSet('bootstrap', [...urls]),
        slots,
        durationMs: performance.now() - started,
        loaded: tracking.traceSet(
          'bootstrap.loaded',
          pages.map((page) => page.url),
        ),
        wanted: tracking.traceSet(
          'bootstrap.wanted',
          pages.map((page) => page.url),
        ),
      }));
    })()
      .catch((error) => {
        diagnosticFailure('coverage-bootstrap-failed', error);
        throw error;
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  };
  return {
    ensure,
    get ready() {
      return ready;
    },
  };
}
