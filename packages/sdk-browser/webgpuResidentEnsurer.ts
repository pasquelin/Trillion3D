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
 * Rend la main à la boucle d'évènements — pas seulement à la file de microtâches.
 *
 * `await cache.load(...)` n'attend qu'une promesse déjà résolue quand les octets sont en mémoire :
 * la boucle entière s'exécute alors en une seule tâche, et ni le rendu, ni `requestAnimationFrame`,
 * ni les évènements de la page n'ont la moindre occasion de passer. Un `MessageChannel` est une
 * vraie tâche, sans le plafond de quatre millisecondes qu'un `setTimeout` imbriqué finit par subir :
 * l'image qui attendait passe, et la salve suivante reprend aussitôt après.
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
    traceDiagnostic('residency-ensure-start', 'Vérification de la résidence GPU demandée', () =>
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
      // Budget par image : la salve rend la main dès son plafond atteint. Le travail restant n'est
      // pas abandonné, il reprend après l'image — et une caméra qui a bougé entre-temps est déjà
      // prise en compte, puisque chaque tour relit `wanted` avant de téléverser quoi que ce soit.
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
        // Réservoir plein de pages que l'image tient : comme le streamer de la référence, la salve
        // s'arrête là, sans rien lâcher. Ce qui reste voulu s'affiche par son ancêtre résident, et
        // l'admission de la coupe, qui lit le même état, grossit l'erreur écran jusqu'à ce que
        // tout tienne (`admitGpuCut`).
        break;
      }
      cache = getCache();
      if (isLost() || !cache) throw new Error('WEBGPU_LOST');
      if (tracking.wanted.has(key) || bootstrapKey[key]) {
        cache.pin(rec.url);
        tracking.markPinned(key);
      }
    }
    traceDiagnostic('residency-ensure-end', 'Résidence GPU vérifiée', () => ({
      ...payload({
        loaded: loaded(),
        durationMs: performance.now() - started,
        elapsedMs: performance.now() - started,
      }),
      // Sondage borné de l'ensemble pinné : il a la taille de la coupe, pas celle de la file.
      pinned: tracking.traceKeys('pins', tracking.pinned),
    }));
  };
}
