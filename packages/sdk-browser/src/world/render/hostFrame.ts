import type { RenderBackend } from '../../backend/types.ts';
import { createExplorerDraw } from './draw.ts';
import type { createExplorerHostState } from './hostState.ts';
import { createExplorerMetrics } from '../diagnostic/metrics.ts';
import type { prepareExplorer } from '../session/prepare.ts';
import { createExplorerRender } from './render.ts';
import type { ExplorerSession } from '../session/session.ts';
import { createExplorerStreaming } from '../scene/streaming.ts';
import { createPartitionFrame } from '../scene/partitionFrame.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
type Inputs = {
  prepared: Prepared;
  host: ReturnType<typeof createExplorerHostState>;
  backends: RenderBackend[];
};

export function createExplorerHostFrame(session: ExplorerSession, inputs: Inputs) {
  const { options, metadata } = session;
  const { prepared, host, backends } = inputs;
  const { camera, directGpu, pageSources, partitions } = prepared;
  const { geometryUrls, pageIdByUrl, streamer } = pageSources;
  const {
    state,
    baseline,
    webglSurface,
    lookAtTarget,
    compose,
    compositor,
    ensureTarget,
    check,
    setPose,
  } = host;
  const { metricsScratch, profiler, fillMetrics } = createExplorerMetrics(
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
  );
  const streaming = createExplorerStreaming(session, { streamer, geometryUrls, backends, state });
  const drawBackend = createExplorerDraw(session, {
    camera,
    geometryUrls,
    streamer,
    streaming,
    directGpu,
    webglSurface,
    baseline,
    state,
    compose,
  });
  const followCells = createPartitionFrame({
    partitions,
    streamer,
    camera,
    active: () => state.active,
    renew: options.onRowsOutgrown,
  });
  const render = createExplorerRender(session, {
    check,
    followCells,
    state,
    camera,
    lookAtTarget,
    setPose,
    streaming,
    drawBackend,
    ensureTarget,
    directGpu,
    webglSurface,
    backends,
    baseline,
    compositor,
    fillMetrics,
    metricsScratch,
    profiler,
    pageIdByUrl,
    streamer,
    compose,
  });
  return { render, profiler, streaming, followCells };
}
