import { STREAMING_FRAME_MS } from '../../backend/common.ts';
import { createFrameBudget, yieldToEventLoop } from '../../page/integration/frameBudget.ts';
import { pageAddress } from '../row/pageSlots.ts';
import { createPageAdmission } from './admission.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts';
type Cache = ReturnType<typeof createGpuPageCache>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;
type Trace = ReturnType<typeof createWebgpuDiagnostics>['traceDiagnostic'];
type LowerList = { pages: readonly PageRec[]; has: (key: number) => boolean };
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
  /** The lower tiers, served in this order after the camera's: the casters the light cuts asked
   *  for, then the pages ahead of the camera, each highest priority first and without repeats,
   *  with the keys it names (`lowerTier.ts`). */
  lowerTiers: () => readonly LowerList[];
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
}: EnsureOptions) {
  /** The published share of the main thread (`STREAMING_FRAME_MS`): past it, a job yields a task
   *  and starts a new share — a due frame goes through, and the job resumes without waiting for
   *  one, so a hidden tab loads too. True when it yielded. */
  const budget = createFrameBudget(STREAMING_FRAME_MS);
  const pace = async () => {
    if (budget.admits()) return false;
    await yieldToEventLoop();
    budget.open();
    return true;
  };
  /** One job's lower tiers in order, each page once: a page an earlier tier names — a caster also
   *  ahead of the camera — is counted and loaded once. A copy: a tier's list is rewritten in place
   *  by every report taken while this job loads, and a loop resumed on another list keeps neither
   *  its order nor its count of free slots. */
  const lowerList = () => {
    const tiers = lowerTiers(),
      list: PageRec[] = [];
    for (let t = 0; t < tiers.length; t++)
      for (const rec of tiers[t].pages) {
        const key = tracking.keyOf(rec);
        let named = false;
        for (let earlier = 0; earlier < t && !named; earlier++) named = tiers[earlier].has(key);
        if (!named) list.push(rec);
      }
    return list;
  };
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
   * never coarsened for a shadow or for a view to come. The ones already resident are moved to the
   * far end of the eviction order first, so an arrival of these tiers never takes the slot of
   * another page of them.
   */
  const loadLowerTiers = async (
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
    // The share, as the camera's burst: past it the job yields — and leaves if a camera cut asked
    // for pages meanwhile: the queue serves the camera first and runs the tiers again. A job only
    // ends on a tier pass nobody interrupted, so every wait on it finds the tiers posted (#281).
    for (let i = 0; i < lower.length && spare > 0; i++) {
      if ((await pace()) && cameraWaiting()) return;
      const rec = lower[i],
        address = pageAddress(rec);
      if (skip(rec) || cache.get(address)) continue;
      signal?.throwIfAborted();
      if (isLost() || getCache() !== cache) return;
      try {
        spare -= Math.max(0, await admit(rec));
        budget.spend();
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
    let full = false;
    budget.open();
    for (let i = 0; i < wanted.length; i++) {
      const rec = wanted[i],
        key = tracking.keyOf(rec),
        address = pageAddress(rec);
      if (!tracking.wanted.has(key)) continue;
      signal?.throwIfAborted();
      if (isLost()) throw new Error('WEBGPU_LOST');
      if (!hasBytes(rec) || cache.get(address)) continue;
      // The share: past it the burst resumes after a task, nothing dropped — and a camera that
      // moved in between is already taken into account, since each turn rereads `wanted` before
      // uploading anything.
      if (await pace()) {
        cache = getCache();
        if (isLost() || !cache) throw new Error('WEBGPU_LOST');
      }
      try {
        await admit(rec);
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
    const lower = full ? [] : lowerList();
    if (lower.length) await loadLowerTiers(lower, cache, signal, cameraWaiting);
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
