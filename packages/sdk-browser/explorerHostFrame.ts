import type { RenderBackend } from './backendTypes.ts';
import { createExplorerDraw } from './explorerDraw.ts';
import type { createExplorerHostState } from './explorerHostState.ts';
import { createExplorerMetrics } from './explorerMetrics.ts';
import type { prepareExplorer } from './explorerPrepare.ts';
import { createExplorerRender } from './explorerRender.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { createFrameComposer } from './explorerCompose.ts';
import { createExplorerStreaming } from './explorerStreaming.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
type Inputs = {
  prepared: Prepared;
  host: ReturnType<typeof createExplorerHostState>;
  backends: RenderBackend[];
  compose: ReturnType<typeof createFrameComposer>;
};

export function createExplorerHostFrame(session: ExplorerSession, inputs: Inputs) {
  const { options, metadata } = session;
  const { prepared, host, backends, compose } = inputs;
  const { camera, directGpu, pageSources } = prepared;
  const { geometryUrls, pageIdByUrl, streamer } = pageSources;
  const {
    state,
    baseline,
    webglSurface,
    lookAtTarget,
    compositor,
    presentBackend,
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
    presentBackend,
    baseline,
    state,
    compose,
  });
  const render = createExplorerRender(session, {
    check,
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
  return { render, profiler, streaming };
}
