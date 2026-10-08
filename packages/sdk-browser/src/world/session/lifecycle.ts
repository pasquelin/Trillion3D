import { awaitEnginePages } from '../../engine/awaitEnginePages.ts'
import { releasePageWorkers } from '../../page/work/host.ts'
import { releasePageIntegration } from '../../page/integration/host.ts'
import { disposeSource } from './disposeSource.ts'
import { retainVisiblePages } from '../../streaming/retainVisiblePages.ts'
import type { EngineContext, Engine } from '../../engine/types.ts'
import type { HostCamera } from '../../camera/world.ts'
import type { SessionState } from '../render/sessionState.ts'
import type { ExplorerSession } from './session.ts'
import type { createExplorerStreaming } from '../scene/streaming.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'
import type { EngineProfiler } from '../../diagnostic/telemetry.ts'
import type { JobProgress } from '../../../../sdk-core/src/runtime/jobs/jobs.ts'

/** How `awaitPages` waits: with or without a picture, and who hears the pages land. */
type PageWait = { image?: boolean; onProgress?: (event: JobProgress) => void }

type Streamer = ReturnType<typeof createPageStreamer>
type Inputs = {
  check: () => void
  state: SessionState
  gpuDevice?: GPUDevice
  profiler: EngineProfiler
  ownedControls: { dispose(): void }[]
  streamer: Streamer
  streaming: ReturnType<typeof createExplorerStreaming>
  engine: Engine
  source: EngineContext['source']
  camera: HostCamera
}

/** Frees what a session owns: the scene source unless the caller holds it, the device unless
 *  the caller handed it in. */
export function releaseOwned(
  session: ExplorerSession,
  owned: { source?: EngineContext['source']; gpuDevice?: GPUDevice },
) {
  if (owned.source && !session.callerOwned) disposeSource(owned.source)
  try {
    // A device the caller handed in is the caller's to destroy.
    if (owned.gpuDevice !== session.options.gpuDevice) owned.gpuDevice?.destroy()
  } catch {
    /* Device may already be lost. */
  }
}

/** Counts as landed, once, the pages the engine's view reads that the streamer holds, `missing`
 *  aside: resident already, through the watch's `hold`. A page read again later — the WebGPU
 *  residency uploading it — is not counted twice. */
function holdPages(
  engine: Engine,
  streamer: Streamer,
  missing: readonly string[],
  hold: (url: string) => void,
) {
  const lacking = new Set(missing)
  const ranks = engine.retainedRanks()
  // Apply this delta before another read of the engine can turn it into an empty hold.
  streamer.retainRanks(ranks)
  for (let i = 0; i < ranks.heldCount; i++) {
    const url = ranks.urls[ranks.held[i]]
    if (url !== undefined && !lacking.has(url) && streamer.has(url)) hold(url)
  }
}

/** The session's teardown: once, its owned controls, reads, workers, engine and resources. */
function sessionDisposal(session: ExplorerSession, inputs: Inputs) {
  const { scope, diagnosticChannel, diagnose } = session
  const { state, profiler, ownedControls, streaming, streamer, engine } = inputs
  return () => {
    if (state.disposed) return
    diagnose('dispose-start', 'MeasuredWorld disposal started', { kind: 'lifecycle', scope })
    diagnosticChannel.flushSync()
    state.disposed = true
    profiler.dispose()
    ownedControls.splice(0).forEach((control) => {
      try {
        control.dispose()
      } catch {
        /* Owned controls cannot block explorer teardown. */
      }
    })
    // A read cut short says why (#837), never "aborted without reason".
    streaming.backgroundFetchController?.abort(new DOMException('The session closed', 'AbortError'))
    streamer.dispose()
    releasePageWorkers()
    releasePageIntegration()
    engine.dispose()
    releaseOwned(session, inputs)
    diagnose('dispose-complete', 'MeasuredWorld disposal completed', { kind: 'lifecycle', scope })
    diagnosticChannel.flushSync()
    diagnosticChannel.close()
  }
}

/** The pages the view reads, made resident; `image: false` takes no picture of them.
 *  `onProgress` hears `pages`: `total` the pages the view reads — those the streamer held already
 *  and every page it reads for the view while the wait runs, a prefetch aside, whoever asks it
 *  (`readWatch.ts`): the host for the cut, or the engine itself, as the WebGPU residency does
 *  inside its flush —, `completed` those resident, rising as each lands; the last event says
 *  `completed === total`. */
function pageAwaiter(inputs: Inputs) {
  const { check, state, streamer, streaming, engine, camera } = inputs
  return async (options: PageWait = {}) => {
    const { onProgress, ...wait } = options
    let said = { completed: -1, total: -1 }
    const report = (last = false) => {
      const { landed: completed, asked } = read.reads()
      const total = last ? completed : asked
      if (completed === said.completed && total === said.total) return
      said = { completed, total }
      onProgress?.({
        phase: 'pages',
        completed,
        total,
        message: `${completed} of ${total} pages the view reads`,
      })
    }
    const read = streamer.watch(() => report())
    try {
      check()
      if (streaming.promise) await streaming.promise
      const load = async (missing: string[]) => {
        holdPages(engine, streamer, missing, read.hold)
        // `load` hears the cut even when it lacks nothing; an empty batch is not asked.
        if (missing.length) await streamer.request(missing, { signal: streamer.signal })
        for (const url of missing) {
          const array = streamer.get(url)
          if (array) engine.acceptPage(url, array)
        }
      }
      await awaitEnginePages(engine, camera, load, wait)
      retainVisiblePages(engine, streamer)
      report(true)
    } finally {
      read.stop()
    }
    state.loaded = streamer.stats().loaded
    state.pageBytesRead = streamer.stats().bytesRead
  }
}

export function createExplorerLifecycle(session: ExplorerSession, inputs: Inputs) {
  const { check, streaming, engine } = inputs
  const flush = async () => {
    check()
    if (streaming.promise) await streaming.promise
    await engine.flush()
    await session.diagnosticChannel.flush()
  }
  return { dispose: sessionDisposal(session, inputs), flush, awaitPages: pageAwaiter(inputs) }
}
