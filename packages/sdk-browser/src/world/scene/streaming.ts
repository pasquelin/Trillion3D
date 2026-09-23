import { createArrivalQueue } from '../../page/integration/arrivalQueue.ts';
import { ARRIVAL_BUDGET_MS, ARRIVAL_QUEUE_BATCH } from '../../backend/common.ts';
import { decodePageOffThread } from '../../page/decode/host.ts';
import { PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { ExplorerHostState } from '../render/hostState.ts';
import type { ExplorerSession } from '../session/session.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';

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
  // A `Set` rather than an array: insertion order is the same, membership no longer costs a
  // walk per added address, and the duplicate is dropped by the structure itself.
  const queuedFetch = new Set<string>();
  const decodeFailures = new Set<string>();
  // Page arrivals no longer enter the frame that discovers them: the queue stacks them and a
  // single bounded drain, at the head of `render()`, makes them resident before selection of
  // the next frame. The ceiling is TIME — 2 ms of integration per frame; 512 KiB of index and 64 pages
  // double it without ever replacing it, because a streaming packet carries a cluster count
  // unknown in advance and no byte count then bounds the duration.
  const arrivals = createArrivalQueue(512 * 1024, 64, ARRIVAL_BUDGET_MS);
  // What a frame queues at most. The queue delivers only a handful per frame: stacking
  // thousands ahead would only add, every frame, as many cache reads — and each read moves
  // its address to the head of the least-recently-used order. The rest leaves on the next
  // frame, in the same priority order.
  const queueCached = (backend: RenderBackend, missing: readonly string[]) => {
    let held = 0;
    for (let i = 0; i < missing.length && held < ARRIVAL_QUEUE_BATCH; i++) {
      const url = missing[i];
      if (geometryUrls.has(url)) continue;
      const cached = streamer.get(url);
      // The batch counts the pages the cache HOLDS, stacked this instant or already waiting:
      // without that a late queue would rewalk the whole list every frame without stacking anything.
      if (!cached) continue;
      held++;
      arrivals.queue(backend, url, cached);
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
                // A decode refusal is final for this address; a cancellation is not: the page
                // will leave again with the next request, otherwise a camera that
                // changes its mind would dig a permanent hole in the image.
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
            'Page load failed; GPU fallback cover kept if available',
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
