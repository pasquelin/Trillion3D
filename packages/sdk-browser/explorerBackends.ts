import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { autonomousPagesBackend } from './autonomousPages.ts';
import { DEFAULT_BACKENDS } from './defaultBackends.ts';
import { DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import type { BackendContext, ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { AssetScope, ClusterManifest, RuntimeEvent } from '../sdk-core/index.ts';
import type { createExplorerPageSources } from './explorerPageSources.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';

type Inputs = {
  canvas: HTMLCanvasElement;
  options: ExplorerOptions;
  scope: AssetScope;
  metadata: ClusterManifest;
  source: THREE.Object3D;
  sceneLightingSource?: THREE.Object3D;
  associations: BackendContext['associations'];
  signal?: AbortSignal;
  pageSources: Awaited<ReturnType<typeof createExplorerPageSources>>;
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  gpuDevice?: GPUDevice;
  directGpu: boolean;
  autonomous: boolean;
  backends: RenderBackend[];
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

export async function prepareExplorerBackends(inputs: Inputs) {
  const {
    canvas,
    options,
    scope,
    metadata,
    source,
    sceneLightingSource,
    associations,
    signal,
    pageSources,
    diagnosticChannel,
    gpuDevice,
    directGpu,
    autonomous,
    backends,
    emit,
    diagnose,
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
    sceneLighting: sceneLightingSource,
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
