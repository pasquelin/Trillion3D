import type { Engine } from '../../session/engine/types.ts'
import { createDrawFrame } from './draw.ts'
import type { createSessionState } from './sessionState.ts'
import { createExplorerMetrics } from '../../diagnostic/world/metrics.ts'
import type { PreparedExplorer } from '../../session/prepare.ts'
import { primeFirstView } from '../../session/sessionScene.ts'
import { holdPartitions } from '../../session/pageSources.ts'
import type { PartitionCells } from '../../geometry/partition/cells.ts'
import type { WorldRootsHold } from '../../geometry/hlod/worldRoots.ts'
import { createExplorerRender } from './render.ts'
import type { ExplorerSession } from '../../session/session.ts'
import { createExplorerStreaming } from '../../scene/drive/streaming.ts'
import { createPartitionFrame } from '../../scene/drive/partitionFrame.ts'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'

type Inputs = {
  prepared: PreparedExplorer
  host: ReturnType<typeof createSessionState>
  engine: Engine
}

/** Partitions joining the session while it runs: their pages catalogued, their roots counted and
 *  bound, the cells the view reaches placed, as the open does (`prepareExplorer`). */
function partitionJoins(
  session: ExplorerSession,
  prepared: PreparedExplorer,
  followCells: ReturnType<typeof createPartitionFrame>,
) {
  const { camera, pageSources } = prepared
  const { streamer } = pageSources
  return {
    async prime(cells: readonly PartitionCells[], roots: readonly WorldRootsHold[]) {
      holdPartitions(streamer, cells, roots)
      prepared.worldRoots.push(...roots)
      await primeFirstView(
        session,
        { partitions: cells },
        camera,
        streamer,
        resolveWorldStreaming(prepared.context),
      )
    },
    follow: followCells.follow,
    leave: followCells.leave,
  }
}

/** The cells the session places each frame, over its streaming settings as they stand. */
function cellFrame(
  prepared: PreparedExplorer,
  renew: ExplorerSession['options']['onPartitionOutgrown'],
  engine: Engine,
) {
  const { camera, pageSources, partitions, frameBudget } = prepared
  // The session's streaming settings as they stand, read by their resolvers at each frame into one
  // object, which each cell frame copies at once (`cells.ts`).
  const streamingNow = resolveWorldStreaming()
  return createPartitionFrame({
    partitions,
    streamer: pageSources.streamer,
    camera,
    engine,
    renew,
    budget: frameBudget,
    streaming: () => resolveWorldStreaming(prepared.context, streamingNow),
  })
}

/** The session's frame: its metrics, its page streaming, the cells it places and its draw. */
export function createSessionFrame(session: ExplorerSession, inputs: Inputs) {
  const { options, metadata } = session
  const { prepared, host, engine } = inputs
  const { camera, pageSources, frameBudget, hostBytes } = prepared
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
  const drawFrame = createDrawFrame({
    ...{ camera, streamer, streaming, engine, hostBytes },
    drawViews: options.drawViews,
  })
  const followCells = cellFrame(prepared, options.onPartitionOutgrown, engine)
  const partitionsJoin = partitionJoins(session, prepared, followCells)
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
  return { render, profiler, streaming, followCells, partitionsJoin }
}
