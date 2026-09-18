import * as THREE from 'three';
import { createBlendCopy } from './blendCopyMesh.ts';
import { indexSourceBytes } from './webgpuPagesCatalogue.ts';
import type { BackendContext } from './backendTypes.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import {
  collectClusterPages,
  indexPagesByUrl,
  RequestStamps,
  rootCoverage,
} from './pageSelection.ts';
import { lighting } from './webgpuPagesHelpers.ts';
import { createHostRankDelta } from './webgpuPagesHostRanks.ts';
import { RASTER_BACKGROUND } from './pageRaster.ts';
import { POOL_LAYER_BYTES } from './textureTiles.ts';

/** Le budget d'allocation d'image par défaut, en octets : voir `createWebgpuPagesSetup`. */
export const DEFAULT_FRAME_BUDGET = 288 * 1024 * 1024;
/**
 * Le budget du pool de textures par défaut : 512 Mio, partagés à parts égales entre l'atlas
 * couleur et l'atlas de données, en couches de 30×30 tuiles de 136² texels (63,5 Mio chacune).
 * Fixe quelle que soit la scène, comme le budget d'image : c'est le critère de parité. Ce qu'une
 * vue demande de plus attend qu'une tuile moins regardée se libère, et le relevé le publie.
 */
const DEFAULT_TEXTURE_POOL_BUDGET = 512 * 1024 * 1024;

/** Couches par atlas que le budget donne ; refus nommé sous une couche par atlas. */
export function texturePoolLayersFor(budgetBytes: number, device: GPUDevice | undefined) {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1)
    throw new Error('INVALID_TEXTURE_POOL_BUDGET');
  const layers = Math.floor(budgetBytes / 2 / POOL_LAYER_BYTES);
  if (layers < 1)
    throw new Error(
      `TEXTURE_POOL_BUDGET: ${budgetBytes} bytes, under one layer per atlas (${2 * POOL_LAYER_BYTES})`,
    );
  const limit = device?.limits?.maxTextureArrayLayers;
  if (typeof limit === 'number' && layers > limit)
    throw new Error(
      `TEXTURE_POOL_DEVICE_LIMIT: ${layers} layers per atlas, device allows ${limit}`,
    );
  return layers;
}

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
  const { roots, allPages, blendCopies, prepared, requestCount, worlds } = collectClusterPages(
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
        copy = createBlendCopy(mesh, rec.renderOrder, rec.matrix);
      copy.userData.pagedBlend = true;
      pagedBlendCopies.set(mesh, copy);
      blendCopies.push(copy);
    }
  blendCopies.sort((a, b) => a.renderOrder - b.renderOrder);
  // Rang de requête → adresse, posée une fois pour la vie de la scène : la différence que l'hôte
  // reçoit après le rendu ne porte que des entiers, et c'est cette table qui les traduit.
  const requestUrls: string[] = new Array<string>(requestCount);
  for (let i = 0; i < allPages.length; i++) {
    const rec = allPages[i],
      rank = rec.requestIndex;
    if (rank !== undefined && rank >= 0 && rank < requestCount)
      requestUrls[rank] = rec.streamUrl ?? rec.url;
  }
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
  const sourceBytes = indexSourceBytes(allPages);
  // 288 Mio : ce que 2496 × 1404 — la résolution de relevé — demande avec toutes les cibles de la
  // version 1, la réserve Hi-Z, les deux cibles d'historique de l'antialiasing temporel et la
  // cible de retour d'image des transparents (289,7 Mo, calculé), arrondi au multiple de 32 Mio.
  // Avant l'historique, 256 suffisaient ; la 4K ne tenait pas et ne tient toujours pas.
  const frameBudget = context.maxFrameAllocationBytes ?? DEFAULT_FRAME_BUDGET;
  const reserveHiz = typeof gpuDevice?.createComputePipeline === 'function';
  const textureBudget = Math.max(
    1,
    Number.isFinite(context.maxTextureTransferBytesPerFrame)
      ? context.maxTextureTransferBytesPerFrame!
      : 16 * 1024 * 1024,
  );
  return {
    source,
    // L'index des matrices monde du moteur : ce que l'image remonte, et ce qu'un nœud déplacé
    // recalcule. Les fiches, les racines et les copies transparentes en portent les matrices.
    worlds,
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
    // Le dédoublonnage des clés de requête sans table de hachage, partagé par les deux listes que
    // l'hôte demande après le rendu : leur rang est posé une fois pour toutes par le catalogue.
    requestStamps: new RequestStamps(requestCount),
    requestUrls,
    // Ce que l'hôte épingle, tenu d'une image à l'autre et publié comme une différence de rangs.
    hostRanks: createHostRankDelta(requestCount, requestUrls),
    cap,
    slots,
    scene,
    pageBytes,
    sourceBytes,
    frameBudget,
    reserveHiz,
    textureBudget,
    texturePoolLayers: texturePoolLayersFor(
      context.texturePoolBytes ?? DEFAULT_TEXTURE_POOL_BUDGET,
      gpuDevice,
    ),
  };
}
