import type * as THREE from 'three';
import type { AssetScope, CameraPose, PreparationProgress } from '../sdk-core/index.ts';
import type { ComparisonLayout } from './comparison.ts';
import type { BackendDiagnostic, BackendFactory, DiagnosticDetail } from './backendTypes.ts';

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
  /** Atlas size classes the prepared WebGPU renderer may allocate. Defaults to 1. */
  atlasClasses?: 1 | 2;
  sceneLighting?: THREE.Object3D;
  /** La lumière qui rebondit. Allumée par défaut ; `false` la coupe pour toute la session. */
  bounce?: boolean;
  /** Durée visée de l'étape « Rebond » par image, en millisecondes. 0,8 ms par défaut. */
  bounceBudgetMs?: number;
  /** Chronométrer chaque étape de l'image et publier `explorer.stageProfile()`. Éteint par défaut. */
  stageProfile?: boolean;
  /** Déclarer les lampes que le fichier source portait, lues dans le cache. Allumé par défaut :
   *  une scène importée arrive avec ses lumières. `false` ouvre la scène sans aucune d'elles. */
  importedLights?: boolean;
  logInterval?: number;
}
