import type { BackendContext, RenderBackend } from './backendTypes.ts';
import { chooseBackends, resolveTextureSource } from './defaultBackends.ts';
import { configureExplorer } from './explorerCapabilities.ts';
import { directWebgpu } from './explorerInteractiveOptions.ts';
import { probeExplorerCapabilities } from './explorerCapabilityProbe.ts';
import { prepareExplorerBackends } from './explorerBackends.ts';
import { createExplorerCamera } from './explorerCamera.ts';
import { createExplorerPageSources } from './explorerPageSources.ts';
import { loadPreparedScene } from './explorerScene.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { WebglSurface } from './webglSurface.ts';

export type ExplorerResources = {
  source?: BackendContext['source'];
  webglSurface?: WebglSurface;
  gpuDevice?: GPUDevice;
};

/** The scene a loader builds: what `loadPreparedScene` returns. */
export type ExplorerScene = Awaited<ReturnType<typeof loadPreparedScene>>;

/** A scene the caller already holds, handed to `openMeasuredWorld` in place of a manifest URL. */
export type ExplorerSource = {
  manifestUrl: string;
  metadataUrl: string;
  base: string;
  metadata: import('../sdk-core/index.ts').ClusterManifest;
  scene: ExplorerScene;
};

type Inputs = {
  scene?: ExplorerScene;
  manifestUrl: string;
  metadataUrl: string;
  base: string;
  backends: RenderBackend[];
  resources: ExplorerResources;
  progress: (phase: string, completed: number, total: number, message: string) => void;
};

export async function prepareExplorer(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, metadata, scope, signal, diagnosticChannel, diagnose } = session;
  const { manifestUrl, metadataUrl, base, backends, resources, progress } = inputs;
  // The machine is read before the scene: which engine path renders decides which file the
  // session loads — the cache's prepared scene for the autonomous path, `source.gltf` otherwise.
  const { capabilities, gpuDevice } = await probeExplorerCapabilities(session);
  resources.gpuDevice = gpuDevice;
  const choice = chooseBackends(options, metadata, gpuDevice, !!capabilities.renderer);
  const autonomous = choice.autonomous;
  // What the loader opens follows what will draw: a path that samples the host images needs
  // them read, however the host set `textureSource`.
  const textureSource = resolveTextureSource(options.textureSource, choice.factories);
  diagnose('backend-choice', 'Backend chosen for this session', {
    kind: 'configuration',
    scope,
    origin: choice.origin,
    reason: choice.reason,
    renderer: choice.renderer,
    autonomous,
    webgpuDevice: !!gpuDevice,
    textureSource,
  });
  const sceneFile = autonomous ? metadata.autonomousScene! : 'source.gltf';
  progress(
    'scene',
    0,
    1,
    `Chargement de ${metadata.selectedTriangles.toLocaleString()} triangles (${scope})`,
  );
  const loadedScene =
    inputs.scene ??
    (await loadPreparedScene(
      { ...options, textureSource },
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
    ));
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
  const directGpu = directWebgpu(options, choice.factories, gpuDevice);
  await configureExplorer(session, {
    choice,
    directGpu,
    manifestUrl,
    metadataUrl,
    sceneFile,
    base,
    source,
    pageSources,
    resources,
  });
  const { viewport, context } = await prepareExplorerBackends(session, {
    source,
    sceneLightingSource: loadedScene.sceneLightingSource,
    associations: loadedScene.associations,
    textureIndices: loadedScene.textureIndices,
    pageSources,
    gpuDevice,
    webglContext: resources.webglSurface?.context,
    directGpu,
    factories: choice.factories,
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
    capabilities,
    directGpu,
    viewport,
    context,
    ...cameraState,
  };
}
