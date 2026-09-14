import type { AssetScope } from './contractsBase.ts';

export interface GeometryPageDescriptor {
  url: string;
  sha256: string;
  bytes: number;
  formatVersion: 2;
  codec: 'meshopt';
  vertexCount: number;
  indexCount: number;
  flags: number;
  uncompressedBytes: number;
}
export interface Page {
  id: number;
  url: string;
  sha256: string;
  bytes: number;
  count: number;
  min: number[];
  max: number[];
  role?: 'exact' | 'coarse';
  geometry?: GeometryPageDescriptor;
  /** Offset of the earliest source index this page descends from. Restores a transparent draw order. */
  start?: number;
  /** DAG cut, when the compiler emitted one. `lodError` is the object-space error of the group that
   *  produced this cluster, projected through `sphere`; `parentError` is the error of the group that
   *  replaces it, projected through `parentSphere`. Both are null on a root, which is never replaced. */
  level?: number;
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  /** Group that replaces this cluster (null on a root) and group that produced it (null at level 0).
   *  Coarsening is a group-wide swap, so a runtime short of memory needs both links. */
  group?: number | null;
  source?: number | null;
  /** Streaming bundle holding this cluster and its byte offset inside it. One request serves dozens
   *  of clusters; the cluster stays readable on its own through `url`. */
  stream?: number;
  streamOffset?: number;
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
export function primitiveUsesClusterErrors(primitive: Pick<Primitive, 'pages'>) {
  return primitive.pages.length > 0 && primitive.pages.every(pageCarriesClusterError);
}
/** Flat culling hierarchy over a primitive's clusters. `stride` numbers per node, node 0 is the root:
 *  min[3], max[3], sphere[4], maxParentError (-1 when the subtree holds a cluster with no
 *  replacement), firstChild, childCount, firstPage, pageCount. A leaf has childCount 0. */
export interface CullingHierarchy {
  stride: number;
  count: number;
  nodes: number[];
}
/** One reduction of the cluster DAG. `children` and `outputs` cover the same surface, never both. */
export interface ClusterGroup {
  level: number;
  error: number;
  sphere: number[];
  children: number[];
  outputs: number[];
}
/** Group links of a primitive, plus the clusters that nothing replaces. */
export interface ClusterStructure {
  version: number;
  roots: number[];
  groups: ClusterGroup[];
}
export interface StreamBundle {
  url: string;
  sha256: string;
  bytes: number;
  count: number;
}
/** Streaming bundles of a primitive. The first `pinned` bundles hold exactly the root clusters,
 *  so keeping them resident guarantees a complete, if coarse, cover of the primitive. */
export interface StreamCatalogue {
  version: number;
  pinned: number;
  bundleBytes: number;
  pages: StreamBundle[];
}
export interface Primitive {
  mesh: number;
  primitive: number;
  pass: string;
  clusterStrategy?: 'dag-groups';
  pages: Page[];
  culling?: CullingHierarchy | null;
  structure?: ClusterStructure | null;
  streams?: StreamCatalogue | null;
  topology?: {
    triangles: number;
    edges: { boundary: number; manifold: number; nonManifold: number };
    vertices: { interior: number; boundary: number; locked: number; unused: number };
    manifold: boolean;
  };
}
export interface ClusterManifest {
  formatVersion?: number;
  compilerVersion?: string;
  errorModel?: string;
  simplification?: boolean;
  schema: number;
  status: string;
  key: string;
  scope: AssetScope;
  clusterStrategy?: string;
  sourceTriangles: number;
  selectedTriangles: number;
  selectedNodes: number[];
  totalNodes: number;
  autonomousScene?: string | null;
  primitives: Primitive[];
}
