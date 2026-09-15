import { FRUSTUM_PLANE_VALUES } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { createConeContext, type ConeContext, type NormalCone } from './pageCone.ts';
import type { ClusterCut } from './pageSelectionMath.ts';
import type { ClusterStructureIndex } from './pageSelectionTypes.ts';

export interface PageRecord extends ClusterCut {
  triangles: number;
  level?: number;
  min?: number[];
  max?: number[];
  cone?: NormalCone;
  material?: THREE.Material | THREE.Material[];
  array?: Uint32Array;
}

export interface SelectionState<T extends PageRecord> {
  camera: THREE.PerspectiveCamera;
  hold: boolean;
  rootFallback: boolean;
  wanted: T[];
  shown: T[];
  isResident?: (page: T) => boolean;
  pageResident: (page: T) => boolean;
  pixelError: number;
  frustumRejected: number;
  /** Nœuds de hiérarchie dépilés par la coupe de cette image. */
  nodesTested: number;
  lodLevel: number;
  complete: boolean;
  cameraStretch: number;
  flatWorld: THREE.Matrix4;
  flatElements: ArrayLike<number>;
  flatStretch: number;
  flatFocal: number;
  flatStructure?: ClusterStructureIndex;
  flatForced?: Uint8Array;
  flatForcedList?: number[];
  /** Ce que le rejet de cône lit de la racine et de la caméra, posé au premier cône de la racine. */
  flatCone: ConeContext;
  /** Le seuil de cette image vaut zéro et l'étirement, la focale et le plan proche sont sains : la
   *  coupe se décide alors sans projeter, à l'identique. */
  flatExact: boolean;
  flatUseForcing: boolean;
  flatMissing: boolean;
  flatShort: boolean;
  /** Triangles des deux coupes, sommés à la retenue dans l'ordre des tableaux : la somme est celle
   *  d'un balayage de `wanted` et de `shown`, au même ordre et aux mêmes bits. */
  wantedTriangles: number;
  shownTriangles: number;
  /** Budget de pages au-delà duquel un passage n'a plus rien à dire ; `0` quand il n'y en a pas. */
  budget: number;
  /** Ce passage a dépassé le budget : son résultat est jeté, la descente s'arrête là. */
  over: boolean;
}

/** Résultat de la coupe, rempli en place : l'appelant fournit l'objet, l'image n'en alloue aucun. */
export interface SelectionResult<T> {
  shown: T[];
  wanted: T[];
  visible: number;
  selectedTriangles: number;
  displayedTriangles: number;
  frustumRejected: number;
  /** Nœuds de hiérarchie dépilés par la coupe, ce que la sélection a réellement testé. */
  nodesTested: number;
  lodLevel: number;
  complete: boolean;
  pixelError: number;
}

/** Un résultat de coupe vide, à poser une fois par appelant chaud puis à réutiliser d'image en image :
 *  `selectVisiblePages` réécrit chaque champ, seule l'identité de l'objet compte. */
export function createSelectionResult<T>(): SelectionResult<T> {
  return {
    shown: [],
    wanted: [],
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    nodesTested: 0,
    lodLevel: 0,
    complete: true,
    pixelError: 0,
  };
}

export const IDENTITY_WORLD = new THREE.Matrix4();
/** Synchronous selection reuses these buffers between frames without allocating a new cut. */
export const selectionScratch = {
  /** Plans du tronc en repère monde, qui rejettent une racine entière par sa boîte monde. */
  worldPlanes: new Float64Array(FRUSTUM_PLANE_VALUES),
  matrix: new THREE.Matrix4(),
  viewMatrix: new THREE.Matrix4(),
  viewMin: [Infinity, Infinity, Infinity] as [number, number, number],
  viewMax: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  pixelScale: [1, 1] as [number, number],
  clip: new THREE.Matrix4(),
  /** Plans du tronc dans le repère de la racine en cours, bruts : ceux de la descente exacte. */
  planes: new Float64Array(FRUSTUM_PLANE_VALUES),
  stack: new Int32Array(4096),
};
export const fallbackScratch: unknown[] = [];
export const forceScratch: number[] = [];

/** L'état d'une coupe, posé une seule fois. La sélection est synchrone et non réentrante, comme
 *  `selectionScratch` : réutiliser cet état retire la dernière allocation par image. */
const reusedState: SelectionState<PageRecord> = {
  camera: undefined as unknown as THREE.PerspectiveCamera,
  hold: false,
  rootFallback: false,
  wanted: [],
  shown: [],
  isResident: undefined,
  pageResident: (rec) =>
    !reusedState.hold || (reusedState.isResident ? reusedState.isResident(rec) : !!rec.array),
  pixelError: 0,
  frustumRejected: 0,
  nodesTested: 0,
  lodLevel: 0,
  complete: true,
  cameraStretch: 1,
  flatWorld: IDENTITY_WORLD,
  flatElements: IDENTITY_WORLD.elements,
  flatStretch: 1,
  flatFocal: 1,
  flatCone: createConeContext(),
  flatExact: false,
  flatUseForcing: false,
  flatMissing: false,
  flatShort: false,
  wantedTriangles: 0,
  shownTriangles: 0,
  budget: 0,
  over: false,
};

/** Ramène `shown` à un préfixe et sa somme de triangles avec lui : même ordre, mêmes bits que le
 *  balayage que cette somme remplace. Les replis sont les seuls à raccourcir la coupe. */
export function truncateShown<T extends PageRecord>(s: SelectionState<T>, to: number) {
  s.shown.length = to;
  let sum = 0;
  for (let i = 0; i < to; i++) sum += s.shown[i].triangles;
  s.shownTriangles = sum;
}

/** L'état réutilisé, vu au type de pages demandé. */
export function selectionState<T extends PageRecord>(): SelectionState<T> {
  return reusedState as unknown as SelectionState<T>;
}
