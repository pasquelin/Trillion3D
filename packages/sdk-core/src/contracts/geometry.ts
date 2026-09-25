import type { DagReport } from './dag.ts';
import type { AssetScope } from './base.ts';
import type { SceneProxyDescriptor } from './proxy.ts';
import type {
  GeometryPageDescriptor,
  GeometryPageFormat,
  PrimitiveQuantization,
} from '../page/contracts.ts';
import type { TexturePreview } from '../texture/previewContracts.ts';
export type { TexturePreview };

/** One cluster of a compiled model: a small piece of triangles the engine loads on its own. */
export interface Page {
  /** The cluster's number. */ id: number;
  /** Where its bytes are read. */ url: string;
  /** Fingerprint of its bytes. */ sha256: string;
  /** Size of its bytes. */ bytes: number;
  /** Triangles it holds. */ count: number;
  /** Lowest corner of its box. */ min: number[];
  /** Highest corner of its box. */ max: number[];
  /** Full detail or coarse. */ role?: 'exact' | 'coarse';
  /** How its bytes are laid out. */ geometry?: GeometryPageDescriptor;
  /** Offset of the earliest source index this page descends from. Restores a transparent draw order. */
  start?: number;
  /** DAG cut, when the compiler emitted one. `lodError` is the object-space error of the group that
   *  produced this cluster, projected through `sphere`; `parentError` is the error of the group that
   *  replaces it, projected through `parentSphere`. Both are null on a root, which is never replaced. */
  level?: number;
  /** Its simplification error. */ lodError?: number;
  /** The ball its error is measured through. */ sphere?: number[];
  /** The error of what replaces it. */ parentError?: number | null;
  /** The ball of what replaces it. */ parentSphere?: number[] | null;
  /** Group that replaces this cluster (null on a root) and group that produced it (null at level 0).
   *  Coarsening is a group-wide swap, so a runtime short of memory needs both links. */
  group?: number | null;
  /** The group that produced it. */ source?: number | null;
  /** Streaming bundle holding this cluster and its byte offset inside it. One request serves dozens
   *  of clusters; the cluster stays readable on its own through `url`. */
  stream?: number;
  /** Its byte offset in that bundle. */ streamOffset?: number;
  /** Coplanar depth layer, 0 for every cluster the compiler left alone. A cluster of layer n draws
   *  with a depth bias of n whole layer steps, which is what decides the winner between two opaque
   *  surfaces that share a plane exactly. Absent and 0 mean the same thing: the untouched draw. */
  depthLayer?: number;
}
/** A bounding sphere an error band can be projected through: four finite values, a radius of at
 *  least zero. Unrolled on purpose: it runs once per cluster at preparation, with no closure. */
export function clusterSphereValid(sphere: unknown): sphere is number[] {
  return (
    Array.isArray(sphere) &&
    sphere.length === 4 &&
    Number.isFinite(sphere[0]) &&
    Number.isFinite(sphere[1]) &&
    Number.isFinite(sphere[2]) &&
    Number.isFinite(sphere[3]) &&
    sphere[3] >= 0
  );
}
/** A cluster carrying its own screen-error band needs no hierarchy: selection is a flat per-page test. */
export function pageCarriesClusterError(page: Page) {
  return (
    typeof page.lodError === 'number' &&
    Number.isFinite(page.lodError) &&
    page.lodError >= 0 &&
    clusterSphereValid(page.sphere)
  );
}
/** Whether every page of a primitive carries its own error band. */
export function primitiveUsesClusterErrors(primitive: Pick<Primitive, 'pages'>) {
  return primitive.pages.length > 0 && primitive.pages.every(pageCarriesClusterError);
}
/** Layout of an unsplit primitive kept outside the cluster DAG by the compiler:
 *  full mesh, source order preserved. Three material properties lead there today —
 *  transmission, skinning, and morph targets —, never an object name. */
export const UNSPLIT_PASS = 'shared-blend';
/**
 * A primitive that this runtime can draw. Two forms, and two only: a DAG where each
 * cluster carries its screen error band, or an unsplit mesh that the compiler
 * left outside the DAG — that one has no pages, hence no band, which is its definition, not a
 * gap. A shared-blend primitive that still carries pages comes from a compiler
 * that we do not read: it is rejected like a DAG without band.
 */
export function primitiveIsDrawable(primitive: Pick<Primitive, 'pages' | 'pass'>) {
  return primitive.pass === UNSPLIT_PASS
    ? primitive.pages.length === 0
    : primitiveUsesClusterErrors(primitive);
}
/** Flat culling hierarchy over a primitive's clusters. `stride` numbers per node, node 0 is the root:
 *  min[3], max[3], sphere[4], maxParentError (-1 when the subtree holds a cluster with no
 *  replacement), firstChild, childCount, firstPage, pageCount. A leaf has childCount 0. */
export interface CullingHierarchy {
  /** Numbers per node. */ stride: number;
  /** How many nodes. */ count: number;
  /** Every node's numbers, one after the other. */ nodes: number[];
}
/** One reduction of the cluster DAG. `children` and `outputs` cover the same surface, never both. */
export interface ClusterGroup {
  /** How many times it was simplified. */ level: number;
  /** Its simplification error. */ error: number;
  /** The ball its error is measured through. */ sphere: number[];
  /** The finer clusters it replaces. */ children: number[];
  /** The coarser clusters it makes. */ outputs: number[];
}
/** Group links of a primitive, plus the clusters that nothing replaces. */
export interface ClusterStructure {
  /** Format version. */ version: number;
  /** Clusters nothing replaces. */ roots: number[];
  /** Every group. */ groups: ClusterGroup[];
}
/** A file holding many clusters, fetched in one request. */ export interface StreamBundle {
  /** Where it is read. */ url: string;
  /** Fingerprint of its bytes. */ sha256: string;
  /** Its size. */ bytes: number;
  /** Clusters it holds. */ count: number;
  /** The bundles holding the parents of its clusters, closed up to the pinned root cover and
   *  ascending: it is installed after every one of them. */ dependencies: number[];
}
/** Streaming bundles of a primitive. The first `pinned` bundles hold exactly the root clusters,
 *  so keeping them resident guarantees a complete, if coarse, cover of the primitive. */
export interface StreamCatalogue {
  /** Format version. */ version: number;
  /** Bundles always kept. */ pinned: number;
  /** Target bundle size. */ bundleBytes: number;
  /** Most bundles holding the parents of one bundle's clusters, fixed before packing. */ dependencyBound: number;
  /** Longest closed dependency list of a bundle, as the compiler published it. */ maxDependencies: number;
  /** Every bundle. */ pages: StreamBundle[];
}
/** One mesh part of a compiled model, with its pages and hierarchy. */ export interface Primitive {
  /** Its mesh's number. */ mesh: number;
  /** Its number in the mesh. */ primitive: number;
  /** How it is drawn. */ pass: string;
  /** How clusters were made. */ clusterStrategy?: 'dag-groups';
  /** Its clusters. */ pages: Page[];
  /** The DAG's report. */ dag?: DagReport | null;
  /** Its culling tree. */ culling?: CullingHierarchy | null;
  /** Its group links. */ structure?: ClusterStructure | null;
  /** Its stream bundles. */ streams?: StreamCatalogue | null;
  /** Null on a primitive without pages, which was quantized on no grid. */
  quantization?: PrimitiveQuantization | null;
  /** What the mesh's edges and corners look like. */ topology?: {
    triangles: number;
    edges: { boundary: number; manifold: number; nonManifold: number };
    vertices: { interior: number; boundary: number; locked: number; unused: number };
    manifold: boolean;
  };
}
/** The manifest of a compiled model: its primitives, their pages and how it was made. */
export interface ClusterManifest {
  /** Cache format. */ formatVersion?: number;
  /** Compiler version. */ compilerVersion?: string;
  /** How errors are measured. */ errorModel?: string;
  /** The cluster page format of every `pages[].geometry`; absent from a cache without pages. */
  geometryPages?: GeometryPageFormat;
  /** Whether meshes were simplified. */ simplification?: boolean;
  /** Manifest format. */ schema: number;
  /** Compile outcome. */ status: string;
  /** Cache key. */ key: string;
  /** Full or streamed. */ scope: AssetScope;
  /** How clusters were made. */ clusterStrategy?: string;
  /** Triangles in the source. */ sourceTriangles: number;
  /** Triangles kept. */ selectedTriangles: number;
  /** Nodes kept. */ selectedNodes: number;
  /** Nodes in all. */ totalNodes: number;
  /** Its built-in scene. */ autonomousScene?: string | null;
  /** Its primitives. */ primitives: Primitive[];
  /** One entry per decoded (texture, atlas), sorted by texture then by atlas; empty without a
   *  decodable image. */
  texturePreviews?: TexturePreview[];
  /** Template for baked levels, relative to manifest: {sha} the source image digest,
   *  {kind} the atlas name (PREVIEW_ATLAS_NAMES), {level} the level rank. Absent from a
   *  cache compiled before baked levels, which this reader rejects via sidecar version. */
  textures?: { url: string };
  /** Where to read the resident scene proxy and its BVH: geometry hit by rays.
   *  Absent from a cache compiled before bounce, which remains readable as is. */
  proxy?: SceneProxyDescriptor;
}
