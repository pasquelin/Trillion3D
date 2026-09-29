import { STREAMING_FRAME_MS, STREAMING_SHARES_PER_FRAME } from '../../backend/common.ts';
import { createFrameBudget, createSharePace } from '../../page/integration/frameBudget.ts';
import { pageAddress } from '../row/pageSlots.ts';
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts';
import { createAdmissionReads, createPageAdmission } from './admission.ts';
import { createLowerMerge, type LowerList } from './lowerTier.ts';
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
  /** The lower tiers, served after the camera's: the casters the light cuts asked for, then the
   *  pages ahead of the camera, each highest priority first, without repeats (`lowerTier.ts`). */
  lowerTiers: () => readonly LowerList[];
  /** Starts a page's bytes read ahead of its admission, at PRIORITY_PREFETCH for the lower tiers. */
  prefetch?: (page: PageRec, signal: AbortSignal, priority?: number) => void;
  /** True when the camera rests at the last plan's view; absent, still. */
  still?: () => boolean;
};

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
  lowerTiers,
  prefetch,
  still = () => true,
}: EnsureOptions) {
  /** The published share of the main thread (`STREAMING_FRAME_MS`): past it a job yields a task,
   *  past `STREAMING_SHARES_PER_FRAME` of a visible page a frame, and opens a new share. */
  const budget = createFrameBudget(STREAMING_FRAME_MS);
  const nextShare = createSharePace(budget.open, STREAMING_SHARES_PER_FRAME);
  /** The reads a pass starts before its admissions, under the job's `reads`; none without `prefetch`. */
  const readAhead = prefetch && createAdmissionReads({ hasBytes, parentsOf, prefetch }),
    mergeLower = createLowerMerge(tracking.keyOf);
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
   * What the camera left: the casters the light cuts want, then the pages ahead of the camera,
   * loaded only into slots nobody holds — free, or taken by a page no tier wants. They are never
   * pinned: a camera page evicts them, they never evict a camera page, and an object on screen is
   * never coarsened for a shadow or for a view to come. At rest the tier settles on the list's
   * first pages the unpinned slots hold, never on arrivals (#1016); moving, it keeps every page
   * the list still names, so a wanted caster is never evicted and reloaded each frame.
   */
  const loadLowerTiers = async (
    lower: readonly PageRec[],
    cache: Cache,
    signal: AbortSignal | undefined,
    cameraWaiting: () => boolean,
    reads: AbortSignal,
  ) => {
    const skip = (rec: PageRec) => {
      const key = tracking.keyOf(rec);
      return tracking.wanted.has(key) || bootstrapKey[key] || !hasBytes(rec);
    };
    const slots = cache.unpinnedSlots(),
      live = still();
    let spare = slots;
    for (let i = 0, kept = 0; i < lower.length && (!live || kept < slots); i++)
      if (!skip(lower[i]) && (!live || ++kept) && cache.touch(pageAddress(lower[i]), true)) spare--;
    readAhead?.(lower, spare, (rec) => !skip(rec), cache, reads, PRIORITY_PREFETCH);
    // The share, as the camera's burst: past it the job yields — and leaves if a camera cut asked
    // for pages meanwhile: the queue serves the camera first and runs the tiers again. A job only
    // ends on a tier pass nobody interrupted, so every wait on it finds the tiers posted (#281).
    for (let i = 0; i < lower.length && spare > 0; i++) {
      if (!budget.admits()) {
        await nextShare();
        if (cameraWaiting()) return;
      }
      const rec = lower[i],
        address = pageAddress(rec);
      if (skip(rec) || cache.get(address)) continue;
      signal?.throwIfAborted();
      if (isLost() || getCache() !== cache) return;
      try {
        spare -= Math.max(0, await admit(rec, PRIORITY_PREFETCH));
        budget.spend();
      } catch (error) {
        // The camera's own burst took the last slot meanwhile: the tier waits, as it does.
        if (String(error).includes('ALL_PAGES_PINNED')) return;
        throw error;
      }
    }
  };
  /** `cameraWaiting` says a camera cut queued behind this job: the caster tier gives way to it. */
  return async (
    wanted: readonly PageRec[],
    jobFrame: number,
    jobId: number,
    cameraWaiting: () => boolean = () => false,
    landed: () => void = () => {},
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
    // The reads the job starts and no load joins — pages it does not reach — leave the queue.
    const reads = new AbortController(),
      wants = (rec: PageRec) => tracking.wanted.has(tracking.keyOf(rec));
    try {
      readAhead?.(wanted, cache.unpinnedSlots(), wants, cache, reads.signal);
      let full = false;
      for (let i = 0; i < wanted.length; i++) {
        const rec = wanted[i],
          key = tracking.keyOf(rec),
          address = pageAddress(rec);
        if (!tracking.wanted.has(key)) continue;
        signal?.throwIfAborted();
        if (isLost()) throw new Error('WEBGPU_LOST');
        if (!hasBytes(rec) || cache.get(address)) continue;
        // The share: past it the burst resumes after a task, nothing dropped — the page read again
        // against `wanted` and the pool, which a camera that moved in between may have changed.
        if (!budget.admits()) {
          await nextShare();
          cache = getCache();
          if (isLost() || !cache) throw new Error('WEBGPU_LOST');
          if (!tracking.wanted.has(key) || cache.get(address)) continue;
        }
        try {
          // A page whose parents lack their bytes is not loaded (-1): nothing to draw, no wake.
          if ((await admit(rec)) > 0) landed();
          budget.spend();
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
      const lower = full ? [] : mergeLower(lowerTiers());
      if (lower.length) await loadLowerTiers(lower, cache, signal, cameraWaiting, reads.signal);
    } finally {
      reads.abort();
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
