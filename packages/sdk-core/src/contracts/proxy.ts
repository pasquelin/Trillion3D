/**
 * The resident proxy: format of the cache product that light rays hit (LC1).
 *
 * Nothing here names a scene. The proxy is a coarse representation of all the geometry,
 * built at compile time, independent of the camera, with triangles of bounded size: the
 * compiler snaps vertices onto a grid, discards what no longer has surface and recuts what
 * remains too large, until it holds the triangle budget. This bounded size is also that
 * of a cell of the surface cache, which carries one value per triangle and per face.
 *
 * The BVH is wide: four children per node, boxes written on eight bits in the parent's exact
 * bounds and rounded outward, so a quantized box always contains what
 * it contained. The engine tests all four at once, descends on the nearest and stacks the
 * others: the same traversal bound covers four times more tree than a binary tree.
 */

/** Version of the "proxy" cache product. A proxy of another version is rejected, never guessed. */
export const SCENE_PROXY_VERSION = 2;
/** 'W','G','P','X' read as an unsigned 32-bit integer little-endian. */
export const SCENE_PROXY_MAGIC = 0x58504757;
/** Header integers: signature, version, triangles, nodes. */
export const SCENE_PROXY_HEADER_WORDS = 4;
/** Numbers per proxy triangle: three world vertices, no normal — it is deduced from the triangle. */
export const PROXY_TRIANGLE_FLOATS = 9;
/** Numbers per BVH node: its exact bounds, frame of its children's quantized boxes. */
export const PROXY_NODE_FLOATS = 6;
/** Children of a node: four boxes tested at once, the nearest kept for the rest. */
export const PROXY_CHILDREN = 4;
/** Integers per child: two words of quantized box and count, then the link. */
export const PROXY_CHILD_WORDS = 3;
/** Integers per node: its four children concatenated. */
export const PROXY_NODE_WORDS = PROXY_CHILDREN * PROXY_CHILD_WORDS;

/** Proxy columns, as its cache object carries them and the GPU copies them. */
export interface SceneProxyColumns {
  /** Three world vertices per triangle, `PROXY_TRIANGLE_FLOATS` numbers each. */
  triangles: Float32Array;
  /** Linear diffuse albedo of the triangle, packed RGBA8. */
  albedo: Uint32Array;
  /** Exact bounds of each BVH node. */
  nodeBounds: Float32Array;
  /** The four children of each node: quantized box, triangle count, presence, link. */
  nodeChildren: Uint32Array;
}

/**
 * What the manifest says of the resident proxy: where to read it, what it weighs and what it is
 * worth. It is a separate cache product, not a sidecar column: a manifest without it stays readable
 * word for word by an engine that ignores it, and its tens of megabytes do not delay the first
 * frame of a scene that declares no light.
 */
export interface SceneProxyDescriptor {
  /** Format version. */
  version: number;
  /** Where it is read. */
  url: string;
  /** Fingerprint of its bytes. */
  sha256: string;
  /** Its size. */
  bytes: number;
  /** Geometric error of the proxy in metres: that of the cut, plus that of simplification. */
  errorMetres: number;
  /** Floor of the threshold: what the specification asks before the budget widens it. */
  errorFloorMetres: number;
  /** Grid step that simplification took: the size of a triangle, hence of a cell. */
  cellMetres: number;
  /** Published triangle budget, the one that decided the threshold actually obtained. */
  triangleBudget: number;
  /** World extent of the proxy: three lower bounds then three upper. */
  bounds: [number, number, number, number, number, number];
  /** Triangles. */
  triangles: number;
  /** Tree nodes. */
  nodes: number;
}

/** The read proxy: its descriptor and its columns, views on the bytes of its cache object. */
export interface SceneProxy extends SceneProxyDescriptor {
  /** Its columns. */
  data: SceneProxyColumns;
}
