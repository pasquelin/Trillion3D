import * as THREE from 'three';
import type { NormalCone } from './pageCone.ts';

/** Vingt-quatre flottants par nœud : les seize du manifeste, puis la sphère du plancher d'erreur du
 *  sous-arbre, le plancher et un mot de drapeaux (`gpuDagPackNodes.ts`). */
export const DAG_NODE_FLOATS = 24,
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
  /** `bounds` : les bornes par nœud que `cullingBounds` dérive des pages. L'hôte les partage entre
   *  tous les placements d'une primitive ; sans elles, le rangement les dérive lui-même. */
  culling?: { nodes: Float64Array; stride: number; bounds?: Float64Array };
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
  /** Nœuds de chaque étage, toutes primitives confondues : le majorant de la file de chaque passe.
   *  Sa LONGUEUR est la profondeur de la hiérarchie la plus profonde, donc le nombre de passes de la
   *  descente ; un second champ pour la redire ne serait qu'un état à tenir d'accord. */
  levelSizes: Uint32Array;
  nodeCount: number;
  worldCount: number;
  pageCount: number;
  rootCount: number;
  pageUrls: string[];
};
