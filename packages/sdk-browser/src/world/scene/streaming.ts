import { createArrivalQueue } from '../../page/integration/arrivalQueue.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import { ARRIVAL_QUEUE_BATCH } from '../../engine/common.ts'
import { PRIORITY_VISIBLE } from '../../streaming/priority.ts'
import type { Engine } from '../../engine/types.ts'
import type { SessionState } from '../render/sessionState.ts'
import type { ExplorerSession } from '../session/session.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'

type Inputs = {
  streamer: ReturnType<typeof createPageStreamer>
  engine: Engine
  state: Pick<SessionState, 'disposed'>
  /** The session's one integration budget per frame (`EngineContext.frameBudget`). */
  budget: FrameClock
}

/** A page read failed for good, or waits the longest: `degraded` while the coarse cover the engine
 *  already holds is whole — the view stays drawn on it —, `fatal` otherwise (no engine yet, or no
 *  cover resident); said once per failure by its caller, `failedPages` the reads failing now. */
export function streamFailed(
  session: Pick<ExplorerSession, 'scope' | 'emit' | 'diagnose'>,
  engine: Engine | undefined,
  failedPages: number,
  detail: string,
) {
  const { scope, emit, diagnose } = session
  const coverageReady = engine?.metrics().coverageReady
  const recovered = coverageReady === true
  emit(
    recovered
      ? {
          eventVersion: 1,
          type: 'degraded',
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
  )
  diagnose(
    'coverage-streaming-failed',
    'Page load failed; the coarse cover already resident is kept if whole',
    {
      kind: 'error',
      version: 1,
      error: detail,
      failedPages,
      coverageReady: coverageReady ?? null,
      recovered,
      scope,
    },
  )
}

/**
 * What a frame queues at most of the pages the engine lacks and the cache holds. The queue
 * delivers only a handful per frame: stacking thousands ahead would only add, every frame, as many
 * cache reads — and each read moves its address to the head of the least-recently-used order. The
 * rest leaves on the next frame, in the same priority order.
 */
function cachedQueue(
  streamer: Inputs['streamer'],
  arrivals: ReturnType<typeof createArrivalQueue>,
  engine: Engine,
) {
  return (missing: readonly string[]) => {
    let held = 0
    for (let i = 0; i < missing.length && held < ARRIVAL_QUEUE_BATCH; i++) {
      const url = missing[i]
      const cached = streamer.get(url)
      // The batch counts the pages the cache HOLDS, stacked this instant or already waiting:
      // without that a late queue would rewalk the whole list every frame without stacking anything.
      if (!cached) continue
      held++
      arrivals.queue(engine, url, cached)
    }
  }
}

export function createExplorerStreaming(session: ExplorerSession, inputs: Inputs) {
  const { signal } = session
  const { streamer, engine, state, budget } = inputs
  let streamingError: string | null = null,
    streamingPromise: Promise<void> | null = null,
    backgroundFetchController: AbortController | undefined
  // A `Set`: insertion order kept, membership without a walk, a duplicate dropped by the structure.
  const queuedFetch = new Set<string>()
  // Arrivals are stacked and drained, bounded, at the head of `render()`, before the next
  // frame's selection. The ceiling is TIME, the frame's one integration budget (`frameBudget`);
  // 512 KiB of index and 64 pages double it, never replace it: a packet's cluster count is
  // unknown in advance, so no byte count bounds the duration.
  const arrivals = createArrivalQueue(512 * 1024, 64, budget)
  const queueCached = cachedQueue(streamer, arrivals, engine)
  const unasked = (url: string) =>
    !streamer.has(url) && !streamer.loading(url) && !streamer.failed(url)
  const startFetch = (urls: string[]) => {
    if (!urls.length) return
    const controller = new AbortController()
    backgroundFetchController = controller
    // Each page is queued the moment IT lands, while the others still travel, not once the whole
    // batch has: waiting for the slowest page held every page of the batch behind it (#982).
    const land = (url: string) => {
      const array = streamer.get(url)
      if (array) arrivals.queue(engine, url, array)
    }
    streamingPromise = streamer
      .request(urls, { signal: controller.signal, priority: PRIORITY_VISIBLE, onPage: land })
      .catch((error) => {
        // The page's failure reached the host already, once, from the read layer (`onStalled`,
        // `streamFailed`): the batch only keeps it for its owner to read.
        if (state.disposed || signal?.aborted || controller.signal.aborted) return
        streamingError = String(error)
      })
      .finally(() => {
        if (backgroundFetchController === controller) backgroundFetchController = undefined
        streamingPromise = null
        if (!queuedFetch.size) return
        const pending = [...queuedFetch]
        queuedFetch.clear()
        startFetch(pending.filter(unasked))
      })
  }
  return {
    arrivals,
    queueCached,
    unasked,
    startFetch,
    queuedFetch,
    get error() {
      return streamingError
    },
    get promise() {
      return streamingPromise
    },
    get backgroundFetchController() {
      return backgroundFetchController
    },
  }
}
