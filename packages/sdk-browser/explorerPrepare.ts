import * as THREE from 'three';
import type { RenderBackend } from './backendTypes.ts';
import { configureExplorer } from './explorerCapabilities.ts';
import { prepareExplorerBackends } from './explorerBackends.ts';
import { createExplorerCamera } from './explorerCamera.ts';
import { createExplorerPageSources } from './explorerPageSources.ts';
import { loadPreparedScene } from './explorerScene.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { WebglSurface } from './webglSurface.ts';

export type ExplorerResources = {
  source?: THREE.Object3D;
  renderer?: THREE.WebGLRenderer;
  webglSurface?: WebglSurface;
  gpuDevice?: GPUDevice;
};

type Inputs = {
  manifestUrl: string;
  metadataUrl: string;
  sceneFile: string;
  base: string;
  autonomous: boolean;
  backends: RenderBackend[];
  resources: ExplorerResources;
  progress: (phase: string, completed: number, total: number, message: string) => void;
};

export async function prepareExplorer(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, metadata, scope, signal, diagnosticChannel, diagnose } = session;
  const { manifestUrl, metadataUrl, sceneFile, base, autonomous, backends, resources, progress } =
    inputs;
  progress(
    'scene',
    0,
    1,
    `Chargement de ${metadata.selectedTriangles.toLocaleString()} triangles (${scope})`,
  );
  const loadedScene = await loadPreparedScene(
    options,
    metadata,
    sceneFile,
    base,
    scope,
    autonomous,
    signal,
    diagnose,
    (source) => {
      resources.source = source;
    },
  );
  const source = loadedScene.source;
  resources.source = source;
  const pageSources = await createExplorerPageSources(
    metadata,
    options,
    base,
    signal,
    autonomous,
    backends,
    diagnosticChannel,
    progress,
  );
  const configured = await configureExplorer(session, {
    autonomous,
    manifestUrl,
    metadataUrl,
    sceneFile,
    base,
    source,
    pageSources,
    resources,
  });
  resources.renderer = configured.renderer;
  resources.gpuDevice = configured.gpuDevice;
  const { viewport, context } = await prepareExplorerBackends(session, {
    source,
    sceneLightingSource: loadedScene.sceneLightingSource,
    associations: loadedScene.associations,
    textureIndices: loadedScene.textureIndices,
    pageSources,
    gpuDevice: resources.gpuDevice,
    directGpu: configured.directGpu,
    autonomous,
    backends,
    base,
  });
  // Framing replays the buffer reserved at load, then returns it: it is its last reader.
  const cameraState = createExplorerCamera(
    source,
    autonomous,
    loadedScene.associations,
    metadata,
    canvas,
    options,
    loadedScene.framingLot,
  );
  loadedScene.framingLot?.release();
  return {
    source,
    pageSources,
    capabilities: configured.capabilities,
    directGpu: configured.directGpu,
    viewport,
    context,
    ...cameraState,
  };
}
