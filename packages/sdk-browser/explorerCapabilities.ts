import { directWebgpu } from './explorerInteractiveOptions.ts';
import { mathBatchMetrics, prepareMathBatch } from './mathBatchState.ts';
import { pageDecodeTransport } from './pageDecodeShared.ts';
import { materialTextures, meshes as objects } from './sceneMeshes.ts';
import { SDK_BUILD_PROVENANCE } from './buildProvenance.ts';
import {
  DEFAULT_HEIGHT,
  DEFAULT_PAGE_WORKERS,
  DEFAULT_WIDTH,
  devicePixels,
} from './backendCommon.ts';
import type { BackendChoice } from './defaultBackends.ts';
import type { BackendContext } from './backendTypes.ts';
import type { createExplorerPageSources } from './explorerPageSources.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { WebglSurface } from './webglSurface.ts';
import { prepareExplorerWebglSurface } from './explorerWebglHost.ts';
type Inputs = {
  choice: BackendChoice;
  gpuDevice?: GPUDevice;
  manifestUrl: string;
  metadataUrl: string;
  sceneFile: string;
  base: string;
  source: BackendContext['source'];
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
  const { canvas, options, scope, metadata, diagnosticChannel, diagnose } = session;
  const { choice, gpuDevice, manifestUrl, metadataUrl, sceneFile, base, source, pageSources } =
    inputs;
  const { resources } = inputs;
  const autonomous = choice.autonomous;
  const { pages, geometryPages, cacheCap } = pageSources;
  const calculEnLot = prepareMathBatch(options.mathPath ?? 'auto');
  const directGpu = directWebgpu(options, choice.factories, gpuDevice);
  if (!directGpu) {
    // The engine's surface is the session's only WebGL2 resource: the composition host builds
    // its programs and targets on it later.
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
        for (const texture of materialTextures(material)) {
          texture.anisotropy = maximum;
          texture.needsUpdate = true;
        }
  }
  return { directGpu };
}
