import { UPLOAD_SLICE_MS } from '../../backend/common.ts';
import { pageAddress } from '../row/pageSlots.ts';
import { createPageAdmission } from './admission.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts';
type Cache = ReturnType<typeof createGpuPageCache>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;
type Trace = ReturnType<typeof createWebgpuDiagnostics>['traceDiagnostic'];
type EnsureOptions = {
  getCache: () => Cache | undefined;
  tracking: Tracking;
  bootstrapKey: Uint8Array;
  signal?: AbortSignal;
  hasBytes: (page: PageRec) => boolean;
  /** The pages a page depends on (`./admission.ts`): each is resident before the page is loaded. */
  parentsOf: (page: PageRec) => readonly PageRec[];
  isLost: () => boolean;
  traceEnabled: boolean;
  traceDiagnostic: Trace;
  /** The lower tier: casters the light cuts asked for, highest priority first (`shadowTier.ts`). */
  shadowPages: () => readonly PageRec[];
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
  parentsOf,
  isLost,
  traceEnabled,
  traceDiagnostic,
  shadowPages,
}: EnsureOptions) {
  /** Every load of both tiers goes through the install order; what the image holds is pinned. */
  const admit = createPageAdmission({
    getCache,
    tracking,
    bootstrapKey,
    signal,
    isLost,
    hasBytes,
    parentsOf,
  });
  /**
   * What the camera left: the casters the light cuts want, loaded only into slots nobody holds —
   * free, or taken by a page no tier wants. They are never pinned: a camera page evicts them,
   * they never evict a camera page, and an object on screen is never coarsened for a shadow.
   * The ones already resident are moved to the far end of the eviction order first, so an
   * arrival of this tier never takes the slot of another page of it.
   */
  const loadShadowTier = async (
    lower: readonly PageRec[],
    cache: Cache,
    signal: AbortSignal | undefined,
    cameraWaiting: () => boolean,
  ) => {
    const skip = (rec: PageRec) => {
      const key = tracking.keyOf(rec);
      return tracking.wanted.has(key) || bootstrapKey[key] || !hasBytes(rec);
    };
    let held = 0;
    for (let i = 0; i < lower.length; i++)
      if (!skip(lower[i]) && cache.touch(pageAddress(lower[i]))) held++;
    let spare = cache.unpinnedSlots() - held;
    // Upload slices, as the camera's burst: each yields to the event loop and the job resumes
    // after it — unless a camera cut asked for pages meanwhile: the tier then leaves, the queue
    // serves the camera first and runs the tier again. A job only ends on a tier pass nobody
    // interrupted, so every wait on it finds the tier posted (#281).
    let sliceStart = performance.now();
    for (let i = 0; i < lower.length && spare > 0; i++) {
      if (performance.now() - sliceStart >= UPLOAD_SLICE_MS) {
        await yieldToEventLoop();
        if (cameraWaiting()) return;
        sliceStart = performance.now();
      }
      const rec = lower[i],
        address = pageAddress(rec);
      if (skip(rec) || cache.get(address)) continue;
      signal?.throwIfAborted();
      if (isLost() || getCache() !== cache) return;
      try {
        spare -= Math.max(0, await admit(rec));
      } catch (error) {
        // The camera's own burst took the last slot meanwhile: the tier waits, as it does.
        if (String(error).includes('ALL_PAGES_PINNED')) return;
        throw error;
      }
    }
  };
  /**
   * `cameraWaiting` says a camera cut is queued behind this job: the queue passes it, so the
   * caster tier gives way to the camera. A barrier passes none and loads the whole tier.
   */
  return async (
    wanted: readonly PageRec[],
    jobFrame: number,
    jobId: number,
    cameraWaiting: () => boolean = () => false,
  ) => {
    let cache = getCache();
    if (!cache) return;
    const started = performance.now(),
      urls = traceEnabled ? wanted.map(pageAddress) : [];
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
    let sliceStart = performance.now(),
      full = false;
    for (let i = 0; i < wanted.length; i++) {
      const rec = wanted[i],
        key = tracking.keyOf(rec),
        address = pageAddress(rec);
      if (!tracking.wanted.has(key)) continue;
      signal?.throwIfAborted();
      if (isLost()) throw new Error('WEBGPU_LOST');
      if (!hasBytes(rec) || cache.get(address)) continue;
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
        await admit(rec);
      } catch (error) {
        if (!String(error).includes('ALL_PAGES_PINNED')) throw error;
        // Pool full of pages the image holds: like the reference streamer, the burst stops there,
        // without dropping anything. What stays wanted displays through its resident ancestor; cut
        // admission (`admitGpuCut`) only reports that the image asks for more than the slots hold.
        full = true;
        break;
      }
      cache = getCache();
      if (isLost() || !cache) throw new Error('WEBGPU_LOST');
    }
    // A copy: the tier's list is rewritten in place by every report taken while this one loads,
    // and a loop resumed on another list keeps neither its order nor its count of free slots.
    const lower = full ? [] : shadowPages();
    if (lower.length) await loadShadowTier(lower.slice(), cache, signal, cameraWaiting);
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
