import { FRUSTUM_PLANE_VALUES } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { createConeContext, type ConeContext, type NormalCone } from './pageCone.ts';
import type { EngineCamera } from './cameraWorld.ts';
import { IDENTITY_ELEMENTS, type MatrixElements } from './matrixElements.ts';
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
  cam: EngineCamera;
  hold: boolean;
  rootFallback: boolean;
  wanted: T[];
  shown: T[];
  isResident?: (page: T) => boolean;
  pixelError: number;
  frustumRejected: number;
  /** Nœuds de hiérarchie dépilés par la coupe de cette image. */
  nodesTested: number;
  lodLevel: number;
  complete: boolean;
  cameraStretch: number;
  flatWorld: MatrixElements;
  flatElements: ArrayLike<number>;
  flatStretch: number;
  flatFocal: number;
  flatStructure?: ClusterStructureIndex;
  flatForced?: Uint8Array;
  flatForcedList?: number[];
  /** Ce que le rejet de cône lit de la racine et de la caméra, posé au premier cône de la racine. */
  flatCone: ConeContext;
  /** Cette racine déclare porter des cônes : le chemin par cluster lit `cone`. Une racine qui
   *  déclare n'en porter aucun sort le cône de la boucle, sans changer une seule décision. */
  flatCones: boolean;
  /** Cette racine déclare que chacune de ses pages porte sa boîte : sous un nœud entièrement dans
   *  le tronc, le chemin par cluster ne lit alors ni `min` ni `max`. */
  flatBoxes: boolean;
  /** La règle de résidence de cette coupe, résolue une fois : `RESIDENT_ALL` quand rien n'est tenu
   *  (tout est réputé résident), `RESIDENT_ASK` quand l'hôte fournit sa réponse, `RESIDENT_ARRAY`
   *  quand la résidence est le tableau d'indices de la page. Le chemin par cluster lit ce mode au
   *  lieu de relire `hold` et `isResident` sur l'état à chaque cluster retenu ; les replis l'appliquent
   *  par `residentUnder`. */
  residentMode: number;
  /** Le seuil de cette image vaut zéro et l'étirement, la focale et le plan proche sont sains : la
   *  coupe se décide alors sans projeter, à l'identique. */
  flatExact: boolean;
  flatUseForcing: boolean;
  flatMissing: boolean;
  flatShort: boolean;
  /** Ce que les deux listes portent vraiment. Les tableaux ne sont plus vidés par `length = 0` à
   *  chaque image — ils y perdraient leur capacité et la repousseraient de zéro à quatre-vingt
   *  mille — mais réécrits par indice, et leur longueur n'est posée qu'une fois la coupe finie.
   *  Pendant la coupe, ces deux comptes sont la seule vérité : `length` est en retard. */
  shownCount: number;
  wantedCount: number;
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

/** Rien n'est tenu : la coupe n'a pas de résidence à tester. */
export const RESIDENT_ALL = 0;
/** L'hôte répond lui-même de la résidence d'une page. */
export const RESIDENT_ASK = 1;
/** La résidence d'une page est son tableau d'indices. */
export const RESIDENT_ARRAY = 2;

/** La règle de résidence d'une coupe, dite une fois par appel : `keep` la reçoit en paramètre et ne
 *  relit plus l'état par cluster. Une seule écriture de la règle, pour le chemin chaud comme pour
 *  les replis. */
export function residentModeOf(hold: boolean, isResident: unknown) {
  return !hold ? RESIDENT_ALL : isResident ? RESIDENT_ASK : RESIDENT_ARRAY;
}

/** La résidence d'une page sous un mode déjà résolu. */
export function residentUnder<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  mode: number,
): boolean {
  if (mode === RESIDENT_ALL) return true;
  if (mode === RESIDENT_ARRAY) return !!rec.array;
  return (s.isResident as (page: T) => boolean)(rec);
}

export const IDENTITY_WORLD: MatrixElements = { elements: IDENTITY_ELEMENTS };
/** Synchronous selection reuses these buffers between frames without allocating a new cut. */
export const selectionScratch = {
  viewMatrix: new Float64Array(16),
  viewMin: [Infinity, Infinity, Infinity] as [number, number, number],
  viewMax: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  pixelScale: [1, 1] as [number, number],
  clip: new Float64Array(16),
  /** Plans du tronc dans le repère de la racine en cours, bruts : ceux de la descente exacte. */
  planes: new Float64Array(FRUSTUM_PLANE_VALUES),
  stack: new Int32Array(4096),
};
export const fallbackScratch: unknown[] = [];
export const forceScratch: number[] = [];

/** L'état d'une coupe, posé une seule fois. La sélection est synchrone et non réentrante, comme
 *  `selectionScratch` : réutiliser cet état retire la dernière allocation par image. */
const reusedState: SelectionState<PageRecord> = {
  cam: undefined as unknown as EngineCamera,
  hold: false,
  rootFallback: false,
  wanted: [],
  shown: [],
  isResident: undefined,
  pixelError: 0,
  frustumRejected: 0,
  nodesTested: 0,
  lodLevel: 0,
  complete: true,
  cameraStretch: 1,
  flatWorld: IDENTITY_WORLD,
  flatElements: IDENTITY_ELEMENTS,
  flatStretch: 1,
  flatFocal: 1,
  flatCone: createConeContext(),
  flatCones: true,
  flatBoxes: false,
  residentMode: RESIDENT_ALL,
  flatExact: false,
  flatUseForcing: false,
  flatMissing: false,
  flatShort: false,
  shownCount: 0,
  wantedCount: 0,
  wantedTriangles: 0,
  shownTriangles: 0,
  budget: 0,
  over: false,
};

/** Ramène `shown` à un préfixe et sa somme de triangles avec lui : même ordre, mêmes bits que le
 *  balayage que cette somme remplace. Les replis sont les seuls à raccourcir la coupe. */
export function truncateShown<T extends PageRecord>(s: SelectionState<T>, to: number) {
  s.shownCount = to;
  let sum = 0;
  for (let i = 0; i < to; i++) sum += s.shown[i].triangles;
  s.shownTriangles = sum;
}

/** L'état réutilisé, vu au type de pages demandé. */
export function selectionState<T extends PageRecord>(): SelectionState<T> {
  return reusedState as unknown as SelectionState<T>;
}
