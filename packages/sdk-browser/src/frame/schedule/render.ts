import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import type { CameraPose } from '../../../../sdk-core/src/contracts/base.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { emitExplorerFrameDiagnostic } from '../../diagnostic/world/frameDiagnostic.ts'
import { debugMode } from '../../session/host/debugMode.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { SessionState } from './sessionState.ts'
import type { ExplorerSession } from '../../session/session.ts'
import type { createExplorerStreaming } from '../../scene/drive/streaming.ts'
import type { FrameClock } from '../../geometry/integration/frameBudget.ts'
import type { PageStreaming } from '../../geometry/streaming/pageStreamer.ts'
import type { EngineProfiler } from '../../diagnostic/telemetry.ts'

type Inputs = {
  check: () => void
  /** Places the cells of a partitioned scene the camera now needs, before the frame draws. */
  followCells: (() => void) | null
  /** The page's guides: those that follow a node are moved to it, before the frame draws. */
  guides?: { follow(): void }
  state: SessionState
  engine: Engine
  lookAtTarget: { x: number; y: number; z: number }
  setPose: (pose: CameraPose) => void
  streaming: ReturnType<typeof createExplorerStreaming>
  /** The frame's one integration budget, opened before the cells and the arrivals spend it. */
  frameBudget: FrameClock
  drawFrame: () => void
  /** Fills the frame's metrics; returns the queue's numbers it read (`streamer.stats()`). */
  fillMetrics: () => ReturnType<PageStreaming['stats']>
  metricsScratch: FrameMetrics
  profiler: EngineProfiler
  pageIdByUrl: Map<string, number>
  streamer: PageStreaming
}

/** The `ExplorerSession` fields the frame render actually reads — narrower than the full
 *  session so a caller can supply a session slice instead of every field it never touches. */
type ExplorerRenderSession = Pick<ExplorerSession, 'scope' | 'diagnosticChannel' | 'diagnose'>

export function createExplorerRender(session: ExplorerRenderSession, inputs: Inputs) {
  const { scope, diagnosticChannel, diagnose } = session
  const { check, followCells, guides, state, engine, lookAtTarget, setPose } = inputs
  const { streaming, frameBudget, drawFrame, fillMetrics, metricsScratch, profiler } = inputs
  const render = (pose?: CameraPose): FrameMetrics => {
    check()
    const frameNumber = ++state.frame
    const start = cpuNow()
    if (pose) setPose(pose)
    guides?.follow() // no integration: it spends none of the budget
    // One integration budget per frame: the cells placed, then the arrivals drained, both
    // outside the frame they would have lengthened; the engine's row records spend what is left.
    frameBudget.open()
    let arrivalStart: number
    try {
      followCells?.()
      arrivalStart = cpuNow()
      streaming.arrivals.drain()
    } finally {
      frameBudget.pause() // balanced on every path: the engine's own work spends none of it
    }
    engine.cpuStep('arrivalsMs', msSince(arrivalStart))
    // The engine draws and presents its own surface; an error is the caller's, never hidden.
    drawFrame()
    const stream = fillMetrics()
    const frameEnd = cpuNow()
    metricsScratch.cpuFrameMs = frameEnd - start
    engine.frameCpuMs(metricsScratch.cpuFrameMs)
    if (debugMode()) profiler.record(metricsScratch) // the frame report is a debug tool
    const { pageIdByUrl, streamer } = inputs
    emitExplorerFrameDiagnostic({
      diagnosticChannel,
      engine,
      lookAtTarget,
      metricsScratch,
      pageIdByUrl,
      streamer,
      stream,
      scope,
      frameNumber,
      diagnose,
    })
    return metricsScratch
  }
  return render
}
