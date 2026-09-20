import type { DagReport } from './dagContracts.ts';
import type { AssetScope } from './contractsBase.ts';
import type { SceneProxyDescriptor } from './proxyContracts.ts';

/** A quantized cluster page (`WGP3`, `docs/FORMAT.md`): `bytes` is what a reader keeps resident,
 *  `uncompressedBytes` what its float decode occupies. */
export interface GeometryPageDescriptor {
  url: string;
  sha256: string;
  bytes: number;
  formatVersion: 3;
  codec: 'quantized';
  vertexCount: number;
  indexCount: number;
  flags: number;
  uncompressedBytes: number;
}
/** The grid a primitive's pages were quantized on, and the largest displacement it caused. */
export interface PrimitiveQuantization {
  /** Position step is `2 ** positionExponent`, in object units. */
  positionExponent: number;
  positionStep: number;
  /** Texture coordinates sit on `2 ** uvExponent`. */
  uvExponent: number;
  /** Largest distance between a source position and its decoded value; null without pages. */
  maxPositionError: number | null;
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
  dag?: DagReport | null;
  culling?: CullingHierarchy | null;
  structure?: ClusterStructure | null;
  streams?: StreamCatalogue | null;
  quantization?: PrimitiveQuantization;
  topology?: {
    triangles: number;
    edges: { boundary: number; manifold: number; nonManifold: number };
    vertices: { interior: number; boundary: number; locked: number; unused: number };
    manifold: boolean;
  };
}
/**
 * The mip chain of an atlas texture: the tail in the sidecar — from the first level where no
 * side exceeds PREVIEW_BASE down to 1x1, in RGBA8 in its atlas encoding — and, above it,
 * bakedLevels lossless PNG files in the cache, one per level from 0 to bakedLevels - 1, at
 * the address templated by ClusterManifest.textures.url. The engine writes each received level into the
 * same-rank mip level of its layer and samples the resident tail without recalculating anything.
 */
export interface TexturePreview {
  /** Index in the textures array of the prepared scene. */
  texture: number;
  /** Index in its images array, where the source uri is read when present. */
  image: number;
  width: number;
  height: number;
  /** 0 when bytes came from an image uri, 1 when they came from sourceBufferView. */
  sourceKind: number;
  /** Buffer view of the prepared scene, or -1 for a uri source. */
  sourceBufferView: number;
  /** SHA-256 of decoded source bytes. */
  sha256: string;
  /** The atlas this entry serves: PREVIEW_ATLAS_COLOR or PREVIEW_ATLAS_DATA. */
  atlas: number;
  /** Index of the first level carried in the source's mip chain; 0 when it already fits
   *  under PREVIEW_BASE and the sidecar thus carries its full resolution. */
  firstLevel: number;
  /** Levels baked into files in the cache, from 0 to bakedLevels - 1; firstLevel when the
   *  chain is complete, 0 when nothing was written and the engine loads the source image. */
  bakedLevels: number;
  /** Levels carried in order, from finest to 1x1, each a view on sidecar bytes. */
  levels: Uint8Array<ArrayBuffer>[];
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
