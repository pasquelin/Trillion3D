import type { PageRec } from '../../page/selection/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import type { WebgpuResidencySets } from './sets.ts';
import { pageAddress } from '../row/pageSlots.ts';
import type { GpuCut } from '../../gpu/core/selection.ts';
import type { GroupClosure } from '../../page/cut/groupClosure.ts';
import { createRequestAdmission } from './requestAdmission.ts';

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
  /** The groups the cut closes over: what the GPU cut's admission walks (`requestAdmission.ts`) and
   *  the CPU cut's ranking is refilled from. */
  closure: Pick<GroupClosure, 'closeOver' | 'forEachHeld'>;
  ensureResident: (
    wanted: readonly PageRec[],
    frame: number,
    jobId: number,
    cameraWaiting: () => boolean,
  ) => Promise<void>;
  markLost: (error: unknown) => void;
  traceEnabled: boolean;
  traceDiagnostic: Diagnostics['traceDiagnostic'];
  diagnosticFailure: Diagnostics['diagnosticFailure'];
};

/** Follows the wanted set with one asynchronous uploader, and never rebuilds that set to do it. */
export function createWebgpuResidencyQueue(options: QueueOptions) {
  const { tracking, sets, getCache, getFrame, updatePins, ensureResident } = options;
  const { markLost, traceEnabled, traceDiagnostic, diagnosticFailure } = options;
  const admitRequests = createRequestAdmission(sets, tracking, options.closure);
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
        pages: tracking.traceRecs('queue', items),
        wanted: tracking.traceKeys('wanted', tracking.wanted),
        loaded: tracking.traceRecs(
          'queue.loaded',
          items.filter((rec) => !!getCache()?.get(pageAddress(rec))),
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
        pages: tracking.traceRecs('job', items),
        elapsedMs: null,
        cpuWorkIncluded: true,
        gpuQueueWaitIncluded: false,
      }));
      try {
        while (scheduled) {
          scheduled = false;
          // The job yields its caster tier to a cut queued meanwhile, and runs again for it.
          await ensureResident(items, jobFrame, jobId, () => scheduled);
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
     * The CPU cut's: it has already applied its delta; only the page budget remains to be enforced.
     * `limited` says the requested coverage does not fit in the slots: the budget is then zero, the
     * queue empties, and the image sticks to pinned coverage.
     */
    queueCutResidency(limited: boolean) {
      sets.decideBy(true, options.closure);
      sets.applyBudget(limited ? 0 : options.room());
      follow();
    },
    /** The GPU cut's: it keeps loading at full budget, admission reading its readback's requests,
     *  coarsest first; the rest is drawn by its nearest resident ancestor. */
    queueGpuCutResidency(cut: GpuCut | null) {
      sets.decideBy(false, options.closure);
      admitRequests(options.room(), cut);
      follow();
    },
    /** Bytes of the GPU cut's admission tables (`requestAdmission.ts`). */
    get hostBytes() {
      return admitRequests.hostBytes();
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
