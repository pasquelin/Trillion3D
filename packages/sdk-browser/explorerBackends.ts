import * as THREE from 'three';
import type { HostNode } from './hostResources.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { autonomousPagesBackend } from './autonomousPages.ts';
import { DEFAULT_BACKENDS } from './defaultBackends.ts';
import { DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import { createSceneLightStore, dagWarningsDiagnostic } from '../sdk-core/index.ts';
import { createSceneProxyReader } from './sceneProxyLoad.ts';
import { createTextureLevelReader } from './textureLevelReader.ts';
import { resolveDiagnosticGpuVariant } from './diagnosticGpuVariant.ts';
import { declareImportedLights, loadImportedLights } from './importedLights.ts';
import type { BackendContext, RenderBackend } from './backendTypes.ts';
import type { createExplorerPageSources } from './explorerPageSources.ts';
import type { ExplorerSession } from './explorerSession.ts';

type Inputs = {
  source: THREE.Object3D;
  sceneLightingSource?: HostNode;
  associations: BackendContext['associations'];
  textureIndices: Map<THREE.Texture, number>;
  pageSources: Awaited<ReturnType<typeof createExplorerPageSources>>;
  gpuDevice?: GPUDevice;
  webglContext?: WebGL2RenderingContext;
  directGpu: boolean;
  autonomous: boolean;
  backends: RenderBackend[];
  /** Manifest url base: that is what locates the resident-proxy cache object. */
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
    webglContext,
    directGpu,
    autonomous,
    backends,
    base,
  } = inputs;
  const { indices, streamer, attachCap, cacheCap, preload } = pageSources;
  const viewport: [number, number] = [canvas.width, canvas.height];
  // One light store per session: every engine reads it, the host is the only one that writes it.
  const sceneLights = createSceneLightStore();
  // Lights the source file carried, declared before the first engine: the `auto` view knows
  // from its first frame that it has a source, and no engine prepares on an empty store that
  // would then have to be pushed. A cache without this product declares none, as before.
  let importedLightIds: string[] = [];
  if (options.importedLights !== false) {
    const imported = await loadImportedLights(base, signal);
    const { declared, dropped } = declareImportedLights(sceneLights, imported.lights);
    importedLightIds = declared;
    if (declared.length || dropped || Object.keys(imported.rejected).length)
      diagnose('imported-lights', 'Lights declared by the source file', {
        kind: 'preparation',
        declared: declared.length,
        dropped,
        rejected: imported.rejected,
        maxLights: sceneLights.settings.maxLights,
        scope,
      });
  }
  // What the compiler named without being able to fix it — a DAG that is not mounted — is
  // said at open, before the engine is chosen: it is a fact of the cache, not of an engine.
  const dagWarnings = dagWarningsDiagnostic(metadata.primitives);
  if (dagWarnings)
    diagnose(dagWarnings.phase, dagWarnings.message, {
      kind: 'preparation',
      ...dagWarnings.context,
    });
  const context: BackendContext = {
    source,
    metadata,
    indices,
    readPage: (url) => streamer.read(url),
    readGeometryPage: (url) => streamer.readBytes(url),
    associations: associations,
    textureIndices,
    signal,
    // The page ceiling is the host's, or nothing: the WebGPU engine holds its pool in bytes;
    // host-memory engines keep by default what the streamer computed for them.
    maxResidentPages: options.maxResidentPages,
    residentPagesDefault: attachCap,
    maxCachedPages: cacheCap,
    pixelError: options.pixelError ?? 0,
    lodAdaptive: options.lodAdaptive,
    clearColor: options.clearColor ?? DEFAULT_CLEAR_COLOR,
    onDiagnostic: diagnosticChannel.enabled ? diagnosticChannel.emit : undefined,
    diagnosticDetail: diagnosticChannel.detail,
    viewport,
    gpuDevice,
    webglContext,
    gpuCanvas: directGpu ? canvas : undefined,
    maxTextureTransferBytesPerFrame: options.maxTextureTransferBytesPerFrame,
    maxTextureUploadMsPerFrame: options.maxTextureUploadMsPerFrame,
    temporalAntialiasing: options.temporalAntialiasing ?? true,
    geometryPoolBytes: options.geometryPoolBytes,
    geometryPoolCeilingBytes: options.geometryPoolCeilingBytes,
    texturePoolBytes: options.texturePoolBytes,
    textureCompression: options.textureCompression,
    stageProfile: options.stageProfile === true,
    // The diagnostic variant is checked here, once: outside `trace`, it is refused.
    diagnosticGpuVariant: resolveDiagnosticGpuVariant(
      options.diagnosticGpuVariant,
      diagnosticChannel.detail,
    ),
    shadowBudgetMs: options.shadowBudgetMs,
    shadowPageInvalidation: options.shadowPageInvalidation,
    sceneLighting: sceneLightingSource,
    // Bounced light stays off by default: its measured step holds 1.1 to 1.3 ms on Emerald,
    // above the one-millisecond bar, and the host turns it on explicitly.
    bounce: options.bounce,
    bounceBudgetMs: options.bounceBudgetMs,
    readSceneProxy: createSceneProxyReader(metadata.proxy, base, signal),
    // The reader exists only at the host's request: under `'host'`, the loader has read and
    // decoded the images, and the engine takes the previous path — reading them a second time
    // from the cache would double the network for the same image.
    readTextureLevel:
      options.textureSource === 'cache'
        ? createTextureLevelReader(metadata.textures, base, signal)
        : undefined,
    sceneLights,
    importedLightIds,
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
