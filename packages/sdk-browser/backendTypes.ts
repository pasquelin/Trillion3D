import type * as THREE from 'three';
import type { HostCamera } from './cameraWorld.ts';
import type {
  BackendCapabilities,
  ClusterManifest,
  SceneLightStore,
  StageProfile,
} from '../sdk-core/index.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { BackendMetrics } from './backendMetricKeys.ts';

export type { BackendCapabilities };

export interface RenderBackend {
  id: string;
  capabilities: BackendCapabilities;
  setDiagnostic?(mode: DiagnosticMode): void;
  refreshSceneLighting?(): void;
  /** Vrai quand la scène rendue porte au moins une lampe déclarée. Faux = vue sans éclairage, dont
   *  la composition est l'identité (P6). Absent d'un moteur qui ne passe pas par Three. Lu à chaque
   *  image : une lampe posée après la création du moteur change la réponse. */
  sceneLit?(): boolean;
  /** Le magasin de lampes du contrat a changé : l'image suivante le relira. Absent = lampes ignorées. */
  refreshSceneLights?(): void;
  /** Déplace un nœud nommé de la scène préparée ; appliqué à l'image suivante, sans allocation (R8). */
  setTransform?(nodeName: string, matrix: Float32Array): void;
  prepare(): Promise<void>;
  render(camera: HostCamera): void;
  readonly overBudget: boolean;
  /** Vrai quand la dernière image rendue a été tenue : rien n'a été resélectionné ni remonté, et la
   *  scène attachée EST cette image-ci. Lu par image ; absent d'un moteur qui ne tient rien. */
  readonly frameHeld?: boolean;
  scene: THREE.Scene;
  metrics(): BackendMetrics & {
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
  /** Empreinte de l'atlas d'ombres, bit pour bit : la preuve du dessin par pages, jamais une image. */
  shadowAtlasDigest?(): Promise<import('./gpuShadowDigest.ts').ShadowAtlasDigest | null>;
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
    camera: HostCamera,
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
  /** Atlas size classes the host allows. Defaults to 1, the single-array allocation. */
  atlasClasses?: 1 | 2;
  sceneLighting?: THREE.Object3D;
  /** Les lampes du contrat, possédées par l'hôte et partagées par tous les moteurs de la session. */
  sceneLights?: SceneLightStore;
  /** Les identifiants des lampes que le fichier source portait, dans l'ordre du cache. L'hôte les
   *  relit par `explorer.importedLights()` pour les régler ou les retirer une à une. */
  importedLightIds?: string[];
  /** La lumière qui rebondit. Éteinte par défaut : son étape reste au-dessus de la barre d'une
   *  milliseconde mesurée sur les trois vues ; `true` l'allume pour toute la session. */
  bounce?: boolean;
  /** Durée visée de l'étape « Rebond » sur la carte graphique, par image, en millisecondes.
   *  Par défaut `BOUNCE_SETTINGS.budgetMs` (0,8 ms) : c'est une consigne, pas une promesse. */
  bounceBudgetMs?: number;
  /** Chronométrer chaque étape de l'image. Éteint par défaut : seuls le banc et le harnais l'allument. */
  stageProfile?: boolean;
  /** Budget de l'étape Ombres, en millisecondes de carte graphique par image. Voir `LIGHT_SETTINGS`. */
  shadowBudgetMs?: number;
  /** Invalidation des cartes d'ombre page par page. Allumée par défaut. */
  shadowPageInvalidation?: boolean;
  /** Lit l'objet de cache du proxy résident. Absent quand le cache n'en porte pas ; appelé au plus
   *  une fois, à la première image qui porte une lampe déclarée. */
  readSceneProxy?: () => Promise<import('../sdk-core/index.ts').SceneProxy>;
  /** Host-owned, validated page reader for the initial complete GPU fallback. */
  readPage?: (url: string) => Promise<Uint32Array>;
  readGeometryPage?: (url: string) => Promise<Uint8Array>;
}
export type BackendFactory = (context: BackendContext) => RenderBackend;
export type { ExplorerOptions, PointOfInterest } from './explorerOptions.ts';
