import type { Engine } from '../../engine/types.ts'
import { createDrawFrame } from './draw.ts'
import type { createSessionState } from './sessionState.ts'
import { createExplorerMetrics } from '../diagnostic/metrics.ts'
import type { prepareExplorer } from '../session/prepare.ts'
import { createExplorerRender } from './render.ts'
import type { ExplorerSession } from '../session/session.ts'
import { createExplorerStreaming } from '../scene/streaming.ts'
import { createPartitionFrame } from '../scene/partitionFrame.ts'

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>
type Inputs = {
  prepared: Prepared
  host: ReturnType<typeof createSessionState>
  engine: Engine
}

/** The session's frame: its metrics, its page streaming, the cells it places and its draw. */
export function createSessionFrame(session: ExplorerSession, inputs: Inputs) {
  const { options, metadata } = session
  const { prepared, host, engine } = inputs
  const { camera, pageSources, partitions, frameBudget } = prepared
  const { pageIdByUrl, streamer } = pageSources
  const { state, lookAtTarget, check, setPose } = host
  const { metricsScratch, profiler, fillMetrics } = createExplorerMetrics(
    engine,
    metadata,
    options,
    streamer,
    state.loaded,
    state.pageBytesRead,
    () => ({
      loaded: state.loaded,
      pageBytesRead: state.pageBytesRead,
      streamingError: streaming.error,
    }),
  )
  const streaming = createExplorerStreaming(session, {
    streamer,
    engine,
    state,
    budget: frameBudget,
  })
  const drawFrame = createDrawFrame({ camera, streamer, streaming, engine })
  const followCells = createPartitionFrame({
    partitions,
    streamer,
    camera,
    engine,
    renew: options.onPartitionOutgrown,
    budget: frameBudget,
  })
  const render = createExplorerRender(session, {
    check,
    followCells,
    guides: options.guides,
    state,
    engine,
    camera,
    lookAtTarget,
    setPose,
    streaming,
    frameBudget,
    drawFrame,
    fillMetrics,
    metricsScratch,
    profiler,
    pageIdByUrl,
    streamer,
  })
  return { render, profiler, streaming, followCells }
}
