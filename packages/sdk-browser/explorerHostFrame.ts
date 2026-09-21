import type { RenderBackend } from './backendTypes.ts';
import { createExplorerDraw } from './explorerDraw.ts';
import type { createExplorerHostState } from './explorerHostState.ts';
import { createExplorerMetrics } from './explorerMetrics.ts';
import type { ExplorerResources, prepareExplorer } from './explorerPrepare.ts';
import { createExplorerRender } from './explorerRender.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { createSceneDrawer } from './explorerDrawScene.ts';
import { createExplorerStreaming } from './explorerStreaming.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
type Inputs = {
  prepared: Prepared;
  resources: ExplorerResources;
  host: ReturnType<typeof createExplorerHostState>;
  backends: RenderBackend[];
  drawScene: ReturnType<typeof createSceneDrawer>;
};

export function createExplorerHostFrame(session: ExplorerSession, inputs: Inputs) {
  const { options, metadata } = session;
  const { prepared, resources, host, backends, drawScene } = inputs;
  const { camera, directGpu, pageSources } = prepared;
  const { geometryUrls, pageIdByUrl, streamer } = pageSources;
  const { webglSurface } = resources;
  const {
    state,
    baseline,
    renderer,
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
    renderer: renderer!,
    webglSurface,
    presentBackend,
    baseline,
    state,
    drawScene,
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
    webglSurface,
    backends,
    baseline,
    compositor,
    fillMetrics,
    metricsScratch,
    profiler,
    pageIdByUrl,
    streamer,
    drawScene,
  });
  return { render, profiler, streaming };
}
