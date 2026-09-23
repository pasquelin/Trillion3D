import type { MatrixElements } from '../../math/matrixElements.ts';
import type { NormalCone } from '../../page/cone/cone.ts';
import type { PageSurface } from '../../page/surface.ts';

/** Twenty-four floats per node: the sixteen from the manifest, then the subtree error-floor
 *  sphere, the floor and a flags word (`packNodes.ts`). */
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
  material?: PageSurface;
  /** Cluster triangles and its pass: the GPU holds the totals, the CPU no longer sums them
   *  (`layout.ts`, snapshot header). */
  triangles?: number;
  transparent?: boolean;
};
export type DagRoot = {
  world: MatrixElements;
  pages: DagCluster[];
  flat?: boolean;
  /** A parked instance-buffer row: packed with the others, and deposited in no queue. */
  parked?: boolean;
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
  /** Root node of each primitive, parked or not: what `rootNodes` takes back when a row returns. */
  rootBases: Uint32Array;
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
