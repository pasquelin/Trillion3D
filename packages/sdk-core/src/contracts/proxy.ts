/**
 * The scene's proxy: format of the cache product that light rays and reflections hit (LC1).
 *
 * Nothing here names a scene. One proxy a compiled mesh, in the mesh's own space, built at compile time by
 * the builder the browser's run-time cuts go through: the compiler snaps the vertices of the mesh's coarse cut
 * onto a grid, discards what no longer has surface, and builds the tree. The engine places it where a node
 * does, by the node's live world — an instance is four words, however many nodes place the mesh.
 *
 * The BVH is wide: four children per node, boxes written on eight bits in the parent's exact
 * bounds and rounded outward, so a quantized box always contains what
 * it contained. The engine tests all four at once, descends on the nearest and stacks the
 * others: the same traversal bound covers four times more tree than a binary tree.
 */

export {
  PROXY_CHILD_WORDS,
  PROXY_CHILDREN,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
  SCENE_PROXY_HEADER_WORDS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
} from './writtenFormats.ts'

/** What poses a deformed placement's proxy from its rest shape: for each corner of the proxy's triangles, in
 *  triangle order and corner order, the vertex it was built from keeps its skin and its morph deltas
 *  (`world/page/runtimeDeform.ts`). A corner is `CORNER_INFLUENCES` joint ranks, as many weights, then the
 *  three deltas of each target: `8 + 3 × targets` floats. */
export interface CutDeformation {
  /** Morph targets of the mesh. */
  targets: number
  corners: Float32Array<ArrayBuffer>
}

/** Influences a posed corner keeps of its vertex: the four heaviest. */
export const CORNER_INFLUENCES = 4

/** A mesh's or a cut's proxy in its own space (`page-codec-wasm/src/proxy.rs` `columns_of`): the columns of
 *  a `proxy.bin`'s mesh, built by the compiler's builder, and the grid step taken. Read from the cache for a
 *  compiled mesh, held in memory by the primitive of a cut the world made at run time, never written to a
 *  manifest. */
export interface RuntimeCutProxy {
  /** Three vertices a triangle, `PROXY_TRIANGLE_FLOATS` numbers each. */ triangles: Float32Array<ArrayBuffer>
  /** Packed RGBA8 albedo of each triangle: a compiled mesh's material colour, white for a run-time cut's. */ albedo: Uint32Array<ArrayBuffer>
  /** Exact bounds of each wide node. */ nodeBounds: Float32Array<ArrayBuffer>
  /** The four children of each node. */ nodeChildren: Uint32Array<ArrayBuffer>
  /** The grid step the mesh was snapped to, in the mesh's units. */ cellMetres: number
  /** Present on a mesh that deforms: what poses it (`CutDeformation`). */ deform?: CutDeformation
}

/** The proxy's columns as its cache object carries them: one proxy a compiled primitive. */
export interface SceneProxyColumns {
  /** The proxy of each compiled primitive, in primitive order; a primitive no shown node places holds
   *  empty columns. */
  meshes: readonly RuntimeCutProxy[]
}

/**
 * What the manifest says of the proxy: where to read it, what it weighs and what it is
 * worth. It is a separate cache product, not a sidecar column: a manifest without it stays readable
 * word for word by an engine that ignores it, and its tens of megabytes do not delay the first
 * frame of a scene that declares no light.
 */
export interface SceneProxyDescriptor {
  /** Format version. */
  version: number
  /** Where it is read. */
  url: string
  /** Fingerprint of its bytes. */
  sha256: string
  /** Its size. */
  bytes: number
  /** Geometric error of the proxy in metres: that of the cut, plus that of simplification at the largest scale. */
  errorMetres: number
  /** Floor of the threshold: what the specification asks before the budget widens it. */
  errorFloorMetres: number
  /** Grid step that simplification took at the largest scale a mesh is placed at, in metres. */
  cellMetres: number
  /** Published triangle budget, the one that decided the threshold actually obtained. */
  triangleBudget: number
  /** World extent of the placements: three lower bounds then three upper. */
  bounds: [number, number, number, number, number, number]
  /** Triangles of all the meshes. */
  triangles: number
  /** Tree nodes of all the meshes. */
  nodes: number
  /** Meshes the table names: the compiled primitives. */
  meshes: number
}

/** The read proxy: its descriptor and its immutable columns, viewing the cache object's bytes. */
export interface SceneProxy extends SceneProxyDescriptor {
  /** Its columns. */
  data: SceneProxyColumns
}
