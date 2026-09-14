import { prepareWebgpuPresentation } from './webgpuPresentationSetup.ts';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { createWebgpuTexturePump } from './webgpuTexturePump.ts';
import { createWebgpuBootstrap } from './webgpuBootstrap.ts';
import { createWebgpuResidencyQueue } from './webgpuResidencyQueue.ts';
import { createWebgpuResidentEnsurer } from './webgpuResidentEnsurer.ts';
import { createBudgetedResidency } from './webgpuBudgetedResidency.ts';
import { createWebgpuPinUpdater } from './webgpuPinUpdater.ts';
import { drawWebgpuFallback } from './webgpuFallbackDraw.ts';
import { encodeWebgpuVisibilityPasses } from './webgpuVisibilityPasses.ts';
import { createWebgpuVisibilityDrawer } from './webgpuVisibilityDrawer.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { writeWebgpuVisibilityUniforms } from './webgpuVisibilityUniforms.ts';
import { buildWebgpuVisibilityItems } from './webgpuVisibilityItems.ts';
import { partitionWebgpuVisibility } from './webgpuVisibilityPartition.ts';
import {
  createWebgpuVisibilityRasterPipelines,
  createWebgpuShadePipeline,
} from './webgpuVisibilityPipelines.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { prepareWebgpuDataAtlas } from './webgpuDataAtlas.ts';
import { prepareWebgpuColorAtlas } from './webgpuColorAtlas.ts';
import { collectWebgpuMaterialTextures } from './webgpuMaterialTextures.ts';
import { prepareWebgpuGeometry } from './webgpuGeometryPrepare.ts';
import { prepareWebgpuBlend } from './webgpuBlendPrepare.ts';
import { ensureWebgpuPositionBuffer } from './webgpuPositions.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { UNIFORM_STRIDE, writeBlendUniforms } from './webgpuBlendUniforms.ts';
import { selectWebgpuBlend } from './webgpuBlendSelection.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuRowSync } from './webgpuRowSync.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { createWebgpuRowState } from './webgpuRowState.ts';
import { createWebgpuResidencyMirror } from './webgpuResidencyMirror.ts';
import { createPageRowWriter } from './webgpuPageRow.ts';
import { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import {
  viewProj,
  remap,
  PAGES_GREEN,
  MAX_BUDGET_PIXEL_ERROR,
  outputColorDiagnostic,
  lighting,
  linearColor,
  clusterRgb,
  materialSide,
  triangleSum,
  partitionByPass,
} from './webgpuPagesHelpers.ts';
import { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
export { outputColorDiagnostic } from './webgpuPagesHelpers.ts';
import { createWebgpuPagesPipelines } from './webgpuPagesPipelines.ts';
import {
  createSurfaceBuffer,
  checkSurfaceSize,
  frameTargetBytes,
  SURFACE_FORMATS,
  type SurfaceBuffer,
  type SurfaceCapture,
} from './surfaceBuffer.ts';
import { createSceneLightBuffer } from './sceneLighting.ts';
import { createDeferredLighting } from './deferredLighting.ts';
import {
  createGpuPresenter,
  readGpuImage,
  createSynchronousCanvasCapture,
} from './gpuPresentation.ts';
import { generateMaterialMips } from './textureMips.ts';
import { createGpuSmallTriangles, type GpuSmallTriangles } from './gpuSmallTriangles.ts';
import { createGpuTiming } from './gpuTiming.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import type { BackendCapabilities, BackendFactory, RenderBackend } from './backendTypes.ts';
import { createGpuPageCache } from './gpuPages.ts';
import {
  acceptPageArray,
  collectClusterPages,
  collectPendingUrls,
  indexPagesByUrl,
  pageRequestUrl,
  projectedPageError,
  resolvePixelError,
  selectVisiblePages,
  rootCoverage,
  type PageRec,
} from './pageSelection.ts';
import { screenErrorColor, screenErrorRatio } from './diagnosticColors.ts';
import {
  cameraSelectionUniforms,
  type GpuSelection,
  type SelectionSubmission,
  type SelectionUniforms,
} from './gpuSelection.ts';
import { createGpuDagSelection, packDagSelection } from './gpuDagSelection.ts';
import { OPEN_CONE, triangleCone } from './pageCone.ts';
import { RASTER_BACKGROUND } from './pageRaster.ts';
import {
  HIZ_BOUNDS_VALUES,
  applyTemporalHiz,
  createBoxCorners,
  sameHizView,
  type TemporalHizState,
} from './hiz.ts';
import { createGpuHiz, type GpuHiz } from './gpuHiz.ts';
import {
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  DRAW_ITEM_U32,
  createGpuDraw,
  type GpuDraw,
} from './gpuDraw.ts';
import {
  PAGE_INFO_STRIDE,
  VIS_MAX_PAGES,
  rasterVisibilityIds,
  shadeVisibility,
  visMaterial,
} from './visibilityBuffer.ts';
import type { DiagnosticMode, GpuPassTimings } from '../sdk-core/index.ts';
import * as THREE from 'three';
/** Spread arguments overflow the call stack beyond ~100k pages; append with a loop instead. */
function appendAll<T>(target: T[], ...sources: readonly (readonly T[])[]) {
  for (const source of sources) for (let i = 0; i < source.length; i++) target.push(source[i]);
}

type WebgpuPagesBackend = RenderBackend & {
  flush(): Promise<void>;
  rasterRgba(): Uint8Array;
  selectedPageIds(): string[];
  visibilityIds(): Uint32Array;
};

/** WebGPU raster of cluster pages. GPU frustum + per-cluster error band when compute is available;
 *  `selectVisiblePages` remains the CPU oracle and the silent fallback. */
export const webgpuPagesBackend: BackendFactory = (context) => {
  const { source, metadata, indices, associations, maxResidentPages, gpuDevice } = context;
  const viewport = context.viewport ?? [1, 1];
  const clearColor = context.clearColor ?? RASTER_BACKGROUND;
  const diagnosticDetail = (context as typeof context & { diagnosticDetail?: 'summary' | 'trace' })
    .diagnosticDetail;
  const traceEnabled = !!context.onDiagnostic && diagnosticDetail !== 'summary';
  const { traceDiagnostic, engineDiagnostic, diagnosticFailure, drainTraceNow } =
    createWebgpuDiagnostics(context.onDiagnostic, traceEnabled);
  const onGpuError = (event: GPUUncapturedErrorEvent) => {
    diagnosticFailure('gpu-uncaptured-error', event.error);
    lost = true;
  };
  const inputColor = {
    clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
    value: clearColor,
    source: context.clearColor === undefined ? 'fallback moteur' : 'hôte',
  };
  engineDiagnostic('clear-color-input', 'Couleur de fond reçue par WebGeometry WebGPU', inputColor);
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
  traceDiagnostic('page-catalog', 'Catalogue stable des pages WebGPU', {
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
  let coverageBudgetLimited = false;
  /** Screen-error floor the GPU page budget imposes on the cut; 0 when the requested detail fits. */
  let budgetPixelError = 0;
  const deferredDrops = new Set<string>();
  let coverageBudgetEvent: Record<string, unknown> | undefined;
  // `byUrl` is indexed by REQUEST key: the streaming bundle when the cache publishes one, the cluster
  // object otherwise. One request therefore hands bytes to every cluster that shares it. The GPU page
  // cache below stays keyed by cluster (`rec.url`), because that is the granularity it uploads and pins.
  const byUrl = indexPagesByUrl(allPages),
    pendingScratch: string[] = [],
    urlScratch: string[] = [],
    readyScratch: PageRec[] = [];
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
  let cache: ReturnType<typeof createGpuPageCache> | undefined,
    bindGroupLayout: GPUBindGroupLayout | undefined;
  let pipelineBack: GPURenderPipeline | undefined,
    pipelineBackCw: GPURenderPipeline | undefined,
    pipelineNone: GPURenderPipeline | undefined,
    pipelineBlend: GPURenderPipeline | undefined,
    pipelineBlendTextured: GPURenderPipeline | undefined,
    pipelineBlendFront: GPURenderPipeline | undefined,
    pipelineBlendBack: GPURenderPipeline | undefined;
  let colorTexture: GPUTexture | undefined,
    depthTexture: GPUTexture | undefined,
    colorView: GPUTextureView | undefined,
    depthView: GPUTextureView | undefined;
  const positionBuffers = new Map<THREE.BufferGeometry['attributes'], GPUBuffer>(),
    positionIds = new WeakMap<GPUBuffer, number>();
  let nextPositionId = 1;
  let uniformBuffer: GPUBuffer | undefined,
    uniformPacked = new Float32Array(UNIFORM_STRIDE / 4);
  const bindGroups = new Map<number, GPUBindGroup>(),
    clusterRgbCache = new Map<string, [number, number, number]>();
  let synchronousCapture: ReturnType<typeof createSynchronousCanvasCapture> | undefined;
  let presenter: ReturnType<typeof createGpuPresenter> | undefined;
  let canvasTexture: THREE.CanvasTexture | undefined,
    blitMaterial: THREE.ShaderMaterial | undefined,
    blit: THREE.Mesh | undefined;
  let surfaces: SurfaceBuffer | undefined,
    hdrTexture: GPUTexture | undefined,
    hdrView: GPUTextureView | undefined;
  let deferred: Awaited<ReturnType<typeof createDeferredLighting>> | undefined,
    lights: ReturnType<typeof createSceneLightBuffer> | undefined;
  const frameBudget = context.maxFrameAllocationBytes ?? 256 * 1024 * 1024;
  const reserveHiz = typeof gpuDevice?.createComputePipeline === 'function';
  const checkFrameBudget = (width: number, height: number, additional = 0) => {
    if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
    checkSurfaceSize(gpuDevice, width, height, frameBudget, 1);
    const bytes = frameTargetBytes(width, height, reserveHiz) + additional;
    if (bytes > frameBudget) throw new Error(`SURFACE_BUDGET: ${bytes} > ${frameBudget}`);
    return bytes;
  };
  let captureAllocationBytes = 0,
    surfaceCapture: SurfaceCapture | undefined,
    secondaryCamera: THREE.PerspectiveCamera | undefined;
  let surfaceRenderAllowed = false,
    imageRevision = 0,
    capturedRevision = -1,
    capturedPixels: Uint8Array | undefined,
    capturePending: Promise<void> | undefined;
  let captureStreamingDeferrals = 0,
    captureDeferralLogged = false;
  let lightState: { count: number; types: string[] } | undefined;
  let blendSubmittedTriangles = 0,
    blendDrawCalls = 0,
    blendFrustumRejected = 0,
    gpuDrawCalls = 0,
    lastProgressMs = 0;
  let lost = false,
    overBudget = false,
    visible = 0,
    selectedTriangles = 0,
    submittedTriangles = 0,
    uncoveredTriangles = 0,
    frustumRejected = 0,
    lodLevel = 0,
    frame = 0;
  let diagnostic: DiagnosticMode = 'beauty';
  const motion: { last?: THREE.Vector3; lastMs?: number } = {};
  const shown: PageRec[] = [],
    desired: PageRec[] = [],
    drawn: PageRec[] = [];
  let targetSize: [number, number] = [viewport?.[0] ?? 1, viewport?.[1] ?? 1];
  let gpuSelection: GpuSelection | undefined;
  const opaqueRoots = roots.filter((root) => !root.pages[0]?.transparent),
    transparentRoots = roots.filter((root) => root.pages[0]?.transparent);
  const packedPages: PageRec[] = opaqueRoots.flatMap((root) => root.pages);
  const worldUpdates = new Float32Array(opaqueRoots.length * 16);
  // The occluder half of an image is reused as the next image's first pass, and it is keyed by cluster
  // key: a key backing several placements occludes for all of them. A dense index per key replaces the
  // set of strings the drawing path used to hash once per page per image.
  const urlIndexOfPage = new Int32Array(packedPages.length);
  let urlCount = 0;
  {
    const dense = new Map<string, number>();
    for (let i = 0; i < packedPages.length; i++) {
      const url = packedPages[i].url;
      let index = dense.get(url);
      if (index === undefined) {
        index = urlCount++;
        dense.set(url, index);
      }
      urlIndexOfPage[i] = index;
    }
  }
  const drawnOccluderUrls = new Uint8Array(Math.max(1, urlCount));
  let noOccluderHistory = true;
  const gpuWanted: PageRec[] = bootstrap.filter((page) => !page.transparent);
  // Reused by `renderGpuCut`; the cut changes every frame, the arrays and sets behind it do not.
  const opaqueScratch: PageRec[] = [],
    transparentScratch: PageRec[] = [],
    drawableScratch: PageRec[] = [];
  const copiesByUrl = new Map<string, number>();
  let maxCopies = 1;
  for (const page of packedPages) {
    const n = (copiesByUrl.get(page.url) ?? 0) + 1;
    copiesByUrl.set(page.url, n);
    maxCopies = Math.max(maxCopies, n);
  }
  // Visibility IDs reserve 24 bits for row+1 (zero means background) and 8 for the triangle.
  const drawSlots = Math.max(1, Math.min(VIS_MAX_PAGES, packedPages.length, slots * maxCopies));
  const rows = createWebgpuRowState(packedPages, drawSlots);
  const mirror = createWebgpuResidencyMirror({
    pageIndicesByUrl: rows.pageIndicesByUrl,
    residentOffsetWords: rows.residentOffsetWords,
    tracking,
    engineDiagnostic,
    getCache: () => cache,
    getFrame: () => frame,
  });
  /** Every triangle of every drawable row: the bound the small-triangle list can never exceed. */
  const smallTriangleCapacity = drawSlots * Math.ceil(Math.max(1, pageBytes / 4) / 3);
  /**
   * Resident cluster keys the change journal has accounted for but the row table never carries — the
   * transparent ones. The mirror's own count cannot be checked against the cache's, which counts those
   * too; what has to hold is that the journal saw every change, so that is what is compared.
   */

  /**
   * Whether anything the rank of a row depends on has moved since the rows were decided: a cluster
   * arrived or left, or a shared input changed epoch. Nothing else can change a rank — the drawable
   * set is the resident opaque pages in catalogue order — so an image that sees neither re-decides
   * nothing and reads none of the forty thousand catalogue entries.
   */
  /**
   * World-space corners of every page's box, kept across images and rebuilt only when the epoch of the
   * shared inputs changes — the same epoch a row is rewritten on. A moving camera reprojects them every
   * image; it no longer retransforms them.
   */
  const boxCorners = createBoxCorners(packedPages.length);
  const hizBounds = new Float64Array(drawSlots * HIZ_BOUNDS_VALUES);
  const hizTestedBounds = new Float64Array(drawSlots * HIZ_BOUNDS_VALUES);
  const hizTestedRows = new Uint32Array(drawSlots);
  const hizRest = new Uint8Array(drawSlots);
  const drawItemWords = new Uint32Array(drawSlots * DRAW_ITEM_U32);
  const drawRestBits = new Uint32Array(Math.max(1, Math.ceil(drawSlots / 32)));
  /** Rows per indirect bin (pipeline, then half): a bin nothing fills is not worth a draw call. */
  const binInstances = new Uint32Array(6);
  let gpuFrameActive = false,
    gpuMetricsReady = false;
  const selectionUniforms: SelectionUniforms = {
    planes: new Float32Array(24),
    view: new Float32Array(16),
    pixelScale: [1, 1],
    pixelError: 0,
    near: 0.1,
    cameraWorld: [0, 0, 0],
  };
  const untexturedMaterials = 'Untextured source color; double-sided when the material is';
  const visFeatures = [
    'visibility buffer',
    'textured PBR maps',
    'occlusion culling',
    'temporal occlusion culling',
  ];
  const capabilities: BackendCapabilities = {
    renderer: 'WebGPU page raster',
    materials: untexturedMaterials,
    hierarchy: true,
    gpuDriven: false,
    simplification: false,
    eviction: true,
    unsupported: [
      'material extensions, skinning and morph targets in WebGPU',
      'per-texture transforms, UV channels and sampler modes',
      'environment maps, light shadows, area lights and light probes',
      'indirect draw',
      'occlusion culling',
      'temporal occlusion culling',
      'small-triangle compute raster',
      'physical VRAM instrumentation',
      'global illumination, surface cache and motion vectors',
      'textured PBR maps',
      'visibility buffer',
      'direct WebGPU present',
    ],
  };
  const dropGpuSelection = () => {
    gpuSelection?.dispose();
    gpuSelection = undefined;
    capabilities.gpuDriven = false;
  };
  let visEnabled = false,
    visTexture: GPUTexture | undefined,
    visView: GPUTextureView | undefined;
  let visPipelineBack: GPURenderPipeline | undefined,
    visPipelineBackCw: GPURenderPipeline | undefined,
    visPipelineNone: GPURenderPipeline | undefined,
    visPipelineFront: GPURenderPipeline | undefined,
    visPipelineFrontCw: GPURenderPipeline | undefined,
    shadePipeline: GPURenderPipeline | undefined;
  let gpuHiz: GpuHiz | undefined;
  let gpuSmall: GpuSmallTriangles | undefined,
    hybridUnavailable = false;
  let visHizRestBack: GPURenderPipeline | undefined,
    visHizRestBackCw: GPURenderPipeline | undefined,
    visHizRestNone: GPURenderPipeline | undefined,
    visHizRestFront: GPURenderPipeline | undefined,
    visHizRestFrontCw: GPURenderPipeline | undefined;
  let visBindGroupLayout: GPUBindGroupLayout | undefined,
    visBindGroup: GPUBindGroup | undefined,
    visHizBindGroup: GPUBindGroup | undefined,
    visUniform: GPUBuffer | undefined,
    zeroFlags: GPUBuffer | undefined,
    zeroUv: GPUBuffer | undefined,
    blendBindGroupLayout: GPUBindGroupLayout | undefined;
  let gpuDraw: GpuDraw | undefined;
  let shadeBindGroupLayout: GPUBindGroupLayout | undefined,
    shadeBindGroup: GPUBindGroup | undefined;
  // Six raster slots × tested-or-not, and the small-triangle groups by flag source × selection:
  // both sets are built from buffers that outlive the frame, so a frame never rebuilds a bind group.
  const visSlotGroups: Array<GPUBindGroup | undefined> = new Array(12).fill(undefined);
  const smallGroups: Array<unknown> = new Array(8).fill(undefined);
  let concatPos: GPUBuffer | undefined,
    concatUv: GPUBuffer | undefined,
    concatNrm: GPUBuffer | undefined,
    pageTable: GPUBuffer | undefined,
    shadeUniform: GPUBuffer | undefined,
    mapsTexture: GPUTexture | undefined,
    dataMapsTexture: GPUTexture | undefined,
    mapsSampler: GPUSampler | undefined,
    materialScales: GPUBuffer | undefined;
  let mapsArrayView: GPUTextureView | undefined, dataMapsArrayView: GPUTextureView | undefined;
  const inverseViewProj = new THREE.Matrix4(),
    cameraWorldScratch = new THREE.Vector3(),
    cameraWorldArray: [number, number, number] = [0, 0, 0];
  const shadeUniPacked = new Float32Array(64),
    visUniPacked = new Float32Array(7 * 64),
    geometryBlocks = new Map<
      THREE.BufferGeometry['attributes'],
      { vertexBase: number; count: number; hasUv: boolean; hasNormal: boolean; hasTangent: boolean }
    >(),
    mapLayer = new Map<THREE.Texture, number>(),
    dataLayer = new Map<THREE.Texture, number>();
  const uvScales: Array<[number, number]> = [[1, 1]],
    dataUvScales: Array<[number, number]> = [[1, 1]];
  const textureJobs: Array<{
    kind: 'color' | 'data';
    layer: number;
    bytes: number;
    upload: () => void;
  }> = [];
  const textureBudget = Math.max(
    1,
    Number.isFinite(context.maxTextureTransferBytesPerFrame)
      ? context.maxTextureTransferBytesPerFrame!
      : 16 * 1024 * 1024,
  );
  let textureColorSize: [number, number] = [1, 1],
    textureDataSize: [number, number] = [1, 1];
  const texturePumpState = createWebgpuTexturePump({
    device: gpuDevice,
    jobs: textureJobs,
    budget: textureBudget,
    colorScales: uvScales,
    dataScales: dataUvScales,
    colorAtlas: () => ({ texture: mapsTexture, size: textureColorSize }),
    dataAtlas: () => ({ texture: dataMapsTexture, size: textureDataSize }),
    onFailure: diagnosticFailure,
  });
  const pumpTextures = texturePumpState.pump;
  const temporalHizState: TemporalHizState = {};
  let previousHizView: THREE.PerspectiveCamera | undefined;
  let lastSubmitMs: number | null = null;
  let gpuTiming: ReturnType<typeof createGpuTiming> | undefined,
    lastGpuPassMs: GpuPassTimings | null = null,
    lastGpuFrameMs: number | null = null,
    lastGpuHostGapMs: number | null = null;
  // Encode-side step durations of the current image, reported by the `cpu-timing` diagnostic.
  let lastProjectMs = 0,
    lastPartitionMs = 0,
    lastItemsMs = 0,
    rowsSyncedFrame = -1;
  const CPU_STEPS = [
    'adoptCutMs',
    'transparentSelectMs',
    'admissionMs',
    'residencyQueueMs',
    'syncRowsMs',
    'residencyUploadMs',
    'selectionDispatchMs',
    'projectBoxesMs',
    'partitionMs',
    'itemsMs',
    'encodeRestMs',
    'encodeSubmitMs',
    'totalMs',
  ] as const;
  const cpuProfile = createCpuStepProfile(CPU_STEPS);
  let lastCpuLogMs = 0;
  /**
   * Publishes where the image's CPU time went, on the cadence of the progress diagnostic. It is called
   * by both render paths: a measured loop renders without ever flushing, and the profile is exactly what
   * such a loop needs.
   */
  const publishCpuProfile = () => {
    if (traceEnabled || !cpuSample || frame === lastCpuLogFrame) return;
    const now = performance.now();
    if (now - lastCpuLogMs < 2000) return;
    lastCpuLogMs = now;
    lastCpuLogFrame = frame;
    engineDiagnostic('cpu-timing', 'Durées CPU mesurées dans le moteur', {
      ...cpuSample,
      steps: cpuProfile.summary(),
    });
  };
  let cpuSample: Record<string, unknown> | undefined,
    transparentEncodeMs = 0,
    lastCpuLogFrame = -1;
  const cameraPose = (camera: THREE.PerspectiveCamera) => ({
    position: camera.getWorldPosition(new THREE.Vector3()).toArray(),
    quaternion: camera.getWorldQuaternion(new THREE.Quaternion()).toArray(),
  });
  /**
   * One image, one command buffer. A frame that drives the GPU cut opens it before the selection and
   * every pass it encodes lands in it, so the driver validates one buffer instead of two and the
   * enclosing GPU span has no host gap left to hold. The buffer the image drops must be settled, not
   * merely forgotten: the selection's readback copy would never run and its slot would stay mapped.
   */
  let frameEncoder: GPUCommandEncoder | undefined, frameSelection: SelectionSubmission | undefined;
  const newEncoder = (device: GPUDevice) =>
    gpuTiming && !secondaryCamera ? gpuTiming.createEncoder(frame) : device.createCommandEncoder();
  const createRenderEncoder = (device: GPUDevice) => frameEncoder ?? newEncoder(device);
  const openFrameEncoder = (device: GPUDevice) => (frameEncoder = newEncoder(device));
  const abandonFrameEncoder = () => {
    if (!frameEncoder) return;
    frameEncoder = undefined;
    const settle = frameSelection;
    frameSelection = undefined;
    settle?.(false);
    gpuTiming?.cancelUnsubmitted();
  };
  const dropGpuHiz = () => {
    gpuHiz?.dispose();
    gpuHiz = undefined;
    visHizBindGroup = undefined;
    visHizRestBack = undefined;
    visHizRestBackCw = undefined;
    visHizRestNone = undefined;
    visHizRestFront = undefined;
    visHizRestFrontCw = undefined;
    noOccluderHistory = true;
    previousHizView = undefined;
    temporalHizState.pyramid = undefined;
    temporalHizState.camera = undefined;
    temporalHizState.viewport = undefined;
  };
  const dropGpuDraw = () => {
    gpuDraw?.dispose();
    gpuDraw = undefined;
    if (!capabilities.unsupported.includes('indirect draw'))
      capabilities.unsupported.push('indirect draw');
  };
  const dropVis = () => {
    visEnabled = false;
    visPipelineBack = undefined;
    visPipelineBackCw = undefined;
    visPipelineNone = undefined;
    visPipelineFront = undefined;
    visPipelineFrontCw = undefined;
    shadePipeline = undefined;
    shadeBindGroup = undefined;
    shadeBindGroupLayout = undefined;
    visBindGroupLayout = undefined;
    visBindGroup = undefined;
    visHizBindGroup = undefined;
    mapsSampler = undefined;
    blendBindGroupLayout = undefined;
    pipelineBlendTextured = undefined;
    for (const item of blendState.blendGpu) item.group = undefined;
    visSlotGroups.fill(undefined);
    smallGroups.fill(undefined);
    gpuSmall?.dispose();
    gpuSmall = undefined;
    dropGpuDraw();
    dropGpuHiz();
    concatPos?.destroy();
    concatUv?.destroy();
    concatNrm?.destroy();
    pageTable?.destroy();
    shadeUniform?.destroy();
    visUniform?.destroy();
    zeroFlags?.destroy();
    mapsTexture?.destroy();
    dataMapsTexture?.destroy();
    materialScales?.destroy();
    materialScales = undefined;
    visSlotGroups.fill(undefined);
    smallGroups.fill(undefined);
    concatPos =
      concatUv =
      concatNrm =
      pageTable =
      shadeUniform =
      visUniform =
      zeroFlags =
      mapsTexture =
      dataMapsTexture =
        undefined;
    mapsArrayView = undefined;
    dataMapsArrayView = undefined;
    rows.pageTableFloats = undefined;
    rows.pageTableInts = undefined;
    rows.rowPageIndex.fill(-1);
    rows.rowOffsetWords.fill(-1);
    rows.rowEpoch.fill(0);
    rows.rowCount = 0;
    rows.dirtyFrom = drawSlots;
    rows.dirtyTo = -1;
    rows.candidateCount = 0;
    rows.packedCount = 0;
    rows.rowsChanged = true;
    capabilities.materials = untexturedMaterials;
    textureJobs.length = 0;
    for (const item of visFeatures)
      if (!capabilities.unsupported.includes(item)) capabilities.unsupported.push(item);
  };
  const pageSource = {
    read: async (key: string) => {
      const bytes = sourceBytes.get(key);
      if (!bytes) throw new Error('Missing page');
      return bytes;
    },
  };
  let lastCamera: THREE.PerspectiveCamera | undefined,
    diagnosticPixelError = 0;
  const pageRgb = (rec: PageRec): [number, number, number] => {
    if (diagnostic === 'beauty') return linearColor(rec.material);
    if (diagnostic === 'pages') return PAGES_GREEN;
    if (diagnostic === 'lod')
      return rec.role === 'coarse' ? [0.95, 0.42, 0.05] : [0.04, 0.51, 0.94];
    if (diagnostic === 'visibility') return PAGES_GREEN;
    if (diagnostic === 'screen-error')
      return lastCamera
        ? screenErrorColor(projectedPageError(rec, lastCamera, viewport), diagnosticPixelError)
        : [0, 1, 0.12];
    let rgb = clusterRgbCache.get(rec.clusterId);
    if (!rgb) {
      rgb = clusterRgb(rec.clusterId);
      clusterRgbCache.set(rec.clusterId, rgb);
    }
    return rgb;
  };
  const ensureTargets = (device: GPUDevice, width: number, height: number) => {
    if (
      colorTexture &&
      targetSize[0] === width &&
      targetSize[1] === height &&
      surfaces &&
      (!visEnabled || visTexture) &&
      (!gpuHiz || (gpuHiz.width === width && gpuHiz.height === height))
    )
      return;
    traceDiagnostic('targets-request', 'Demande de cibles GPU pour la frame', () => ({
      frame,
      width,
      height,
      previousSize: targetSize.slice(),
      additionalBytes: captureAllocationBytes,
      budgetBytes: frameBudget,
      hiZReserved: reserveHiz,
    }));
    const allocationBytes = checkFrameBudget(width, height, captureAllocationBytes);
    colorTexture?.destroy();
    depthTexture?.destroy();
    visTexture?.destroy();
    hdrTexture?.destroy();
    surfaces?.dispose();
    visTexture = undefined;
    visView = undefined;
    shadeBindGroup = undefined;
    visBindGroup = undefined;
    visHizBindGroup = undefined;
    gpuSmall?.dispose();
    gpuSmall = undefined;
    capturedPixels = undefined;
    capturedRevision = -1;
    const usage =
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC;
    colorTexture = device.createTexture({
      label: 'WG display color',
      size: { width, height },
      format: 'rgba8unorm',
      usage,
    });
    depthTexture = device.createTexture({
      label: 'WG opaque depth',
      size: { width, height },
      format: 'depth32float',
      usage: usage | GPUTextureUsage.COPY_DST,
    });
    hdrTexture = device.createTexture({
      label: 'WG HDR lighting',
      size: { width, height },
      format: 'rgba16float',
      usage,
    });
    surfaces = createSurfaceBuffer(device, width, height, frameBudget - captureAllocationBytes);
    colorView = colorTexture.createView();
    depthView = depthTexture.createView();
    hdrView = hdrTexture.createView();
    targetSize = [width, height];
    try {
      visTexture = device.createTexture({
        label: 'WG visibility',
        size: { width, height },
        format: 'r32uint',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      visView = visTexture.createView();
    } catch (error) {
      diagnosticFailure('visibility-target-failed', error);
    }
    if (gpuHiz && !gpuHiz.resize(device, width, height)) dropGpuHiz();
    const allocation = {
      frame,
      width,
      height,
      allocationBytes,
      captureAllocationBytes,
      budgetBytes: frameBudget,
      physicalVramBytes: null,
      surfaceVersion: 1,
    };
    traceDiagnostic('targets-transition', 'Cibles GPU allouées après transition', () => allocation);
    engineDiagnostic('frame-allocation', 'Cibles GPU allouées', allocation);
  };
  const windingCw = (rec: PageRec) => {
    const e = rec.matrix.elements;
    return (
      e[0] * (e[5] * e[10] - e[6] * e[9]) -
        e[1] * (e[4] * e[10] - e[6] * e[8]) +
        e[2] * (e[4] * e[9] - e[5] * e[8]) <
      0
    );
  };
  const pipelineFor = (rec: PageRec) => {
    const side = materialSide(rec.material);
    if (side === THREE.DoubleSide) return pipelineNone;
    return windingCw(rec) ? pipelineBackCw : pipelineBack;
  };
  const visPipelineFor = (rec: PageRec, rest: boolean) => {
    const side = materialSide(rec.material),
      cw = windingCw(rec);
    if (side === THREE.DoubleSide) return rest ? visHizRestNone : visPipelineNone;
    if (side === THREE.BackSide)
      return rest
        ? cw
          ? visHizRestFrontCw
          : visHizRestFront
        : cw
          ? visPipelineFrontCw
          : visPipelineFront;
    return rest
      ? cw
        ? visHizRestBackCw
        : visHizRestBack
      : cw
        ? visPipelineBackCw
        : visPipelineBack;
  };
  const bindGroupFor = (device: GPUDevice, position: GPUBuffer) => {
    let id = positionIds.get(position);
    if (!id) {
      id = nextPositionId++;
      positionIds.set(position, id);
    }
    let group = bindGroups.get(id);
    if (!group && bindGroupLayout && cache && uniformBuffer) {
      group = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: cache.buffer } },
          { binding: 1, resource: { buffer: position } },
          { binding: 2, resource: { buffer: uniformBuffer, size: UNIFORM_STRIDE } },
        ],
      });
      bindGroups.set(id, group);
    }
    return group;
  };
  const ensureUniform = (device: GPUDevice, draws: number) => {
    const bytes = Math.max(1, draws, cap) * UNIFORM_STRIDE;
    if (!uniformBuffer || uniformBuffer.size < bytes) {
      uniformBuffer?.destroy();
      bindGroups.clear();
      for (const item of blendState.blendGpu) item.group = undefined;
      uniformBuffer = device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    if (uniformPacked.byteLength < bytes) uniformPacked = new Float32Array(bytes / 4);
  };
  let outputDiagnosticLogged = false,
    renderPathLogged = false;
  const blendState = createWebgpuBlendState();
  const encodeBlend = (device: GPUDevice, encoder: GPUCommandEncoder, uniformBase: number) => {
    if (
      !pipelineBlend ||
      !blendState.visibleBlend.length ||
      !colorView ||
      !depthView ||
      !uniformBuffer
    )
      return;
    const textured = !!(
      blendBindGroupLayout &&
      pipelineBlendTextured &&
      mapsTexture &&
      mapsSampler &&
      dataMapsTexture &&
      materialScales &&
      zeroUv
    );
    if (!textured && !bindGroupLayout) return;
    const cpuStart = performance.now();
    ensureUniform(device, uniformBase + blendState.visibleBlend.length);
    writeBlendUniforms({
      device,
      items: blendState.visibleBlend,
      uniformBase,
      uniformPacked,
      uniformBuffer: uniformBuffer!,
      diagnostic,
      lastCamera,
      viewport,
      diagnosticPixelError,
      mapLayer,
      dataLayer,
      uvScales,
      textured,
    });
    const result = drawBlendPass({
      device,
      encoder,
      uniformBase,
      items: blendState.visibleBlend,
      textured,
      visEnabled,
      hdrView,
      colorView: colorView!,
      depthView: depthView!,
      targetSize,
      uniformBuffer: uniformBuffer!,
      blendBindGroupLayout,
      mapsTexture,
      mapsSampler,
      dataMapsTexture,
      materialScales,
      zeroUv,
      lightBuffer: lights?.buffer,
      bindGroupLayout,
      pipelineBlend: pipelineBlend!,
      pipelineBlendTextured,
      pipelineBlendFront,
      pipelineBlendBack,
    });
    gpuDrawCalls += result.drawCalls;
    blendDrawCalls += result.drawCalls;
    blendSubmittedTriangles += result.submittedTriangles;
    transparentEncodeMs += performance.now() - cpuStart;
    if (traceEnabled)
      traceDiagnostic('transparent-encoding', 'Transparents sélectionnés et encodés', () => ({
        frame,
        submission: imageRevision,
        candidates: blendState.blendGpu.length,
        visibleMeshes: blendState.visibleBlend.length,
        frustumRejected: blendFrustumRejected,
        drawCalls: blendDrawCalls,
        submittedTriangles: blendSubmittedTriangles,
        encodeMs: transparentEncodeMs,
        passes: blendState.visibleBlend.length ? 2 : 0,
      }));
  };
  /** The row table spans every row a page can claim, so it is allocated once and never resized. */
  const ensurePageTable = (device: GPUDevice) => {
    if (rows.pageTableFloats) return;
    const bytes = Math.max(PAGE_INFO_STRIDE, drawSlots * PAGE_INFO_STRIDE);
    rows.pageTableFloats = new Float32Array(bytes / 4);
    rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer);
    pageTable?.destroy();
    shadeBindGroup = undefined;
    visBindGroup = undefined;
    visHizBindGroup = undefined;
    visSlotGroups.fill(undefined);
    smallGroups.fill(undefined);
    pageTable = device.createBuffer({
      label: 'WG page table',
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  };
  /**
   * Writes one page-table row. Called when a cluster claims a row, when its GPU slot moves, or when a
   * shared input changes epoch — never once per frame: every field below belongs to the page, its
   * material, its geometry block or its slot, none of them to the image.
   */
  const writePageRow = createPageRowWriter({
    geometryBlocks,
    mapLayer,
    dataLayer,
    uvScales,
    dataUvScales,
    markRowDirty: rows.markRowDirty,
  });
  /**
   * Applies the cache's arrivals and departures to the residency mirror. The mirror is the only
   * incremental state on this path, so the journal that feeds it is checked against the cache on every
   * drain: the journal's own resident count — every key it saw, rowed or not — must equal the cache's.
   * A disagreement means an entry moved without a record, and the mirror is rebuilt from the cache
   * instead of being left to drift into a hole.
   */
  const { commitRows, sourceRowOf } = createWebgpuRowCommit(rows, writePageRow);
  const { syncRows, syncRowsFromCut } = createWebgpuRowSync(
    rows,
    mirror,
    packedPages,
    drawn,
    drawSlots,
    () => !!cache,
    { commitRows, sourceRowOf },
  );
  /** Uploads the span of rows whose bytes changed, and nothing when none did. */
  const uploadDirtyRows = (device: GPUDevice) => {
    if (rows.dirtyTo < rows.dirtyFrom || !pageTable || !rows.pageTableFloats) return;
    device.queue.writeBuffer(
      pageTable,
      rows.dirtyFrom * PAGE_INFO_STRIDE,
      rows.pageTableFloats.buffer as ArrayBuffer,
      rows.dirtyFrom * PAGE_INFO_STRIDE,
      (rows.dirtyTo - rows.dirtyFrom + 1) * PAGE_INFO_STRIDE,
    );
    rows.dirtyFrom = drawSlots;
    rows.dirtyTo = -1;
  };
  const submitColorCopy = (
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    height: number,
    width: number,
    presented = false,
  ) => {
    if (!presented && presenter && colorTexture && !secondaryCamera) {
      presenter.present(encoder, colorTexture, width, height);
      gpuDrawCalls++;
    }
    const owned = encoder === frameEncoder;
    const command = encoder.finish();
    device.queue.submit([command]);
    imageRevision++;
    if (owned) {
      frameEncoder = undefined;
      const settle = frameSelection;
      frameSelection = undefined;
      settle?.(true);
    }
    traceDiagnostic('encoding-submit', 'Commandes WebGPU soumises', () => ({
      frame,
      submission: imageRevision,
      pose: lastCamera ? cameraPose(lastCamera) : null,
      width,
      height,
      drawCalls: gpuDrawCalls,
      drawnTriangles:
        gpuFrameActive && !gpuMetricsReady
          ? null
          : drawn.reduce((sum, page) => sum + page.triangles, 0),
      transparent: { drawCalls: blendDrawCalls, submittedTriangles: blendSubmittedTriangles },
      presentation: secondaryCamera ? 'surface-capture' : context.gpuCanvas ? 'direct' : 'composed',
    }));
    if (gpuTiming?.isSampled(encoder))
      gpuTiming.submitted(encoder, {
        submission: imageRevision,
        viewport: [width, height],
        cameraWorld: lastCamera?.getWorldPosition(new THREE.Vector3()).toArray(),
        viewProjection: [...viewProj.elements],
        scope: 'selection-and-render-passes',
        excludes: ['uploads and copies', 'CPU work', 'presentation latency'],
        drawCalls: gpuDrawCalls,
        transparentDrawCalls: blendDrawCalls,
        transparentSubmittedTriangles: blendSubmittedTriangles,
      });
    if (canvasTexture && !secondaryCamera) canvasTexture.needsUpdate = true;
  };
  const encodeClear = (device: GPUDevice, encoder: GPUCommandEncoder) => {
    const pass = encoder.beginRenderPass({
      label: 'WG clear',
      colorAttachments: [
        {
          view: colorView!,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: {
            r: (clearColor >> 16) / 255,
            g: ((clearColor >> 8) & 255) / 255,
            b: (clearColor & 255) / 255,
            a: 1,
          },
        },
      ],
      depthStencilAttachment: {
        view: depthView!,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.end();
  };
  const encodeSurfaceLighting = (
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    camera: THREE.PerspectiveCamera,
    uniformBase: number,
  ) => {
    if (!surfaces || !deferred || !hdrView || !depthView || !colorView)
      throw new Error('DEFERRED_UNAVAILABLE');
    const [width, height] = targetSize;
    deferred.bind(surfaces, depthView, hdrView);
    inverseViewProj.copy(viewProj).invert();
    camera.getWorldPosition(cameraWorldScratch);
    cameraWorldArray[0] = cameraWorldScratch.x;
    cameraWorldArray[1] = cameraWorldScratch.y;
    cameraWorldArray[2] = cameraWorldScratch.z;
    deferred.update(
      inverseViewProj.elements,
      cameraWorldArray,
      width,
      height,
      clearColor,
      diagnostic !== 'beauty',
    );
    deferred.light(encoder, hdrView);
    gpuDrawCalls++;
    encodeBlend(device, encoder, uniformBase);
    const presentation = secondaryCamera ? undefined : presenter?.targetView(width, height);
    gpuDrawCalls++;
    deferred.compose(
      encoder,
      colorView,
      {
        r: (clearColor >> 16) / 255,
        g: ((clearColor >> 8) & 255) / 255,
        b: (clearColor & 255) / 255,
        a: 1,
      },
      presentation,
    );
    return !!presentation;
  };
  const visBin = (rec: PageRec): 0 | 1 | 2 => {
    const side = materialSide(rec.material);
    if (side === THREE.DoubleSide) return BIN_NONE;
    // Indirect pipelines share ccw front faces; a reflection swaps which side
    // must be culled instead of requiring three more draw slots.
    return (side === THREE.BackSide) !== windingCw(rec) ? BIN_FRONT : BIN_BACK;
  };
  const encodeVis = (device: GPUDevice, camera: THREE.PerspectiveCamera, itemsDirty: boolean) => {
    if (
      !visBindGroupLayout ||
      !cache ||
      !concatPos ||
      !colorView ||
      !depthView ||
      !visView ||
      !visPipelineBack ||
      !shadePipeline ||
      !pageTable ||
      !rows.pageTableInts
    )
      return 0;
    const idsView = visView,
      depthTarget = depthView;
    const [width, height] = targetSize;
    if (!rows.packedCount) {
      if (!surfaces) throw new Error('SURFACE_UNAVAILABLE');
      const encoder = createRenderEncoder(device);
      const pass = encoder.beginRenderPass({
        label: 'WG empty surfaces',
        colorAttachments: surfaces.views().map((view) => ({
          view,
          loadOp: 'clear' as const,
          storeOp: 'store' as const,
          clearValue: [0, 0, 0, 0],
        })),
        depthStencilAttachment: {
          view: depthTarget,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass.end();
      const presented = encodeSurfaceLighting(device, encoder, camera, 0);
      submitColorCopy(device, encoder, height, width, presented);
      return blendSubmittedTriangles;
    }
    ensureUniform(device, Math.max(1, rows.packedCount + blendState.blendGpu.length));
    if (!gpuSmall && !hybridUnavailable && typeof device.createComputePipeline === 'function') {
      try {
        checkFrameBudget(
          width,
          height,
          captureAllocationBytes + width * height * 8 + smallTriangleCapacity * 4,
        );
        gpuSmall = createGpuSmallTriangles(device, width, height, smallTriangleCapacity);
        capabilities.unsupported = capabilities.unsupported.filter(
          (item) => item !== 'small-triangle compute raster',
        );
      } catch (error) {
        hybridUnavailable = true;
        diagnosticFailure('small-triangle-compute-unavailable', error);
      }
    }
    // Occluder/rest partition of the image: the half the previous image drew unoccluded, and the nearest
    // half by depth when there is no history or the history splits nothing. The boxes feed both the
    // partition and the Hi-Z test, projected with the view-projection built once for the batch rather
    // than once per page and once again per tested page.
    const partition = partitionWebgpuVisibility({
      rows,
      camera,
      width,
      height,
      boxCorners,
      hizBounds,
      hizRest,
      drawnOccluderUrls,
      urlIndexOfPage,
      noOccluderHistory,
      hasHiz: !!gpuHiz,
      hasRestPipeline: !!visHizRestBack,
    });
    const { occluders, twoPass } = partition;
    lastPartitionMs = partition.partitionMs;
    lastProjectMs = partition.projectMs;
    lastItemsMs = 0;
    const maxVertexCount = Math.max(1, pageBytes / 4);
    const useIndirect = !!gpuDraw && rows.packedCount <= drawSlots;
    // The table holds every row ever claimed, so a row a page keeps stays valid across frames.
    const tableRows = rows.rowCount;
    if (tableRows > VIS_MAX_PAGES)
      throw new Error(
        `VISIBILITY_ID_RANGE: ${tableRows} pages exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`,
      );
    const itemBatch = buildWebgpuVisibilityItems({
      rows,
      hizRest,
      twoPass,
      itemsDirty,
      drawItemWords,
      binInstances,
      drawRestBits,
      hizTestedBounds,
      hizBounds,
      hizTestedRows,
      visBin,
    });
    const { occluderVertices, restVertices, testedCount } = itemBatch;
    lastItemsMs = itemBatch.itemsMs;
    uploadDirtyRows(device);
    ({ visUniform, shadeUniform } = writeWebgpuVisibilityUniforms({
      device,
      visUniform,
      shadeUniform,
      visUniPacked,
      shadeUniPacked,
      width,
      height,
      hasGpuSmall: !!gpuSmall,
      tableRows,
      gpuFrameActive,
      maskOffset: gpuSelection?.maskOffset ?? 0,
      diagnostic,
    }));
    ({ shadeBindGroup, mapsArrayView, dataMapsArrayView } = ensureWebgpuShadeBindings({
      device,
      group: shadeBindGroup,
      layout: shadeBindGroupLayout,
      visView,
      pageTable,
      cacheBuffer: cache?.buffer,
      concatPos,
      concatUv,
      concatNrm,
      mapsTexture,
      dataMapsTexture,
      mapsSampler,
      shadeUniform,
      mapsArrayView,
      dataMapsArrayView,
    }));
    ({ mapsArrayView, visBindGroup, visHizBindGroup } = ensureWebgpuVisibilityBindings({
      device,
      layout: visBindGroupLayout,
      cacheBuffer: cache?.buffer,
      concatPos,
      concatUv,
      pageTable,
      visUniform,
      zeroFlags,
      mapsTexture,
      mapsSampler,
      hizFlags: gpuHiz?.flags,
      mapsArrayView,
      visBindGroup,
      visHizBindGroup,
    }));
    const encoder = createRenderEncoder(device);
    // The item words restate the rows, so the upload is what consumes the changed flag.
    if (useIndirect) {
      gpuDraw!.encode(
        encoder,
        drawItemWords,
        rows.packedCount,
        itemsDirty,
        drawRestBits,
        maxVertexCount,
        gpuFrameActive ? gpuSelection : undefined,
      );
      rows.rowsChanged = false;
    }
    const visDrawer = createWebgpuVisibilityDrawer({
      device,
      rows,
      visSlots: [
        visPipelineBack,
        visPipelineNone,
        visPipelineFront,
        visHizRestBack,
        visHizRestNone,
        visHizRestFront,
      ],
      visSlotGroups,
      visBindGroupLayout,
      cacheBuffer: cache?.buffer,
      concatPos,
      concatUv,
      pageTable,
      visUniform,
      mapsTexture,
      mapsSampler,
      zeroFlags,
      hizFlags: gpuHiz?.flags,
      gpuDraw,
      mapsArrayView,
      visBindGroup,
      visHizBindGroup,
      useIndirect,
      binInstances,
      twoPass,
      hizRest,
      visPipelineFor,
    });
    const raster = encodeWebgpuVisibilityPasses({
      device,
      encoder,
      idsView,
      depthTarget,
      width,
      height,
      gpuHiz,
      visDrawer,
      twoPass,
      occluderVertices,
      restVertices,
      hizTestedBounds,
      hizTestedRows,
      testedCount,
      tableRows,
      rows,
      hizRest,
      drawnOccluderUrls,
      urlIndexOfPage,
      occluders,
      noOccluderHistory,
    });
    const vertices = raster.vertices;
    noOccluderHistory = raster.noOccluderHistory;
    mapsArrayView = visDrawer.mapsArrayView;
    gpuDrawCalls += visDrawer.drawCalls;
    if (
      gpuSmall &&
      cache &&
      concatPos &&
      concatUv &&
      pageTable &&
      visUniform &&
      zeroFlags &&
      mapsTexture &&
      mapsSampler
    ) {
      // Every row carries its own Hi-Z slot, so a frame that ran no occlusion test is handed the zero
      // flags: the pyramid verdicts of the previous image do not describe this one.
      const hizFlags = twoPass && gpuHiz ? gpuHiz.flags : zeroFlags;
      const smallKey = (hizFlags === zeroFlags ? 0 : 1) + (gpuFrameActive ? 2 : 0);
      gpuSmall.encode(encoder, {
        indices: cache.buffer,
        positions: concatPos,
        pages: pageTable,
        hizFlags,
        uniform: visUniform,
        uvs: concatUv,
        maps: (mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' })),
        sampler: mapsSampler,
        pageRows: tableRows,
        maxTriangles: Math.ceil(maxVertexCount / 3),
        idsView,
        depthView: depthTarget,
        hizView: gpuHiz?.level0View,
        selection: gpuFrameActive ? gpuSelection : undefined,
        groups: smallGroups,
        groupKey: smallKey,
      });
      gpuDrawCalls++;
    }
    if (!surfaces || !deferred || !hdrView) throw new Error('DEFERRED_UNAVAILABLE');
    const shadePass = encoder.beginRenderPass({
      label: 'WG material surfaces v1',
      colorAttachments: surfaces.views().map((view) => ({
        view,
        loadOp: 'clear' as const,
        storeOp: 'store' as const,
        clearValue: [0, 0, 0, 0],
      })),
    });
    shadePass.setViewport(0, 0, width, height, 0, 1);
    if (shadeBindGroup) {
      shadePass.setPipeline(shadePipeline);
      shadePass.setBindGroup(0, shadeBindGroup);
      shadePass.draw(3);
      gpuDrawCalls++;
    }
    shadePass.end();
    const presented = encodeSurfaceLighting(device, encoder, camera, rows.packedCount);
    submitColorCopy(device, encoder, height, width, presented);
    return vertices / 3 + blendSubmittedTriangles;
  };
  const encodeDraws = (device: GPUDevice, camera: THREE.PerspectiveCamera) => {
    gpuDrawCalls = 0;
    blendSubmittedTriangles = 0;
    blendDrawCalls = 0;
    blendFrustumRejected = 0;
    blendState.visibleBlend.length = 0;
    transparentEncodeMs = 0;
    if (!bindGroupLayout || !cache || !colorView || !depthView) return 0;
    const [width, height] = targetSize;
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    blendState.blendFrustum.setFromProjectionMatrix(viewProj, camera.coordinateSystem);
    blendFrustumRejected = selectWebgpuBlend(device, blendState, drawn, cache);
    viewProj.premultiply(remap);
    ensurePageTable(device);
    if (!gpuFrameActive) syncRowsFromCut();
    else if (rowsSyncedFrame !== frame) {
      syncRows();
      rowsSyncedFrame = frame;
    }
    if (diagnostic === 'screen-error' && rows.pageTableFloats) {
      const rowWords = PAGE_INFO_STRIDE / 4;
      for (let row = 0; row < rows.packedCount; row++) {
        const rec = rows.packedRecs[row];
        if (!rec) continue;
        rows.pageTableFloats[row * rowWords + 56] = screenErrorRatio(
          projectedPageError(rec, camera, viewport),
          diagnosticPixelError,
        );
        rows.markRowDirty(row);
      }
    }
    const itemsDirty = rows.rowsChanged;
    if (visEnabled && visPipelineBack && shadePipeline && visView) {
      try {
        return encodeVis(device, camera, itemsDirty);
      } catch (error) {
        abandonFrameEncoder();
        gpuTiming?.cancelUnsubmitted();
        diagnosticFailure('visibility-render-failed', error);
        dropVis();
        gpuDrawCalls = 0;
        if (context.gpuCanvas || secondaryCamera || gpuFrameActive) throw error;
      }
    }
    if (!pipelineBack) return 0;
    uploadDirtyRows(device);
    if (!rows.packedCount) {
      const encoder = createRenderEncoder(device);
      encodeClear(device, encoder);
      encodeBlend(device, encoder, 0);
      submitColorCopy(device, encoder, height, width);
      return blendSubmittedTriangles;
    }
    ensureUniform(device, Math.max(1, rows.packedCount + blendState.blendGpu.length));
    const fallback = drawWebgpuFallback({
      device,
      rows,
      uniformPacked,
      uniformBuffer,
      diagnostic,
      pageRgb,
      createRenderEncoder,
      colorView,
      depthView,
      width,
      height,
      clearColor,
      bindGroupFor,
      pipelineFor,
    });
    const { encoder, vertices } = fallback;
    gpuDrawCalls += fallback.drawCalls;
    encodeBlend(device, encoder, rows.packedCount);
    submitColorCopy(device, encoder, height, width);
    return vertices / 3 + blendSubmittedTriangles;
  };
  const hasBytes = (rec: PageRec) => !!(rec.array || sourceBytes.has(rec.url));
  const culledScratch: PageRec[] = [];
  const budgetedResidency = createBudgetedResidency(tracking, bootstrapKey, bootstrapUrls, slots);
  const pinUpdater = createWebgpuPinUpdater(
    tracking,
    bootstrapKeys,
    bootstrapUrls,
    deferredDrops,
    requestUrlByPage,
    traceEnabled,
    traceDiagnostic,
  );
  const dropPinnedPage = (key: string) => backend.dropPage!(key);
  const updatePins = () => pinUpdater(cache, shown, gpuFrameActive, frame, dropPinnedPage);
  const bootstrapState = createWebgpuBootstrap({
    pages: bootstrap,
    urls: bootstrapUrls,
    slots,
    tracking,
    signal: context.signal,
    readPage: context.readPage,
    acceptPage: (key, data) => backend.acceptPage!(key, data),
    getCache: () => cache,
    getFrame: () => frame,
    isLost: () => lost,
    hasBytes,
    engineDiagnostic,
    traceDiagnostic,
    diagnosticFailure,
  });
  const ensureBootstrap = bootstrapState.ensure;
  const ensureResident = createWebgpuResidentEnsurer({
    getCache: () => cache,
    tracking,
    bootstrapKey,
    signal: context.signal,
    hasBytes,
    isLost: () => lost,
    traceEnabled,
    traceDiagnostic,
  });
  const residency = createWebgpuResidencyQueue({
    tracking,
    getCache: () => cache,
    getFrame: () => frame,
    hasBytes,
    updatePins,
    ensureResident,
    markLost: () => {
      lost = true;
    },
    traceEnabled,
    traceDiagnostic,
    diagnosticFailure,
  });
  const queueResident = residency.queueResident;
  // Readback describes submitted work and future streaming requests. It never
  // decides the cut drawn for a moving camera; the current GPU mask does that.
  const cutAdopter = createWebgpuCutAdopter({
    selection: () => gpuSelection,
    packedPages,
    desired,
    shown,
    drawn,
    wanted: gpuWanted,
    transparentScratch,
    drawableScratch,
    uniforms: selectionUniforms,
    residentOffsetWords: rows.residentOffsetWords,
    frame: () => frame,
  });
  const adoptGpuCut = () => {
    if (!cutAdopter.adopt()) return;
    const metrics = cutAdopter.metrics;
    visible = metrics.visible;
    selectedTriangles = metrics.selectedTriangles;
    uncoveredTriangles = metrics.uncoveredTriangles;
    submittedTriangles = metrics.drawnTriangles + blendSubmittedTriangles;
    frustumRejected = metrics.frustumRejected;
    lodLevel = metrics.lodLevel;
    gpuMetricsReady = metrics.ready;
  };
  const renderGpuCut = (
    camera: THREE.PerspectiveCamera,
    pixelError: number,
    cpuStart: number,
    lightsEnd: number,
  ) => {
    if (!gpuDevice || !cache || !gpuSelection) return;
    gpuFrameActive = true;
    // A cut wider than the GPU page budget is coarsened, never truncated: truncating a DAG cut punches
    // holes, while a coarser threshold is still an exact partition of the surface. `budgetPixelError`
    // carries the previous frame's verdict, the same feedback `pageBudget` applies on the CPU path.
    const budgeted = Math.max(pixelError, budgetPixelError);
    cameraSelectionUniforms(camera, budgeted, viewport, selectionUniforms);
    adoptGpuCut();
    const adoptEnd = performance.now();
    // Forward transparency has its own CPU cut; it is absent from the GPU cluster set.
    const transparentBudget = Math.max(1, slots - bootstrapUrls.size);
    const transparent = transparentRoots.length
      ? selectVisiblePages(transparentRoots, camera, {
          pixelError: budgeted,
          viewport,
          frame,
          holdResident: true,
          rootFallback: true,
          pageBudget: transparentBudget,
          isResident: (rec) => !!cache!.get(rec.url),
        })
      : undefined;
    const transparentSelectEnd = performance.now();
    const oldOpaque = partitionByPass(shown, false, opaqueScratch);
    shown.length = 0;
    appendAll(shown, oldOpaque, transparent?.shown ?? []);
    desired.length = 0;
    appendAll(desired, gpuWanted, transparent?.wanted ?? []);
    if (gpuMetricsReady) visible = desired.length;
    tracking.requestedEpoch++;
    tracking.requestedCount = 0;
    const request = (key: number) => {
      if (tracking.requestedStamp[key] !== tracking.requestedEpoch) {
        tracking.requestedStamp[key] = tracking.requestedEpoch;
        tracking.requestedList[tracking.requestedCount++] = key;
      }
    };
    for (let i = 0; i < bootstrapKeys.length; i++) request(bootstrapKeys[i]);
    for (let i = 0; i < desired.length; i++) request(tracking.keyOf(desired[i]));
    const wasLimited = coverageBudgetLimited;
    coverageBudgetLimited = tracking.requestedCount > slots;
    // Coarsen until the wanted cut fits, and relax again once it fits with room to spare. Doubling
    // and halving with a gap between the two thresholds keeps the loop from oscillating every frame.
    if (coverageBudgetLimited)
      budgetPixelError = Math.min(
        MAX_BUDGET_PIXEL_ERROR,
        budgetPixelError > 0 ? budgetPixelError * 2 : Math.max(1, pixelError * 2),
      );
    else if (budgetPixelError > 0 && tracking.requestedCount < slots * 0.7)
      budgetPixelError = budgetPixelError > pixelError * 2 ? budgetPixelError / 2 : 0;
    if (wasLimited !== coverageBudgetLimited)
      coverageBudgetEvent = {
        version: 1,
        limited: coverageBudgetLimited,
        requiredSlots: tracking.requestedCount,
        slots,
        fallbackRetained: bootstrapState.ready,
        pixelError: budgeted,
      };
    if (!bootstrapState.ready) {
      gpuMetricsReady = false;
      traceDiagnostic('frame', 'Frame en attente de couverture GPU', {
        backend: 'webgpu-page-raster',
        frame,
        submission: imageRevision,
        source: 'gpu',
        coverage: { ready: false },
        selectedTriangles: null,
        submittedTriangles: null,
      });
      return;
    }
    // With the roots pinned the transparent cut always falls back to them, so an incomplete cut here
    // means a pinned root is itself absent from the cache, which is a bug and not a streaming state.
    if (transparent?.complete === false)
      throw new Error('GPU_COVERAGE_INCOMPLETE: a pinned transparent root cluster is not resident');
    tracking.transitionEpoch++;
    tracking.transitionCount = 0;
    if (transparent && !coverageBudgetLimited) {
      const transition = (key: number) => {
        if (tracking.transitionStamp[key] !== tracking.transitionEpoch) {
          tracking.transitionStamp[key] = tracking.transitionEpoch;
          tracking.transitionCount++;
        }
      };
      for (let i = 0; i < tracking.requestedCount; i++) transition(tracking.requestedList[i]);
      for (let i = 0; i < transparent.shown.length; i++)
        transition(tracking.keyOf(transparent.shown[i]));
    }
    if (transparent && !coverageBudgetLimited && tracking.transitionCount > slots) {
      const fallback = selectVisiblePages(transparentRoots, camera, {
        pixelError: budgeted,
        viewport,
        frame,
        holdResident: true,
        rootFallback: true,
        pageBudget: transparentBudget,
        isResident: (rec) => bootstrapUrls.has(rec.url) && !!cache!.get(rec.url),
      });
      if (!fallback.complete)
        throw new Error('GPU_COVERAGE_INCOMPLETE: the pinned transparent cover is not resident');
      shown.length = 0;
      appendAll(shown, oldOpaque, fallback.shown);
    }
    selectedTriangles = triangleSum(shown);
    const admissionEnd = performance.now();
    queueResident(budgetedResidency(desired));
    // Enumerate the bounded resident candidates once. GPU selection and compaction
    // share their page indices; no CPU frustum/LOD traversal or regrouping follows.
    const queueEnd = performance.now();
    ensurePageTable(gpuDevice);
    syncRows();
    rowsSyncedFrame = frame;
    const rowsEnd = performance.now();
    if (rows.candidateOverflow) {
      // The CPU fallback can still select a representable visible subset.
      engineDiagnostic(
        'gpu-selection-capacity',
        'Sélection CPU requise par la capacité des identifiants de visibilité',
        {
          residentCandidates: rows.candidateCount + rows.candidateOverflow,
          maxCandidates: drawSlots,
        },
      );
      dropGpuSelection();
      gpuFrameActive = false;
      backend.render(camera);
      return;
    }
    if (gpuSelection.updateResidency(rows.residentFlags)) gpuMetricsReady = false;
    const residencyUploadEnd = performance.now();
    try {
      frameSelection = gpuSelection.dispatch(selectionUniforms, openFrameEncoder(gpuDevice));
    } catch (error) {
      abandonFrameEncoder();
      diagnosticFailure('gpu-selection-dispatch-failed', error);
      dropGpuSelection();
      gpuFrameActive = false;
      backend.render(camera);
      return;
    }
    drawn.length = 0;
    appendAll(drawn, shown);
    const selectionEnd = performance.now();
    const [width, height] = viewport;
    ensureTargets(gpuDevice, Math.max(1, width), Math.max(1, height));
    if (!renderPathLogged) {
      renderPathLogged = true;
      engineDiagnostic('first-render-path', 'Configuration du premier rendu WebGPU', {
        clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
        targetSize,
        visibilityBuffer: true,
        selection: 'current-frame-mask',
        residentCandidates: rows.candidateCount,
      });
    }
    const encodeStart = performance.now();
    try {
      encodeDraws(gpuDevice, camera);
    } catch (error) {
      abandonFrameEncoder();
      if (context.gpuCanvas) throw error;
      dropGpuSelection();
      gpuFrameActive = false;
      backend.render(camera);
      return;
    }
    // An encode path that returned without submitting would strand the selection's readback slot.
    abandonFrameEncoder();
    const cpuEnd = performance.now();
    lastSubmitMs = cpuEnd - encodeStart;
    if (gpuMetricsReady) submittedTriangles = triangleSum(shown, false) + blendSubmittedTriangles;
    const steps = cpuProfile.row;
    steps[0] = adoptEnd - lightsEnd;
    steps[1] = transparentSelectEnd - adoptEnd;
    steps[2] = admissionEnd - transparentSelectEnd;
    steps[3] = queueEnd - admissionEnd;
    steps[4] = rowsEnd - queueEnd;
    steps[5] = residencyUploadEnd - rowsEnd;
    steps[6] = selectionEnd - residencyUploadEnd;
    steps[7] = lastProjectMs;
    steps[8] = lastPartitionMs;
    steps[9] = lastItemsMs;
    steps[10] = lastSubmitMs - lastProjectMs - lastPartitionMs - lastItemsMs;
    steps[11] = lastSubmitMs;
    steps[12] = cpuEnd - cpuStart;
    cpuProfile.record(frame, cpuEnd - cpuStart);
    cpuSample = {
      version: 1,
      frame,
      submission: imageRevision,
      scope: 'backend-render-call',
      totalMs: cpuEnd - cpuStart,
      lightsMs: lightsEnd - cpuStart,
      selectionMs: selectionEnd - lightsEnd,
      residencyScheduleAndTargetsMs: encodeStart - selectionEnd,
      encodeSubmitMs: lastSubmitMs,
      transparentEncodeMs,
      transparentIncludedIn: 'encodeSubmitMs',
      asyncResidencyWaitMs: null,
    };
    publishCpuProfile();
    if (traceEnabled)
      traceDiagnostic(
        'gpu-selection-current-frame',
        'Sélection GPU consommée par le dessin',
        () => ({
          frame,
          submission: imageRevision,
          source: 'gpu',
          decision: 'current-frame-mask',
          residentCandidates: rows.candidateCount,
          readbackPurpose: 'streaming-and-metrics',
          metricsReady: gpuMetricsReady,
        }),
      );
    if (traceEnabled)
      traceDiagnostic('frame', 'Snapshot complet de la frame WebGPU', () => ({
        backend: 'webgpu-page-raster',
        frame,
        submission: imageRevision,
        pose: cameraPose(camera),
        source: 'gpu',
        selection: { source: 'gpu', decision: 'current-frame-mask' },
        cpu: cpuSample,
        coverage: {
          loaded: tracking.traceSet(
            'frame.loaded',
            rows.packedRecs.slice(0, rows.packedCount).map((page) => page!.url),
          ),
          wanted: tracking.traceSet(
            'frame.wanted',
            desired.map((page) => page.url),
          ),
          shown: gpuMetricsReady
            ? tracking.traceSet(
                'frame.shown',
                shown.map((page) => page.url),
              )
            : null,
          ready: bootstrapState.ready,
        },
        budget: { slots, limited: coverageBudgetLimited },
        selectedTriangles,
        uncoveredTriangles,
        submittedTriangles: gpuMetricsReady ? submittedTriangles : null,
        drawCalls: gpuDrawCalls,
      }));
  };
  const backend: WebgpuPagesBackend = {
    id: 'webgpu-page-raster',
    capabilities,
    scene,
    get overBudget() {
      return overBudget;
    },
    setDiagnostic(mode) {
      diagnostic = mode;
    },
    refreshSceneLighting() {
      lights?.refresh();
      lightState = lights?.update();
      capturedRevision = -1;
      engineDiagnostic('scene-lighting', 'Inventaire des lumières actualisé', {
        version: 1,
        ...lightState,
        shadows: false,
        globalIllumination: false,
      });
    },
    async prepare() {
      context.signal?.throwIfAborted();
      if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
      if (bootstrap.length > slots)
        throw new Error(
          `INITIAL_COVERAGE_BUDGET: ${bootstrap.length} pages required, ${slots} slots`,
        );
      gpuTiming = createGpuTiming(gpuDevice, {
        sampleEveryFrames: traceEnabled ? 1 : 12,
        onSample: (sample) => {
          // The public metric carries the contract's fields only; the diagnostic keeps the full context.
          lastGpuPassMs = {
            frame: sample.frame,
            totalMs: sample.totalMs,
            passes: sample.passes,
            truncated: sample.truncated,
            ...(sample.error ? { error: sample.error } : {}),
          };
          lastGpuFrameMs = sample.submittedMs;
          lastGpuHostGapMs = sample.hostGapMs;
          const phase = sample.error ? 'gpu-timing-unavailable' : 'gpu-timing',
            message = sample.error ? 'Mesure GPU indisponible' : 'Durées GPU mesurées par passe';
          engineDiagnostic(phase, message, sample);
          if (traceEnabled)
            traceDiagnostic(phase, message, () => ({
              backend: 'webgpu-page-raster',
              submission: sample.submission ?? null,
              ...sample,
            }));
        },
      });
      const timingStats = gpuTiming.stats();
      engineDiagnostic('gpu-timing-status', 'Disponibilité des mesures GPU par passe', {
        version: 1,
        available: gpuTiming.supported,
        reason: gpuTiming.supported ? null : 'timestamp-query-unavailable',
        method: 'timestamp-query',
        sampleEveryFrames: timingStats.sampleEveryFrames,
        maxPasses: timingStats.maxPasses,
        maxParts: timingStats.maxParts,
        maxPending: 1,
        queryCount: timingStats.queryCount,
        scope: 'selection-and-render-passes',
        excludes: ['uploads and copies', 'CPU work', 'presentation latency'],
        stats: timingStats,
      });
      gpuDevice.addEventListener?.('uncapturederror', onGpuError);
      gpuDevice.lost
        .then((info) => {
          if (!lost)
            engineDiagnostic('gpu-device-lost', 'Périphérique WebGPU perdu', {
              reason: info.reason,
              message: info.message,
            });
          lost = true;
        })
        .catch((error) => {
          if (!lost) diagnosticFailure('gpu-device-lost', error);
          lost = true;
        });
      try {
        lights = createSceneLightBuffer(gpuDevice, context.sceneLighting ?? source);
        lightState = lights.update();
        engineDiagnostic('scene-lighting', 'Lumières de la scène actives', {
          version: 1,
          ...lightState,
          shadows: false,
          globalIllumination: false,
        });
        deferred = await createDeferredLighting(gpuDevice, lights.buffer);
        context.signal?.throwIfAborted();
        ({ presenter, canvasTexture, blitMaterial, blit } = prepareWebgpuPresentation(
          gpuDevice,
          scene,
          context.gpuCanvas,
        ));
        if (presenter)
          capabilities.unsupported = capabilities.unsupported.filter(
            (item) => item !== 'direct WebGPU present',
          );
        engineDiagnostic('gpu-presentation', 'Présentation GPU initialisée', {
          mode: context.gpuCanvas
            ? 'direct-canvas'
            : presenter
              ? 'gpu-canvas-webgl-composition'
              : 'texture-only',
          imageReadbackDuringRender: false,
        });
        const cacheOptions = (
          traceEnabled
            ? {
                pageBytes,
                slots,
                onDiagnostic: (event: {
                  phase: string;
                  message: string;
                  context: Record<string, unknown>;
                }) =>
                  traceDiagnostic(`cache-${event.phase}`, event.message, () => ({
                    ...event.context,
                    frame,
                  })),
              }
            : { pageBytes, slots }
        ) as Parameters<typeof createGpuPageCache>[2];
        cache = createGpuPageCache(gpuDevice, pageSource, cacheOptions);
        ({ bindGroupLayout, pipelineBack, pipelineBackCw, pipelineNone, pipelineBlend } =
          createWebgpuPagesPipelines(gpuDevice, UNIFORM_STRIDE));
        for (const rec of allPages)
          ensureWebgpuPositionBuffer(gpuDevice, rec.attributes, positionBuffers);
        for (let i = 0; i < packedPages.length; i++)
          rows.pagePositions[i] = positionBuffers.get(packedPages[i].attributes);
        zeroUv = gpuDevice.createBuffer({
          size: 8,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        gpuDevice.queue.writeBuffer(zeroUv, 0, new Float32Array([0, 0]));
        prepareWebgpuBlend(
          gpuDevice,
          blendCopies,
          positionBuffers,
          blendState,
          scene,
          !!context.gpuCanvas,
        );
        const [width, height] = viewport ?? [1, 1];
        ensureTargets(gpuDevice, Math.max(1, width), Math.max(1, height));
        ensureUniform(gpuDevice, cap);
        try {
          geometryBlocks.clear();
          mapLayer.clear();
          dataLayer.clear();
          uvScales.length = 0;
          uvScales.push([1, 1]);
          dataUvScales.length = 0;
          dataUvScales.push([1, 1]);
          ({ concatPos, concatUv, concatNrm } = prepareWebgpuGeometry(
            gpuDevice,
            allPages,
            geometryBlocks,
          ));
          const { maps, dataMaps, normalMaps } = collectWebgpuMaterialTextures(
            allPages,
            blendCopies,
            mapLayer,
            dataLayer,
          );
          engineDiagnostic('material-textures', 'Textures nécessaires au rendu', {
            colorTextures: maps.length,
            dataTextures: dataMaps.length,
            materials: new Set(allPages.map((page) => page.material)).size,
            opaquePages: allPages.length,
            forwardMeshes: blendCopies.length,
            geometryWithTangents: [...geometryBlocks.values()].filter((block) => block.hasTangent)
              .length,
            geometryWithoutTangents: [...geometryBlocks.values()].filter(
              (block) => !block.hasTangent,
            ).length,
          });
          const textureStarted = performance.now();
          const colorAtlas = prepareWebgpuColorAtlas(gpuDevice, maps, uvScales, textureJobs);
          mapsTexture = colorAtlas.mapsTexture;
          textureColorSize = [colorAtlas.maxW, colorAtlas.maxH];
          const { maxW, maxH, fallbackEncoder } = colorAtlas;
          const dataAtlas = prepareWebgpuDataAtlas(
            gpuDevice,
            dataMaps,
            normalMaps,
            dataUvScales,
            textureJobs,
            fallbackEncoder,
          );
          dataMapsTexture = dataAtlas.dataMapsTexture;
          textureDataSize = [dataAtlas.dataW, dataAtlas.dataH];
          const { dataW, dataH } = dataAtlas;
          await generateMaterialMips(
            gpuDevice,
            mapsTexture,
            'rgba8unorm-srgb',
            maxW,
            maxH,
            uvScales,
          );
          await generateMaterialMips(
            gpuDevice,
            dataMapsTexture,
            'rgba8unorm',
            dataW,
            dataH,
            dataUvScales,
          );
          await pumpTextures();
          const scales = new Float32Array(Math.max(uvScales.length, dataUvScales.length) * 4);
          for (let i = 0; i < scales.length / 4; i++) {
            scales.set(dataUvScales[i] ?? [1, 1], i * 4);
            scales.set(uvScales[i] ?? [1, 1], i * 4 + 2);
          }
          materialScales = gpuDevice.createBuffer({
            size: scales.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          gpuDevice.queue.writeBuffer(materialScales, 0, scales);
          engineDiagnostic('material-textures-ready', 'Textures et filtrage prêts', {
            color: {
              count: maps.length,
              size: [maxW, maxH],
              mipLevels: 1 + Math.floor(Math.log2(Math.max(maxW, maxH))),
              format: 'rgba8unorm-srgb',
            },
            data: {
              count: dataMaps.length,
              size: [dataW, dataH],
              mipLevels: 1 + Math.floor(Math.log2(Math.max(dataW, dataH))),
              format: 'rgba8unorm',
            },
            preparationMs: performance.now() - textureStarted,
            lighting: 'GGX direct + diffuse hemisphere; no environment map',
            display: 'ACES once, sRGB once',
          });
          mapsSampler = gpuDevice.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
          });
          try {
            ({
              blendBindGroupLayout,
              pipelineBlendTextured,
              pipelineBlendFront,
              pipelineBlendBack,
            } = await createWebgpuBlendPipelines(gpuDevice, blendState.blendGpu));
          } catch (error) {
            diagnosticFailure('forward-material-pipeline-failed', error);
            blendBindGroupLayout = undefined;
            pipelineBlendTextured = undefined;
          }
          const shaders = await createWebgpuVisibilityShaders(gpuDevice, drawSlots);
          shadeUniform = shaders.shadeUniform;
          visBindGroupLayout = shaders.visBindGroupLayout;
          zeroFlags = shaders.zeroFlags;
          visUniform = shaders.visUniform;
          const { visModule, shadeModule } = shaders;
          gpuHiz = await createGpuHiz(
            gpuDevice,
            Math.max(1, width),
            Math.max(1, height),
            drawSlots,
          );
          let rasterPipelines;
          try {
            if (!gpuHiz || !visBindGroupLayout) throw new Error('HIZ_UNAVAILABLE');
            rasterPipelines = await createWebgpuVisibilityRasterPipelines(
              gpuDevice,
              visModule,
              visBindGroupLayout,
              true,
            );
          } catch (error) {
            diagnosticFailure('hiz-pipeline-fallback', error);
            dropGpuHiz();
            rasterPipelines = await createWebgpuVisibilityRasterPipelines(
              gpuDevice,
              visModule,
              visBindGroupLayout!,
              false,
            );
          }
          ({
            visPipelineBack,
            visPipelineBackCw,
            visPipelineNone,
            visPipelineFront,
            visPipelineFrontCw,
            visHizRestBack,
            visHizRestBackCw,
            visHizRestNone,
            visHizRestFront,
            visHizRestFrontCw,
          } = rasterPipelines);
          ({ shadeBindGroupLayout, shadePipeline } = await createWebgpuShadePipeline(
            gpuDevice,
            shadeModule,
          ));
          if (!pageTable)
            pageTable = gpuDevice.createBuffer({
              size: PAGE_INFO_STRIDE,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
          if (
            visView &&
            cache &&
            concatPos &&
            concatUv &&
            concatNrm &&
            mapsTexture &&
            dataMapsTexture &&
            mapsSampler &&
            shadeUniform &&
            shadeBindGroupLayout
          ) {
            shadeBindGroup = gpuDevice.createBindGroup({
              layout: shadeBindGroupLayout,
              entries: [
                { binding: 0, resource: visView },
                { binding: 1, resource: { buffer: cache.buffer } },
                { binding: 2, resource: { buffer: concatPos } },
                { binding: 3, resource: { buffer: concatUv } },
                { binding: 4, resource: { buffer: concatNrm } },
                { binding: 5, resource: { buffer: pageTable } },
                { binding: 6, resource: mapsTexture.createView({ dimension: '2d-array' }) },
                { binding: 7, resource: mapsSampler },
                { binding: 8, resource: { buffer: shadeUniform } },
                { binding: 9, resource: dataMapsTexture.createView({ dimension: '2d-array' }) },
              ],
            });
          }
          visEnabled = !!visTexture && !!shadeBindGroup && !!shadePipeline && !!visPipelineBack;
          if (visEnabled) {
            engineDiagnostic('material-surfaces-ready', 'Surfaces et éclairage séparés', {
              surfaceVersion: 1,
              formats: SURFACE_FORMATS,
              bytesPerPixel: 28,
              lighting: 'HDR',
              globalIllumination: false,
              motionVectors: false,
            });
            capabilities.materials =
              'Source glTF via GGX direct specular and hemisphere diffuse lighting with visibility buffer; double-sided when the material is';
            capabilities.unsupported = capabilities.unsupported.filter(
              (item) =>
                item !== 'visibility buffer' &&
                item !== 'textured PBR maps' &&
                item !== 'occlusion culling' &&
                item !== 'temporal occlusion culling',
            );
            gpuDraw = await createGpuDraw(gpuDevice, drawSlots);
            if (gpuDraw)
              capabilities.unsupported = capabilities.unsupported.filter(
                (item) => item !== 'indirect draw',
              );
          } else dropVis();
        } catch (error) {
          diagnosticFailure('material-pipeline-failed', error);
          dropVis();
        }
        if (blendState.blendGpu.length && !pipelineBlendTextured) dropVis();
        if (context.gpuCanvas && !visEnabled)
          throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE');
        if (context.gpuCanvas && blendState.blendGpu.length && !pipelineBlendTextured)
          throw new Error('WEBGPU_FORWARD_MATERIAL_UNAVAILABLE');
        const xyzCache = new WeakMap<THREE.BufferGeometry['attributes'], Float32Array>();
        for (const rec of allPages) {
          const array = rec.array,
            attr = rec.attributes.position;
          if (!array || !attr) continue;
          let xyz = xyzCache.get(rec.attributes);
          if (!xyz) {
            xyz = new Float32Array(attr.count * 3);
            for (let i = 0; i < attr.count; i++) {
              xyz[i * 3] = attr.getX(i);
              xyz[i * 3 + 1] = attr.getY(i);
              xyz[i * 3 + 2] = attr.getZ(i);
            }
            xyzCache.set(rec.attributes, xyz);
          }
          rec.cone =
            visMaterial(rec.material).doubleSided || visMaterial(rec.material).backSide
              ? OPEN_CONE
              : triangleCone(xyz, array);
        }
        // Every cluster carries its own error band, so the GPU cut is one thread per cluster.
        if (gpuDraw && opaqueRoots.length)
          gpuSelection = await createGpuDagSelection(gpuDevice, packDagSelection(opaqueRoots), {
            residentCut: true,
          });
        capabilities.gpuDriven = !!gpuSelection;
        await ensureBootstrap();
        engineDiagnostic('render-capabilities', 'Chemins de rendu prêts', {
          surfaceVersion: surfaces?.version ?? null,
          deferredLighting: !!deferred,
          frameBudgetBytes: frameBudget,
          imageReadbackDuringRender: false,
          visibilityBuffer: visEnabled,
          gpuSelection: !!gpuSelection,
          indirectDraw: !!gpuDraw,
          hiz: !!gpuHiz,
          unsupported: [...capabilities.unsupported],
        });
      } catch (error) {
        diagnosticFailure('webgpu-prepare-failed', error);
        if (String(error).includes('WEBGPU') || String(error).includes('INVALID_PAGE_BUDGET'))
          throw error;
        throw error;
      }
    },
    render(camera) {
      if (secondaryCamera && !surfaceRenderAllowed) throw new Error('SURFACE_CAPTURE_BUSY');
      if (context.signal?.aborted) context.signal.throwIfAborted();
      if (lost) throw new Error('WEBGPU_LOST');
      if (!gpuDevice || !cache) throw new Error('WEBGPU_UNAVAILABLE');
      source.updateMatrixWorld(true);
      void pumpTextures().catch((error) =>
        diagnosticFailure('progressive-texture-mips-failed', error),
      );
      for (let i = 0; i < opaqueRoots.length; i++)
        worldUpdates.set(opaqueRoots[i].world.elements, i * 16);
      // A moved root invalidates every row's world matrix, which is the only shared input to a row the
      // scene can still change after `prepare()`.
      if (gpuSelection?.updateWorlds(worldUpdates)) {
        rows.tableEpoch++;
        noOccluderHistory = true;
        temporalHizState.pyramid = undefined;
        temporalHizState.camera = undefined;
      }
      if (!sameHizView(previousHizView, camera)) {
        noOccluderHistory = true;
        temporalHizState.pyramid = undefined;
        temporalHizState.camera = undefined;
        previousHizView = camera.clone();
      }
      for (const item of blendState.blendGpu)
        if (item.sourceMesh) {
          item.matrix.copy(item.sourceMesh.matrixWorld);
          if (item.bounds && item.sourceGeometry.boundingBox)
            item.bounds.copy(item.sourceGeometry.boundingBox).applyMatrix4(item.matrix);
        }
      const cpuStart = performance.now();
      lightState = lights?.update();
      const lightsEnd = performance.now();
      lastCamera = camera;
      overBudget = false;
      submittedTriangles = 0;
      blendSubmittedTriangles = 0;
      blendDrawCalls = 0;
      frame++;
      if (traceEnabled)
        traceDiagnostic('cpu-lights', 'Mise à jour CPU des lumières', () => ({
          frame,
          scope: 'cpu/lights.update',
          elapsedMs: lightsEnd - cpuStart,
          lightState,
        }));
      const pixelError = resolvePixelError(context, camera, motion);
      diagnosticPixelError = pixelError;
      gpuFrameActive = false;
      gpuMetricsReady = false;
      if (gpuSelection?.failed()) dropGpuSelection();
      if (!secondaryCamera && gpuSelection?.residentCut && gpuDraw && visEnabled) {
        renderGpuCut(camera, pixelError, cpuStart, lightsEnd);
        return;
      }
      const selectionStarted = lightsEnd;
      let selected:
        | {
            complete?: boolean;
            shown: PageRec[];
            wanted?: PageRec[];
            visible: number;
            selectedTriangles: number;
            frustumRejected: number;
            lodLevel: number;
          }
        | undefined;
      const gpuSelectionDecision = {
        source: 'cpu' as const,
        decision: 'fallback',
        reason: secondaryCamera ? 'surface-capture' : 'gpu-selection-unavailable',
      };
      const gpuSelectionResolveEnd = performance.now();
      traceDiagnostic(
        'gpu-selection-resolution',
        'Résolution CPU du résultat de sélection GPU',
        () => ({
          frame,
          submission: imageRevision,
          scope: 'cpu/gpu-selection-dispatch-peek',
          elapsedMs: gpuSelectionResolveEnd - selectionStarted,
          decision: gpuSelectionDecision,
          selectedFromGpu: !!selected,
        }),
      );
      if (!selected) {
        const cpuSelectionStarted = performance.now();
        selected = selectVisiblePages(
          roots,
          camera,
          {
            pixelError,
            viewport,
            frame,
            holdResident: true,
            rootFallback: true,
            isResident: (rec) => !!cache!.get(rec.url),
          },
          shown,
        );
        const cpuSelectionEnd = performance.now(),
          chosen = selected;
        traceDiagnostic('cpu-selection', 'Sélection CPU de référence', () => ({
          frame,
          submission: imageRevision,
          scope: 'cpu/selectVisiblePages',
          elapsedMs: cpuSelectionEnd - cpuSelectionStarted,
          shown: tracking.traceSet(
            'selection.shown',
            chosen.shown.map((page) => page.url),
          ),
          wanted: tracking.traceSet(
            'selection.wanted',
            chosen.wanted?.map((page) => page.url) ?? chosen.shown.map((page) => page.url),
          ),
          visible: chosen.visible,
          selectedTriangles: chosen.selectedTriangles,
          frustumRejected: chosen.frustumRejected,
          lodLevel: chosen.lodLevel,
          reason: gpuSelectionDecision.reason ?? 'gpu-selection-unavailable',
        }));
      } else {
        shown.length = 0;
        appendAll(shown, selected.shown);
      }
      desired.length = 0;
      for (let i = 0; i < (selected.wanted?.length ?? shown.length); i++)
        desired.push((selected.wanted ?? shown)[i]);
      overBudget = false;
      visible = selected.visible;
      selectedTriangles = selected.selectedTriangles;
      frustumRejected = selected.frustumRejected;
      lodLevel = selected.lodLevel;
      const admissionStarted = performance.now(),
        requested = new Set([...bootstrapUrls, ...desired.map((page) => page.url)]);
      const wasLimited = coverageBudgetLimited;
      coverageBudgetLimited = requested.size > slots;
      if (wasLimited !== coverageBudgetLimited)
        coverageBudgetEvent = {
          version: 1,
          limited: coverageBudgetLimited,
          requiredSlots: requested.size,
          slots,
          fallbackRetained: bootstrapState.ready,
        };
      traceDiagnostic('residency-admission', 'Admission des ensembles demandés', () => ({
        frame,
        scope: 'cpu/residency-admission',
        elapsedMs: performance.now() - admissionStarted,
        requested: tracking.traceSet('admission.requested', [...requested]),
        wanted: tracking.traceSet(
          'admission.wanted',
          desired.map((page) => page.url),
        ),
        loaded: tracking.traceSet(
          'admission.loaded',
          drawn.map((page) => page.url),
        ),
        slots,
        limited: coverageBudgetLimited,
      }));
      if (!bootstrapState.ready) {
        drawn.length = 0;
        submittedTriangles = 0;
        gpuDrawCalls = 0;
        const loadingEnd = performance.now(),
          sample = {
            version: 1,
            frame,
            submission: imageRevision,
            scope: 'backend-render-call',
            totalMs: loadingEnd - cpuStart,
            lightsMs: lightsEnd - cpuStart,
            selectionMs: loadingEnd - lightsEnd,
            residencyScheduleAndTargetsMs: null,
            encodeSubmitMs: null,
            transparentEncodeMs: 0,
            transparentIncludedIn: 'encodeSubmitMs',
            asyncResidencyWaitMs: null,
          };
        cpuSample = sample;
        traceDiagnostic('frame', 'Snapshot de frame en attente de couverture GPU', () => ({
          backend: 'webgpu-page-raster',
          frame,
          submission: imageRevision,
          pose: cameraPose(camera),
          source: gpuSelectionDecision.source,
          selection: gpuSelectionDecision,
          cpu: sample,
          coverage: {
            loaded: tracking.traceSet('frame.loaded', []),
            wanted: tracking.traceSet(
              'frame.wanted',
              desired.map((page) => page.url),
            ),
            shown: tracking.traceSet('frame.shown', []),
            bootstrap: tracking.traceSet(
              'frame.bootstrap',
              bootstrap.map((page) => page.url),
            ),
            ready: false,
          },
          budget: {
            slots,
            requested: tracking.traceSet('frame.requested', [
              ...bootstrapUrls,
              ...desired.map((page) => page.url),
            ]),
            limited: coverageBudgetLimited,
          },
          gpuTiming: gpuTiming?.stats() ?? { supported: false, reason: 'not-initialized' },
        }));
        return;
      }
      if (selected.complete === false) throw new Error('GPU_COVERAGE_INCOMPLETE');
      // A complete root cover is always pinned. Coarsen atomically before reclaiming
      // old detail slots if old and new refinements cannot coexist in the budget.
      const transitionStarted = performance.now(),
        transition = new Set([...requested, ...shown.map((page) => page.url)]);
      if (!coverageBudgetLimited && transition.size > slots) {
        const fallback = selectVisiblePages(roots, camera, {
          pixelError,
          viewport,
          frame,
          holdResident: true,
          rootFallback: true,
          isResident: (rec) => bootstrapUrls.has(rec.url) && !!cache!.get(rec.url),
        });
        if (!fallback.complete) throw new Error('GPU_COVERAGE_INCOMPLETE');
        shown.length = 0;
        appendAll(shown, fallback.shown);
        lodLevel = fallback.lodLevel;
      }
      traceDiagnostic('residency-transition', 'Transition de couverture calculée', () => ({
        frame,
        scope: 'cpu/residency-transition',
        elapsedMs: performance.now() - transitionStarted,
        from: tracking.traceSet(
          'transition.from',
          drawn.map((page) => page.url),
        ),
        to: tracking.traceSet(
          'transition.to',
          shown.map((page) => page.url),
        ),
        requested: tracking.traceSet('transition.requested', [...requested]),
        transition: tracking.traceSet('transition.all', [...transition]),
        slots,
      }));
      if (shown.some((page) => !hasBytes(page))) throw new Error('GPU_COVERAGE_BYTES_MISSING');
      readyScratch.length = 0;
      appendAll(readyScratch, shown);
      let culled: PageRec[] = readyScratch;
      if (
        visEnabled &&
        !gpuHiz &&
        readyScratch.length >= 2 &&
        readyScratch.every((page) => page.array)
      ) {
        try {
          const cut = applyTemporalHiz(
            partitionByPass(readyScratch, false, opaqueScratch) as Array<
              PageRec & { array: Uint32Array }
            >,
            camera,
            viewport ?? targetSize,
            temporalHizState,
          );
          culledScratch.length = 0;
          appendAll(
            culledScratch,
            cut.shown,
            partitionByPass(readyScratch, true, transparentScratch),
          );
          culled = culledScratch;
        } catch (error) {
          diagnosticFailure('hiz-frame-fallback', error); /* Keep the selected cut. */
        }
      }
      const selectionEnd = performance.now();
      const queueStarted = performance.now();
      queueResident(coverageBudgetLimited ? [] : desired);
      const queueEnd = performance.now();
      traceDiagnostic('residency-queue-reconstruct', 'Ensembles de résidence reconstruits', () => ({
        frame,
        scope: 'cpu/residency-queue-reconstruct',
        elapsedMs: queueEnd - queueStarted,
        requested: tracking.traceSet(
          'reconstruct.requested',
          desired.map((page) => page.url),
        ),
        queued: tracking.traceSet(
          'reconstruct.queued',
          residency.items.map((page) => page.url),
        ),
        job: residency.job,
      }));
      const drawnVerifyStarted = performance.now();
      if (culled.some((page) => !cache!.get(page.url))) throw new Error('GPU_COVERAGE_INCOMPLETE');
      drawn.length = 0;
      appendAll(drawn, culled);
      // The CPU cut draws what it selected; what the Hi-Z pass drops is occluded, not missing.
      uncoveredTriangles = 0;
      const drawnVerifyEnd = performance.now();
      traceDiagnostic(
        'residency-drawn-verify',
        'Couverture résidente vérifiée avant encodage',
        () => ({
          frame,
          scope: 'cpu/residency-drawn-copy',
          elapsedMs: drawnVerifyEnd - drawnVerifyStarted,
          shown: tracking.traceSet(
            'drawn.shown',
            shown.map((page) => page.url),
          ),
          drawn: tracking.traceSet(
            'drawn',
            drawn.map((page) => page.url),
          ),
          loaded: tracking.traceSet(
            'drawn.loaded',
            drawn.filter((page) => !!cache!.get(page.url)).map((page) => page.url),
          ),
        }),
      );
      const [width, height] = viewport ?? targetSize,
        targetStarted = performance.now();
      ensureTargets(gpuDevice, Math.max(1, width), Math.max(1, height));
      traceDiagnostic('targets-ensure', 'Cibles GPU assurées', () => ({
        frame,
        scope: 'cpu/ensureTargets',
        elapsedMs: performance.now() - targetStarted,
        width,
        height,
      }));
      if (!renderPathLogged) {
        renderPathLogged = true;
        const details = {
          clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
          targetSize,
          visibilityBuffer: visEnabled,
          visibilityReady: !!(visPipelineBack && shadePipeline && visView),
          selectedPages: shown.length,
          drawnPages: drawn.length,
        };
        engineDiagnostic('first-render-path', 'Configuration du premier rendu WebGPU', details);
        if (typeof window !== 'undefined')
          console.info('[web-geometry] configuration du premier rendu WebGPU', details);
      }
      const tStart = performance.now();
      submittedTriangles = encodeDraws(gpuDevice, camera);
      const cpuEnd = performance.now();
      lastSubmitMs = cpuEnd - tStart;
      const sample = {
        version: 1,
        frame,
        submission: imageRevision,
        scope: 'backend-render-call',
        totalMs: cpuEnd - cpuStart,
        lightsMs: lightsEnd - cpuStart,
        selectionMs: selectionEnd - lightsEnd,
        residencyScheduleAndTargetsMs: tStart - selectionEnd,
        encodeSubmitMs: lastSubmitMs,
        transparentEncodeMs,
        transparentIncludedIn: 'encodeSubmitMs',
        asyncResidencyWaitMs: null,
      };
      cpuSample = sample;
      publishCpuProfile();
      if (traceEnabled)
        traceDiagnostic('frame', 'Snapshot complet de la frame WebGPU', () => ({
          backend: 'webgpu-page-raster',
          frame,
          submission: imageRevision,
          pose: cameraPose(camera),
          source: gpuSelectionDecision.source,
          selection: gpuSelectionDecision,
          cpu: sample,
          coverage: {
            loaded: tracking.traceSet(
              'frame.loaded',
              drawn.map((page) => page.url),
            ),
            wanted: tracking.traceSet(
              'frame.wanted',
              desired.map((page) => page.url),
            ),
            shown: tracking.traceSet(
              'frame.shown',
              shown.map((page) => page.url),
            ),
            bootstrap: tracking.traceSet(
              'frame.bootstrap',
              bootstrap.map((page) => page.url),
            ),
            ready: bootstrapState.ready,
          },
          budget: {
            slots,
            requested: tracking.traceSet('frame.requested', [
              ...new Set([...bootstrapUrls, ...desired.map((page) => page.url)]),
            ]),
            limited: coverageBudgetLimited,
            frameBytes: frameBudget,
          },
          gpuTiming: gpuTiming?.stats() ?? { supported: false, reason: 'not-initialized' },
          transparent: {
            candidates: blendState.blendGpu.length,
            visibleMeshes: blendState.visibleBlend.length,
            frustumRejected: blendFrustumRejected,
            drawCalls: blendDrawCalls,
            submittedTriangles: blendSubmittedTriangles,
          },
          drawCalls: gpuDrawCalls,
        }));
    },
    syncResident() {
      if (secondaryCamera) return;
      if (lost || !gpuDevice || !cache || !lastCamera) return;
      // Page bytes are already accepted. Keep the submitted image stable until its
      // explicit readback completes; the next render selects/uploads those bytes.
      if (capturePending) {
        captureStreamingDeferrals++;
        return;
      }
      // A complete cut is reselected for the latest camera; CPU arrival alone
      // never authorizes replacing any region's GPU fallback.
      backend.render(lastCamera);
    },
    async flush() {
      await Promise.resolve();
      // Material texture layers are part of readiness, not a per-frame decoration: a page drawn before
      // its layer lands is shaded from layer 0, so the image of one camera keeps changing while the
      // queue drains. `render` still admits at most `textureBudget` bytes per frame; the explicit
      // barrier drains the rest here, outside the measured loop, so a flushed pose is settled.
      while (gpuDevice && textureJobs.length) await pumpTextures();
      await texturePumpState.pending;
      await ensureBootstrap();
      await residency.pending;
      if (coverageBudgetEvent) {
        engineDiagnostic('coverage-budget', 'Admission de la coupe demandée', coverageBudgetEvent);
        coverageBudgetEvent = undefined;
      }
      await gpuTiming?.flush();
      if (performance.now() - lastProgressMs >= 2000) {
        lastProgressMs = performance.now();
        engineDiagnostic('render-progress', 'Suivi du rendu GPU', {
          frame,
          coverage: {
            version: 1,
            ready: bootstrapState.ready,
            bootstrapPages: bootstrap.length,
            budgetLimited: coverageBudgetLimited,
          },
          lights: lightState,
          selectedPages: shown.length,
          residentPages: drawn.length,
          selectedTriangles,
          submittedTriangles,
          transparent: {
            version: 1,
            candidates: blendState.blendGpu.length,
            visibleMeshes: blendState.visibleBlend.length,
            frustumRejected: blendFrustumRejected,
            drawCalls: blendDrawCalls,
            submittedTriangles: blendSubmittedTriangles,
            gpuMs: null,
          },
          pendingPages: collectPendingUrls(desired, pendingScratch).length,
          surfaceVersion: surfaces?.version ?? null,
          presentation: context.gpuCanvas ? 'direct' : 'composed',
          imageReadbackDuringRender: false,
        });
      }
      if (gpuSelection) {
        try {
          await gpuSelection.flush();
          if (gpuSelection.failed()) dropGpuSelection();
          else if (gpuFrameActive) adoptGpuCut();
        } catch (error) {
          diagnosticFailure('gpu-selection-fallback', error);
          dropGpuSelection();
        }
      }
      if (
        gpuDevice &&
        colorTexture &&
        !secondaryCamera &&
        imageRevision > 0 &&
        capturedRevision !== imageRevision
      ) {
        if (!capturePending) {
          const revision = imageRevision,
            [width, height] = targetSize,
            texture = colorTexture;
          checkFrameBudget(
            width,
            height,
            captureAllocationBytes + Math.ceil((width * 4) / 256) * 256 * height,
          );
          capturePending = readGpuImage(gpuDevice, texture, width, height, context.signal)
            .then((pixels) => {
              if (!lost && revision === imageRevision) {
                capturedPixels = pixels;
                capturedRevision = revision;
                if (!outputDiagnosticLogged) {
                  outputDiagnosticLogged = true;
                  engineDiagnostic(
                    'first-readback',
                    'Premier relevé explicite de la cible WebGPU',
                    {
                      width,
                      height,
                      origin: 'bottom-left',
                      ...outputColorDiagnostic(pixels, width, height, clearColor, 'bottom-left'),
                    },
                  );
                  engineDiagnostic('presentation-capture', 'Capture explicite du rendu WebGPU', {
                    width,
                    height,
                    origin: 'bottom-left',
                    imageRevision: revision,
                    surface: 'webgpu-color-target',
                    ...outputColorDiagnostic(pixels, width, height, clearColor, 'bottom-left'),
                  });
                }
              }
            })
            .finally(() => {
              capturePending = undefined;
            });
        }
        await capturePending;
        if (lost) throw new Error('WEBGPU_LOST');
        if (capturedRevision !== imageRevision) throw new Error('CAPTURE_CHANGED_DURING_FLUSH');
        if (captureStreamingDeferrals && !captureDeferralLogged) {
          captureDeferralLogged = true;
          engineDiagnostic(
            'capture-streaming-deferred',
            'Mise à jour du streaming reportée au rendu suivant pendant la capture',
            {
              imageRevision: capturedRevision,
              deferredUpdates: captureStreamingDeferrals,
              pagesRetained: true,
            },
          );
        }
      }
      await Promise.resolve();
    },
    async captureSurfaceView(camera, options) {
      context.signal?.throwIfAborted();
      options.signal?.throwIfAborted();
      if (secondaryCamera || surfaceCapture)
        throw new Error('SURFACE_CAPTURE_BUSY: dispose the previous capture first');
      if (lost || !gpuDevice || !visEnabled || !lastCamera)
        throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
      const reserve = checkSurfaceSize(gpuDevice, options.width, options.height, frameBudget, 32);
      checkFrameBudget(viewport[0], viewport[1], reserve);
      checkFrameBudget(options.width, options.height, reserve);
      const main = lastCamera,
        savedSize: [number, number] = [viewport[0], viewport[1]],
        savedDiagnostic = diagnostic,
        savedMotion = { ...motion };
      const view = camera.clone();
      view.aspect = options.width / options.height;
      view.updateProjectionMatrix();
      view.updateMatrixWorld();
      const started = performance.now();
      let result: SurfaceCapture | undefined;
      secondaryCamera = view;
      captureAllocationBytes = reserve;
      const renderInternal = (camera: THREE.PerspectiveCamera) => {
        surfaceRenderAllowed = true;
        try {
          backend.render(camera);
        } finally {
          surfaceRenderAllowed = false;
        }
      };
      const clearHistory = () => {
        noOccluderHistory = true;
        previousHizView = undefined;
        temporalHizState.pyramid = undefined;
        temporalHizState.camera = undefined;
        temporalHizState.viewport = undefined;
      };
      engineDiagnostic('surface-capture-start', 'Capture GPU depuis une seconde caméra', {
        width: options.width,
        height: options.height,
        allocationBytes: reserve,
      });
      let captureFailed = false,
        captureError: unknown;
      try {
        await residency.pending;
        await gpuDevice.queue.onSubmittedWorkDone();
        options.signal?.throwIfAborted();
        context.signal?.throwIfAborted();
        viewport[0] = options.width;
        viewport[1] = options.height;
        diagnostic = 'beauty';
        clearHistory();
        motion.last = undefined;
        motion.lastMs = undefined;
        renderInternal(view);
        await residency.pending;
        const missing = collectPendingUrls(desired, []);
        if (missing.length) throw new Error(`SURFACE_PAGES_NOT_RESIDENT: ${missing.length}`);
        if (coverageBudgetLimited) throw new Error('SURFACE_PAGE_BUDGET');
        await ensureResident(shown, frame, residency.nextJobId());
        if (shown.some((page) => !cache?.get(page.url)))
          throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');
        drawn.length = 0;
        appendAll(drawn, shown);
        if (drawn.length !== shown.length) throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');
        options.signal?.throwIfAborted();
        context.signal?.throwIfAborted();
        submittedTriangles = encodeDraws(gpuDevice, view);
        if (!visEnabled || !surfaces || !depthTexture)
          throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
        const owned = createSurfaceBuffer(gpuDevice, options.width, options.height, reserve);
        let depth: GPUTexture;
        try {
          depth = gpuDevice.createTexture({
            label: 'WG owned surface depth',
            size: { width: options.width, height: options.height },
            format: 'depth32float',
            usage:
              GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
          });
        } catch (error) {
          owned.dispose();
          throw error;
        }
        let released = false;
        result = {
          ...owned,
          allocationBytes: reserve,
          depth,
          inverseViewProjection: viewProj.clone().invert().elements.slice(),
          cameraWorld: view.getWorldPosition(new THREE.Vector3()).toArray() as [
            number,
            number,
            number,
          ],
          selectedTriangles,
          dispose() {
            if (released) return;
            released = true;
            owned.dispose();
            depth.destroy();
            captureAllocationBytes = 0;
            surfaceCapture = undefined;
            engineDiagnostic('surface-capture-released', 'Capture GPU libérée', {
              allocationBytes: reserve,
            });
          },
        };
        const encoder = gpuDevice.createCommandEncoder();
        const from = [
            surfaces.baseMetal,
            surfaces.normalRough,
            surfaces.emissiveAo,
            surfaces.flags,
            depthTexture,
          ],
          to = [owned.baseMetal, owned.normalRough, owned.emissiveAo, owned.flags, depth];
        for (let i = 0; i < from.length; i++)
          encoder.copyTextureToTexture({ texture: from[i] }, { texture: to[i] }, [
            options.width,
            options.height,
          ]);
        gpuDevice.queue.submit([encoder.finish()]);
        await gpuDevice.queue.onSubmittedWorkDone();
        options.signal?.throwIfAborted();
        context.signal?.throwIfAborted();
        if (lost) throw new Error('WEBGPU_LOST');
        surfaceCapture = result;
        engineDiagnostic('surface-capture-ready', 'Surface GPU disponible', {
          surfaceVersion: 1,
          width: options.width,
          height: options.height,
          selectedTriangles,
          allocationBytes: reserve,
          durationMs: performance.now() - started,
          imageReadback: false,
        });
      } catch (error) {
        result?.dispose();
        captureAllocationBytes = 0;
        diagnosticFailure('surface-capture-failed', error);
        captureFailed = true;
        captureError = error;
      }
      {
        viewport[0] = savedSize[0];
        viewport[1] = savedSize[1];
        diagnostic = savedDiagnostic;
        clearHistory();
        Object.assign(motion, savedMotion);
        let restoreFailed = false,
          restoreError: unknown;
        try {
          if (!lost && !context.signal?.aborted) {
            renderInternal(main);
            await residency.pending;
            await ensureResident(shown, frame, residency.nextJobId());
            if (shown.some((page) => !cache?.get(page.url)))
              throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');
            drawn.length = 0;
            appendAll(drawn, shown);
            submittedTriangles = encodeDraws(gpuDevice, main);
            if (presenter && colorTexture) {
              const encoder = gpuDevice.createCommandEncoder();
              presenter.present(encoder, colorTexture, ...targetSize);
              gpuDevice.queue.submit([encoder.finish()]);
            }
            if (canvasTexture) canvasTexture.needsUpdate = true;
            engineDiagnostic('surface-main-restored', 'Vue principale restaurée', {
              width: savedSize[0],
              height: savedSize[1],
            });
          }
        } catch (error) {
          result?.dispose();
          diagnosticFailure('surface-restore-failed', error);
          restoreFailed = true;
          restoreError = error;
        } finally {
          secondaryCamera = undefined;
          surfaceRenderAllowed = false;
        }
        if (restoreFailed && captureFailed)
          throw new AggregateError(
            [captureError, restoreError],
            'Surface capture and main view restoration failed',
          );
        if (restoreFailed) throw restoreError;
      }
      if (captureFailed) throw captureError;
      return result!;
    },
    capture() {
      if (lost) throw new Error('WEBGPU_LOST');
      if (capturedPixels && capturedRevision === imageRevision) return capturedPixels;
      if (!presenter || !gpuDevice || !colorTexture || secondaryCamera)
        throw new Error('CAPTURE_NOT_READY: render then await flush before capture');
      const encoder = gpuDevice.createCommandEncoder();
      presenter.present(encoder, colorTexture, ...targetSize);
      gpuDevice.queue.submit([encoder.finish()]);
      if (!synchronousCapture) {
        synchronousCapture = createSynchronousCanvasCapture();
        engineDiagnostic('capture-synchronous', 'Lecture synchrone demandée par l’hôte', {
          outsideBeauty: true,
          prefer: 'await flush(); capture()',
        });
      }
      capturedPixels = synchronousCapture.read(presenter.canvas);
      capturedRevision = imageRevision;
      return capturedPixels;
    },
    selectedPageIds() {
      return shown.map((rec) => rec.url);
    },
    visibilityIds() {
      const size = viewport ?? targetSize,
        pages = drawn
          .filter((rec) => rec.array && !rec.transparent)
          .map((rec) => ({ ...rec, array: rec.array! }));
      return rasterVisibilityIds(pages, lastCamera ?? new THREE.PerspectiveCamera(), size);
    },
    rasterRgba() {
      const size = viewport ?? targetSize,
        pages = drawn
          .filter((rec) => rec.array && !rec.transparent)
          .map((rec) => ({ ...rec, array: rec.array! })),
        cam = lastCamera ?? new THREE.PerspectiveCamera();
      return shadeVisibility(rasterVisibilityIds(pages, cam, size), pages, cam, size, clearColor);
    },
    pendingUrls() {
      return collectPendingUrls(
        !bootstrapState.ready ? bootstrap : coverageBudgetLimited ? [] : desired,
        pendingScratch,
      );
    },
    pageUrls() {
      urlScratch.length = 0;
      const seen = new Set<string>();
      for (const list of [bootstrap, shown, coverageBudgetLimited ? [] : desired])
        for (let i = 0; i < list.length; i++) {
          const url = pageRequestUrl(list[i]);
          if (seen.has(url)) continue;
          seen.add(url);
          urlScratch.push(url);
        }
      return urlScratch;
    },
    acceptPage(url, array) {
      deferredDrops.delete(url);
      const recs = byUrl.get(url);
      if (!recs) return;
      // One request can carry a whole bundle: each cluster takes the view at its own offset, and that
      // view — not the bundle — is what the GPU cache uploads under the cluster key.
      acceptPageArray(recs, array);
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i],
          view = rec.array!;
        sourceBytes.set(rec.url, new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      }
      traceDiagnostic('page-accepted', 'Page CPU acceptée pour résidence GPU', {
        frame,
        url,
        bytes: array.byteLength,
        clusters: recs.length,
        bootstrap: recs.some((rec) => bootstrapUrls.has(rec.url)),
        wanted: recs.some(
          (rec) => tracking.wantedStamp[tracking.keyOf(rec)] === tracking.wantedEpoch,
        ),
        pinned: recs.some((rec) => tracking.pinnedAt[tracking.keyOf(rec)] >= 0),
      });
    },
    dropPage(url) {
      const recs = byUrl.get(url);
      if (!recs) return;
      // A request is kept whole: dropping it would take away every cluster it carries, so one pinned
      // cluster is enough to refuse or defer the drop.
      if (recs.some((rec) => bootstrapUrls.has(rec.url))) {
        traceDiagnostic(
          'page-drop-deferred',
          'Abandon de page bootstrap ignoré pour préserver la couverture',
          { frame, url, reason: 'bootstrap-pinned' },
        );
        return;
      }
      const pinned = recs.some((rec) => tracking.pinnedAt[tracking.keyOf(rec)] >= 0),
        wanted = recs.some(
          (rec) => tracking.wantedStamp[tracking.keyOf(rec)] === tracking.wantedEpoch,
        );
      if (pinned || wanted) {
        deferredDrops.add(url);
        traceDiagnostic(
          'page-drop-deferred',
          'Abandon de page différé pendant la transition de couverture',
          {
            frame,
            url,
            reason: pinned ? 'pinned' : 'wanted',
            pinned,
            wanted,
            deferred: [...deferredDrops],
          },
        );
        return;
      }
      deferredDrops.delete(url);
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        rec.array = undefined;
        rec.indexBytes = rec.triangles * 12;
        sourceBytes.delete(rec.url);
        cache?.unload?.(rec.url);
        tracking.unmarkPinned(tracking.keyOf(rec));
      }
      traceDiagnostic('page-dropped', 'Page CPU/GPU libérée', {
        frame,
        url,
        clusters: recs.length,
        reason: 'host-request',
        deferred: false,
      });
    },
    metrics() {
      const stats = cache?.stats();
      let vertexBytes = 0;
      for (const buffer of positionBuffers.values()) vertexBytes += buffer.size;
      vertexBytes += (concatPos?.size ?? 0) + (concatUv?.size ?? 0) + (concatNrm?.size ?? 0);
      for (const item of blendState.blendGpu)
        vertexBytes +=
          item.index.size +
          (item.uv?.size ?? 0) +
          (item.normal?.size ?? 0) +
          (item.diagnosticBuffer?.size ?? 0);

      return {
        coverageReady: bootstrapState.ready,
        coverageBudgetLimited,
        clusters: gpuFrameActive && !gpuMetricsReady ? null : visible,
        selectedTriangles,
        uncoveredTriangles,
        residentPages: gpuFrameActive ? (stats?.residentPages ?? 0) : drawn.length,
        cacheEvictions: stats?.evictions ?? 0,
        geometryAllocationBytes: (stats?.allocatedBytes ?? 0) + vertexBytes,
        frustumRejected,
        lodLevel,
        submittedTriangles: gpuFrameActive && !gpuMetricsReady ? null : submittedTriangles,
        totalSubmittedTriangles: gpuFrameActive && !gpuMetricsReady ? null : submittedTriangles,
        transparentMeshes: blendState.visibleBlend.length,
        transparentFrustumRejected: blendFrustumRejected,
        transparentDrawCalls: blendDrawCalls,
        transparentSubmittedTriangles: blendSubmittedTriangles,
        textureUploaded: texturePumpState.uploaded,
        texturePending: textureJobs.length,
        textureSkipped: texturePumpState.skipped,
        cpuSubmitMs: lastSubmitMs,
        gpuPassMs: lastGpuPassMs,
        gpuFrameMs: lastGpuFrameMs,
        gpuHostGapMs: lastGpuHostGapMs,
        vramBytes: null,
        drawCalls: gpuDrawCalls,
      };
    },
    dispose() {
      gpuDevice?.removeEventListener?.('uncapturederror', onGpuError);
      lost = true;
      residency.quietPending();
      gpuTiming?.dispose();
      dropGpuSelection();
      dropVis();
      visTexture?.destroy();
      visTexture = undefined;
      visView = undefined;
      for (const buffer of positionBuffers.values()) buffer.destroy();
      for (const item of blendState.blendGpu) {
        item.index.destroy();
        item.uv?.destroy();
        item.normal?.destroy();
        item.diagnosticBuffer?.destroy();
      }
      blendState.blendGpu.length = 0;
      blendState.pagedBlendGpu.clear();
      pagedBlendCopies.clear();
      blendState.blendCuts.clear();
      blendState.blendDrawnPages.length = 0;
      blendState.visibleBlend.length = 0;
      uniformBuffer?.destroy();
      uniformBuffer = undefined;
      colorTexture?.destroy();
      depthTexture?.destroy();
      hdrTexture?.destroy();
      surfaces?.dispose();
      surfaceCapture?.dispose();
      deferred?.dispose();
      lights?.dispose();
      presenter?.dispose();
      synchronousCapture?.dispose();
      canvasTexture?.dispose();
      blitMaterial?.dispose();
      blit?.geometry.dispose();
      const closing = cache?.dispose();
      cache = undefined;
      scene.clear();
      drainTraceNow();
      const traceClosing = Promise.resolve();
      return Promise.all([Promise.resolve(closing), traceClosing]).then(() => {});
    },
  };
  return backend;
};
