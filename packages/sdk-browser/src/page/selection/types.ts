import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { HostAttributes, HostMaterials, HostMesh } from '../../host/resources.ts';
import type { PageSurface } from '../surface.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';
import type { NormalCone } from '../cone/cone.ts';
import type { CullingLinks } from '../cut/links.ts';
import type { PlacementOf } from '../../placement/rows.ts';

/** The box a dynamic page's vertices are in this frame (#573), local: its least then greatest
 *  corner (`../../world/core/pageMotion.ts`). */
export type MovedBox = { readonly min: number[]; readonly max: number[] };

/** Where a page's deformation results lie (`PageRec.deformationOutput`), `count` vertices of them;
 *  `pool` names the float-pool block's geometry and placement world. */
export type DeformationOutput = {
  from: number;
  count: number;
  pool?: { attributes: HostAttributes; world?: MatrixElements };
};

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
  /** The cluster page cut again from its source vertices on the grids of the class its material
   *  moved to in the session, when that class is not the one the compiler cut it for (#846): the
   *  WebGL2 page path draws it in place of the page it reads at `url`. */
  recut?: Uint8Array;
  min: number[];
  max: number[];
  /** Where a dynamic page's vertices are this frame (#573), set by each rewrite its session takes
   *  (`webgpu/pages/render/movedGeometry.ts`): every bound of its row — shadow sphere, occlusion
   *  corners, level-of-detail sphere — reads it in place of `min` and `max` grown by its root's
   *  `reach` (`rowBox`). Shared, as the record, by every placement: they draw the same vertices. */
  moved?: MovedBox;
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
  /** GPU deformation output (#357): in this page's cache slot, in words from its start; or, for a
   *  page drawn from the float pool (`pool`), one block of its geometry's vertices in that pool,
   *  `from` its first float, shared by every page of its geometry and placement
   *  (`../../deformation/slotLayout.ts`). */
  deformationOutput?: DeformationOutput;
  sourceOrder?: number;
  renderOrder: number;
  cone?: NormalCone;
  /** Rank of the request key, set once by `indexPageRequests`: deduplication without hashing. */
  requestIndex?: number;
  /** The residency's key of the page: its rank in the WebGPU host catalogue, set once, or the
   *  WebGL2 residency's key, checked against the URL it names (`backend/autonomous/pageKeys.ts`).
   *  Residency and pinning without hashing. */
  keyIndex?: number;
  /** True on a page of the group a root replaces: the minimum capacity holds it and admits it
   *  first (`../../residency/minimumCapacity.ts`). */
  rootChild?: boolean;
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
  /** The packed rank of `pages[0]` in its engine's catalogue (#1235): every record is shared by
   *  all the placements of its primitive, so an instance — a (placement, page) pair — is named by
   *  its packed rank, and its root is the one the layout ranked here. Posted by the layout, read
   *  by the cut (`page/cut/take.ts`) to publish the instances as packed ranks. */
  packedBase?: number;
  /** WebGL placement control record, zero when the placement is rigid: per placement, so on the
   *  root, never on its shared pages (#1235). */
  deformRecord?: number;
  /** Compiled mesh number of its primitive (`Primitive.mesh`), the key the compiler bakes each
   *  `impostors` entry under: the runtime impostor switch looks the mesh up by exactly this number
   *  (#1239), never through a table of its own. */
  mesh?: number;
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
   *  the cut reads none of its pages' cones — they may carry the cooked one (`collect.ts`) — and
   *  then stops reading `cone` per cluster. Absent or `true`, the cut tests every page as before.
   *  Whoever posts a cone for the cut sets this flag on its root: that is the only contract that
   *  makes the omission visible. */
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
  /** Its mark, absent when 0: its surface's sprite bits (`spriteMark`), set at collection, and
   *  `SHADOWLESS_ROOT` while its mesh or row casts no shadow (`followPlacementRows`,
   *  `followHostVisibility`). */
  mark?: number;
  /** The instance-buffer row this root reads its world from, when it was collected from one: an
   *  engine drawn by the host renderer draws its pages instanced, one mesh per page and surface. */
  placement?: PlacementOf;
  /** How far its primitive's deformation can move a vertex from rest (`Primitive.deformation`),
   *  absent on one that does not deform (#357). */
  deformation?: { joints: number[]; targets: number[]; softVertices?: number };
  /** How far its deformation moves a vertex this frame, in its units: every cut grows its bounds
   *  by it (`../../deformation/frame.ts`); absent or zero at rest. */
  reach?: number;
  /** Winding of `world` and the row-table epoch it was computed at (`webgpu/pages/render/winding.ts`). */
  windingCw?: boolean;
  windingEpoch?: number;
};
