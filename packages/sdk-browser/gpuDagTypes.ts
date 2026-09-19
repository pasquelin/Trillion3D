import * as THREE from 'three';
import type { NormalCone } from './pageCone.ts';

/** Twenty-four floats per node: the sixteen from the manifest, then the subtree error-floor
 *  sphere, the floor and a flags word (`gpuDagPackNodes.ts`). */
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
  /** Cluster triangles and its pass: the GPU holds the totals, the CPU no longer sums them
   *  (`gpuDagLayout.ts`, snapshot header). */
  triangles?: number;
  transparent?: boolean;
};
export type DagRoot = {
  world: THREE.Matrix4;
  pages: DagCluster[];
  flat?: boolean;
  /** `bounds`: per-node bounds `cullingBounds` derives from the pages. The host shares them
   *  among all placements of a primitive; without them, the layout derives them itself. */
  culling?: { nodes: Float64Array; stride: number; bounds?: Float64Array };
};
export type PackedDag = {
  kind: 'dag';
  clusters: Float32Array;
  nodes: Float32Array;
  pageCones: Float32Array;
  worlds: Float32Array;
  worldStretch: Float32Array;
  /** Root node of each primitive, from which the level descent starts; `SELECTION_NONE` without. */
  rootNodes: Uint32Array;
  /** Nodes of each stage, all primitives together: the upper bound of each pass's queue. Its
   *  LENGTH is the depth of the deepest hierarchy, hence the number of descent passes; a second
   *  field to restate it would only be state to keep in agreement. */
  levelSizes: Uint32Array;
  nodeCount: number;
  worldCount: number;
  pageCount: number;
  rootCount: number;
  pageUrls: string[];
};
