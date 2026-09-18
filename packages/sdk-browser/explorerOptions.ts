import type * as THREE from 'three';
import type {
  AssetScope,
  CameraPose,
  MathPathMode,
  PreparationProgress,
  ScreenErrorVariant,
} from '../sdk-core/index.ts';
import type { ComparisonLayout } from './comparison.ts';
import type { BackendDiagnostic, BackendFactory, DiagnosticDetail } from './backendTypes.ts';
import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';

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
  /** Octets de tuiles de textures que le moteur WebGPU admet par image ; 16 Mio par défaut. */
  maxTextureTransferBytesPerFrame?: number;
  /** Octets du pool de pages de géométrie du moteur WebGPU — la mémoire de géométrie diffusée,
   *  quelle que soit la scène, comme le pool de 512 Mo de la référence. 512 Mio par défaut. La
   *  couverture racine y tient toujours ; ce qu'une vue demande de plus s'affiche plus grossier,
   *  jamais refusé. Se règle en cours de session par `explorer.setMemoryBudgets`. */
  geometryPoolBytes?: number;
  /** Le plus grand pool de géométrie que `explorer.setMemoryBudgets` pourra demander en cours de
   *  session — le maximum d'un curseur de réglage. Le budget de départ sans lui. */
  geometryPoolCeilingBytes?: number;
  /** Octets du pool de textures virtuelles du moteur WebGPU — la mémoire de textures, quelle que
   *  soit la scène. 512 Mio par défaut, à parts égales entre l'atlas couleur et l'atlas de données,
   *  en couches de 63,5 Mio ; sous une couche par atlas le pool est relevé à une, nommément. Ce
   *  qu'une vue demande de plus attend qu'une tuile moins regardée se libère, et une tuile absente
   *  montre son niveau grossier : les métriques `textureTiles*` le publient. Se règle en cours de
   *  session par `explorer.setMemoryBudgets`. */
  texturePoolBytes?: number;
  /** L'antialiasing temporel du moteur WebGPU, actif par défaut comme chez la référence : chaque
   *  image est rendue avec une gigue d'une fraction de pixel et accumulée sur les précédentes,
   *  reprojetées. `false` rend l'image échantillonnée au centre du pixel, sans historique — c'est
   *  le « avant » d'une comparaison, et ce que les bancs au pixel près demandent. */
  temporalAntialiasing?: boolean;
  /** D'où viennent les texels des matériaux. `'host'`, le défaut : le chargeur glTF lit et décode
   *  chaque image source, comme toujours — c'est ce qu'un moteur qui dessine la scène de l'hôte
   *  (le témoin Three) exige. `'cache'` : une image dont la chaîne de mips est cuite dans le cache
   *  n'est ni lue ni décodée, le moteur WebGPU en lit les niveaux un à un quand l'écran les demande.
   *  À ne demander que lorsque tous les moteurs de la session lisent l'atlas et non la scène. */
  textureSource?: 'host' | 'cache';
  sceneLighting?: THREE.Object3D;
  /** La lumière qui rebondit. Éteinte par défaut ; `true` l'allume pour toute la session. */
  bounce?: boolean;
  /** Durée visée de l'étape « Rebond » par image, en millisecondes. 0,8 ms par défaut. */
  bounceBudgetMs?: number;
  /** Chronométrer chaque étape de l'image et publier `explorer.stageProfile()`. Éteint par défaut. */
  stageProfile?: boolean;
  /** Une variante de DIAGNOSTIC de la carte graphique (`diagnosticGpuVariant.ts`) : elle neutralise
   *  un facteur de l'image pour en ventiler la durée, et rend donc une image différente de celle de
   *  production. Absente par défaut ; refusée hors `diagnosticDetail: 'trace'`. */
  diagnosticGpuVariant?: DiagnosticGpuVariant;
  /** Budget de l'étape Ombres, en millisecondes de carte graphique par image. 1,0 par défaut : les
   *  pages invalidées au-delà attendent leur tour, jamais perdues, leur retard publié. */
  shadowBudgetMs?: number;
  /** Invalidation des cartes d'ombre page par page. Allumée par défaut ; `false` fait repartir la
   *  face entière dès qu'un objet bouge dans sa portée, comme avant le lot des ombres virtualisées. */
  shadowPageInvalidation?: boolean;
  /** Déclarer les lampes que le fichier source portait, lues dans le cache. Allumé par défaut :
   *  une scène importée arrive avec ses lumières. `false` ouvre la scène sans aucune d'elles. */
  importedLights?: boolean;
  /** Chemin des opérations de calcul en lot : `'auto'` par défaut, la mesure arbitrant entre le
   *  JavaScript de référence et le module WebAssembly. `'js'` ou `'wasm'` l'imposent pour une
   *  campagne ; `'wasm'` retombe sur `'js'` là où le module manque, et le dit dans les métriques. */
  mathPath?: MathPathMode;
  /** EXPÉRIENCE de mesure (`sdk-core/screenErrorVariant.ts`) : la métrique d'erreur écran des
   *  clusters. `'certifiee'` par défaut, la nôtre ; `'reference'` met la projection simple de la
   *  référence externe, processeur et carte graphique au même résultat au f32 près. */
  screenError?: ScreenErrorVariant;
  logInterval?: number;
}
