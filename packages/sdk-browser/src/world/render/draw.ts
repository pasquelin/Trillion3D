import { EngineError } from '../../../../sdk-core/src/index.ts'
import { PAGE_REQUEST_BATCH } from '../../engine/common.ts'
import type { Engine } from '../../engine/types.ts'
import type { HostCamera } from '../../camera/world.ts'
import { retainVisiblePages } from '../../streaming/retainVisiblePages.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'
import type { createExplorerStreaming } from '../scene/streaming.ts'

type Inputs = {
  camera: HostCamera
  streamer: ReturnType<typeof createPageStreamer>
  streaming: ReturnType<typeof createExplorerStreaming>
  engine: Engine
}

/**
 * Addresses that a request already gone will send again later. Same addresses and same add
 * order as a hand-deduped array: membership is that of the structure, where an `includes`
 * rewalked the whole list for every address, frame after frame.
 */
export function pushPending(pending: Set<string>, urls: readonly string[]) {
  for (const url of urls) pending.add(url)
}

/**
 * One frame of the engine: it draws and presents its own surface, then the pages it still lacks
 * are asked for and the ones it reads are retained. The engine times its own passes; a frame whose
 * visible pages exceed the resident budget is refused by name (`PAGE_BUDGET`).
 */
export function createDrawFrame(inputs: Inputs) {
  const { camera, streamer, streaming, engine } = inputs
  return () => {
    engine.render(camera)
    const renderEnd = performance.now()
    const missing = engine.pendingUrls()
    if (missing.length > 0) {
      streaming.queueCached(missing)
      // Per-frame budget on requests too: on a cold cache the missing list counts the pages
      // of the whole city, and making each frame a filtered array then a promise per address
      // cost more than the render. The list is ordered by priority — the most costly miss
      // first — so the head is enough; the rest leaves on the next frame, shorter by what
      // just arrived. The walk, for its part, goes to the end: a failed address does not
      // consume the batch and therefore never blocks those that follow.
      const needFetch: string[] = []
      for (let i = 0; i < missing.length && needFetch.length < PAGE_REQUEST_BATCH; i++) {
        if (streaming.unasked(missing[i])) needFetch.push(missing[i])
      }
      if (needFetch.length > 0) {
        if (!streaming.promise) streaming.startFetch(needFetch)
        else {
          pushPending(streaming.queuedFetch, needFetch)
          streaming.backgroundFetchController?.abort(
            new DOMException('Camera request superseded', 'AbortError'),
          )
        }
      }
    }
    const pendingEnd = performance.now()
    retainVisiblePages(engine, streamer)
    engine.cpuStep('pendingMs', pendingEnd - renderEnd)
    engine.cpuStep('retainMs', performance.now() - pendingEnd)
    // The engine draws into the page canvas: the frame closes here, where the bounds the host
    // just sampled still belong to it.
    engine.cpuFrameEnd()
    if (engine.overBudget)
      throw new EngineError('PAGE_BUDGET', 'Visible pages exceed the resident budget')
  }
}
