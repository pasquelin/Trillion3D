import type { HostNode, HostScene, HostTexture } from './hostResources.ts';
import type { HostCamera, HostDrawCamera } from './cameraWorld.ts';
import type { HostDrawOutput } from './webglRenderTarget.ts';
import type {
  BackendCapabilities,
  ClusterManifest,
  DiagnosticMode,
  Material,
  SceneLightStore,
  StageProfile,
} from '../sdk-core/index.ts';
import type { BackendMetrics } from './backendMetricKeys.ts';
import type { MemoryBudgets, MemoryBudgetsReport } from './webgpuPagesMemory.ts';
import type { CpuStepSummary } from './cpuProfile.ts';
export type { BackendCapabilities, HostDrawOutput };

export interface RenderBackend {
  id: string;
  capabilities: BackendCapabilities;
  setDiagnostic?(mode: DiagnosticMode): void;
  refreshSceneLighting?(): void;
  /** True when the rendered scene carries at least one declared light; false is the unlit view,
   *  whose composition is identity (P6). Read every frame: a light added later changes it. */
  sceneLit?(): boolean;
  /** The contract light store has changed: the next frame will reread it. Absent = lights ignored. */
  refreshSceneLights?(): void;
  /** What no signature says about this engine's lighting: its shadows, and the phrase that names
   *  what it does not apply. The rest of the capabilities is read from the present methods; see
   *  `lightingCapabilitiesOf`. Absent from an engine that has nothing more to declare. */
  lighting?: { shadows: boolean; reason?: string };
  /** Moves a named node of the prepared scene; applied to the next frame, without allocation (R8). */
  setTransform?(nodeName: string, matrix: Float32Array): void;
  /** Sets memory pools during the session; returns what the engine holds afterwards. */
  setMemoryBudgets?(budgets: MemoryBudgets): Promise<MemoryBudgetsReport>;
  prepare(): Promise<void>;
  render(camera: HostCamera): void;
  /** Draws the engine's whole image — paged clusters, diagnostic pages, scene copies, or the
   *  scene a witness holds — into the framebuffer the host has bound and cleared, `output`
   *  naming it and its display chain. Absent from an engine that presents its own surface. */
  drawHostGeometry?(camera: HostDrawCamera, output: HostDrawOutput): void;
  readonly overBudget: boolean;
  /** True when the last rendered frame was held: nothing was reselected or rebuilt, and the
   *  attached scene IS this frame. Read per frame; absent from an engine that holds nothing. */
  readonly frameHeld?: boolean;
  scene: HostScene;
  /** Canvas the engine presented its image into, when that canvas is not the host's own surface:
   *  a host composing elsewhere copies it (`createBackendPresenter`) instead of drawing `scene`.
   *  Absent from an engine drawing on the host surface itself, and withdrawn — canvas blanked —
   *  by a lost or disposed device before the next call raises `WEBGPU_LOST`: no host composes a
   *  frame older than the device. */
  readonly presentedSurface?: HTMLCanvasElement;
  metrics(): BackendMetrics & {
    drawCalls?: number;
    batchRebuilds?: number;
    batchIndexBytesUpdated?: number;
    pageRangeWrites?: number;
    subDraws?: number;
  };
  /** Per-step profile of the sliding window: CPU and GPU durations kept separate.
   *  Absent from an engine that does not hold one; `enabled: false` when the host did not ask. */
  stageProfile?(): StageProfile;
  /** Forgets the profile window: warmup and the first frames no longer weigh on its quantiles. */
  resetStageProfile?(): void;
  /** CPU bounds of the images since that reset, read once then forgotten; `null` with no row. */
  cpuSteps?(): CpuStepSummary | null;
  /** Shadow-atlas fingerprint, bit for bit: the proof of drawing by pages, never an image. */
  shadowAtlasDigest?(): Promise<import('./gpuShadowDigest.ts').ShadowAtlasDigest | null>;
  /** What the GPU partition of the last frame wrote, and the inputs it drew it from: the proof,
   *  cluster by cluster, that its rectangles and depths are conservative. */
  partitionAudit?(): Promise<import('./webgpuPartitionAudit.ts').PartitionAudit | null>;
  /** What the transparent occlusion test rejected, and the depth it rejected against: the proof
   *  that no removed cluster would have written a pixel. */
  transparentOcclusionAudit?(): Promise<
    import('./webgpuTransparentOcclusionAudit.ts').TransparentOcclusionAudit | null
  >;
  pendingUrls?(): string[];
  /** Bundles a finer cut would need. Fetched at low priority while the network is otherwise idle,
   *  so a small camera move finds them already resident. */
  prefetchUrls?(): string[];
  pageUrls?(): string[];
  /** The same pins as `pageUrls`, spoken as a difference of request ranks: the host no longer has
   *  to rebuild a set of strings every frame. An engine that does not implement it keeps `pageUrls`. */
  retainedRanks?(): import('./streamingTypes.ts').HostRetentionDelta;
  /** The catalogue integer sheet for a request: what off-thread integration plans. */
  pageSpecs?(url: string): Int32Array | undefined;
  acceptPage?(
    url: string,
    array: Uint32Array,
    plan?: import('./pageIntegrationHost.ts').ArrivalPlan,
  ): void;
  acceptGeometryPage?(url: string, data: import('./geometryPage.ts').DecodedGeometryPage): void;
  replaceGeometryPage?(url: string, data: import('./geometryPage.ts').DecodedGeometryPage): void;
  /** Prepared-scene instance placed by sixteen column-major floats the engine copies. */
  addInstance?(id: string, transform: Float64Array): void;
  updateInstance?(id: string, transform: Float64Array): void;
  removeInstance?(id: string): void;
  /** Repaints a primitive from the engine's material parameters: no shader, no program hook. */
  updateMaterial?(primitive: string, material: Material): void;
  dropPage?(url: string): void;
  syncResident?(): void;
  flush?(): Promise<void>;
  /** Wait for submitted work without image readback; true asks for another interactive frame. */
  pendingFrame?(): Promise<boolean>;
  /** Current GPU image, bottom-left origin. Prefer flush() first; browser hosts can explicitly read synchronously. */
  capture?(): Uint8Array;
  captureSurfaceView?(
    camera: HostCamera,
    options: { width: number; height: number; signal?: AbortSignal },
  ): Promise<import('./surfaceBuffer.ts').SurfaceCapture>;
  rasterRgba?(): Uint8Array;
  visibilityIds?(): Uint32Array;
  dispose(): void;
}
export type DiagnosticDetail = 'summary' | 'trace';
import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';
export type BackendDiagnostic = {
  phase: string;
  message: string;
  context: Record<string, unknown>;
  /** Added by the host collector; optional for standalone backend consumers. */
  sequence?: number;
  sessionId?: string;
  queuedAt?: number;
  createdAt?: number;
};
export interface BackendContext {
  source: HostNode;
  metadata: ClusterManifest;
  indices: Map<string, Uint32Array>;
  associations: Map<HostNode, { meshes?: number; primitives?: number }>;
  /** glTF rank of each texture of the prepared scene, to tie an atlas layer to its preview. */
  textureIndices?: Map<HostTexture, number>;
  /** Reader of texture levels baked in the cache; absent from a cache that has none. */
  readTextureLevel?: import('./textureLevelReader.ts').TextureLevelReader;
  signal?: AbortSignal;
  maxResidentPages?: number;
  /** What host-memory engines keep resident without a host ceiling; the WebGPU pool is in bytes. */
  residentPagesDefault?: number;
  maxCachedPages?: number;
  /** Resident page/bundle bytes kept by the streamer; `DEFAULT_CACHED_BYTES` by default. */
  maxCachedBytes?: number;
  pixelError?: number;
  lodAdaptive?: boolean;
  /** Presentation clear color supplied by the host, encoded as 0xRRGGBB. */
  clearColor?: number;
  /** Bounded diagnostics emitted by a backend and owned by the host report. */
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  /** Summary suppresses per-frame trace records; trace is the default with an observer. */
  diagnosticDetail?: DiagnosticDetail;
  viewport?: [number, number];
  gpuDevice?: GPUDevice;
  gpuCanvas?: HTMLCanvasElement; // a host canvas dedicated to this WebGPU backend
  /** Engine-owned host context. WebGL backends may allocate resources on it but never replace it. */
  webglContext?: WebGL2RenderingContext;
  /** Texture-tile bytes admitted per frame, and CPU milliseconds a frame's tile pass may spend
   *  copying; the rest waits. */
  maxTextureTransferBytesPerFrame?: number;
  maxTextureUploadMsPerFrame?: number;
  /** Geometry-page pool bytes, fixed regardless of the scene; 512 MiB by default. The root cover
   *  always fits; the rest draws coarser when it does not fit. Image targets follow resolution.
   *  The ceiling: the largest pool `setMemoryBudgets` may ask for, the starting budget without
   *  it; per-drawable-page tables are sized once, to it. */
  geometryPoolBytes?: number;
  geometryPoolCeilingBytes?: number;
  /** Virtual-texture pool bytes, shared by the colour and data atlases; 512 MiB by default. A
   *  view beyond it waits for a less-looked-at tile, a missing tile shows its coarse level.
   *  `textureCompression`: the pools' block family, `'auto'` what the device samples. */
  texturePoolBytes?: number;
  textureCompression?: import('./textureBlockFormats.ts').TextureCompression;
  /** Temporal antialiasing, on by default as in the reference: `false` renders the
   *  image sampled at the pixel centre, with no jitter and no history — the "before" of a comparison. */
  temporalAntialiasing?: boolean;
  sceneLighting?: HostNode;
  /** Contract lights, owned by the host and shared by every engine of the session. */
  sceneLights?: SceneLightStore;
  /** Identifiers of the lights the source file carried, in cache order; the host rereads them
   *  via `explorer.importedLights()` to set or remove them one by one. */
  importedLightIds?: string[];
  /** Bounced light, off by default: its step stays above the measured one-millisecond bar. Its
   *  budget: the step's target GPU milliseconds per frame, `BOUNCE_SETTINGS.budgetMs` (0.8 ms)
   *  by default — a target, not a promise. */
  bounce?: boolean;
  bounceBudgetMs?: number;
  /** Time every step of the frame. Off by default: only the bench and the harness turn it on. */
  stageProfile?: boolean;
  /** DIAGNOSTIC variant kept by the host, checked (`diagnosticGpuVariant.ts`); absent in production. */
  diagnosticGpuVariant?: DiagnosticGpuVariant;
  /** Shadows-step budget, in GPU milliseconds per frame (`LIGHT_SETTINGS`); page-by-page
   *  shadow-map invalidation, on by default. */
  shadowBudgetMs?: number;
  shadowPageInvalidation?: boolean;
  /** Reads the resident-proxy cache object. Absent when the cache does not carry one;
   *  called at most once, on the first frame that carries a declared light. */
  readSceneProxy?: () => Promise<import('../sdk-core/index.ts').SceneProxy>;
  /** Host-owned, validated page reader for the initial complete GPU fallback. */
  readPage?: (url: string) => Promise<Uint32Array>;
  readGeometryPage?: (url: string) => Promise<Uint8Array>;
}
export type BackendFactory = (context: BackendContext) => RenderBackend;
export type { ExplorerOptions, PointOfInterest } from './explorerOptions.ts';
