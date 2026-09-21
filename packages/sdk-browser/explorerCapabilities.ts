import * as THREE from 'three';
import { directWebgpu } from './explorerInteractiveOptions.ts';
import { detectCapabilities } from './capabilities.ts';
import { mathBatchMetrics, prepareMathBatch } from './mathBatchState.ts';
import { pageDecodeTransport } from './pageDecodeShared.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { meshes as objects } from './sceneMeshes.ts';
import { SDK_BUILD_PROVENANCE } from './buildProvenance.ts';
import {
  DEFAULT_HEIGHT,
  DEFAULT_PAGE_WORKERS,
  DEFAULT_WIDTH,
  WEBGPU_REQUIRED_LIMITS,
  devicePixels,
} from './backendCommon.ts';
import type { createExplorerPageSources } from './explorerPageSources.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { WebglSurface } from './webglSurface.ts';
import { prepareExplorerWebglSurface } from './explorerWebglHost.ts';
type Inputs = {
  autonomous: boolean;
  manifestUrl: string;
  metadataUrl: string;
  sceneFile: string;
  base: string;
  source: THREE.Object3D;
  pageSources: Awaited<ReturnType<typeof createExplorerPageSources>>;
  resources: {
    webglSurface?: WebglSurface;
    gpuDevice?: GPUDevice;
  };
};
/** The anisotropy the context allows, read where the reference renderer reads it. */
function maxAnisotropy(gl: WebGL2RenderingContext) {
  const extension = gl.getExtension('EXT_texture_filter_anisotropic');
  return extension ? (gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
}
export async function configureExplorer(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, scope, metadata, diagnosticChannel, emit, diagnose } = session;
  const { autonomous, manifestUrl, metadataUrl, sceneFile, base, source, pageSources, resources } =
    inputs;
  const { pages, geometryPages, cacheCap } = pageSources;
  let gpuDevice: GPUDevice | undefined;
  const calculEnLot = prepareMathBatch(options.mathPath ?? 'auto');
  const capabilities = await detectCapabilities('webgl', canvas);
  if (!capabilities.renderer) {
    emit({
      eventVersion: 1,
      type: 'fatal',
      audience: 'blocking',
      recovered: false,
      code: 'NO_WEBGL2',
      detail: capabilities.reason,
    });
    diagnose('error', 'WebGL2 capability check failed', {
      kind: 'error',
      code: 'NO_WEBGL2',
      reason: capabilities.reason,
      scope,
    });
    throw new Error(capabilities.reason);
  }
  emit({
    eventVersion: 1,
    type: 'capability',
    audience: 'diagnostic',
    recovered: true,
    code: 'WEBGL2_BASELINE',
    detail: capabilities.reason,
  });
  diagnose('capability', 'WebGL2 capability detected', {
    kind: 'capability',
    backend: 'webgl',
    reason: capabilities.reason,
    scope,
  });
  const wantsWebgpu =
    !autonomous && (!options.backends || options.backends.includes(webgpuPagesBackend));
  try {
    if (wantsWebgpu) {
      const gpu = options.gpu ?? (typeof navigator === 'undefined' ? undefined : navigator.gpu);
      if (gpu) {
        const gpuCaps = await detectCapabilities('webgpu', canvas, { gpu });
        if (gpuCaps.renderer) {
          emit({
            eventVersion: 1,
            type: 'capability',
            audience: 'diagnostic',
            recovered: true,
            code: 'WEBGPU_AVAILABLE',
            detail: gpuCaps.reason,
          });
          diagnose('capability', 'WebGPU capability detected', {
            kind: 'capability',
            backend: 'webgpu',
            reason: gpuCaps.reason,
            scope,
          });
        }
        if (gpuCaps.adapter) {
          const features: GPUFeatureName[] = [];
          if (gpuCaps.adapter.features.has('indirect-first-instance'))
            features.push('indirect-first-instance');
          if (gpuCaps.adapter.features.has('timestamp-query')) features.push('timestamp-query');
          const adapterLimits = gpuCaps.adapter.limits;
          const requiredLimits: Record<string, number> = {};
          for (const name of WEBGPU_REQUIRED_LIMITS) {
            const value = (adapterLimits as unknown as Record<string, number | undefined>)[name];
            if (typeof value === 'number' && Number.isFinite(value)) requiredLimits[name] = value;
          }
          gpuDevice = await gpuCaps.adapter.requestDevice({
            requiredFeatures: features,
            requiredLimits,
          });
          resources.gpuDevice = gpuDevice;
        }
      }
    }
  } catch (error) {
    diagnose('fallback', 'WebGPU setup unavailable; WebGL path retained', {
      kind: 'fallback',
      backend: 'webgpu',
      error: String(error),
      scope,
    }); /* WebGPU stays optional; the WebGL2 backends remain the default path. */
  }
  const directGpu = directWebgpu(options, gpuDevice);
  if (!directGpu) {
    // The engine's surface is the session's WebGL2 resource: the composition host mounts its
    // draw adapter on it later, and nothing here knows of one.
    resources.webglSurface = prepareExplorerWebglSurface({
      canvas,
      size: options,
      onLifecycle: (state) =>
        diagnose(`webgl-context-${state}`, `Engine WebGL2 surface context ${state}`, {
          kind: 'lifecycle',
          scope,
        }),
    });
  } else {
    canvas.width = devicePixels(options.width ?? DEFAULT_WIDTH, options.pixelRatio);
    canvas.height = devicePixels(options.height ?? DEFAULT_HEIGHT, options.pixelRatio);
  }
  await calculEnLot;
  diagnose('configuration', 'Active explorer configuration', {
    kind: 'configuration',
    scope,
    detail: diagnosticChannel.detail,
    backendMode: autonomous ? 'autonomous-webgl' : directGpu ? 'webgpu-direct' : 'webgl-composed',
    limits: {
      maxResidentPages: options.maxResidentPages ?? null,
      maxCachedPages: cacheCap,
      pageFetchWorkers: options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
      geometryPoolBytes: options.geometryPoolBytes ?? null,
      texturePoolBytes: options.texturePoolBytes ?? null,
    },
    pageCatalogue: (autonomous ? geometryPages : pages).map((page) => ({
      url: page.url,
      bytes: page.bytes,
    })),
    mathBatch: mathBatchMetrics(),
    // Decoded-page path: `partage` when the page is isolated between origins and shared
    // memory exists, `transfert` everywhere else. Announced, never guessed.
    pageDecode: pageDecodeTransport(),
    provenance: {
      sdk: SDK_BUILD_PROVENANCE,
      manifestUrl,
      metadataUrl,
      formatVersion: metadata.formatVersion ?? metadata.schema,
      schema: metadata.schema,
      compilerVersion: metadata.compilerVersion ?? null,
      sourceGltfUrl: new URL(sceneFile, base).href,
    },
  });
  if (options.detail === 'maximum' && resources.webglSurface) {
    const maximum = maxAnisotropy(resources.webglSurface.context);
    for (const mesh of objects(source))
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) {
            value.anisotropy = maximum;
            value.needsUpdate = true;
          }
  }
  return { capabilities, gpuDevice, directGpu };
}
