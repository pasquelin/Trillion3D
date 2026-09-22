import type { HostAttributes, HostGeometry, HostMaterials, HostMesh } from './hostResources.ts';
import type { MatrixElements } from './matrixElements.ts';
import type { NormalCone } from './pageCone.ts';
import type { CullingLinks } from './pageSelectionCutForced.ts';

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
  attributes: HostAttributes;
  material: HostMaterials;
  transparent?: boolean;
  sourceMesh?: HostMesh;
  sourceOrder?: number;
  matrix: MatrixElements;
  /** Cached winding and epoch of the world matrix that produced it (`webgpuPagesWinding`). */
  windingCw?: boolean;
  windingEpoch?: number;
  renderOrder: number;
  geometry?: HostGeometry;
  mesh?: HostMesh;
  attached: boolean;
  resident?: boolean;
  cone?: NormalCone;
  /** Rank of the request key, set once by `indexPageRequests`: deduplication without hashing. */
  requestIndex?: number;
  /** Rank of the cluster key in the host catalogue, set once: residency and pinning without
   *  hashing. The host sets it, nobody else reads it. */
  keyIndex?: number;
  /** Rank of the page in a WebGPU engine's packed catalogue, set once. Another engine that
   *  rewrites it fools nobody: the reader checks that the catalogue actually yields this page. */
  packedIndex?: number;
  /** Rank of the root — the placement — in a WebGPU engine's selection roots, set once by its
   *  layout: that is what the record carries to look up the placement's motion. */
  placementIndex?: number;
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
  world: MatrixElements;
  pages: T[];
  /** `bounds`: per-node bounds derived from the nodes and the pages, once at prepare time.
   *  `links`: parent of each node and leaf node of each cluster, the same shared prepare.
   *  `marks`: the nodes forcing touches, owned by this placement and zeroed each image. */
  culling?: {
    nodes: Float64Array;
    stride: number;
    bounds: Float64Array;
    links?: CullingLinks;
    marks?: Int32Array;
  };
  /** Root world box, six bounds flat (`mathBox.ts`). */
  worldBox?: Float64Array;
  /** The local box of which `worldBox` is the image: what a node move reprojects (R8). */
  localBox?: Float64Array;
  stretch?: number;
  stretchKey?: Float64Array;
  structure?: ClusterStructureIndex;
  forced?: Uint8Array;
  forcedList?: number[];
  /** What the root declares of its normal cones, once and for all at prepare time: `false` says
   *  none of its pages carry one, and the cut then stops reading `cone` per cluster. Absent or
   *  `true`, the cut tests every page as before. Whoever sets a cone on a page sets this flag on
   *  its root: that is the only contract that makes the omission visible. */
  cones?: boolean;
  /** What the root declares of its pages' boxes, once and for all at prepare time: `true` says
   *  each carries `min` and `max`, and the cut then stops checking them per cluster under a node
   *  entirely inside the frustum. Absent or `false`, it tests every page as before. Whoever
   *  builds a page without a box declares nothing: that is the only contract that makes the
   *  omission visible. */
  boxes?: boolean;
};

/**
 * Rounds of climb toward a resident ancestor before the pinned root cover takes over. The flat
 * cut and the cluster-DAG cut escalate the same number of times: two separate values would have
 * been tuned one without the other.
 */
export const ESCALATION_ROUNDS = 3;

/**
 * Relative slack added to the threshold when the cut climbs toward a resident ancestor.
 *
 * Escalation sets `threshold = parent's screen error` so the missing cluster stops being kept
 * (`parent error > threshold` becomes false at equality) and its parent replaces it (`parent
 * error <= threshold` true at the same equality). Both flips therefore rest on an EXACT equality
 * between a value written by one pass and the same value recomputed by another. In f32 that
 * equality does not hold: the driver compiler contracts the same operands differently from one
 * entry point to another, and the re-read value drifts by a few units in the last bit — the
 * missing cluster becomes kept again, and its parent does not replace it. The threshold is
 * therefore set strictly above, by a slack that amply covers that drift while remaining four
 * orders of magnitude under a pixel: both flips become strict.
 */
export const ESCALATION_SLACK = 1 + 2 ** -14;
