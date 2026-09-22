import type { HostMesh } from './hostResources.ts';
import type { BlendCopy } from './blendCopyContract.ts';
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
import { createBlendHostScene } from './hostBlendScene.ts';
import { createHostRankDelta } from './webgpuPagesHostRanks.ts';
import { RASTER_BACKGROUND } from './pageRaster.ts';
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
  geometryPoolFor,
  textureTransferBytesFor,
  textureUploadMsFor,
  type TexturePools,
} from './webgpuMemoryBudgets.ts';

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
    source: context.clearColor === undefined ? 'engine fallback' : 'host',
  };
  diag.engineDiagnostic(
    'clear-color-input',
    'Background colour received by WebGeometry WebGPU',
    inputColor,
  );
  if (typeof window !== 'undefined')
    console.info('[web-geometry] background colour received by WebGeometry WebGPU', inputColor);
  const { roots, allPages, blendCopies, requestCount, worlds } = collectClusterPages(
    source,
    metadata,
    indices,
    associations,
    { allowMissing: true },
  );
  // Transparent pages share selection/residency with opaque pages, but retain
  // one forward draw per source mesh (all back faces, then all front faces).
  const pagedBlendCopies = new Map<HostMesh, BlendCopy>();
  for (const rec of allPages)
    if (rec.transparent && rec.sourceMesh) {
      const mesh = rec.sourceMesh;
      if (pagedBlendCopies.has(mesh)) continue;
      const copy = createBlendCopy(mesh, rec.renderOrder, rec.matrix, rec.material);
      copy.userData.pagedBlend = true;
      pagedBlendCopies.set(mesh, copy);
      blendCopies.push(copy);
    }
  blendCopies.sort((a, b) => a.renderOrder - b.renderOrder);
  // Request rank → address, posted once for the scene's life: the delta the host receives after the
  // render carries only integers, and it is this table that translates them.
  const requestUrls: string[] = new Array<string>(requestCount);
  for (let i = 0; i < allPages.length; i++) {
    const rec = allPages[i],
      rank = rec.requestIndex;
    if (rank !== undefined && rank >= 0 && rank < requestCount)
      requestUrls[rank] = rec.streamUrl ?? rec.url;
  }
  const tracking = createWebgpuPageTracking(allPages);
  diag.traceDiagnostic('page-catalog', 'Stable WebGPU page catalogue', {
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
  const uniquePages = Math.max(1, new Set(allPages.map((page) => page.url)).size);
  const scene = createBlendHostScene(clearColor, blendCopies);
  // What a pool slot holds for a cluster: its quantized geometry page where the cache carries
  // one, its index page otherwise. The slot is the widest of them, so any admitted page fits.
  const geometryUrls = new Map<string, string>();
  let pageBytes = 4,
    fromGeometryPage = 0,
    fromSourceGeometry = 0,
    transparentClusters = 0;
  for (const page of allPages) {
    const geometry = page.geometryPage;
    if (geometry) {
      geometryUrls.set(page.url, geometry.url);
      fromGeometryPage++;
    } else if (page.transparent) transparentClusters++;
    else fromSourceGeometry++;
    const n = geometry ? geometry.bytes : (page.array?.byteLength ?? page.indexBytes);
    const padded = n + (n % 4 ? 4 - (n % 4) : 0);
    if (padded > pageBytes) pageBytes = padded;
  }
  // Said out loud, never silently: an opaque or masked cluster the cache gave no geometry page
  // still draws from the source float buffers, and that is what those bytes are there for.
  diag.engineDiagnostic('geometry-pages', 'Clusters drawn from their quantized page', {
    backend: 'webgpu-page-raster',
    clusters: allPages.length,
    fromGeometryPage,
    fromSourceGeometry,
    transparentClusters,
    slotBytes: pageBytes,
  });
  const sourceBytes = indexSourceBytes(allPages);
  // The engine's two fixed pools, in bytes, as in the reference: what does not fit renders coarser.
  // Image targets, themselves, follow resolution with no ceiling.
  const poolFor = (budgetBytes: number, ceilingSlots?: number) =>
    geometryPoolFor({
      budgetBytes,
      pageBytes,
      uniquePages,
      rootPages: bootstrapUrls.size,
      maxResidentPages,
      ceilingSlots,
      limits: gpuDevice?.limits,
    });
  const geometryPool = poolFor(context.geometryPoolBytes ?? DEFAULT_GEOMETRY_POOL_BUDGET);
  // Ceiling the pool can reach mid-session (`setMemoryBudgets`): tables sized by drawable page are
  // sized once, to that ceiling. With no declared ceiling, it is the starting budget.
  const cap = poolFor(
    Math.max(geometryPool.budgetBytes, context.geometryPoolCeilingBytes ?? 0),
  ).slots;
  // The texture pools are prepare's to draw, once the catalogue says which family the session
  // samples and which lane each texture takes; until then only the budget is held.
  const texturePoolBudget = context.texturePoolBytes ?? DEFAULT_TEXTURE_POOL_BUDGET;
  const reserveHiz = typeof gpuDevice?.createComputePipeline === 'function';
  // The tile pass's two budgets: bytes, and the reference's fixed upload cadence in the frame's
  // own unit.
  const textureBudget = textureTransferBytesFor(context.maxTextureTransferBytesPerFrame);
  const textureUploadMs = textureUploadMsFor(context.maxTextureUploadMsPerFrame);
  return {
    source,
    // Index of the engine's world matrices: what the image walks, and what a moved node recomputes.
    // Rows, roots and transparent copies carry the matrices.
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
    // Dedup of request keys without a hash table, shared by the two lists the host asks after the
    // render: their rank is posted once and for all by the catalogue.
    requestStamps: new RequestStamps(requestCount),
    requestUrls,
    // What the host pins, held from one image to the next and published as a rank delta.
    hostRanks: createHostRankDelta(requestCount, requestUrls),
    // Ceiling of tables sized by drawable page: the slots the pool can reach mid-session.
    cap,
    scene,
    pageBytes,
    sourceBytes,
    // Geometry page url of every cluster drawn from one, by cluster address: what the pool reads
    // for that slot. A cluster absent from this table is uploaded from `sourceBytes`.
    geometryUrls,
    reserveHiz,
    textureBudget,
    textureUploadMs,
    // The two pools as they are held; `setMemoryBudgets` replaces them with another drawn from the
    // same rule, `slots` follows.
    geometryPool,
    // The same pool for another budget, under the session ceiling.
    geometryPoolFor: (budgetBytes: number) => poolFor(budgetBytes, cap),
    texturePoolBudget,
    /** The family, the encoding and the lane pools, set by prepare; `setMemoryBudgets` redraws. */
    texturePools: undefined as TexturePools | undefined,
    get slots() {
      return this.geometryPool.slots;
    },
  };
}
