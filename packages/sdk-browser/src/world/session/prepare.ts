import type { BackendContext, RenderBackend } from '../../backend/types.ts';
import { chooseBackends, resolveTextureSource } from '../../backend/defaultBackends.ts';
import { configureExplorer } from './capabilities.ts';
import { directWebgpu } from './interactiveOptions.ts';
import { probeExplorerCapabilities } from './capabilityProbe.ts';
import { prepareExplorerBackends } from './backends.ts';
import { createExplorerCamera } from '../camera/camera.ts';
import { createExplorerPageSources } from './pageSources.ts';
import { loadPreparedScene } from '../scene/scene.ts';
import { primePartitions } from '../scene/partitionFrame.ts';
import type { ExplorerSession } from './session.ts';
import type { WebglSurface } from '../../webgl/core/surface.ts';

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
  metadata: import('../../../../sdk-core/src/index.ts').ClusterManifest;
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
    loadedScene.partitions.flatMap((cells) => cells.pages),
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
  // The cells the first camera needs are placed before the engines read their rows: the first
  // frame reads them and nothing further (`partitionFrame.ts`).
  if (loadedScene.partitions.length) {
    const bytes = await primePartitions(
      loadedScene.partitions,
      cameraState.camera,
      canvas.height,
      options.pixelError ?? 0,
      pageSources.streamer,
      signal,
    );
    diagnose('partition', 'Cells read before the first frame', {
      kind: 'preparation',
      scope,
      bytes,
      cells: loadedScene.partitions.map((cells) => cells.stats()),
    });
  }
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
  return {
    source,
    partitions: loadedScene.partitions,
    pageSources,
    capabilities,
    directGpu,
    viewport,
    context,
    ...cameraState,
  };
}
