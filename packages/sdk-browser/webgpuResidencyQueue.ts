import type { PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import type { WebgpuResidencySets } from './webgpuResidencySets.ts';
import { pageAddress } from './webgpuPageSlots.ts';

type Cache = ReturnType<typeof createGpuPageCache>;
type Diagnostics = ReturnType<typeof createWebgpuDiagnostics>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;
type QueueOptions = {
  tracking: Tracking;
  sets: WebgpuResidencySets;
  /** Slots the queue can ask beyond root coverage, read every cut. */
  room: () => number;
  getCache: () => Cache | undefined;
  getFrame: () => number;
  updatePins: () => void;
  ensureResident: (wanted: readonly PageRec[], frame: number, jobId: number) => Promise<void>;
  markLost: (error: unknown) => void;
  traceEnabled: boolean;
  traceDiagnostic: Diagnostics['traceDiagnostic'];
  diagnosticFailure: Diagnostics['diagnosticFailure'];
};

/** Follows the wanted set with one asynchronous uploader, and never rebuilds that set to do it. */
export function createWebgpuResidencyQueue(options: QueueOptions) {
  const { tracking, sets, getCache, getFrame, updatePins, ensureResident } = options;
  const { markLost, traceEnabled, traceDiagnostic, diagnosticFailure } = options;
  /** The pages of the wanted set, one record per key: the queue is that set, not a copy of it. */
  const items = tracking.wantedPages;
  let pending: Promise<unknown> = Promise.resolve();
  let scheduled = false,
    running = false,
    job = 0;

  const follow = () => {
    const queuedAt = performance.now(),
      jobId = ++job,
      jobFrame = getFrame();
    updatePins();
    scheduled = true;
    if (traceEnabled)
      traceDiagnostic('residency-queue', 'GPU residency queued', () => ({
        frame: jobFrame,
        jobId,
        pages: tracking.traceSet('queue', items.map(pageAddress)),
        wanted: tracking.traceKeys('wanted', tracking.wanted),
        loaded: tracking.traceSet(
          'queue.loaded',
          items.map(pageAddress).filter((address) => !!getCache()?.get(address)),
        ),
        queueDepth: items.length,
        residentPages: getCache()?.stats().residentPages ?? null,
      }));
    if (running) return;
    running = true;
    pending = Promise.resolve().then(async () => {
      const started = performance.now();
      traceDiagnostic('residency-job-start', 'GPU residency job started', () => ({
        frame: jobFrame,
        jobId,
        scope: 'async-residency-job',
        queueWaitMs: started - queuedAt,
        pages: tracking.traceSet('job', items.map(pageAddress)),
        elapsedMs: null,
        cpuWorkIncluded: true,
        gpuQueueWaitIncluded: false,
      }));
      try {
        while (scheduled) {
          scheduled = false;
          await ensureResident(items, jobFrame, jobId);
        }
      } catch (error) {
        // The withdrawal precedes the report: a host drawing on it finds nothing stale.
        if (/LOST|DISPOSED/i.test(String(error))) markLost(error);
        diagnosticFailure('coverage-upload-failed', error);
        throw error;
      } finally {
        running = false;
        traceDiagnostic('residency-job-end', 'GPU residency job finished', () => ({
          frame: jobFrame,
          jobId,
          scope: 'async-residency-job',
          durationMs: performance.now() - started,
          elapsedMs: performance.now() - queuedAt,
          // The requested set is sampled by a bounded probe, and what the cache holds of it is the count
          // it already holds: filtering the whole set walked it twice more.
          pages: tracking.traceKeys('job', tracking.wanted),
          residentPages: getCache()?.stats().residentPages ?? null,
          queueWaitMs: started - queuedAt,
          cpuWorkIncluded: true,
          gpuQueueWaitIncluded: false,
        }));
      }
    });
    void pending.catch(() => {});
  };

  return {
    items,
    /**
     * The cut has already applied its delta; only the page budget remains to be enforced. `limited`
     * says the requested coverage does not fit in the slots: the budget is then zero, the queue
     * empties, and the image sticks to pinned coverage. The two cut paths do not say the same thing
     * about it and each says it, with no default: the GPU cut, itself, grows its screen error until
     * coverage fits and therefore keeps loading at full budget.
     */
    queueCutResidency(limited: boolean) {
      sets.applyBudget(limited ? 0 : options.room());
      follow();
    },
    nextJobId: () => ++job,
    quietPending: () => {
      pending = pending.catch(() => {});
    },
    get pending() {
      return pending;
    },
    /** True while an upload is in flight or queued: residency can still change. */
    get busy() {
      return running || scheduled;
    },
    get job() {
      return job;
    },
  };
}
