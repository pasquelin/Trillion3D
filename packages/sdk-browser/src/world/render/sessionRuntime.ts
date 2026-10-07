import type { Engine } from '../../engine/types.ts'
import { createSessionState, type SessionState } from './sessionState.ts'
import { createSessionFrame } from './sessionFrame.ts'
import { engineReads } from './sessionReads.ts'
import { createExplorerLifecycle } from '../session/lifecycle.ts'
import { frameWaits } from '../session/familyUse.ts'
import type { MeasuredWorldOptions } from '../session/options.ts'
import type { ExplorerResources, prepareExplorer } from '../session/prepare.ts'
import type { ExplorerSession } from '../session/session.ts'

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>
type Inputs = {
  prepared: Prepared
  resources: ExplorerResources
  engine: Engine
}
type Frame = ReturnType<typeof createSessionFrame>

/** Whether another frame is wanted: a family or a read on its way, arrivals queued, the engine's
 *  own work, or cells placed by the frames after their read, camera still or not. */
function pendingFrameOf(
  options: MeasuredWorldOptions,
  state: SessionState,
  engine: Engine,
  { streaming, followCells }: Pick<Frame, 'streaming' | 'followCells'>,
) {
  return async () => {
    // A frame that waited for a family on its way is drawn once it has arrived.
    const families = frameWaits(options)
    const loading = streaming.promise
    await Promise.all([families, loading])
    if (state.disposed) return false
    const pending = await engine.pendingFrame()
    const cells = await followCells?.pending()
    const arriving = !!families || !!loading || !!streaming.promise
    return arriving || streaming.arrivals.pending > 0 || !!pending || !!cells
  }
}

export function createSessionRuntime(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, metadata, scope, signal } = session
  const { prepared, resources, engine } = inputs
  const { source, pageSources, viewport, context, camera, center, bounds, radius } = prepared
  const { gpuDevice } = resources
  const host = createSessionState(prepared, signal)
  const { state, ownedControls, lookAtTarget, check, setPose } = host
  const frame = createSessionFrame(session, { prepared, host, engine })
  const { render, profiler, streaming } = frame
  const { dispose, flush, awaitPages } = createExplorerLifecycle(session, {
    ...{ check, state, gpuDevice, profiler, ownedControls, streaming, engine, source, camera },
    streamer: pageSources.streamer,
  })
  return {
    ...{ options, camera, center, bounds, metadata, canvas, render, gpuDevice, dispose, setPose },
    ...{ awaitPages, flush, check, scope, viewport, context, lookAtTarget, radius, ownedControls },
    ...{ profiler, state },
    /** The session's one engine, the WebGPU page raster. */
    engine,
    /** The families the next frame draws with still on their way, `undefined` once none is: a
     *  frame that waits is not drawn (`familyUse.ts`). */
    familiesPending: () => frameWaits(options),
    pendingFrame: pendingFrameOf(options, state, engine, frame),
    ...engineReads(engine, check, camera),
    setDiagnostic: (mode: SessionState['diagnostic']) => {
      state.diagnostic = mode
    },
    setCapturingSurface: (value: boolean) => {
      state.capturingSurface = value
    },
  }
}

/** What the session runtime hands the public API: one alias types both ends. */
export type SessionRuntime = ReturnType<typeof createSessionRuntime>
