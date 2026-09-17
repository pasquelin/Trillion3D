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
        wanted: tracking.traceKeys('wanted', tracking.wanted),
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
          // L'ensemble demandé est relevé par sondage borné, et ce que le cache en tient est le
          // compte qu'il tient déjà : filtrer l'ensemble entier le parcourait deux fois de plus.
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
     * La coupe a déjà appliqué sa différence ; il ne reste que le budget de pages à faire respecter.
     * `limited` dit que la couverture demandée ne tient pas dans les fentes : le budget est alors
     * nul, la file se vide, et l'image s'en tient à la couverture épinglée. Les deux chemins de
     * coupe n'en disent pas la même chose et le disent chacun, sans valeur par défaut : la coupe de
     * la carte, elle, grossit son erreur écran jusqu'à ce que la couverture tienne et continue donc
     * de charger à plein budget.
     */
    queueCutResidency(limited: boolean) {
      sets.applyBudget(limited ? 0 : options.room);
      follow();
    },
    nextJobId: () => ++job,
    quietPending: () => {
      pending = pending.catch(() => {});
    },
    get pending() {
      return pending;
    },
    /** Vrai tant qu'un téléversement est en cours ou en file : la résidence peut encore changer. */
    get busy() {
      return running || scheduled;
    },
    get job() {
      return job;
    },
  };
}
