import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { GraphMesh } from '../../host/graph/mesh.ts';
import type { HostAttributes, HostMaterials, HostMesh } from '../../host/resources.ts';
import type { PageSurface } from '../surface.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';
import type { NormalCone } from '../cone/cone.ts';
import type { CullingLinks } from '../cut/links.ts';
import type { PlacementOf } from '../../placement/rows.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

export type PageRec = {
  id: number;
  url: string;
  clusterId: string;
  array?: Uint32Array;
  triangles: number;
  indexBytes: number;
  /** Quantized cluster page of this cluster (`WGP3`, `docs/FORMAT.md`), when the compiler wrote
   *  one AND the cluster is opaque or masked: an engine that reads pages in place uploads these
   *  bytes instead of the index page and decodes every corner from them. Left undefined on a
   *  transparent cluster — its forward draw still reads an index buffer — and on a cache that
   *  carries no geometry page, both of which keep the source float buffers. */
  geometryPage?: GeometryPageDescriptor;
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
  /** One record of each bundle its bundle is installed after, closed up to the root cover
   *  (`./bundleDependencies.ts`): a request for this record brings the missing ones with it. */
  dependencies?: readonly PageRec[];
  /** Coplanar depth layer, 0 for every cluster the compiler left alone. Always present, never
   *  undefined, so a page record keeps one shape through the selection loop. */
  depthLayer: number;
  attributes: HostAttributes;
  /** The engine's own record of the surface this cluster wears (`../surface.ts`). Every reader
   *  on the way to the image takes it from here and nothing else. */
  material: PageSurface;
  /** The host declaration the record was read from, carried for the ONE use that needs the object
   *  itself: handing a surface back to the library that owns it — the WebGL2 witness draw, the
   *  transparent copy, the diagnostic materials. The closed list of
   *  `tests/integration/engine-without-three.test.ts` says who may read it. */
  declaration: HostMaterials;
  transparent?: boolean;
  sourceMesh?: HostMesh;
  sourceOrder?: number;
  matrix: MatrixElements;
  /** Cached winding and epoch of the world matrix that produced it (`webgpuPagesWinding`). */
  windingCw?: boolean;
  windingEpoch?: number;
  renderOrder: number;
  geometry?: Geometry;
  /** The mesh of the engine's own graph the WebGL2 page path draws the page as. */
  mesh?: GraphMesh;
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
  /** The instance-buffer row this record is placed by, as its root: an engine drawn by the host
   *  renderer draws such records instanced, one mesh per page and surface. */
  placement?: PlacementOf;
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
   *  `links`: parent of each node and leaf node of each cluster, the same shared prepare. */
  culling?: {
    nodes: Float64Array;
    stride: number;
    bounds: Float64Array;
    links?: CullingLinks;
  };
  /** Root world box, six bounds flat (`packages/sdk-core/src/math/primitives/box.ts`). */
  worldBox?: Float64Array;
  /** The local box of which `worldBox` is the image: what a node move reprojects (R8). Shared by
   *  every placement of the primitive, so it is read, never written. */
  localBox?: Float64Array;
  stretch?: number;
  stretchKey?: Float64Array;
  structure?: ClusterStructureIndex;
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
  /** True while the row this root was collected from is parked, or its source node hidden: every
   *  cut skips the root, and its tables stay as they are, ready to be taken back
   *  (`placement/rows.ts`, `placement/hidden.ts`). */
  parked?: boolean;
  /** True while the host hides the source node or one of its ancestors (`placement/hidden.ts`). */
  hidden?: boolean;
  /** Its surface's sprite mark (`spriteMark`), absent on any other surface: `SPRITE_ROOT` keeps it
   *  out of every light cut and of the shadow scene box, `SPRITE_UNCULLED` opens it to every camera
   *  cut. Set once at collection. */
  sprite?: number;
  /** The instance-buffer row this root reads its world from, when it was collected from one. */
  placement?: PlacementOf;
};
