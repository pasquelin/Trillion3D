import * as THREE from 'three';
import type { AssetScope, ClusterManifest, RuntimeEvent } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import { configureExplorer } from './explorerCapabilities.ts';
import { prepareExplorerBackends } from './explorerBackends.ts';
import { createExplorerCamera } from './explorerCamera.ts';
import { createExplorerPageSources } from './explorerPageSources.ts';
import { loadPreparedScene } from './explorerScene.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';

export type ExplorerResources = {
  source?: THREE.Object3D;
  renderer?: THREE.WebGLRenderer;
  gpuDevice?: GPUDevice;
};

type Inputs = {
  canvas: HTMLCanvasElement;
  options: ExplorerOptions;
  metadata: ClusterManifest;
  manifestUrl: string;
  metadataUrl: string;
  sceneFile: string;
  base: string;
  scope: AssetScope;
  autonomous: boolean;
  signal?: AbortSignal;
  backends: RenderBackend[];
  resources: ExplorerResources;
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  progress: (phase: string, completed: number, total: number, message: string) => void;
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

export async function prepareExplorer(inputs: Inputs) {
  const {
    canvas,
    options,
    metadata,
    manifestUrl,
    metadataUrl,
    sceneFile,
    base,
    scope,
    autonomous,
    signal,
    backends,
    resources,
    diagnosticChannel,
    progress,
    emit,
    diagnose,
  } = inputs;
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
  const configured = await configureExplorer({
    canvas,
    options,
    scope,
    autonomous,
    metadata,
    manifestUrl,
    metadataUrl,
    sceneFile,
    base,
    source,
    pageSources,
    diagnosticChannel,
    resources,
    emit,
    diagnose,
  });
  resources.renderer = configured.renderer;
  resources.gpuDevice = configured.gpuDevice;
  const { viewport, context } = await prepareExplorerBackends({
    canvas,
    options,
    scope,
    metadata,
    source,
    sceneLightingSource: loadedScene.sceneLightingSource,
    associations: loadedScene.associations,
    signal,
    pageSources,
    diagnosticChannel,
    gpuDevice: resources.gpuDevice,
    directGpu: configured.directGpu,
    autonomous,
    backends,
    emit,
    diagnose,
  });
  const cameraState = createExplorerCamera(
    source,
    autonomous,
    loadedScene.associations,
    metadata,
    canvas,
    options,
  );
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
