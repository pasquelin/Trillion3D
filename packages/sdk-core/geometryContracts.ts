import type { DagReport } from './dagContracts.ts';
import type { AssetScope } from './contractsBase.ts';
import type { SceneProxyDescriptor } from './proxyContracts.ts';

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
/** Le rangement d'une primitive que le compilateur garde d'un seul tenant, hors du DAG de clusters :
 *  un maillage entier, ordre source conservé. Trois propriétés de matériau y mènent aujourd'hui — la
 *  transmission, la peau et les cibles de morphing —, jamais un nom d'objet. */
export const UNSPLIT_PASS = 'shared-blend';
/**
 * Une primitive que ce runtime sait dessiner. Deux formes, et deux seulement : un DAG dont chaque
 * cluster porte sa bande d'erreur d'écran, ou un maillage d'un seul tenant que le compilateur a
 * laissé hors du DAG — celui-là n'a aucune page, donc aucune bande, et c'est sa définition, pas une
 * lacune. Une primitive `shared-blend` qui porterait quand même des pages vient d'un compilateur
 * qu'on ne lit pas : elle est refusée comme un DAG sans bande.
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
  topology?: {
    triangles: number;
    edges: { boundary: number; manifold: number; nonManifold: number };
    vertices: { interior: number; boundary: number; locked: number; unused: number };
    manifold: boolean;
  };
}
/**
 * La chaîne de mips d'une texture d'atlas : la queue dans le sidecar — du premier niveau dont aucun
 * côté ne dépasse `PREVIEW_BASE` au 1×1, en RGBA8 dans l'encodage de son atlas — et, au-dessus,
 * `bakedLevels` fichiers PNG sans perte dans le cache, un par niveau du 0 au `bakedLevels - 1`, à
 * l'adresse que `ClusterManifest.textures.url` gabarit. Le moteur écrit chaque niveau reçu dans le
 * niveau de mip de même rang de sa couche et échantillonne la queue résidente sans rien recalculer.
 */
export interface TexturePreview {
  /** Rang dans le tableau `textures` de la scène préparée. */
  texture: number;
  /** Rang dans son tableau `images`, où se lit l'`uri` source quand il y en a une. */
  image: number;
  width: number;
  height: number;
  /** 0 quand les octets venaient d'une `uri` d'image, 1 quand ils venaient de `sourceBufferView`. */
  sourceKind: number;
  /** Vue de tampon de la scène préparée, ou -1 pour une source `uri`. */
  sourceBufferView: number;
  /** SHA-256 des octets sources décodés. */
  sha256: string;
  /** L'atlas que cette entrée sert : `PREVIEW_ATLAS_COLOR` ou `PREVIEW_ATLAS_DATA`. */
  atlas: number;
  /** Rang du premier niveau porté dans la chaîne de mips de la source ; 0 quand elle tient déjà
   *  sous `PREVIEW_BASE` et que le sidecar porte donc sa pleine résolution. */
  firstLevel: number;
  /** Niveaux cuits en fichiers dans le cache, du 0 au `bakedLevels - 1` ; `firstLevel` quand la
   *  chaîne est entière, 0 quand rien n'a été écrit et que le moteur charge l'image source. */
  bakedLevels: number;
  /** Les niveaux portés dans l'ordre, du plus fin au 1×1, chacun une vue sur les octets du sidecar. */
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
  /** Une entrée par (texture, atlas) décodée, triée par texture puis par atlas ; vide sans image
   *  décodable. */
  texturePreviews?: TexturePreview[];
  /** Le gabarit des niveaux cuits, relatif au manifeste : `{sha}` l'empreinte de l'image source,
   *  `{kind}` le nom de l'atlas (`PREVIEW_ATLAS_NAMES`), `{level}` le rang du niveau. Absent d'un
   *  cache compilé avant les niveaux cuits, que ce lecteur refuse par la version du sidecar. */
  textures?: { url: string };
  /** Où lire le proxy résident de la scène et son BVH : la géométrie que les rayons touchent.
   *  Absent d'un cache compilé avant le rebond, qui reste lisible tel quel. */
  proxy?: SceneProxyDescriptor;
}
