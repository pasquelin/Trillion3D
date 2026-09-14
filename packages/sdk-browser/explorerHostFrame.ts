import type { RenderBackend } from './backendTypes.ts';
import { createExplorerDraw } from './explorerDraw.ts';
import type { createExplorerHostState } from './explorerHostState.ts';
import { createExplorerMetrics } from './explorerMetrics.ts';
import type { ExplorerResources, prepareExplorer } from './explorerPrepare.ts';
import { createExplorerRender } from './explorerRender.ts';
import type { ExplorerSession } from './explorerSession.ts';
import { createExplorerStreaming } from './explorerStreaming.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
type Inputs = {
  prepared: Prepared;
  resources: ExplorerResources;
  host: ReturnType<typeof createExplorerHostState>;
  backends: RenderBackend[];
};

export function createExplorerHostFrame(session: ExplorerSession, inputs: Inputs) {
  const { options, metadata } = session;
  const { prepared, resources, host, backends } = inputs;
  const { camera, directGpu, pageSources } = prepared;
  const { geometryUrls, pageIdByUrl, streamer } = pageSources;
  const renderer = resources.renderer;
  const { state, baseline, lookAtTarget, compositor, ensureTarget, check, setPose } = host;
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
    renderer: renderer!,
    baseline,
    state,
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
    renderer: renderer!,
    backends,
    baseline,
    compositor,
    fillMetrics,
    metricsScratch,
    profiler,
    pageIdByUrl,
    streamer,
  });
  return { render, profiler, streaming };
}
