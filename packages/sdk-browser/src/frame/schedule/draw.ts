import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { PAGE_REQUEST_BATCH } from '../../session/engine/common.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { ViewCamera } from '../../camera/world.ts'
import type { PageStreaming } from '../../geometry/streaming/pageStreamer.ts'
import type { createExplorerStreaming } from '../../scene/drive/streaming.ts'

type Inputs = {
  camera: ViewCamera
  streamer: PageStreaming
  streaming: ReturnType<typeof createExplorerStreaming>
  engine: Engine
  /** The CPU bytes the engine's host tables and the world roots hold now. */
  hostBytes: () => number
  /** The views beside the main one, drawn after its image (`world.addView`). */
  drawViews?: (refreshMs: number | null) => void
}

/**
 * One frame of the engine: it draws and presents its own surface, then the pages it still lacks
 * are asked for, the ones it reads are retained, and the host tables its view sized are reserved
 * off the page cache. The engine times its own passes; a frame whose visible pages exceed the
 * resident budget is refused by name (`PAGE_BUDGET`).
 */
export function createDrawFrame(inputs: Inputs) {
  const { camera, streamer, streaming, engine, hostBytes, drawViews } = inputs
  return () => {
    engine.render(camera)
    // Their cuts join the residency's union before the pages the frame lacks are asked.
    drawViews?.(engine.refreshMs())
    const renderEnd = cpuNow()
    const missing = engine.pendingUrls()
    streaming.queueCached(missing)
    // Per-frame budget on requests too: on a cold cache the missing list counts the pages of the
    // whole city. The list is ordered by priority — the most costly miss first — so the head is
    // enough; the rest leaves on the next frame, shorter by what just arrived. A page held or failed
    // for good does not consume the batch and therefore never blocks those that follow. One asker
    // holds the reads (`streaming.ask`): a page still lacked keeps its read, never re-asked.
    const head: string[] = []
    for (let i = 0; i < missing.length && head.length < PAGE_REQUEST_BATCH; i++)
      if (!streamer.has(missing[i]) && !streamer.failed(missing[i])) head.push(missing[i])
    streaming.ask(head)
    const pendingEnd = cpuNow()
    // The pages the view reads pinned through its request-rank difference.
    streamer.retainRanks(engine.retainedRanks())
    streamer.reserve(hostBytes())
    engine.cpuStep('pendingMs', pendingEnd - renderEnd)
    engine.cpuStep('retainMs', msSince(pendingEnd))
    // The engine draws into the page canvas: the frame closes here, where the bounds the host
    // just sampled still belong to it.
    engine.cpuFrameEnd()
    if (engine.overBudget)
      throw new EngineError('PAGE_BUDGET', 'Visible pages exceed the resident budget')
  }
}
