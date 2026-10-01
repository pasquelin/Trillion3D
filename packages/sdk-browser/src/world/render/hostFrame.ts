import { checkViewMaskLights } from '../views/mask.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { createExplorerViews } from '../views/explorerViews.ts';
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
  const { camera, directGpu, pageSources, partitions, frameBudget, context } = prepared;
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
      effectBytes: compose.effectBytes() + views.bytes(),
      gpu: drawBackend.gpu,
    }),
  );
  const streaming = createExplorerStreaming(session, {
    streamer,
    geometryUrls,
    backends,
    state,
    budget: frameBudget,
  });
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
  const views = createExplorerViews({
    active: () => state.active,
    check,
    draw: drawBackend,
    gl: directGpu ? undefined : webglSurface?.context,
    options,
    compose,
    beauty: host.beautyMaterials,
    diagnostic: () => state.diagnostic,
  });
  const followCells = createPartitionFrame({
    partitions,
    views: views.cameras,
    streamer,
    camera,
    active: () => state.active,
    opened: context,
    renew: options.onPartitionOutgrown,
    budget: frameBudget,
  });
  const render = createExplorerRender(session, {
    check,
    followCells,
    guides: options.guides,
    state,
    camera,
    lookAtTarget,
    setPose,
    streaming,
    frameBudget,
    drawBackend,
    drawViews: views.draw,
    multipleViews: views.customized,
    publishViewMetrics: views.publishMetrics,
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
  return {
    render,
    profiler,
    streaming,
    followCells,
    views: Object.assign(views, { checkMask: () => checkViewMaskLights(context.sceneLights) }),
  };
}
