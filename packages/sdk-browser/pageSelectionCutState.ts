import * as THREE from 'three';
import type { NormalCone } from './pageCone.ts';
import type { ClusterCut } from './pageSelectionMath.ts';
import type { ClusterStructureIndex } from './pageSelectionTypes.ts';

export interface PageRecord extends ClusterCut {
  triangles: number;
  seen: number;
  level?: number;
  min?: number[];
  max?: number[];
  cone?: NormalCone;
  material?: THREE.Material | THREE.Material[];
  array?: Uint32Array;
}

export interface SelectionState<T extends PageRecord> {
  camera: THREE.PerspectiveCamera;
  frame: number;
  hold: boolean;
  rootFallback: boolean;
  wanted: T[];
  shown: T[];
  isResident?: (page: T) => boolean;
  pageResident: (page: T) => boolean;
  pixelError: number;
  frustumRejected: number;
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
  flatInside: boolean;
  flatUseForcing: boolean;
  flatMissing: boolean;
  flatShort: boolean;
}

/** Résultat de la coupe, rempli en place : l'appelant fournit l'objet, l'image n'en alloue aucun. */
export interface SelectionResult<T> {
  shown: T[];
  wanted: T[];
  visible: number;
  selectedTriangles: number;
  displayedTriangles: number;
  frustumRejected: number;
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
    lodLevel: 0,
    complete: true,
    pixelError: 0,
  };
}

export const IDENTITY_WORLD = new THREE.Matrix4();
/** Synchronous selection reuses these buffers between frames without allocating a new cut. */
export const selectionScratch = {
  frustum: new THREE.Frustum(),
  matrix: new THREE.Matrix4(),
  viewMatrix: new THREE.Matrix4(),
  box: new THREE.Box3(),
  corner: new THREE.Vector3(),
  viewMin: [Infinity, Infinity, Infinity] as [number, number, number],
  viewMax: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  pixelScale: [1, 1] as [number, number],
  clip: new THREE.Matrix4(),
  planes: new Float64Array(24),
  stack: new Int32Array(4096),
};
export const fallbackScratch: unknown[] = [];
export const forceScratch: number[] = [];

/** L'état d'une coupe, posé une seule fois. La sélection est synchrone et non réentrante, comme
 *  `selectionScratch` : réutiliser cet état retire la dernière allocation par image. */
const reusedState: SelectionState<PageRecord> = {
  camera: undefined as unknown as THREE.PerspectiveCamera,
  frame: 0,
  hold: false,
  rootFallback: false,
  wanted: [],
  shown: [],
  isResident: undefined,
  pageResident: (rec) =>
    !reusedState.hold || (reusedState.isResident ? reusedState.isResident(rec) : !!rec.array),
  pixelError: 0,
  frustumRejected: 0,
  lodLevel: 0,
  complete: true,
  cameraStretch: 1,
  flatWorld: IDENTITY_WORLD,
  flatElements: IDENTITY_WORLD.elements,
  flatStretch: 1,
  flatFocal: 1,
  flatInside: false,
  flatUseForcing: false,
  flatMissing: false,
  flatShort: false,
};

/** L'état réutilisé, vu au type de pages demandé. */
export function selectionState<T extends PageRecord>(): SelectionState<T> {
  return reusedState as unknown as SelectionState<T>;
}
