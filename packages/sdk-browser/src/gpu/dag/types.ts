import type { MatrixElements } from '../../math/matrixElements.ts';
import type { NormalCone } from '../../page/cone/cone.ts';
import type { PageSurface } from '../../page/surface.ts';
import type { SelectionUniforms } from '../core/selection.ts';
import type { LightPages } from '../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';
import type { ClusterStructureIndex } from '../../page/selection/types.ts';
import type { CullingLinks } from '../../page/cut/links.ts';

/**
 * The view one run of the kernel serves: a camera's uniforms, or a shadow face's with `light`, the
 * pages it redraws this frame (`lightCut.ts`). A box covering none of them is dropped, and no
 * normal cone rejects, since every face of a caster writes depth.
 */
export type DagViewUniforms = SelectionUniforms & { light?: LightPages };

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
  /** Its sprite mark (`ClusterRoot.sprite`): left out of a light cut, open to a camera's when
   *  never culled. */
  sprite?: number;
  /** `bounds`: per-node bounds `cullingBounds` derives from the pages. The host shares them
   *  among all placements of a primitive; without them, the layout derives them itself. */
  culling?: { nodes: Float64Array; stride: number; bounds?: Float64Array; links?: CullingLinks };
  /** Group links: what the cut rule's residency is derived from (`../../page/cut/readiness.ts`). */
  structure?: ClusterStructureIndex;
};
/** What a placement's cut residency is derived from, and where its pages and nodes sit in the
 *  packing (`readiness.ts`). */
export type DagCutLinks = {
  structure?: ClusterStructureIndex;
  links: CullingLinks;
  pageBase: number;
  pageCount: number;
  nodeBase: number;
  nodeCount: number;
};
export type PackedDag = {
  kind: 'dag';
  /** Hot records, one per UNIQUE cluster: placements of one primitive share theirs (`layout.ts`). */
  clusters: Float32Array;
  nodes: Float32Array;
  /** Working table (one placement word per page), residency bits, then the unique cold records. */
  pageCones: Float32Array;
  worlds: Float32Array;
  worldStretch: Float32Array;
  /** Root node of each primitive, from which the level descent starts; `SELECTION_NONE` without. */
  rootNodes: Uint32Array;
  /** Root node of each primitive, parked or not: what `rootNodes` takes back when a row returns. */
  rootBases: Uint32Array;
  /** One per primitive: its root's sprite mark (`DagRoot.sprite`), else 0. */
  sprite: Uint8Array;
  /** Nodes of each stage, all primitives together: the upper bound of each pass's queue. Its
   *  LENGTH is the depth of the deepest hierarchy, hence the number of descent passes; a second
   *  field to restate it would only be state to keep in agreement. */
  levelSizes: Uint32Array;
  nodeCount: number;
  worldCount: number;
  pageCount: number;
  /** Unique records behind the `pageCount` pages. */
  recordCount: number;
  /** Per placement, what its page index adds to reach its record, as a wrapping u32. */
  recordShift: Uint32Array;
  rootCount: number;
  pageUrls: string[];
  /** Per placement, its group and culling links (`readiness.ts`). */
  cutLinks: DagCutLinks[];
};

/**
 * Where a light cut leaves the pages its views draw, in the order its mask kernel appended them:
 * catalogue indices from word `offset` of `buffer`, view `v`'s range starting `work[offsetWord + v]`
 * words further and holding `work[countWord + v]` of them — both known on the GPU alone —, and
 * `work[groupsWord]` the most sixty-four-wide groups any view drew.
 */
export type DrawnLog = {
  buffer: GPUBuffer;
  offset: number;
  work: GPUBuffer;
  offsetWord: number;
  countWord: number;
  groupsWord: number;
};
