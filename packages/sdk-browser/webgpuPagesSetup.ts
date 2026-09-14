import * as THREE from 'three';
import type { BackendContext } from './backendTypes.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import {
  collectClusterPages,
  indexPagesByUrl,
  pageRequestUrl,
  rootCoverage,
} from './pageSelection.ts';
import { lighting } from './webgpuPagesHelpers.ts';
import { RASTER_BACKGROUND } from './pageRaster.ts';

export type WebgpuDiagnostics = ReturnType<typeof createWebgpuDiagnostics> & {
  traceEnabled: boolean;
};
export type WebgpuPagesSetup = ReturnType<typeof createWebgpuPagesSetup>;

/** Everything the backend derives once from the host context: the page catalogue, its bootstrap
 *  cover, the request index, the slot budget and the scene the forward copies live in. */
export function createWebgpuPagesSetup(context: BackendContext, diag: WebgpuDiagnostics) {
  const { source, metadata, indices, associations, maxResidentPages, gpuDevice } = context;
  const viewport = context.viewport ?? [1, 1];
  const clearColor = context.clearColor ?? RASTER_BACKGROUND;
  const inputColor = {
    clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
    value: clearColor,
    source: context.clearColor === undefined ? 'fallback moteur' : 'hôte',
  };
  diag.engineDiagnostic(
    'clear-color-input',
    'Couleur de fond reçue par WebGeometry WebGPU',
    inputColor,
  );
  if (typeof window !== 'undefined')
    console.info('[web-geometry] couleur de fond reçue par WebGeometry WebGPU', inputColor);
  const { roots, allPages, blendCopies, prepared } = collectClusterPages(
    source,
    metadata,
    indices,
    associations,
    { allowMissing: true },
  );
  // Transparent pages share selection/residency with opaque pages, but retain
  // one forward draw per source mesh (all back faces, then all front faces).
  const pagedBlendCopies = new Map<THREE.Mesh, THREE.Mesh>();
  for (const rec of allPages)
    if (rec.transparent && rec.sourceMesh && !pagedBlendCopies.has(rec.sourceMesh)) {
      const mesh = rec.sourceMesh,
        copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(mesh.matrixWorld);
      copy.renderOrder = rec.renderOrder;
      copy.userData.sourceMesh = mesh;
      copy.userData.pagedBlend = true;
      pagedBlendCopies.set(mesh, copy);
      blendCopies.push(copy);
    }
  blendCopies.sort((a, b) => a.renderOrder - b.renderOrder);
  const tracking = createWebgpuPageTracking(allPages);
  diag.traceDiagnostic('page-catalog', 'Catalogue stable des pages WebGPU', {
    backend: 'webgpu-page-raster',
    count: tracking.pageCatalog.length,
    urls: tracking.pageCatalog,
  });
  const bootstrap = rootCoverage(roots),
    bootstrapUrls = new Set(bootstrap.map((page) => page.url));
  const bootstrapKeys = new Int32Array(bootstrap.length),
    bootstrapKey = new Uint8Array(tracking.keyCount);
  for (let i = 0; i < bootstrap.length; i++) {
    bootstrapKeys[i] = tracking.keyOf(bootstrap[i]);
    bootstrapKey[bootstrapKeys[i]] = 1;
  }
  // `byUrl` is indexed by REQUEST key: the streaming bundle when the cache publishes one, the cluster
  // object otherwise. One request therefore hands bytes to every cluster that shares it. The GPU page
  // cache stays keyed by cluster (`rec.url`), because that is the granularity it uploads and pins.
  const byUrl = indexPagesByUrl(allPages);
  const bundledPages = allPages.some((page) => page.streamUrl !== undefined);
  const requestUrlByPage = bundledPages
    ? new Map(allPages.map((page) => [page.url, pageRequestUrl(page)] as const))
    : undefined;
  const cap = maxResidentPages ?? Math.max(1024, prepared);
  const uniquePages = Math.max(1, new Set(allPages.map((page) => page.url)).size);
  const slots = Math.max(1, Math.min(cap, uniquePages));
  const scene = new THREE.Scene();
  lighting(scene, clearColor);
  for (const copy of blendCopies) scene.add(copy);
  let pageBytes = 4;
  for (const page of allPages) {
    const n = page.array?.byteLength ?? page.indexBytes;
    const padded = n + (n % 4 ? 4 - (n % 4) : 0);
    if (padded > pageBytes) pageBytes = padded;
  }
  const sourceBytes = new Map(
    allPages.flatMap((page) =>
      page.array
        ? [
            [
              page.url,
              new Uint8Array(page.array.buffer, page.array.byteOffset, page.array.byteLength),
            ] as const,
          ]
        : [],
    ),
  );
  const frameBudget = context.maxFrameAllocationBytes ?? 256 * 1024 * 1024;
  const reserveHiz = typeof gpuDevice?.createComputePipeline === 'function';
  const textureBudget = Math.max(
    1,
    Number.isFinite(context.maxTextureTransferBytesPerFrame)
      ? context.maxTextureTransferBytesPerFrame!
      : 16 * 1024 * 1024,
  );
  return {
    source,
    gpuDevice,
    viewport,
    clearColor,
    roots,
    allPages,
    blendCopies,
    pagedBlendCopies,
    tracking,
    bootstrap,
    bootstrapUrls,
    bootstrapKeys,
    bootstrapKey,
    byUrl,
    requestUrlByPage,
    cap,
    slots,
    scene,
    pageBytes,
    sourceBytes,
    frameBudget,
    reserveHiz,
    textureBudget,
  };
}
