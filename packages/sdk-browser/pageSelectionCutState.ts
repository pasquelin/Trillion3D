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
