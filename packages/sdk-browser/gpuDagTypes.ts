import * as THREE from 'three';
import type { NormalCone } from './pageCone.ts';

export const DAG_NODE_FLOATS = 16,
  FRAME_VEC4 = 7,
  CULL_STRIDE = 15;
type DagCluster = {
  url: string;
  lodError?: number;
  parentError?: number | null;
  sphere?: number[];
  parentSphere?: number[] | null;
  level?: number;
  min?: number[];
  max?: number[];
  cone?: NormalCone;
  material?: THREE.Material | THREE.Material[];
};
export type DagRoot = {
  world: THREE.Matrix4;
  pages: DagCluster[];
  flat?: boolean;
  culling?: { nodes: Float64Array; stride: number };
};
export type PackedDag = {
  kind: 'dag';
  clusters: Float32Array;
  nodes: Float32Array;
  pageCones: Float32Array;
  worlds: Float32Array;
  worldStretch: Float32Array;
  /** Le nœud racine de chaque primitive, d'où part la descente par niveaux ; `SELECTION_NONE` sans. */
  rootNodes: Uint32Array;
  /** Profondeur de la hiérarchie la plus profonde : le nombre de passes de la descente. */
  levelCount: number;
  nodeCount: number;
  worldCount: number;
  pageCount: number;
  rootCount: number;
  pageUrls: string[];
};
