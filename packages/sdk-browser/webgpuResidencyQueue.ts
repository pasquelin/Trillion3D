import type { PageRec } from './pageSelection.ts';
import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';

type Cache = ReturnType<typeof createGpuPageCache>;
type Diagnostics = ReturnType<typeof createWebgpuDiagnostics>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;
type QueueOptions = {
  tracking: Tracking;
  getCache: () => Cache | undefined;
  getFrame: () => number;
  hasBytes: (page: PageRec) => boolean;
  updatePins: () => void;
  ensureResident: (wanted: readonly PageRec[], frame: number, jobId: number) => Promise<void>;
  markLost: () => void;
  traceEnabled: boolean;
  traceDiagnostic: Diagnostics['traceDiagnostic'];
  diagnosticFailure: Diagnostics['diagnosticFailure'];
};

/** Rebuilds wanted ranks in place and lets one asynchronous uploader follow the latest cut. */
export function createWebgpuResidencyQueue(options: QueueOptions) {
  const {
    tracking,
    getCache,
    getFrame,
    hasBytes,
    updatePins,
    ensureResident,
    markLost,
    traceEnabled,
    traceDiagnostic,
    diagnosticFailure,
  } = options;
  const items: PageRec[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  let scheduled = false,
    running = false,
    job = 0;

  const queueResident = (wanted: PageRec[]) => {
    const queuedAt = performance.now(),
      jobId = ++job,
      jobFrame = getFrame();
    tracking.wantedEpoch++;
    tracking.wantedCount = 0;
    for (const page of wanted) {
      const key = tracking.keyOf(page);
      if (tracking.wantedStamp[key] !== tracking.wantedEpoch) {
        tracking.wantedStamp[key] = tracking.wantedEpoch;
        tracking.wantedList[tracking.wantedCount++] = key;
      }
    }
    updatePins();
    items.length = 0;
    tracking.queuedEpoch++;
    for (const page of wanted) {
      const key = tracking.keyOf(page);
      if (!hasBytes(page) || tracking.queuedStamp[key] === tracking.queuedEpoch) continue;
      tracking.queuedStamp[key] = tracking.queuedEpoch;
      items.push(page);
    }
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
    queueResident,
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
