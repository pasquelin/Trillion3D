import { UPLOAD_SLICE_MS } from './backendCommon.ts';
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

/**
 * Yields to the event loop — not only to the microtask queue.
 *
 * `await cache.load(...)` only waits for an already-resolved promise when the bytes are in memory:
 * the whole loop then runs in a single task, and neither the render, nor `requestAnimationFrame`,
 * nor page events get any chance to pass. A `MessageChannel` is a real task, without the four-
 * millisecond ceiling a nested `setTimeout` eventually suffers: the waiting image goes through, and
 * the next burst resumes right after.
 */
const yieldToEventLoop = () =>
  new Promise<void>((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      done();
    };
    channel.port2.postMessage(0);
  });

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
    traceDiagnostic('residency-ensure-start', 'GPU residency check requested', () =>
      payload({
        wanted: tracking.traceSet('ensure.wanted', urls),
        loaded: loaded(),
        queueWaitMs: null,
        elapsedMs: null,
      }),
    );
    let sliceStart = performance.now();
    for (let i = 0; i < wanted.length; i++) {
      const rec = wanted[i],
        key = tracking.keyOf(rec);
      if (!tracking.wanted.has(key)) continue;
      signal?.throwIfAborted();
      if (isLost()) throw new Error('WEBGPU_LOST');
      if (!hasBytes(rec) || cache.get(rec.url)) continue;
      // Per-image budget: the burst yields as soon as its ceiling is reached. Remaining work is not
      // dropped, it resumes after the image — and a camera that moved in between is already taken
      // into account, since each turn rereads `wanted` before uploading anything.
      if (performance.now() - sliceStart >= UPLOAD_SLICE_MS) {
        await yieldToEventLoop();
        cache = getCache();
        if (isLost() || !cache) throw new Error('WEBGPU_LOST');
        sliceStart = performance.now();
      }
      try {
        await cache.load(rec.url, signal);
      } catch (error) {
        if (!String(error).includes('ALL_PAGES_PINNED')) throw error;
        // Pool full of pages the image holds: like the reference streamer, the burst stops there,
        // without dropping anything. What stays wanted displays through its resident ancestor, and
        // cut admission, which reads the same state, grows the screen error until everything fits
        // (`admitGpuCut`).
        break;
      }
      cache = getCache();
      if (isLost() || !cache) throw new Error('WEBGPU_LOST');
      if (tracking.wanted.has(key) || bootstrapKey[key]) {
        cache.pin(rec.url);
        tracking.markPinned(key);
      }
    }
    traceDiagnostic('residency-ensure-end', 'GPU residency checked', () => ({
      ...payload({
        loaded: loaded(),
        durationMs: performance.now() - started,
        elapsedMs: performance.now() - started,
      }),
      // Bounded probe of the pinned set: it has the size of the cut, not of the queue.
      pinned: tracking.traceKeys('pins', tracking.pinned),
    }));
  };
}
