import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { autonomousPagesBackend } from './autonomousPages.ts';
import { DEFAULT_BACKENDS } from './defaultBackends.ts';
import { DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import { createSceneLightStore } from '../sdk-core/index.ts';
import { createSceneProxyReader } from './sceneProxyLoad.ts';
import type { BackendContext, RenderBackend } from './backendTypes.ts';
import type { createExplorerPageSources } from './explorerPageSources.ts';
import type { ExplorerSession } from './explorerSession.ts';

type Inputs = {
  source: THREE.Object3D;
  sceneLightingSource?: THREE.Object3D;
  associations: BackendContext['associations'];
  textureIndices: Map<THREE.Texture, number>;
  pageSources: Awaited<ReturnType<typeof createExplorerPageSources>>;
  gpuDevice?: GPUDevice;
  directGpu: boolean;
  autonomous: boolean;
  backends: RenderBackend[];
  /** Base d'url du manifeste : c'est elle qui situe l'objet de cache du proxy résident. */
  base: string;
};

export async function prepareExplorerBackends(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, scope, metadata, signal, diagnosticChannel, emit, diagnose } = session;
  const {
    source,
    sceneLightingSource,
    associations,
    textureIndices,
    pageSources,
    gpuDevice,
    directGpu,
    autonomous,
    backends,
    base,
  } = inputs;
  const { indices, streamer, attachCap, cacheCap, preload } = pageSources;
  const viewport: [number, number] = [canvas.width, canvas.height];
  const context: BackendContext = {
    source,
    metadata,
    indices,
    readPage: (url) => streamer.read(url),
    readGeometryPage: (url) => streamer.readBytes(url),
    associations: associations,
    textureIndices,
    signal,
    maxResidentPages: attachCap,
    maxCachedPages: cacheCap,
    pixelError: options.pixelError ?? 0,
    lodAdaptive: options.lodAdaptive,
    clearColor: options.clearColor ?? DEFAULT_CLEAR_COLOR,
    onDiagnostic: diagnosticChannel.enabled ? diagnosticChannel.emit : undefined,
    diagnosticDetail: diagnosticChannel.detail,
    viewport,
    gpuDevice,
    gpuCanvas: directGpu ? canvas : undefined,
    maxFrameAllocationBytes: options.maxFrameAllocationBytes,
    maxTextureTransferBytesPerFrame: options.maxTextureTransferBytesPerFrame,
    atlasClasses: options.atlasClasses ?? 1,
    stageProfile: options.stageProfile === true,
    sceneLighting: sceneLightingSource,
    // La lumière qui rebondit est éteinte par défaut : son coût carte graphique reste très
    // au-dessus du budget publié, et l'hôte l'allume explicitement quand il la veut.
    bounce: options.bounce,
    readSceneProxy: createSceneProxyReader(metadata.proxy, base, signal),
    // Un seul magasin de lampes par session : chaque moteur le lit, l'hôte est le seul à l'écrire.
    sceneLights: createSceneLightStore(),
  };
  const factories = autonomous
    ? [autonomousPagesBackend]
    : (options.backends ??
      (gpuDevice ? [...DEFAULT_BACKENDS, webgpuPagesBackend] : DEFAULT_BACKENDS));
  for (const factory of factories) {
    const backend = factory(context);
    if (backends.some((b) => b.id === backend.id)) throw new Error('Duplicate backend id');
    diagnose('backend-preparation-start', 'Backend preparation started', {
      kind: 'preparation',
      backend: backend.id,
      scope,
    });
    try {
      await backend.prepare();
      backends.push(backend);
      diagnose('backend-preparation-complete', 'Backend preparation completed', {
        kind: 'preparation',
        backend: backend.id,
        scope,
      });
    } catch (error) {
      diagnose('backend-preparation-error', 'Backend preparation failed', {
        kind: 'error',
        backend: backend.id,
        error: String(error),
        scope,
      });
      backend.dispose();
      if (backend.id === 'webgpu-page-raster' && !directGpu) {
        emit({
          eventVersion: 1,
          type: 'fallback',
          audience: 'diagnostic',
          recovered: true,
          code: 'WEBGPU_UNAVAILABLE',
          detail: String(error),
        });
        diagnose('fallback', 'WebGPU backend unavailable; continue with other backends', {
          kind: 'fallback',
          backend: backend.id,
          error: String(error),
          scope,
        });
        continue;
      }
      throw error;
    }
  }
  if (preload !== 'all') indices.clear();
  if (!backends.length) throw new Error('No backend');
  return { viewport, context };
}
