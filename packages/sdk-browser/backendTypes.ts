import type * as THREE from 'three';
import type {
  AssetScope,
  PreparationProgress,
  CameraPose,
  FrameMetrics,
  BackendCapabilities,
  ClusterManifest,
  SceneLightStore,
  StageProfile,
} from '../sdk-core/index.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { ComparisonLayout } from './comparison.ts';

export type { BackendCapabilities };

export interface RenderBackend {
  id: string;
  capabilities: BackendCapabilities;
  setDiagnostic?(mode: DiagnosticMode): void;
  refreshSceneLighting?(): void;
  /** Le magasin de lampes du contrat a changé : l'image suivante le relira. Absent = lampes ignorées. */
  refreshSceneLights?(): void;
  /** Déplace un nœud nommé de la scène préparée ; appliqué à l'image suivante, sans allocation (R8). */
  setTransform?(nodeName: string, matrix: Float32Array): void;
  prepare(): Promise<void>;
  render(camera: THREE.PerspectiveCamera): void;
  readonly overBudget: boolean;
  scene: THREE.Scene;
  metrics(): Partial<
    Pick<
      FrameMetrics,
      | 'clusters'
      | 'selectedTriangles'
      | 'residentPages'
      | 'geometryAllocationBytes'
      | 'pagesDetached'
      | 'cacheEvictions'
      | 'frustumRejected'
      | 'lodLevel'
      | 'submittedTriangles'
      | 'totalSubmittedTriangles'
      | 'transparentMeshes'
      | 'transparentFrustumRejected'
      | 'transparentDrawCalls'
      | 'transparentSubmittedTriangles'
      | 'coverageReady'
      | 'coverageBudgetLimited'
      | 'textureUploaded'
      | 'texturePending'
      | 'textureInFlight'
      | 'textureSlicesUploaded'
      | 'textureBytesLastFrame'
      | 'textureSkipped'
      | 'textureLevelsUploaded'
      | 'textureAtlasBytesCalculated'
      | 'textureAtlasClassBytesCalculated'
      | 'textureAtlasClassesUsed'
      | 'lightsActive'
      | 'shadowsUpdated'
      | 'gpuLightListsMs'
      | 'gpuShadowsMs'
      | 'gpuLightingMs'
      | 'shadowFacesDrawn'
      | 'shadowDrawCalls'
    >
  > & {
    drawCalls?: number;
    batchRebuilds?: number;
    batchIndexBytesUpdated?: number;
    displayDetachments?: number;
    pageRangeWrites?: number;
    subDraws?: number;
  };
  /** Profil par étape de la fenêtre glissante : durées processeur et carte graphique séparées.
   *  Absent d'un moteur qui n'en tient pas ; `enabled: false` quand l'hôte ne l'a pas demandé. */
  stageProfile?(): StageProfile;
  /** Oublie la fenêtre du profil : la chauffe et les premières images ne pèsent plus sur ses quantiles. */
  resetStageProfile?(): void;
  pendingUrls?(): string[];
  /** Bundles a finer cut would need. Fetched at low priority while the network is otherwise idle,
   *  so a small camera move finds them already resident. */
  prefetchUrls?(): string[];
  pageUrls?(): string[];
  acceptPage?(url: string, array: Uint32Array): void;
  acceptGeometryPage?(url: string, data: import('./geometryPage.ts').DecodedGeometryPage): void;
  replaceGeometryPage?(url: string, data: import('./geometryPage.ts').DecodedGeometryPage): void;
  /** Additional prepared-scene instance; supported by backends that own mutable scene records. */
  addInstance?(id: string, transform: THREE.Matrix4): void;
  updateInstance?(id: string, transform: THREE.Matrix4): void;
  removeInstance?(id: string): void;
  updateMaterial?(primitive: string, material: THREE.Material): void;
  dropPage?(url: string): void;
  syncResident?(): void;
  flush?(): Promise<void>;
  /** Current GPU image, bottom-left origin. Prefer flush() first; browser hosts can explicitly read synchronously. */
  capture?(): Uint8Array;
  captureSurfaceView?(
    camera: THREE.PerspectiveCamera,
    options: { width: number; height: number; signal?: AbortSignal },
  ): Promise<import('./surfaceBuffer.ts').SurfaceCapture>;
  rasterRgba?(): Uint8Array;
  visibilityIds?(): Uint32Array;
  dispose(): void;
}
export type DiagnosticDetail = 'summary' | 'trace';
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
  source: THREE.Object3D;
  metadata: ClusterManifest;
  indices: Map<string, Uint32Array>;
  associations: Map<THREE.Object3D, { meshes?: number; primitives?: number }>;
  /** Rang glTF de chaque texture de la scène préparée, pour relier une couche d'atlas à son aperçu. */
  textureIndices?: Map<THREE.Texture, number>;
  signal?: AbortSignal;
  maxResidentPages?: number;
  maxCachedPages?: number;
  /** Resident page/bundle bytes kept by the streamer. Defaults to DEFAULT_CACHED_BYTES. */
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
  /** A host canvas dedicated to this WebGPU backend. */
  gpuCanvas?: HTMLCanvasElement;
  /** WebGPU frame targets, Hi-Z pyramids, one surface capture and async image staging; excludes scene assets and WebGL diagnostic capture. */
  maxFrameAllocationBytes?: number;
  /** Maximum source texture bytes admitted to GPU upload per frame. */
  maxTextureTransferBytesPerFrame?: number;
  sceneLighting?: THREE.Object3D;
  /** Les lampes du contrat, possédées par l'hôte et partagées par tous les moteurs de la session. */
  sceneLights?: SceneLightStore;
  /** Chronométrer chaque étape de l'image. Éteint par défaut : seuls le banc et le harnais l'allument. */
  stageProfile?: boolean;
  /** Host-owned, validated page reader for the initial complete GPU fallback. */
  readPage?: (url: string) => Promise<Uint32Array>;
  readGeometryPage?: (url: string) => Promise<Uint8Array>;
}
export type BackendFactory = (context: BackendContext) => RenderBackend;
export type PointOfInterest = { id: string; label: string; pose: CameraPose };
export interface ExplorerOptions {
  replicaCount?: 1 | 4 | 9 | 12;
  detail?: 'source' | 'maximum';
  onEvent?: (event: import('../sdk-core/index.ts').RuntimeEvent) => void;
  manifestUrl: string;
  scope?: AssetScope;
  signal?: AbortSignal;
  width?: number;
  height?: number;
  fov?: number;
  pixelRatio?: number;
  pageFetchWorkers?: number;
  maxPageTransferBytes?: number;
  onPreparation?: (event: PreparationProgress) => void;
  backends?: BackendFactory[];
  maxResidentPages?: number;
  maxCachedPages?: number;
  /** Resident page/bundle bytes kept by the streamer. Defaults to DEFAULT_CACHED_BYTES. */
  maxCachedBytes?: number;
  pixelError?: number;
  lodAdaptive?: boolean;
  /** Presentation clear color supplied by the host, encoded as 0xRRGGBB. */
  clearColor?: number;
  /** Bounded diagnostics emitted by a backend and owned by the host report. */
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  /** Summary suppresses per-frame trace records; trace is the default with an observer. */
  diagnosticDetail?: DiagnosticDetail;
  preload?: 'visible' | 'all';
  /** Render static prepared pages without requesting the full source geometry buffer. */
  autonomousGeometry?: boolean;
  comparisonLayout?: ComparisonLayout;
  comparisonPair?: [string, string];
  gpu?: GPU;
  pointsOfInterest?: PointOfInterest[];
  maxFrameAllocationBytes?: number;
  maxTextureTransferBytesPerFrame?: number;
  sceneLighting?: THREE.Object3D;
  /** Chronométrer chaque étape de l'image et publier `explorer.stageProfile()`. Éteint par défaut. */
  stageProfile?: boolean;
  logInterval?: number;
}
