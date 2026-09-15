import { createArrivalQueue } from './arrivalQueue.ts';
import { decodePageOffThread } from './pageDecodeHost.ts';
import { PRIORITY_VISIBLE } from './streamingPriority.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { createPageStreamer } from './streamingPages.ts';

type Inputs = {
  streamer: ReturnType<typeof createPageStreamer>;
  geometryUrls: Set<string>;
  backends: RenderBackend[];
  state: Pick<ExplorerHostState, 'disposed' | 'measuring' | 'active'>;
};

export function createExplorerStreaming(session: ExplorerSession, inputs: Inputs) {
  const { signal, scope, emit, diagnose } = session;
  const { streamer, geometryUrls, backends, state } = inputs;
  let streamingError: string | null = null,
    lastPrefetch = 0;
  let streamingPromise: Promise<void> | null = null,
    backgroundFetchController: AbortController | undefined;
  // Un `Set` plutôt qu'un tableau : l'ordre d'insertion est le même, l'appartenance ne coûte plus
  // un balayage par adresse ajoutée, et le doublon est écarté par la structure elle-même.
  const queuedFetch = new Set<string>();
  const decodeFailures = new Set<string>();
  // Les arrivées de pages n'entrent plus dans l'image qui les découvre : la file les empile et un
  // drain unique et borné, en tête de `render()`, les fait résider avant la sélection de l'image
  // suivante. Budget : 512 Kio d'index et 64 pages, soit ce qu'une image accepte de porter.
  const arrivals = createArrivalQueue(512 * 1024, 64);
  const queueCached = (backend: RenderBackend, missing: readonly string[]) => {
    for (let i = 0; i < missing.length; i++) {
      const url = missing[i];
      if (geometryUrls.has(url)) continue;
      const cached = streamer.get(url);
      if (cached) arrivals.queue(backend, url, cached);
    }
  };
  const startFetch = (urls: string[], priority = PRIORITY_VISIBLE) => {
    if (!urls.length || state.measuring) return;
    const controller = new AbortController();
    backgroundFetchController = controller;
    streamingPromise = streamer
      .request(urls, { signal: controller.signal, priority })
      .then(async () => {
        for (const url of urls) {
          if (geometryUrls.has(url)) {
            const bytes = streamer.getBytes(url);
            if (bytes) {
              try {
                const decoded = await decodePageOffThread(bytes, controller.signal);
                for (const b of backends) b.acceptGeometryPage?.(url, decoded);
              } catch (error) {
                // Un refus du décodage est définitif pour cette adresse ; une annulation ne l'est
                // pas : la page repartira avec la prochaine demande, sans quoi une caméra qui
                // change d'avis creuserait un trou permanent dans l'image.
                if (!controller.signal.aborted) decodeFailures.add(url);
                throw error;
              }
            }
            continue;
          }
          const array = streamer.get(url);
          if (array) for (const b of backends) arrivals.queue(b, url, array);
        }
      })
      .catch((error) => {
        if (state.disposed || signal?.aborted || controller.signal.aborted) return;
        const detail = String(error);
        if (streamingError !== detail) {
          streamingError = detail;
          const recovered = state.active.metrics().coverageReady === true;
          emit(
            recovered
              ? {
                  eventVersion: 1,
                  type: 'fallback',
                  audience: 'diagnostic',
                  recovered: true,
                  code: 'PAGE_STREAM_FAILED',
                  detail,
                }
              : {
                  eventVersion: 1,
                  type: 'fatal',
                  audience: 'blocking',
                  recovered: false,
                  code: 'PAGE_STREAM_FAILED',
                  detail,
                },
          );
          diagnose(
            'coverage-streaming-failed',
            'Échec du chargement des pages ; couverture GPU de secours conservée si disponible',
            {
              kind: 'error',
              version: 1,
              error: detail,
              failedPages: streamer.stats().failed,
              maxAttemptsPerPage: 3,
              coverageReady: state.active.metrics().coverageReady ?? null,
              recovered,
              scope,
            },
          );
        }
      })
      .finally(() => {
        if (backgroundFetchController === controller) backgroundFetchController = undefined;
        streamingPromise = null;
        if (queuedFetch.size && !state.measuring) {
          const attente = [...queuedFetch];
          queuedFetch.clear();
          const next = attente.filter(
            (url) =>
              (geometryUrls.has(url) || !streamer.has(url)) &&
              !streamer.loading(url) &&
              !streamer.failed(url) &&
              !decodeFailures.has(url),
          );
          if (next.length) startFetch(next);
        }
      });
  };
  return {
    arrivals,
    queueCached,
    startFetch,
    queuedFetch,
    decodeFailures,
    get error() {
      return streamingError;
    },
    get promise() {
      return streamingPromise;
    },
    get backgroundFetchController() {
      return backgroundFetchController;
    },
    get lastPrefetch() {
      return lastPrefetch;
    },
    set lastPrefetch(value: number) {
      lastPrefetch = value;
    },
  };
}
