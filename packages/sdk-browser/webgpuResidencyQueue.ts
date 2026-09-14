import type { PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import type { WebgpuResidencySets } from './webgpuResidencySets.ts';

type Cache = ReturnType<typeof createGpuPageCache>;
type Diagnostics = ReturnType<typeof createWebgpuDiagnostics>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;
type QueueOptions = {
  tracking: Tracking;
  sets: WebgpuResidencySets;
  room: number;
  getCache: () => Cache | undefined;
  getFrame: () => number;
  getShown: () => readonly PageRec[];
  updatePins: () => void;
  ensureResident: (wanted: readonly PageRec[], frame: number, jobId: number) => Promise<void>;
  markLost: () => void;
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
      traceDiagnostic('residency-queue', 'Résidence GPU mise en file', () => ({
        frame: jobFrame,
        jobId,
        pages: tracking.traceSet(
          'queue',
          items.map((page) => page.url),
        ),
        wanted: tracking.traceSet('wanted', tracking.wantedUrls()),
        loaded: tracking.traceSet(
          'queue.loaded',
          items.filter((page) => !!getCache()?.get(page.url)).map((page) => page.url),
        ),
        queueDepth: items.length,
        residentPages: getCache()?.stats().residentPages ?? null,
      }));
    if (running) return;
    running = true;
    pending = Promise.resolve().then(async () => {
      const started = performance.now();
      traceDiagnostic('residency-job-start', 'Job de résidence GPU démarré', () => ({
        frame: jobFrame,
        jobId,
        scope: 'async-residency-job',
        queueWaitMs: started - queuedAt,
        pages: tracking.traceSet(
          'job',
          items.map((page) => page.url),
        ),
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
        diagnosticFailure('coverage-upload-failed', error);
        if (/LOST|DISPOSED/i.test(String(error))) markLost();
        throw error;
      } finally {
        running = false;
        traceDiagnostic('residency-job-end', 'Job de résidence GPU terminé', () => ({
          frame: jobFrame,
          jobId,
          scope: 'async-residency-job',
          durationMs: performance.now() - started,
          elapsedMs: performance.now() - queuedAt,
          pages: tracking.traceSet('job', tracking.wantedUrls()),
          loaded: tracking.traceSet(
            'job.loaded',
            tracking.wantedUrls().filter((url) => !!getCache()?.get(url)),
          ),
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
    /** The CPU cut hands its wanted and drawn lists over whole; it owns no difference to give. */
    queueResident(wanted: readonly PageRec[]) {
      sets.refreshCpu(wanted, options.getShown());
      follow();
    },
    /** The GPU cut already applied its difference; only the page budget is left to enforce. */
    queueCutResidency(desired: readonly PageRec[], transparent: readonly PageRec[]) {
      sets.applyBudget(options.room, desired, transparent);
      follow();
    },
    nextJobId: () => ++job,
    quietPending: () => {
      pending = pending.catch(() => {});
    },
    get pending() {
      return pending;
    },
    get job() {
      return job;
    },
  };
}
