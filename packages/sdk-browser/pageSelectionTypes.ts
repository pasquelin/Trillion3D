import * as THREE from 'three';
import type { NormalCone } from './pageCone.ts';

export type PageRec = {
  id: number;
  url: string;
  clusterId: string;
  array?: Uint32Array;
  triangles: number;
  indexBytes: number;
  min: number[];
  max: number[];
  role?: 'exact' | 'coarse';
  /** Flat DAG cut, copied from the page. Absent on caches without a per-cluster error. */
  level?: number;
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  /** Group that replaces this cluster, and group that produced it. */
  group?: number | null;
  source?: number | null;
  /** Streaming bundle that carries this cluster, and its byte offset inside it. Residency is a
   *  property of the bundle: one request makes dozens of clusters drawable at once. */
  streamUrl?: string;
  streamOffset?: number;
  /** Coplanar depth layer, 0 for every cluster the compiler left alone. Always present, never
   *  undefined, so a page record keeps one shape through the selection loop. */
  depthLayer: number;
  attributes: THREE.BufferGeometry['attributes'];
  material: THREE.Material | THREE.Material[];
  transparent?: boolean;
  sourceMesh?: THREE.Mesh;
  sourceOrder?: number;
  matrix: THREE.Matrix4;
  /** Sens de parcours mémorisé et époque de la matrice monde qui l'a donné (`webgpuPagesWinding`). */
  windingCw?: boolean;
  windingEpoch?: number;
  renderOrder: number;
  geometry?: THREE.BufferGeometry;
  mesh?: THREE.Mesh;
  attached: boolean;
  resident?: boolean;
  cone?: NormalCone;
  /** Rang de la clé de requête, posé une fois par `indexPageRequests` : dédoublonnage sans hachage. */
  requestIndex?: number;
  /** Rang de la clé de cluster dans le catalogue de l'hôte, posé une fois : résidence et épinglage sans
   *  hachage. L'hôte le pose, personne d'autre ne le lit. */
  keyIndex?: number;
  /** Rang de la page dans le catalogue empaqueté d'un moteur WebGPU, posé une fois. Un autre moteur
   *  qui le réécrit ne trompe personne : le lecteur vérifie que le catalogue rend bien cette page. */
  packedIndex?: number;
};
/**
 * Group links of a primitive, flattened once and shared by every instance of it.
 *
 * `children` and `outputs` of a group cover the same surface, never both at once, so replacing one
 * by the other is always a complete swap. `sources` and `owners` say, for a cluster, which group
 * produced it and which group replaces it.
 */
export type ClusterStructureIndex = {
  groupCount: number;
  childOffsets: Int32Array;
  children: Int32Array;
  outputOffsets: Int32Array;
  outputs: Int32Array;
  sources: Int32Array;
  owners: Int32Array;
  error: Float64Array;
  sphere: Float64Array;
  roots: readonly number[];
};
/**
 * One primitive instance as the selection sees it: its clusters, the world matrix that places them,
 * its flat culling hierarchy and its group links. There is no tree — every cluster carries its own
 * screen-error band, and the hierarchy is only a traversal accelerator.
 */
export type ClusterRoot<T> = {
  world: THREE.Matrix4;
  pages: T[];
  /** `bounds` : bornes par nœud dérivées des nœuds et des pages, une fois à la préparation. */
  culling?: { nodes: Float64Array; stride: number; bounds: Float64Array };
  /** Boîte monde de la racine, six bornes à plat (`mathBox.ts`). */
  worldBox?: Float64Array;
  /** La boîte locale dont `worldBox` est l'image : ce qu'un déplacement de nœud reprojette (R8). */
  localBox?: Float64Array;
  stretch?: number;
  stretchKey?: Float64Array;
  structure?: ClusterStructureIndex;
  forced?: Uint8Array;
  forcedList?: number[];
};

/**
 * Tours de montée vers un ancêtre résident avant que la couverture racine épinglée ne prenne le
 * relais. La coupe plate et la coupe du DAG de clusters escaladent le même nombre de fois : deux
 * valeurs séparées se seraient réglées l'une sans l'autre.
 */
export const ESCALATION_ROUNDS = 3;
