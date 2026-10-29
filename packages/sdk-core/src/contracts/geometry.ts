import type { DagReport, PrimitiveDagStall } from './dag.ts'
import type { AssetScope } from './base.ts'
import type { GeometryPageDescriptor, GeometryPageFormat } from '../page/contracts.ts'
import type { TexturePreview } from '../texture/previewContracts.ts'
import type { SoftBodyType } from '../physics/soft/soft.ts'

/** One cluster of a compiled model: a small piece of triangles the engine loads on its own. */
export interface Page {
  /** The cluster's number. */ id: number
  /** Where its bytes are read. */ url: string
  /** Fingerprint of its bytes. */ sha256: string
  /** Size of its bytes. */ bytes: number
  /** Triangles it holds. */ count: number
  /** Lowest corner of its box. */ min: number[]
  /** Highest corner of its box. */ max: number[]
  /** Full detail or coarse. */ role?: 'exact' | 'coarse'
  /** How its bytes are laid out. */ geometry?: GeometryPageDescriptor
  /** Offset of the earliest source index this page descends from. Restores a transparent draw order. */
  start?: number
  /** DAG cut, when the compiler emitted one. `lodError` is the object-space error of the group that
   *  produced this cluster, projected through `sphere`; `parentError` is the error of the group that
   *  replaces it, projected through `parentSphere`. Both are null on a root, which is never replaced. */
  level?: number
  /** Its simplification error. */ lodError?: number
  /** The ball its error is measured through. */ sphere?: number[]
  /** The error of what replaces it. */ parentError?: number | null
  /** The ball of what replaces it. */ parentSphere?: number[] | null
  /** Group that replaces this cluster (null on a root) and group that produced it (null at level 0).
   *  Coarsening is a group-wide swap, so a runtime short of memory needs both links. */
  group?: number | null
  /** The group that produced it. */ source?: number | null
  /** Streaming bundle holding this cluster and its byte offset inside it. One request serves dozens
   *  of clusters; the cluster stays readable on its own through `url`. */
  stream?: number
  /** Its byte offset in that bundle. */ streamOffset?: number
  /** Coplanar depth layer, 0 for every cluster the compiler left alone. A cluster of layer n draws
   *  with a depth bias of n whole layer steps, which is what decides the winner between two opaque
   *  surfaces that share a plane exactly. Absent and 0 mean the same thing: the untouched draw. */
  depthLayer?: number
}
/** An LOD sphere an error band is projected through — culling reads boxes —: four finite values,
 *  a radius of at least zero. Unrolled on purpose: it runs once per cluster at preparation, with no closure. */
export function clusterSphereValid(sphere: unknown): sphere is number[] {
  return (
    Array.isArray(sphere) &&
    sphere.length === 4 &&
    Number.isFinite(sphere[0]) &&
    Number.isFinite(sphere[1]) &&
    Number.isFinite(sphere[2]) &&
    Number.isFinite(sphere[3]) &&
    sphere[3] >= 0
  )
}
/** A cluster carrying its own screen-error band needs no hierarchy: selection is a flat per-page test. */
export function pageCarriesClusterError(page: Page) {
  return (
    typeof page.lodError === 'number' &&
    Number.isFinite(page.lodError) &&
    page.lodError >= 0 &&
    clusterSphereValid(page.sphere)
  )
}
/** Whether every page of a primitive carries its own error band. */
export function primitiveUsesClusterErrors(primitive: Pick<Primitive, 'pages'>) {
  return primitive.pages.length > 0 && primitive.pages.every(pageCarriesClusterError)
}
/** Flat culling hierarchy over a primitive's clusters. `stride` numbers per node, node 0 is the root:
 *  min[3], max[3], sphere[4], maxParentError (-1 when the subtree holds a cluster with no
 *  replacement), firstChild, childCount, firstPage, pageCount. A leaf has childCount 0. */
export interface CullingHierarchy {
  /** Numbers per node. */ stride: number
  /** How many nodes. */ count: number
  /** Every node's numbers, one after the other. */ nodes: number[]
}
/** One reduction of the cluster DAG. `children` and `outputs` cover the same surface, never both. */
export interface ClusterGroup {
  /** How many times it was simplified. */ level: number
  /** Its simplification error. */ error: number
  /** The ball its error is measured through. */ sphere: number[]
  /** The finer clusters it replaces. */ children: number[]
  /** The coarser clusters it makes. */ outputs: number[]
}
/** Group links of a primitive, plus the clusters that nothing replaces. */
export interface ClusterStructure {
  /** Format version. */ version: number
  /** Clusters nothing replaces. */ roots: number[]
  /** Every group. */ groups: ClusterGroup[]
}
/** A STREAMING PAGE: clusters read together in one request, installed, kept and dropped together
 *  — the unit of the runtime's residency (`sdk-browser/src/geometry/residency/queue.ts`). */
export interface StreamBundle {
  /** Where it is read; for a range of a geometry container, its name in the page catalogue: the
   *  container's address and its offset there. */ url: string
  /** A range of a geometry container: `bytes` of the file at `file`, from `offset`. */
  range?: { file: string; offset: number }
  /** Fingerprint of its bytes. */ sha256: string
  /** Its size. */ bytes: number
  /** Clusters it holds. */ count: number
  /** Every page of the groups holding its groups' outputs, closed up to the pinned root pages and
   *  ascending: it is installed after every one of them. */ dependencies: number[]
}
/** Streaming pages of a primitive (the compiler's page assignment, `compiler/pages/bundles.rs`):
 *  its groups from the coarsest, a group spreading over several pages. The first `pinned` are its
 *  root pages, 32 KiB and 64 clusters each — as many as its `alwaysResidentKib` asks, one at least —,
 *  holding its roots, so keeping them resident guarantees a complete, if coarse, cover of the
 *  primitive; the others hold 128 KiB and 256 clusters at most. */
export interface StreamCatalogue {
  /** Format version. */ version: number
  /** Root pages, always kept. */ pinned: number
  /** A streaming page's most bytes. */ bundleBytes: number
  /** Most pages one page lists directly, as the compiler measured them. */ dependencyBound: number
  /** Longest closed dependency list of a bundle, as the compiler published it. */ maxDependencies: number
  /** Every bundle. */ pages: StreamBundle[]
}
/** One mesh part of a compiled model, with its pages and hierarchy. */ export interface Primitive {
  /** Its mesh's number. */ mesh: number
  /** Its number in the mesh. */ primitive: number
  /** How it is drawn. */ pass: string
  /** How clusters were made. */ clusterStrategy?: 'dag-groups'
  /** Its clusters. */ pages: Page[]
  /** The DAG's report. */ dag?: DagReport | null
  /** Its culling tree. */ culling?: CullingHierarchy | null
  /** Its group links. */ structure?: ClusterStructure | null
  /** Its stream bundles. */ streams?: StreamCatalogue | null
  /** A primitive a world cut at run time: no compiler built its cards or its distance field. */
  runtime?: boolean
  /** The tree rays walk over its triangles, made where it was cut (`rayTracingTreeOf`): only on a run-time primitive of faces that does not deform. */
  rayTracing?: import('../lighting/rayTracingTree.ts').RayTracingTree
  /** Whether the material of a run-time primitive is double-sided: its distance field takes its triangles as two-sided, as a compiled mesh's (`Cut.doubleSided`). */
  doubleSided?: boolean
  /** A world's dynamic geometry: index pages alone, their vertices read as floats from the
   *  host geometry the engine rewrites in place. */
  dynamic?: boolean
  /** How far its deformation can move a vertex from its rest pose: per joint of its skin
   *  the ball of the vertices that joint moves, `[x, y, z, radius]` flat, and each morph target's
   *  largest displacement; `null` or absent on a primitive that does not deform. */
  deformation?: {
    joints: number[]
    targets: number[]
    softVertices?: number
    /** The soft body kind its node declares, when a soft body draws it (`drawnTwoSided`). */
    softKind?: SoftBodyType
  } | null
}
/** The manifest of a compiled model: its primitives, their pages and how it was made. */
export interface ClusterManifest {
  /** Cache format. */ formatVersion: number
  /** Compiler version. */ compilerVersion?: string
  /** How errors are measured. */ errorModel?: string
  /** The cluster page format of every `pages[].geometry`; absent from a cache without pages. */
  geometryPages?: GeometryPageFormat
  /** Whether meshes were simplified. */ simplification?: boolean
  /** The scene's temporal anti-aliasing level, only when its job named one (`TEMPORAL_AA_FIELD`):
   *  the runtime's `'scene'` setting. */
  temporalAntialiasing?: import('./compilerAbi.ts').TemporalAntialiasingLevel
  /** Compile outcome. */ status: string
  /** Cache key. */ key: string
  /** Full or streamed. */ scope: AssetScope
  /** How clusters were made. */ clusterStrategy?: string
  /** Triangles in the source. */ sourceTriangles: number
  /** Triangles kept. */ selectedTriangles: number
  /** Nodes kept. */ selectedNodes: number
  /** Nodes in all. */ totalNodes: number
  /** Its primitives. */ primitives: Primitive[]
  /** The compiler's stall table: at most ten primitives with a stalled group that kept level-0
   *  roots, worst first. Absent from a cache compiled before it. */
  worstStalls?: PrimitiveDagStall[]
  /** One entry per decoded (texture, atlas), sorted by texture then by atlas; empty without a
   *  decodable image. */
  texturePreviews?: TexturePreview[]
  /** The file holding the previews' RGBA8 tails when they are not in the head's sidecar: their
   *  `levels` then come from `fetchVerified` of it, only for a session that reads them. Absent
   *  from a cache that keeps them inline. */
  texturePreviewPixels?: { url: string; bytes: number; sha256: string }
  /** Template for baked levels, relative to manifest: {sha} the chain's fingerprint — its source
   *  image digest and the channels and cuts that decide its bytes —,
   *  {kind} the atlas name (PREVIEW_ATLAS_NAMES), {level} the level rank. Absent from a
   *  cache compiled before baked levels, which this reader rejects via sidecar version. `version`
   *  is the levels' (`TEXTURE_PREVIEW_VERSION`): a reader reads no level of another. */
  textures?: { url: string; version?: number }
  /** Where to read the scene's animation banks: the clips its instanced skinned objects play on
   *  the GPU (`../scene/core/animationBanks.ts`). Absent from a scene with none. */
  animationBanks?: AnimationBanksDescriptor
}

/** The manifest's entry of the scene's animation banks (`animation-banks.bin`): its address
 *  relative to the manifest, its version (`ANIMATION_BANKS_VERSION`), its length and digest, and
 *  how many items — tracks — it holds. */
export interface AnimationBanksDescriptor {
  url: string
  version: number
  bytes: number
  sha256: string
  items: number
}
