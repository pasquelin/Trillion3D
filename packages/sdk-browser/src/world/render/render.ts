import { type CameraPose, type FrameMetrics } from '../../../../sdk-core/src/index.ts'
import { emitExplorerFrameDiagnostic } from '../diagnostic/frameDiagnostic.ts'
import { createHostFrameCostAudit } from '../../frame/costAudit.ts'
import { debugMode } from '../../host/debugMode.ts'
import type { Engine } from '../../engine/types.ts'
import type { SessionState } from './sessionState.ts'
import type { ExplorerSession } from '../session/session.ts'
import type { createExplorerStreaming } from '../scene/streaming.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'
import type { EngineProfiler } from '../../diagnostic/telemetry.ts'
import type { HostCamera } from '../../camera/world.ts'

type Inputs = {
  check: () => void
  /** Places the cells of a partitioned scene the camera now needs, before the frame draws. */
  followCells: (() => void) | null
  /** The page's guides: those that follow a node are moved to it, before the frame draws. */
  guides?: { follow(): void }
  state: SessionState
  engine: Engine
  camera: HostCamera
  lookAtTarget: { x: number; y: number; z: number }
  setPose: (pose: CameraPose) => void
  streaming: ReturnType<typeof createExplorerStreaming>
  /** The frame's one integration budget, opened before the cells and the arrivals spend it. */
  frameBudget: FrameClock
  drawFrame: () => void
  fillMetrics: () => void
  metricsScratch: FrameMetrics
  profiler: EngineProfiler
  pageIdByUrl: Map<string, number>
  streamer: ReturnType<typeof createPageStreamer>
}

/** The `ExplorerSession` fields the frame render actually reads — narrower than the full
 *  session so a caller can supply a session slice instead of every field it never touches. */
type ExplorerRenderSession = Pick<ExplorerSession, 'scope' | 'diagnosticChannel' | 'diagnose'>

export function createExplorerRender(session: ExplorerRenderSession, inputs: Inputs) {
  const { scope, diagnosticChannel, diagnose } = session
  const { check, followCells, guides, state, engine, camera, lookAtTarget, setPose } = inputs
  const { streaming, frameBudget, drawFrame, fillMetrics, metricsScratch, profiler } = inputs
  const auditFrame = createHostFrameCostAudit()
  const render = (pose?: CameraPose): FrameMetrics => {
    check()
    const frameNumber = ++state.frame
    const start = performance.now()
    if (pose) setPose(pose)
    guides?.follow() // no integration: it spends none of the budget
    // One integration budget per frame: the cells placed, then the arrivals drained, both
    // outside the frame they would have lengthened; the engine's row records spend what is left.
    frameBudget.open()
    let arrivalStart: number
    try {
      followCells?.()
      arrivalStart = performance.now()
      streaming.arrivals.drain()
    } finally {
      frameBudget.pause() // balanced on every path: the engine's own work spends none of it
    }
    engine.cpuStep('arrivalsMs', performance.now() - arrivalStart)
    // The engine draws and presents its own surface; an error is the caller's, never hidden.
    drawFrame()
    fillMetrics()
    const frameEnd = performance.now()
    metricsScratch.cpuFrameMs = frameEnd - start
    engine.frameCpuMs(metricsScratch.cpuFrameMs)
    // Submitted triangles of this frame: those the engine counted, and only those. `null` when
    // it has not counted them — a zero published here would read as an empty frame, and that is
    // what the contract forbids. Draw calls follow the same rule, in `fillMetrics`.
    metricsScratch.triangles = metricsScratch.totalSubmittedTriangles ?? null
    auditFrame(frameNumber, metricsScratch)
    if (debugMode()) profiler.record(metricsScratch) // the frame report is a debug tool
    const { pageIdByUrl, streamer } = inputs
    emitExplorerFrameDiagnostic({
      diagnosticChannel,
      engine,
      camera,
      lookAtTarget,
      metricsScratch,
      pageIdByUrl,
      streamer,
      scope,
      frameNumber,
      diagnose,
    })
    return metricsScratch
  }
  return render
}
