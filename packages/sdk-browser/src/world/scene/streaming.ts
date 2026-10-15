import { createArrivalQueue } from '../../page/integration/arrivalQueue.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import { ARRIVAL_QUEUE_BATCH, ARRIVAL_QUEUE_BYTES } from '../../engine/common.ts'
import { PRIORITY_VISIBLE } from '../../streaming/priority.ts'
import { createViewAsks } from './viewAsks.ts'
import type { Engine } from '../../engine/types.ts'
import type { SessionState } from '../render/sessionState.ts'
import type { ExplorerSession } from '../session/session.ts'
import type { PageStreaming } from '../../streaming/pageStreamer.ts'

type Inputs = {
  streamer: PageStreaming
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

/**
 * The session's page reads: the engine's missing pages asked by the view's one asker
 * (`createViewAsks`) — a page the next frame still lacks keeps its read, one it no longer lacks is
 * let go —, each landing queued into the arrivals the moment it lands, and the cached ones queued
 * by the frame (`queueCached`).
 */
export function createExplorerStreaming(session: ExplorerSession, inputs: Inputs) {
  const { signal } = session
  const { streamer, engine, state, budget } = inputs
  let streamingError: string | null = null,
    reads: Promise<void>[] = []
  // Arrivals are stacked and drained, bounded, at the head of `render()`, before the next
  // frame's selection. The ceiling is TIME, the frame's one integration budget (`frameBudget`);
  // the byte and page ceilings double it, never replace it: a packet's cluster count is unknown in
  // advance, so no byte count bounds the duration.
  const arrivals = createArrivalQueue(ARRIVAL_QUEUE_BYTES, ARRIVAL_QUEUE_BATCH, budget)
  const queueCached = cachedQueue(streamer, arrivals, engine)
  const asks = createViewAsks(streamer)
  // Each page is queued the moment IT lands, while the others still travel (#982). A failure
  // reached the host already, once, from the read layer (`onStalled`, `streamFailed`): it is only
  // kept for the owner to read.
  const heard = {
    land(url: string) {
      const array = streamer.get(url)
      if (array) arrivals.queue(engine, url, array)
    },
    fail(error: unknown) {
      if (!state.disposed && !signal?.aborted) streamingError = String(error)
    },
  }
  return {
    arrivals,
    queueCached,
    /** The frame's asks: `urls`, the head of what the engine lacks that no read holds or failed
     *  for good; what the last frame asked and this one does not is let go. */
    ask(urls: readonly string[]) {
      reads = asks.ask(urls, PRIORITY_VISIBLE, heard)
      asks.end()
    },
    /** Settles once the reads the last frame asked have, either way; none when it asked none. */
    pending: () => (reads.length ? Promise.all(reads) : undefined),
    /** Every read let go: the session closed. */
    stop: () => asks.drop(new DOMException('The session closed', 'AbortError')),
    get error() {
      return streamingError
    },
  }
}
